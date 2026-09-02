package domain

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"time"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/notify"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/store"
)

// The issue operations that are not about a single issue: the bulk edit, the recycle bin
// and the restore out of it, and the sub-issue rollup. The team's estimate scale is here
// too — it lives on the team row, but it is a decision about how that team's issues are
// estimated, and it is more use beside the estimate validation it governs than beside team
// renaming.

const (
	// maxBulkIssues bounds one bulk edit.
	//
	// The point of this path is that it takes the workspace version lock exactly once, and
	// that lock is the serialisation point of the whole sync engine: for as long as this
	// transaction runs, every other writer in the workspace waits behind it. An unbounded
	// selection — "select all" across a hundred thousand issues — would turn one careless
	// click into a workspace-wide stall that looks, from every other session, like the
	// product has hung. Five hundred is far above any selection a person assembles by hand
	// and far below where the lock hold time becomes noticeable.
	maxBulkIssues = 500

	// One reason for both "there is no such issue" and "there is, but not for you".
	//
	// They have to be the same string. A caller who can tell them apart can pass a list of
	// candidate uuids and read back which ones exist in the private teams they cannot see,
	// which is precisely the enumeration the not-found answers elsewhere in this package
	// exist to prevent.
	skipUnreachable = "no such issue, or you do not have access to it"

	// Statuses belong to one team, so a selection spanning teams cannot all move to one
	// status. Naming that is safe — the caller can already see these issues — and it is the
	// difference between "nothing happened" and "these eleven are in another team".
	skipStatusOtherTeam = "that status belongs to a different team"

	skipTeamRetired = "that issue's team is retired and read-only"
)

// BulkSkip is one id the caller asked for and did not get, with the reason.
//
// Skipping rather than failing is the entire design of this path. A selection of fifty
// issues that happens to include two the caller cannot reach should edit the forty-eight
// and say so: an all-or-nothing refusal leaves them with no way forward except to bisect
// their own selection to find the offending ids, which is exactly what this tells them.
type BulkSkip struct {
	ID     uuid.UUID
	Reason string
}

// BulkUpdateIssuesInput is one property change applied across a selection.
//
// Deliberately narrower than UpdateIssueInput: no title, no description, and no reordering.
// Those are edits to one issue by definition — there is no single new sort key for two
// hundred rows — and leaving them out is what lets the whole thing be one statement.
type BulkUpdateIssuesInput struct {
	IDs []uuid.UUID

	StateID *uuid.UUID

	AssigneeID    *uuid.UUID
	ClearAssignee bool

	Priority *int

	Estimate      *int
	ClearEstimate bool

	DueDate      *model.Date
	ClearDueDate bool

	// AddLabelIDs and RemoveLabelIDs are set operations, not a replacement: a bulk edit
	// says "put this label on all of these" and "take that one off all of these", because
	// there is no single new label set for two hundred rows any more than there is a
	// single new title.
	AddLabelIDs    []uuid.UUID
	RemoveLabelIDs []uuid.UUID
}

