package domain

import (
	"context"
	"fmt"
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
		in.Estimate == nil && !in.ClearEstimate && in.DueDate == nil && !in.ClearDueDate {
		// Otherwise this writes every selected row, bumps the version and wakes every
		// client to deliver a change that changed nothing.
		return nil, nil, 0, platform.Validation("input", "a bulk edit needs at least one property to change")
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
		before := make([]store.Issue, 0, len(in.IDs))

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

		rows, err := q.BulkUpdateIssues(ctx, params)
		if err != nil {
			return platform.Internal(err)
		}

		beforeByID := make(map[uuid.UUID]store.Issue, len(before))
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
			issue := toIssue(row, team.Key)
			out = append(out, issue)
			changes = append(changes, Change{
				EntityType: "issue", EntityID: row.ID, Op: OpUpsert, TeamID: &row.TeamID,
				Scope: authz.TeamScope(row.TeamID, team.Private), Payload: issue,
				ChangedFields: fields,
			})
		}

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
			entries, err := bulkHistoryEntries(ctx, q, beforeByID[row.ID], row, stateNames)
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
		return nil, nil, 0, err
	}
	return out, skipped, version, nil
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
	ctx context.Context, q *store.Queries, before, after store.Issue, names map[uuid.UUID]string,
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
		out = toIssue(row, team.Key)

		change := Change{
			EntityType: "issue", EntityID: id, Op: OpUpsert, TeamID: &row.TeamID,
			Scope: authz.TeamScope(row.TeamID, team.Private), Payload: out,
			// The deletion is what moved, and naming it is what stops a restore reading as a
			// creation: an empty list would re-notify the assignee, re-fire every mention in
			// the description, and tell the whole thread about a comment written last week.
			ChangedFields: []string{notify.FieldDeleted},
		}
		if row.ArchivedAt != nil {
			// It was archived before it was deleted, and archived issues are never cached
			// by a client. Upserting it would put a row into every replica that the next
			// bootstrap would then drop again, which reads as an issue appearing and
			// vanishing for no reason. A delete leaves the replicas where they already are.
			change.Op = OpDelete
			change.Payload = nil
		}

		if version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), change); err != nil {
			return err
		}
		return s.em.History(ctx, q, p.WorkspaceID, p.Actor(), row.CreatedAt,
			HistoryEntry{IssueID: id, Kind: "restored"})
	})
	return out, version, err
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
		out = append(out, toIssue(r, keys[r.TeamID]))
	}
	return out, nil
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
	if len(children) == 0 {
		return nil, nil
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
		return &progress, nil
	}
	// Integer rounding, to keep this free of a float that would render as 66.66666666666667
	// the one time somebody logs it.
	progress.Percent = (progress.Completed*100 + remaining/2) / remaining
	return &progress, nil
}