// BulkUpdateIssues applies one change to many issues in one transaction and one version
// block.
//
// The version block is the reason this exists rather than being a loop over UpdateIssue.
// Emit reserves a run of versions with a single row lock on the workspace; N calls take that
// lock N times, mint N versions, and send N wakeups to every connected client — so a bulk
// edit of two hundred issues becomes two hundred serialised transactions that every other
// writer queues behind, and two hundred deltas the receiving clients apply one render at a
// time. One block is one lock, one wakeup and one frame.
//
// Issues the caller cannot reach are skipped with a reason rather than failing the call.
func (s *Service) BulkUpdateIssues(
	ctx context.Context, p *authz.Principal, in BulkUpdateIssuesInput,
) ([]model.Issue, []BulkSkip, int64, error) {
	if len(in.IDs) == 0 {
		return nil, nil, 0, platform.Validation("ids", "select at least one issue")
	}
	if len(in.IDs) > maxBulkIssues {
		return nil, nil, 0, platform.Validation("ids",
			fmt.Sprintf("a bulk edit covers at most %d issues at a time", maxBulkIssues))
	}
	if in.Priority != nil && (*in.Priority < 0 || *in.Priority > 4) {
		return nil, nil, 0, platform.Validation("priority", "priority must be 0 (none) to 4 (low)")
	}
	if in.AssigneeID != nil && in.ClearAssignee {
		return nil, nil, 0, platform.Validation("assigneeId", "cannot set and clear the assignee in one call")
	}
	if in.Estimate != nil && in.ClearEstimate {
		return nil, nil, 0, platform.Validation("estimate", "cannot set and clear the estimate in one call")
	}
	if in.DueDate != nil && in.ClearDueDate {
		return nil, nil, 0, platform.Validation("dueDate", "cannot set and clear the due date in one call")
	}
	if in.StateID == nil && in.AssigneeID == nil && !in.ClearAssignee && in.Priority == nil &&
		in.Estimate == nil && !in.ClearEstimate && in.DueDate == nil && !in.ClearDueDate &&
		len(in.AddLabelIDs) == 0 && len(in.RemoveLabelIDs) == 0 {
		// Otherwise this writes every selected row, bumps the version and wakes every
		// client to deliver a change that changed nothing.
		return nil, nil, 0, platform.Validation("input", "a bulk edit needs at least one property to change")
	}
	// Adding and removing the same label in one edit has no defensible outcome, and the
	// two statements below would race to decide it.
	for _, add := range in.AddLabelIDs {
		if slices.Contains(in.RemoveLabelIDs, add) {
			return nil, nil, 0, platform.Validation("addLabelIds",
				"cannot add and remove the same label in one call")
		}
	}
	estimate, err := validateEstimate(in.Estimate)
	if err != nil {
		return nil, nil, 0, err
	}
	dueDay, hasDueDate, err := parseDueDate(in.DueDate)
	if err != nil {
		return nil, nil, 0, err
	}

	out := []model.Issue{}
	skipped := []BulkSkip{}
	var version int64

	err = s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		var newState *store.WorkflowState
		if in.StateID != nil {
			st, err := q.GetWorkflowState(ctx, *in.StateID)
			if err != nil {
				if store.IsNotFound(err) {
					return platform.Validation("stateId", "no such status")
				}
				return platform.Internal(err)
			}
			newState = &st
		}

		teams := map[uuid.UUID]store.Team{}
		assigneeChecked := map[uuid.UUID]bool{}
		seen := map[uuid.UUID]bool{}
		before := make([]store.GetIssueRow, 0, len(in.IDs))

		// One point read per id. These are primary-key lookups inside a transaction that
		// holds no contended lock yet — the version lock is not taken until Emit — and they
		// buy the two things the single statement below cannot give: a precise reason for
		// each skip, and the before-values the activity feed needs. It is the writes that
		// must not be N, not the reads.
		for _, id := range in.IDs {
			if seen[id] {
				// A repeated id would otherwise produce two change rows for one issue, and
				// a client applying the second would re-render a row it had just settled.
				continue
			}
			seen[id] = true

			row, err := q.GetIssue(ctx, id)
			if err != nil {
				if store.IsNotFound(err) {
					skipped = append(skipped, BulkSkip{ID: id, Reason: skipUnreachable})
					continue
				}
				return platform.Internal(err)
			}
			// Membership is the whole test for issue.update, so this is CanInTeam inlined
			// rather than requireTeamAccess: that helper answers with an error, and here a
			// team the caller cannot reach has to become a skip instead.
			if row.WorkspaceID != p.WorkspaceID || !authz.CanInTeam(p, authz.ActionIssueUpdate, row.TeamID, false) {
				skipped = append(skipped, BulkSkip{ID: id, Reason: skipUnreachable})
				continue
			}

			team, ok := teams[row.TeamID]
			if !ok {
				team, err = q.GetTeam(ctx, row.TeamID)
				if err != nil {
					return platform.Internal(err)
				}
				teams[row.TeamID] = team
			}
			if team.RetiredAt != nil {
				skipped = append(skipped, BulkSkip{ID: id, Reason: skipTeamRetired})
				continue
			}
			if newState != nil && newState.TeamID != row.TeamID {
				// Without this the statement would happily point an issue at a status
				// belonging to another team, which no view can render and no transition
				// rule can reason about.
				skipped = append(skipped, BulkSkip{ID: id, Reason: skipStatusOtherTeam})
				continue
			}
			// An assignee who cannot see the issue is a property of the edit, not of one
			// issue: applying it to some of the selection and refusing the rest would leave
			// the caller unable to say which. So this fails the call, where reach fails one
			// row. Checked once per team, since that is what the rule depends on.
			if in.AssigneeID != nil && !assigneeChecked[row.TeamID] {
				if err := s.validateAssignee(ctx, q, p, row.TeamID, in.AssigneeID); err != nil {
					return err
				}
				assigneeChecked[row.TeamID] = true
			}

			before = append(before, row)
		}

		if len(before) == 0 {
			// Version 0 rather than the workspace's current version, and deliberately: the
			// client uses it to decide how long to hold its optimistic state, and there is
			// no delta coming for it to wait for.
			return nil
		}

		// Both lists are built from the rows that survived the loop above, so the statement
		// re-states the decision rather than inheriting it. The team filter is redundant
		// given the ids — and is there precisely because it is: a future edit that widened
		// the id list without re-reading this comment would still not be able to write into
		// a team the caller was never allowed to touch.
		ids := make([]uuid.UUID, 0, len(before))
		eligibleTeams := map[uuid.UUID]bool{}
		teamIDs := make([]uuid.UUID, 0, len(teams))
		for _, row := range before {
			ids = append(ids, row.ID)
			if !eligibleTeams[row.TeamID] {
				eligibleTeams[row.TeamID] = true
				teamIDs = append(teamIDs, row.TeamID)
			}
		}

		// The labels this edit adds, resolved once for the whole batch. Scope is a
		// property of the edit rather than of one row — a team label aimed at a selection
		// spanning two teams cannot be applied to half of it and reported as a success —
		// so a label out of scope fails the call the way a bad assignee does.
		addLabels, err := s.resolveBulkAddLabels(ctx, q, p, in.AddLabelIDs, teamIDs)
		if err != nil {
			return err
		}

		var (
			setTimestamps bool
			started       *time.Time
			completed     *time.Time
			canceled      *time.Time
		)
		if newState != nil {
			setTimestamps = true
			// The statement COALESCEs started_at against itself, so this is the value used
			// only where there is none yet — the "never cleared once set" rule, expressed in
			// SQL because expressing it in Go would need a lock per row.
			started = startedAtFor(newState.Category, nil)
			completed = completedAtFor(newState.Category)
			canceled = canceledAtFor(newState.Category)
		}

		var priority *int16
		if in.Priority != nil {
			v := int16(*in.Priority)
			priority = &v
		}

		params := store.BulkUpdateIssuesParams{
			StateID:       in.StateID,
			Priority:      priority,
			ClearAssignee: in.ClearAssignee,
			AssigneeID:    in.AssigneeID,
			ClearEstimate: in.ClearEstimate,
			Estimate:      estimate,
			ClearDueDate:  in.ClearDueDate,
			SetTimestamps: setTimestamps,
			StartedAt:     started,
			CompletedAt:   completed,
			CanceledAt:    canceled,
			Ids:           ids,
			WorkspaceID:   p.WorkspaceID,
			TeamIds:       teamIDs,
		}
		if hasDueDate {
			params.DueDate = store.DateOf(dueDay)
		}

		// A label-only edit does not write the issue row. Running the statement anyway
		// would move every selected issue's updated_at, which is the sort key of My
		// Issues and of every "recently updated" view — so putting one label on two
		// hundred issues would reorder somebody's whole screen for a change that did not
		// touch the issue at all.
		var rows []store.BulkUpdateIssuesRow
		if bulkTouchesTheIssueRow(in) {
			rows, err = q.BulkUpdateIssues(ctx, params)
			if err != nil {
				return platform.Internal(err)
			}
		} else {
			rows = make([]store.BulkUpdateIssuesRow, 0, len(before))
			for _, row := range before {
				rows = append(rows, store.BulkUpdateIssuesRow(row))
			}
		}

		beforeByID := make(map[uuid.UUID]store.GetIssueRow, len(before))
		for _, row := range before {
			beforeByID[row.ID] = row
		}

		// What this edit set, the same for every row in it — which is what a bulk edit is.
		// It has to be recorded rather than left empty: an empty list means "create" to the
		// notification engine, and a bulk status change reported as two hundred creations
		// would mention, assign and re-announce every one of them.
		fields := bulkChangedFields(in)

		changes := make([]Change, 0, len(rows))
		for _, row := range rows {
			team := teams[row.TeamID]
			issue := toIssue(store.AsIssueRow(row), team.Key)
			out = append(out, issue)
			if !bulkTouchesTheIssueRow(in) {
				// Nothing on the row changed, so there is nothing for a client to apply
				// and no reason to re-render every selected issue. The label rows below
				// carry the edit.
				continue
			}
			changes = append(changes, Change{
				EntityType: "issue", EntityID: row.ID, Op: OpUpsert, TeamID: &row.TeamID,
				Scope: authz.TeamScope(row.TeamID, team.Private), Payload: issue,
				ChangedFields: fields,
			})
		}

		labelChanges, err := s.applyBulkLabels(ctx, q, p, ids, teams, before, addLabels, in.RemoveLabelIDs)
		if err != nil {
			return err
		}
		changes = append(changes, labelChanges...)

		// One call, one block of versions, one wakeup. This is the line the whole method
		// exists for.
		if version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), changes...); err != nil {
			return err
		}

		// The feed still gets one entry per issue. An issue whose status changed in a bulk
		// edit and shows nothing in its own history is indistinguishable, to the person
		// reading it, from one that changed by itself.
		stateNames := map[uuid.UUID]string{}
		for _, row := range rows {
			entries, err := bulkHistoryEntries(ctx, q, beforeByID[row.ID], store.AsIssueRow(row), stateNames)
			if err != nil {
				return err
			}
			if err := s.em.History(ctx, q, p.WorkspaceID, p.Actor(),
				beforeByID[row.ID].CreatedAt, entries...); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		// Exactly as AddIssueLabel does it: the conflict cannot be explained inside the
		// transaction that raised it, because every further statement on that connection
		// fails until the rollback.
		var conflict errLabelGroupConflict
		if errors.As(err, &conflict) {
			return nil, nil, 0, s.explainGroupConflict(ctx, conflict)
		}
		return nil, nil, 0, err
	}
	return out, skipped, version, nil
}

// bulkTouchesTheIssueRow reports whether this edit changes a column on `issue`.
//
// A label lives in its own table and on its own entity in the change stream, so an edit
// that only moves labels must leave the issue row — and its updated_at — alone.
func bulkTouchesTheIssueRow(in BulkUpdateIssuesInput) bool {
	return in.StateID != nil || in.AssigneeID != nil || in.ClearAssignee ||
		in.Priority != nil || in.Estimate != nil || in.ClearEstimate ||
		in.DueDate != nil || in.ClearDueDate
}

// resolveBulkAddLabels reads each label the edit applies and refuses the ones it cannot.
//
// The checks are the ones explainApplyFailure makes for a single application, moved in
// front of the write because the bulk statement's ON CONFLICT DO NOTHING would otherwise
// turn "that label belongs to another team" into a silent no-op — which is the shape of
// the bug this whole finding is about.
func (s *Service) resolveBulkAddLabels(
	ctx context.Context, q *store.Queries, p *authz.Principal, ids []uuid.UUID, teamIDs []uuid.UUID,
) ([]store.GetLabelRow, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	out := make([]store.GetLabelRow, 0, len(ids))
	seen := map[uuid.UUID]bool{}
	for _, id := range ids {
		if seen[id] {
			continue
		}
		seen[id] = true

		lbl, err := s.loadLabel(ctx, q, p, id)
		if err != nil {
			if platform.CodeOf(err) == platform.CodeNotFound {
				return nil, platform.Validation("addLabelIds", "no such label")
			}
			return nil, err
		}
		if lbl.IsGroup {
			return nil, platform.Validation("addLabelIds", fmt.Sprintf(
				"%q is a group — apply one of the labels inside it", lbl.Name))
		}
		if lbl.TeamID != nil {
			for _, teamID := range teamIDs {
				if *lbl.TeamID != teamID {
					return nil, platform.Validation("addLabelIds", fmt.Sprintf(
						"%q belongs to another team and cannot be applied to this selection", lbl.Name))
				}
			}
		}
		out = append(out, lbl)
	}
	return out, nil
}

// applyBulkLabels writes both set operations and returns their change rows.
//
// Two statements for the whole batch rather than two per issue, which is the same reason
// BulkUpdateIssues exists: the version block is taken once, so the writes must be too.
//
// The rows each statement RETURNS are the ones it actually changed — labels already
// present produce nothing, labels not present remove nothing — so the change stream
// carries the real edit rather than the requested one, and a client re-renders only what
// moved.
func (s *Service) applyBulkLabels(
	ctx context.Context, q *store.Queries, p *authz.Principal,
	issueIDs []uuid.UUID, teams map[uuid.UUID]store.Team, before []store.GetIssueRow,
	add []store.GetLabelRow, remove []uuid.UUID,
) ([]Change, error) {
	if len(add) == 0 && len(remove) == 0 {
		return nil, nil
	}

	// The change row's scope comes from the ISSUE's team, never the label's: a workspace
	// label applied to a private team's issue must not be visible outside that team, and
	// the scope is the only thing the hub consults.
	teamOf := make(map[uuid.UUID]uuid.UUID, len(before))
	for _, row := range before {
		teamOf[row.ID] = row.TeamID
	}
	scopeFor := func(issueID uuid.UUID) (uuid.UUID, authz.Scope) {
		teamID := teamOf[issueID]
		return teamID, authz.TeamScope(teamID, teams[teamID].Private)
	}

	changes := []Change{}

	if len(add) > 0 {
		// The cross product, expanded here because ids are minted in Go everywhere else
		// in the system and the bulk path must not be the one place they are not.
		pairIDs := make([]uuid.UUID, 0, len(issueIDs)*len(add))
		pairIssues := make([]uuid.UUID, 0, len(issueIDs)*len(add))
		pairLabels := make([]uuid.UUID, 0, len(issueIDs)*len(add))
		for _, issueID := range issueIDs {
			for _, lbl := range add {
				id, err := uuid.NewV7()
				if err != nil {
					return nil, platform.Internal(err)
				}
				pairIDs = append(pairIDs, id)
				pairIssues = append(pairIssues, issueID)
				pairLabels = append(pairLabels, lbl.ID)
			}
		}
		rows, err := q.BulkAddIssueLabels(ctx, store.BulkAddIssueLabelsParams{
			WorkspaceID: p.WorkspaceID,
			CreatedBy:   &p.UserID,
			Ids:         pairIDs,
			IssueIds:    pairIssues,
			LabelIds:    pairLabels,
		})
		if err != nil {
			// One statement covers many issues, so the conflict cannot name the row it
			// hit; the group is what the caller can act on either way.
			if store.IsUniqueViolation(err, "issue_label_one_per_group") && len(add) > 0 && add[0].ParentID != nil {
				return nil, errLabelGroupConflict{issueID: issueIDs[0], groupID: *add[0].ParentID}
			}
			return nil, platform.Internal(err)
		}
		for _, row := range rows {
			teamID, scope := scopeFor(row.IssueID)
			applied := toIssueLabel(row)
			changes = append(changes, Change{
				EntityType: "issueLabel", EntityID: applied.ID, Op: OpUpsert,
				TeamID: &teamID, Scope: scope, Payload: applied,
			})
		}
	}

	if len(remove) > 0 {
		rows, err := q.BulkRemoveIssueLabels(ctx, store.BulkRemoveIssueLabelsParams{
			IssueIds: issueIDs,
			LabelIds: remove,
		})
		if err != nil {
			return nil, platform.Internal(err)
		}
		for _, row := range rows {
			teamID, scope := scopeFor(row.IssueID)
			changes = append(changes, Change{
				EntityType: "issueLabel", EntityID: row.ID, Op: OpDelete,
				TeamID: &teamID, Scope: scope,
			})
		}
	}

	return changes, nil
}

// bulkChangedFields names the columns this edit set, by the vocabulary internal/notify
// matches on.
//
// Built from the input rather than by diffing each row's before and after, deliberately.
// A diff would call nothing changed where a bulk edit wrote the value a row already held —
// which is true of the row and false of the action, and the person who set fifty issues to
// Done is entitled to have that be one thing that happened rather than forty-one.
func bulkChangedFields(in BulkUpdateIssuesInput) []string {
	fields := make([]string, 0, 5)
	if in.StateID != nil {
		fields = append(fields, notify.FieldState)
	}
	if in.AssigneeID != nil || in.ClearAssignee {
		fields = append(fields, notify.FieldAssignee)
	}
	if in.Priority != nil {
		fields = append(fields, notify.FieldPriority)
	}
	if in.Estimate != nil || in.ClearEstimate {
		fields = append(fields, notify.FieldEstimate)
	}
	if in.DueDate != nil || in.ClearDueDate {
		fields = append(fields, notify.FieldDueDate)
	}
	return fields
}

// bulkHistoryEntries diffs one issue's before and after, for the properties a bulk edit can
// touch. Status names are memoised across the batch: a selection of two hundred issues
// moving between the same two columns would otherwise read the same two rows four hundred
// times.
func bulkHistoryEntries(
	ctx context.Context, q *store.Queries, before, after store.GetIssueRow, names map[uuid.UUID]string,
) ([]HistoryEntry, error) {
	var entries []HistoryEntry

	if before.StateID != after.StateID {
		from, err := workflowStateName(ctx, q, names, before.StateID)
		if err != nil {
			return nil, err
		}
		to, err := workflowStateName(ctx, q, names, after.StateID)
		if err != nil {
			return nil, err
		}
		entries = append(entries, HistoryEntry{
			IssueID: after.ID, Kind: "state", FromValue: from, ToValue: to,
		})
	}
	if !equalUUIDPtr(before.AssigneeID, after.AssigneeID) {
		entries = append(entries, HistoryEntry{
			IssueID: after.ID, Kind: "assignee", FromValue: before.AssigneeID, ToValue: after.AssigneeID,
		})
	}
	if before.Priority != after.Priority {
		entries = append(entries, HistoryEntry{
			IssueID: after.ID, Kind: "priority",
			FromValue: int(before.Priority), ToValue: int(after.Priority),
		})
	}
	if !equalIntPtr(intFromEstimate(before.Estimate), intFromEstimate(after.Estimate)) {
		entries = append(entries, HistoryEntry{
			IssueID: after.ID, Kind: "estimate",
			FromValue: intFromEstimate(before.Estimate), ToValue: intFromEstimate(after.Estimate),
		})
	}
	if !equalDatePtr(dueDateOf(before), dueDateOf(after)) {
		entries = append(entries, HistoryEntry{
			IssueID: after.ID, Kind: "due_date",
			FromValue: dueDateOf(before), ToValue: dueDateOf(after),
		})
	}
	return entries, nil
}

func workflowStateName(
	ctx context.Context, q *store.Queries, names map[uuid.UUID]string, id uuid.UUID,
) (string, error) {
	if name, ok := names[id]; ok {
		return name, nil
	}
	st, err := q.GetWorkflowState(ctx, id)
	if err != nil {
		return "", platform.Internal(err)
	}
	names[id] = st.Name
	return st.Name, nil
}

// IssueRestoreWindow is how long a soft-deleted issue can be brought back.
//
// Thirty days, and the number is not free. DeleteIssue already promises a 30-day recovery
// window and the purge job hard-deletes on that schedule, so a longer window here would
// offer to restore rows that are no longer there — a button that fails for reasons the user
// cannot see. It is also exactly ChangeLogRetention, which means a restore can never be
// older than the deltas a resuming client is still able to read: nobody is handed back an
// issue whose deletion their replica never saw.
const IssueRestoreWindow = 30 * 24 * time.Hour

// RestoreIssue brings a soft-deleted issue back, inside the recovery window.
//
// It republishes the issue's contents as well as the issue, and that is the interesting
// part. A soft delete is an UPDATE, so Postgres never dropped a single comment, label,
// relation or subscription — but the delete reached every client as one change row for the
// issue, and the client's own cascade (Store.forget in web/src/store/store.ts) then threw
// away everything hanging off it. That cascade is right and is what keeps a delete cheap:
// re-sending a delete per comment would be enormous. The consequence is that the restore
// owes those rows back. Sending only the issue leaves a replica that applied every change
// from version N in a different state from one that bootstrapped at version N — the issue
// present with an empty thread and no links — which is the one invariant the change stream
// exists to hold, and it fails silently in both directions until somebody re-bootstraps.
//
// The trade is volume: an issue with five hundred comments restores into five hundred and
// one change rows, in one version block, under the workspace's version lock. That is
// accepted rather than overlooked. A restore is a rare, deliberate act on one issue, the
// rows are small, and the alternative — a "resync this issue" hint the client would have to
// act on — is a second protocol for a case the existing one already expresses.
//
// Each republished row carries its own scope, taken from the same place its original write
// took it: comments and applications are team-scoped, relations carry both ends, and a
// subscription is scoped to the one person it belongs to. Anything else and the rows arrive
// at the wrong replicas, which for a subscription would mean handing a team a list of who is
// watching what.
func (s *Service) RestoreIssue(
	ctx context.Context, p *authz.Principal, id uuid.UUID,
) (model.Issue, int64, error) {
	var out model.Issue
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		cutoff := time.Now().Add(-IssueRestoreWindow)

		// The write runs before the permission check, which reads backwards but is the only
		// order available: every issue read in this schema filters deleted_at IS NULL, so
		// until the row is restored there is nothing that will tell us which team it belongs
		// to. The transaction is what makes it safe — a caller who may not touch this issue
		// leaves with an error and the row still deleted, having learned nothing.
		row, err := q.RestoreIssue(ctx, store.RestoreIssueParams{ID: id, DeletedAfter: &cutoff})
		if err != nil {
			if store.IsNotFound(err) {
				// Never deleted, already restored, or past the window: one answer for all
				// three, because saying which would confirm to somebody outside the team
				// that the issue exists.
				return platform.NotFound("issue")
			}
			return platform.Internal(err)
		}

		// Restoring is the inverse of deleting, so it takes the same permission.
		team, err := s.requireTeamAccess(ctx, q, p, row.TeamID, authz.ActionIssueDelete)
		if err != nil {
			return err
		}
		out = toIssue(store.AsIssueRow(row), team.Key)

		change := Change{
			EntityType: "issue", EntityID: id, Op: OpUpsert, TeamID: &row.TeamID,
			Scope: authz.TeamScope(row.TeamID, team.Private), Payload: out,
			// The deletion is what moved, and naming it is what stops a restore reading as a
			// creation: an empty list would re-notify the assignee, re-fire every mention in
			// the description, and tell the whole thread about a comment written last week.
			ChangedFields: []string{notify.FieldDeleted},
		}
		changes := []Change{change}

		if row.ArchivedAt != nil {
			// It was archived before it was deleted, and archived issues are never cached
			// by a client. Upserting it would put a row into every replica that the next
			// bootstrap would then drop again, which reads as an issue appearing and
			// vanishing for no reason. A delete leaves the replicas where they already are,
			// and it is what a bootstrap taken a moment later agrees with, because the
			// snapshot excludes archived issues.
			//
			// The contents are not republished for the same reason: they would be rows
			// pointing at an issue no replica holds, and the bootstrap's own joins exclude
			// every one of them while the issue is archived.
			changes[0].Op = OpDelete
			changes[0].Payload = nil
		} else {
			contents, err := restoredIssueContents(ctx, q, p.WorkspaceID, store.AsIssueRow(row), team.Private)
			if err != nil {
				return err
			}
			changes = append(changes, contents...)
		}

		if version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), changes...); err != nil {
			return err
		}
		return s.em.History(ctx, q, p.WorkspaceID, p.Actor(), row.CreatedAt,
			HistoryEntry{IssueID: id, Kind: "restored"})
	})
	return out, version, err
}

// restoredIssueContents is everything a replica threw away when the issue's delete arrived,
// as the changes that put it back.
//
// The seven collections are exactly the seven the client's cascade removes for an issue, and
// each is read with the same predicate the bootstrap uses for it, so a replica that applies
// these lands on the same rows a snapshot taken immediately afterwards would contain. That
// agreement is the whole point, and it is why the relations come from a query with the
// bootstrap's joins rather than from the two plain listings the issue panel uses: those
// return links whose far end is archived or deleted, which the snapshot leaves out.
//
// Notifications and favourites were the last two to arrive, and they arrived because the
// snapshot changed underneath this function. While the bootstrap carried neither,
// republishing them would not have closed a divergence but created one in the other
// direction; now that it carries both, not republishing them is the divergence — the
// cascade takes the stars off the issue and the inbox rows about it, and only this puts them
// back. A list that is a subset of the client's cascade is silently wrong in exactly the way
// this whole file exists to prevent, so the two have to be read together.
//
// The volume trade is the one stated above, taken again and larger: a much-discussed issue
// carries an inbox row per recipient per event, so the change block a restore mints is
// proportional to the conversation rather than to the issue. It is still one deliberate act
// on one issue, and the alternative is a replica whose inbox quietly disagrees with the
// server's until something forces a re-bootstrap.
func restoredIssueContents(
	ctx context.Context, q *store.Queries, workspaceID uuid.UUID, issue store.GetIssueRow, private bool,
) ([]Change, error) {
	scope := authz.TeamScope(issue.TeamID, private)
	teamID := issue.TeamID
	var changes []Change

	// Every one of these carries notify.FieldDeleted, and that is load-bearing rather than
	// tidy. The notification engine reads ChangedFields to decide what a change means, and
	// both of the readings it would otherwise take here are wrong:
	//
	//   - an EMPTY list means "created". A republished comment would then tell the whole
	//     thread that something was said, and a republished relation would tell everybody
	//     watching the far issue that it has just been blocked — for a comment written and
	//     a link made weeks ago.
	//   - notify.FieldBody, the honest-looking choice for a comment, re-fires every mention
	//     in it. Restoring an issue with a long thread would notify everybody named anywhere
	//     in it, and they would have no way to tell why.
	//
	// FieldDeleted is true of all of them: the deletion is the only thing that moved, and it
	// moved back. No rule in internal/notify matches it for any of these entity types, so
	// the rows reach the replicas and nobody's inbox.
	restored := []string{notify.FieldDeleted}

	comments, err := q.ListCommentsForIssue(ctx, issue.ID)
	if err != nil {
		return nil, platform.Internal(err)
	}
	for _, c := range comments {
		changes = append(changes, Change{
			EntityType: "comment", EntityID: c.ID, Op: OpUpsert, TeamID: &teamID,
			Scope: scope, Payload: toComment(c), ChangedFields: restored,
		})
	}

	attachments, err := q.ListAttachmentsForIssue(ctx, issue.ID)
	if err != nil {
		return nil, platform.Internal(err)
	}
	for _, a := range attachments {
		changes = append(changes, Change{
			EntityType: "attachment", EntityID: a.ID, Op: OpUpsert, TeamID: &teamID,
			Scope: scope, Payload: toAttachment(a), ChangedFields: restored,
		})
	}

	applications, err := q.ListIssueLabels(ctx, issue.ID)
	if err != nil {
		return nil, platform.Internal(err)
	}
	for _, a := range applications {
		changes = append(changes, Change{
			EntityType: "issueLabel", EntityID: a.ID, Op: OpUpsert, TeamID: &teamID,
			Scope: scope, Payload: toIssueLabel(a), ChangedFields: restored,
		})
	}

	relations, err := q.ListLiveIssueRelationsForIssue(ctx, issue.ID)
	if err != nil {
		return nil, platform.Internal(err)
	}
	for _, r := range relations {
		changes = append(changes, Change{
			EntityType: "issueRelation", EntityID: r.ID, Op: OpUpsert,
			// No single team owns a link, so the team key stays unset and the scope names
			// both ends — the same shape CreateIssueRelation writes, and the reason the two
			// team ids are denormalised onto the row.
			TeamID: nil, Scope: relationScope(r.TeamID, r.RelatedTeamID),
			Payload: toIssueRelation(r), ChangedFields: restored,
		})
	}

	subscriptions, err := q.ListIssueSubscriptionsForIssues(ctx, store.ListIssueSubscriptionsForIssuesParams{
		IssueIds:    []uuid.UUID{issue.ID},
		WorkspaceID: workspaceID,
		TeamIds:     []uuid.UUID{issue.TeamID},
	})
	if err != nil {
		return nil, platform.Internal(err)
	}
	for _, sub := range subscriptions {
		changes = append(changes, Change{
			EntityType: "issueSubscription", EntityID: sub.ID, Op: OpUpsert,
			// One person's row and nobody else's. A team scope here would put everybody's
			// watch list in every teammate's replica.
			Scope: authz.UserScope(sub.UserID), Payload: toIssueSubscription(sub),
			ChangedFields: restored,
		})
	}

	notifications, err := q.ListNotificationsForIssue(ctx, store.ListNotificationsForIssueParams{
		IssueID:     &issue.ID,
		WorkspaceID: workspaceID,
	})
	if err != nil {
		return nil, platform.Internal(err)
	}
	for _, n := range notifications {
		changes = append(changes, Change{
			EntityType: "notification", EntityID: n.ID, Op: OpUpsert,
			// The recipient's, like the subscription above. internal/notify refuses to fan out
			// a change about a notification at all, so these carry no risk of telling anybody
			// again about something they were told weeks ago.
			Scope: authz.UserScope(n.UserID), Payload: toNotification(n),
			ChangedFields: restored,
		})
	}

	favorites, err := q.ListFavoritesForTarget(ctx, store.ListFavoritesForTargetParams{
		WorkspaceID: workspaceID,
		Kind:        model.FavoriteIssue,
		TargetID:    issue.ID,
	})
	if err != nil {
		return nil, platform.Internal(err)
	}
	// Not filtered by who can still see the issue, and that is not an oversight.
	//
	// It was raised as one: a favourite republished to somebody who has since left the
	// issue's team lands in a replica that does not hold the issue. What arrives there is an
	// id and a kind — no title, no description, nothing about the issue at all — and
	// `favoriteLinks` in web/src/app/AppShell.tsx drops a favourite whose target is not in
	// the replica rather than rendering a row with a blank name, naming this exact case in
	// its own comment. The same is true of the subscription above: it carries a user id, an
	// issue id and a flag, and nothing renders it outside a screen that needs the issue.
	//
	// Filtering here would mean resolving each recipient's team membership inside the
	// restore transaction to suppress a row that is already inert, and getting it wrong in
	// the other direction — dropping a favourite from somebody who CAN see the issue — would
	// silently lose a star nobody could explain.
	for _, fav := range favorites {
		changes = append(changes, Change{
			// Only the issue kind: a favourite is dropped when the replica forgets the row it
			// points at, and the only thing of a favouritable kind that a deleted issue takes
			// with it is the issue. Its comments and applications are forgotten too, and
			// nobody can star one of those.
			EntityType: "favorite", EntityID: fav.ID, Op: OpUpsert,
			Scope: authz.UserScope(fav.UserID), Payload: toFavorite(fav),
			ChangedFields: restored,
		})
	}

	return changes, nil
}

// ListDeletedIssues is the recycle bin: what this caller could still bring back.
//
// The window is the same constant RestoreIssue enforces, and it has to be. A screen that
// lists an issue whose restore button then answers "not found" is worse than one that never
// showed it.
func (s *Service) ListDeletedIssues(ctx context.Context, p *authz.Principal) ([]model.Issue, error) {
	teamIDs := p.Teams.IDs()
	if len(teamIDs) == 0 {
		return []model.Issue{}, nil
	}

	q := s.db.Queries()
	cutoff := time.Now().Add(-IssueRestoreWindow)
	rows, err := q.ListDeletedIssues(ctx, store.ListDeletedIssuesParams{
		WorkspaceID:  p.WorkspaceID,
		TeamIds:      teamIDs,
		DeletedAfter: &cutoff,
	})
	if err != nil {
		return nil, platform.Internal(err)
	}

	keys, err := teamKeys(ctx, q, p.WorkspaceID)
	if err != nil {
		return nil, err
	}

	out := make([]model.Issue, 0, len(rows))
	for _, r := range rows {
		out = append(out, toIssue(store.AsIssueRow(r), keys[r.TeamID]))
	}
	return out, nil
}

// maxPurgeBatch bounds how many issues one purge destroys.
//
// Every purged issue becomes a change_log row inside the caller's transaction, and minting
// versions takes a row lock on the workspace for the whole block — so an unbounded "empty
// trash" on a workspace that has deleted forty thousand issues would hold every other writer
// in that workspace behind one statement. Five hundred is a fraction of a second of lock and
// still empties a normal workspace's trash in one call; the caller is told what is left.
const maxPurgeBatch = 500

// PurgeDeletedIssues empties the trash. Admins only, and there is no way back.
//
// THE BLAST RADIUS, stated plainly because nothing else in this package has one like it.
// This is the only hard DELETE of an issue in the product. Every row that references a
// purged issue goes with it by foreign key: its comments, its labels, its relations read
// from either end, its subscriptions, its whole activity feed, and any inbox rows pointing
// at it. Sub-issues survive — issue.parent_id is ON DELETE SET NULL — but they are orphaned,
// and afterwards nothing anywhere records which parent they had. There is no second trash
// behind this one and no restore; the row exists only in a database backup, if there is one.
//
// It is admin-only for that reason and not because the data is sensitive. Every other
// destructive action in the product is reversible for thirty days, so the permission that
// gates them is the permission to make a recoverable mistake. This one is different in kind.
//
// What it publishes, and why it is not nothing. Each purged issue emits the same OpDelete
// its soft delete emitted. Strictly, no replica can still be holding the row: the soft delete
// published a delete to the same scope, the bootstrap has excluded deleted issues since it
// was written, and a client that was offline through the whole window either reads that
// delete out of change_log or is below the oldest retained version and re-bootstraps —
// IssueRestoreWindow and ChangeLogRetention are the same constant precisely so that those are
// the only two cases. The delete is emitted anyway because a write that reaches no reader is
// still a write, and change_log is where the audit log, the webhook feed and every other
// derived record come from; a hard delete that appeared in none of them would be the one
// mutation in the product with no trace. The cascaded children need no rows of their own:
// the client's own cascade dropped them when the issue delete arrived — see Store.forget in
// web/src/store/store.ts — so re-listing them here would be thousands of change rows telling
// every replica to forget what it has already forgotten.
//
// before purges only what was deleted at or before that instant, which is what makes the
// unattended retention sweep expressible as the same call. Nil means now: empty it all.
func (s *Service) PurgeDeletedIssues(
	ctx context.Context, p *authz.Principal, before *time.Time,
) ([]uuid.UUID, int, int64, error) {
	if !authz.Can(p, authz.ActionIssuePurge) {
		return nil, 0, 0, platform.Forbidden("only admins can empty the trash")
	}

	cutoff := time.Now()
	if before != nil {
		cutoff = *before
	}

	var (
		purged    []uuid.UUID
		remaining int
		version   int64
	)
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		ids, changes, err := purgeBatch(ctx, q, p.WorkspaceID, cutoff)
		if err != nil {
			return err
		}
		purged = ids

		left, err := q.CountIssuesToPurge(ctx, store.CountIssuesToPurgeParams{
			WorkspaceID: p.WorkspaceID, DeletedBefore: &cutoff,
		})
		if err != nil {
			return platform.Internal(err)
		}
		remaining = int(left)

		if len(changes) == 0 {
			// An already-empty trash mints no version. The watermark says "nothing on the
			// stream moved", which is exactly true — see syncWatermark.
			version, err = syncWatermark(ctx, q, p.WorkspaceID)
			return err
		}
		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), changes...)
		return err
	})
	if err != nil {
		return nil, 0, 0, err
	}
	return purged, remaining, version, nil
}

// PurgeExpiredIssues is the retention sweep: the same purge, unattended, across every
// workspace with anything past the window. Run daily.
//
// It exists because DeleteIssue promises a thirty-day recovery window and IssueRestoreWindow
// says the purge job hard-deletes on that schedule — and until this, nothing did. A trash
// that is only ever emptied by hand is one that fills up: a workspace's soft-deleted rows sit
// in the same table every list query scans, the partial indexes carry them forever, and a
// promise made in a doc comment that no code keeps is worse than no promise.
//
// The cutoff is IssueRestoreWindow ago, not a parameter. A sweep that could be told to purge
// something still inside the window would be a way to defeat the guarantee the window is,
// and there is no caller who should be able to.
//
// One transaction per workspace, one bounded batch each, and it returns how many it took.
// Bounded per pass rather than looping to exhaustion so that a first run against a workspace
// with years of accumulated deletions is many short transactions across many nights instead
// of one that holds the version lock for minutes.
func (s *Service) PurgeExpiredIssues(ctx context.Context) (int, error) {
	cutoff := time.Now().Add(-IssueRestoreWindow)

	workspaces, err := s.db.Queries().ListWorkspacesWithPurgeableIssues(ctx, &cutoff)
	if err != nil {
		return 0, platform.Internal(err)
	}

	total := 0
	for _, workspaceID := range workspaces {
		err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
			ids, changes, err := purgeBatch(ctx, q, workspaceID, cutoff)
			if err != nil {
				return err
			}
			if len(changes) == 0 {
				return nil
			}
			// A system actor, because nobody instructed this. Attributing a scheduled
			// deletion to whoever happened to delete the issue thirty days ago would put
			// their name on a decision the calendar made.
			if _, err := s.em.Emit(ctx, q, workspaceID, authz.SystemActor(), changes...); err != nil {
				return err
			}
			total += len(ids)
			return nil
		})
		if err != nil {
			// One workspace's failure must not stop the sweep for the rest: the job runs
			// unattended and the next pass picks up whatever this one left.
			platform.Log(ctx).Error("retention sweep failed for a workspace",
				"workspace", workspaceID, "error", err)
		}
	}
	return total, nil
}

// purgeBatch is the shared half: destroy up to maxPurgeBatch rows and describe what went.
//
// The change rows carry the issue's own team scope, resolved from the workspace's teams
// rather than from the issue — which no longer exists by the time this runs, and that is the
// point of Change.TeamID being denormalised in the first place.
func purgeBatch(
	ctx context.Context, q *store.Queries, workspaceID uuid.UUID, cutoff time.Time,
) ([]uuid.UUID, []Change, error) {
	rows, err := q.PurgeDeletedIssues(ctx, store.PurgeDeletedIssuesParams{
		WorkspaceID:   workspaceID,
		DeletedBefore: &cutoff,
		PageSize:      maxPurgeBatch,
	})
	if err != nil {
		return nil, nil, platform.Internal(err)
	}
	if len(rows) == 0 {
		return nil, nil, nil
	}

	teams, err := q.ListTeamsInWorkspace(ctx, workspaceID)
	if err != nil {
		return nil, nil, platform.Internal(err)
	}
	private := make(map[uuid.UUID]bool, len(teams))
	for _, t := range teams {
		private[t.ID] = t.Private
	}

	ids := make([]uuid.UUID, 0, len(rows))
	changes := make([]Change, 0, len(rows))
	for _, r := range rows {
		ids = append(ids, r.ID)
		changes = append(changes, Change{
			EntityType: "issue", EntityID: r.ID, Op: OpDelete, TeamID: &r.TeamID,
			Scope: authz.TeamScope(r.TeamID, private[r.TeamID]),
			// The same field the soft delete named. Left empty it would read as a create,
			// and the notification engine would be told every field on a row that no longer
			// exists is new.
			ChangedFields: []string{notify.FieldDeleted},
		})
	}
	return ids, changes, nil
}

type UpdateTeamEstimatesInput struct {
	TeamID uuid.UUID
	Scale  string
	// AllowZero and Extended are plain bools, not pointers, because all three settings are
	// one decision: both only mean anything relative to a scale, and a partial update that
	// changed the scale without them would leave a team offering "16" on a Fibonacci
	// sequence. The mutation takes all three and this sets all three.
	AllowZero bool
	Extended  bool
}

// UpdateTeamEstimates changes how a team estimates.
//
// It rewrites nothing. The issue stores the number and the team stores the scale, so moving
// a team from Fibonacci to t-shirts changes what "3" is rendered as and leaves every issue
// alone — which is the property that makes changing your mind about a scale cheap instead of
// a migration.
func (s *Service) UpdateTeamEstimates(
	ctx context.Context, p *authz.Principal, in UpdateTeamEstimatesInput,
) (model.Team, int64, error) {
	switch in.Scale {
	case model.EstimateScaleNone, model.EstimateScaleExponential, model.EstimateScaleFibonacci,
		model.EstimateScaleLinear, model.EstimateScaleTShirt:
	default:
		// team_estimate_scale_check would refuse it too, but the wire enum is uppercase and
		// the column is lowercase, so a mapping slip reaches here as a plausible-looking
		// string and deserves a message rather than a constraint name.
		return model.Team{}, 0, platform.Validation("scale", "no such estimate scale")
	}

	var out model.Team
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		// Configuration, not content: admins anywhere, owners in their own team. The same
		// action that gates renaming the team and editing its workflow.
		team, err := s.requireTeamAccess(ctx, q, p, in.TeamID, authz.ActionTeamUpdate)
		if err != nil {
			return err
		}

		row, err := q.UpdateTeamEstimates(ctx, store.UpdateTeamEstimatesParams{
			ID:                in.TeamID,
			EstimateScale:     in.Scale,
			EstimateAllowZero: in.AllowZero,
			EstimateExtended:  in.Extended,
		})
		if err != nil {
			return platform.Internal(err)
		}
		out = toTeam(row)

		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "team", EntityID: in.TeamID, Op: OpUpsert, TeamID: &in.TeamID,
			Scope: authz.TeamScope(in.TeamID, team.Private), Payload: out,
		})
		return err
	})
	return out, version, err
}

// IssueProgress rolls up an issue's direct children. Returns nil when there are none —
// no children is "this is not a parent", which is a different thing from nought per cent.
func (s *Service) IssueProgress(
	ctx context.Context, p *authz.Principal, issueID uuid.UUID,
) (*model.IssueProgress, error) {
	q := s.db.Queries()
	if err := s.requireIssueVisible(ctx, q, p, issueID); err != nil {
		return nil, err
	}

	// Archived children are counted. Excluding them would let somebody archive a stray
	// sub-issue and silently move a parent from "3 of 5" to "3 of 4", changing a number
	// other people are reading with nothing on screen to explain it.
	children, err := q.ListChildIssues(ctx, &issueID)
	if err != nil {
		return nil, platform.Internal(err)
	}
	rows := make([]store.GetIssueRow, len(children))
	for i, c := range children {
		rows[i] = store.AsIssueRow(c)
	}
	return rollUpProgress(rows), nil
}

// rollUpProgress is the arithmetic behind the progress bar, shared by the single-issue call
// above and the batched SubIssuesFor.
//
// One implementation, deliberately: the cancelled-work rule below is the kind of thing that
// gets re-derived slightly differently the second time somebody writes it, and two progress
// bars on one screen disagreeing about the same parent is a bug nobody can reproduce on
// demand.
func rollUpProgress(children []store.GetIssueRow) *model.IssueProgress {
	if len(children) == 0 {
		// No children is "this is not a parent", which is a different statement from nought
		// per cent complete — hence nil, and a nullable field on the wire.
		return nil
	}

	progress := model.IssueProgress{Total: len(children)}
	for _, c := range children {
		// The category timestamps, not the children's workflow states. They are the same
		// fact — the domain layer sets them from the category on every transition — and
		// reading them costs nothing, where resolving each child's status would be a query
		// per distinct state on a call that a list view makes once per visible row.
		switch {
		case c.CanceledAt != nil:
			progress.Canceled++
		case c.CompletedAt != nil:
			progress.Completed++
		}
	}

	remaining := progress.Total - progress.Canceled
	if remaining <= 0 {
		// Every child was cancelled. There is no outstanding work, so the parent is done —
		// nought would leave a bar that nothing the user can do will ever move.
		progress.Percent = 100
		return &progress
	}
	// Integer rounding, to keep this free of a float that would render as 66.66666666666667
	// the one time somebody logs it.
	progress.Percent = (progress.Completed*100 + remaining/2) / remaining
	return &progress
}
