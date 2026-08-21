package domain

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/fractional"
	"github.com/peixotolabs/polaris/services/internal/notify"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/store"
)

const (
	maxTitleLength       = 512
	maxDescriptionLength = 1 << 20 // 1 MiB of markdown

	// maxEstimate mirrors issue_estimate_check. See validateEstimate for why the domain
	// checks a range the database also checks.
	maxEstimate = 1000

	// dateLayout is the only representation a due date ever takes outside the database: the
	// calendar day, with no time and no zone. See model.Date.
	dateLayout = "2006-01-02"
)

// TeamIssueLimit is 60,000 live (non-archived, non-deleted) issues per team. Archived
// issues do not count; completed ones still do. Tests lower this.
var TeamIssueLimit int64 = 60_000

type CreateIssueInput struct {
	TeamID      uuid.UUID
	Title       string
	Description string
	// StateID defaults to the team's default status when nil.
	StateID    *uuid.UUID
	AssigneeID *uuid.UUID
	Priority   int
	// AfterIssueID places the new issue directly below an existing one in the same
	// status column. Nil appends to the bottom.
	AfterIssueID *uuid.UUID

	// Estimate is the raw point value. Nil is unestimated, which is not zero — see the
	// team's estimate scale for how the number is rendered.
	Estimate *int
	// DueDate is a calendar day. Nil is no due date.
	DueDate *model.Date
	// ParentID makes the new issue a sub-issue. Cross-team is allowed on purpose: a
	// platform task under a product feature is the normal case.
	ParentID *uuid.UUID

	// LabelIDs are applied in the same transaction as the insert, each as its own row and
	// its own change. Applying them afterwards would leave a window in which the issue
	// exists without the labels it was filed under — long enough for the change stream to
	// broadcast the bare issue, and permanent if the second call never happens.
	LabelIDs []uuid.UUID

	// TemplateID records which template the issue was filed from. It is provenance, not
	// content: the client fills the title, body and properties from the template before it
	// sends this, because those are edits the user can still make in the dialog, and a
	// server that applied them again would overwrite whatever they typed. What this
	// answers is "is this template still worth having", which nothing else can.
	TemplateID *uuid.UUID

	// FormTemplateID records which form template the issue was filed from. Same provenance
	// contract as TemplateID: the client fills content from the form before sending.
	FormTemplateID *uuid.UUID

	// No clear flags here, unlike UpdateIssueInput. There is nothing to clear on an issue
	// that does not exist yet, and offering the flags would invite a caller to send them.

	// ID lets the client choose the issue's id. Nil means the server mints one.
	//
	// This exists so that an offline create is honest. The number still comes from a
	// row-locked counter and no client can predict it, but the id does not have to be
	// server-chosen — and when it was, an optimistic client had to show a stand-in row and
	// swap it when the response arrived. Offline the response comes back minutes later as
	// a delta, with nothing left holding the pairing, so the server's issue landed beside
	// the stand-in and the user had two rows for one issue until the next full sync.
	//
	// It is validated rather than trusted: v7, and not already used. A client can
	// therefore choose its own ids, which matters less than it sounds because it can
	// already choose any content it likes — and the alternative costs a reconciliation
	// path that only runs in the case hardest to test.
	ID *uuid.UUID

	// ProjectID places the issue in a project. An issue belongs to at most one.
	ProjectID *uuid.UUID
	// ProjectMilestoneID requires the issue to also be in that milestone's project.
	ProjectMilestoneID *uuid.UUID
	// CycleID places the issue in a cycle. An issue belongs to at most one, and it has
	// to be a cycle of the same team — a cooldown is not a cycle, so there is nothing
	// here that would file into the gap.
	CycleID *uuid.UUID

	// FromTriage files the issue into the team's triage status. Used by the inbox's C,
	// and by an outsider filing into a team they can see but have not joined.
	FromTriage bool

	// SkipDefaultTemplate stops the team's member/non-member default from being applied.
	// The composer sends this when the filer cleared the prefilled template; without it
	// an omitted templateId would quietly put the default back.
	SkipDefaultTemplate bool

	// RecurringCadence, with RecurringFirstDueDate, makes this issue the first occurrence
	// of a new schedule. The composer "Make recurring…" path.
	RecurringCadence      *string
	RecurringFirstDueDate *model.Date
}

// issueIDFor returns the id a new issue should take, honouring a client's choice.
//
// Two checks, and both are about what a client id can be used for rather than about
// correctness of the uuid itself:
//
//   - v7. Ids in this schema are time-ordered, which is what keeps index locality good and
//     makes the change log naturally sorted by creation. A client that sent v4s would
//     quietly degrade both, and the degradation would be invisible until someone profiled
//     an insert-heavy workspace.
//   - Unused. Without it, sending the id of an existing issue in a team you cannot see is
//     an oracle: the error tells you the issue exists. Checking here — inside the
//     transaction, before the insert — turns that into the same "already exists" a
//     collision with your own issue would give, and the unique constraint remains the
//     backstop if two requests race between this read and their inserts.
func issueIDFor(ctx context.Context, q *store.Queries, chosen *uuid.UUID) (uuid.UUID, error) {
	if chosen == nil {
		id, err := uuid.NewV7()
		if err != nil {
			return uuid.Nil, platform.Internal(err)
		}
		return id, nil
	}

	if chosen.Version() != 7 {
		return uuid.Nil, platform.Validation("id", "an issue id must be a version 7 uuid")
	}
	if _, err := q.GetIssueExists(ctx, *chosen); err == nil {
		return uuid.Nil, platform.Validation("id", "that id is already in use")
	} else if !store.IsNotFound(err) {
		return uuid.Nil, platform.Internal(err)
	}
	return *chosen, nil
}

func (s *Service) CreateIssue(ctx context.Context, p *authz.Principal, in CreateIssueInput) (model.Issue, int64, error) {
	in.Title = strings.TrimSpace(in.Title)
	if in.Title == "" {
		return model.Issue{}, 0, platform.Validation("title", "an issue needs a title")
	}
	if len(in.Title) > maxTitleLength {
		return model.Issue{}, 0, platform.Validation("title", "title is too long")
	}
	if len(in.Description) > maxDescriptionLength {
		return model.Issue{}, 0, platform.Validation("description", "description is too long")
	}
	if in.Priority < 0 || in.Priority > 4 {
		return model.Issue{}, 0, platform.Validation("priority", "priority must be 0 (none) to 4 (low)")
	}
	estimate, err := validateEstimate(in.Estimate)
	if err != nil {
		return model.Issue{}, 0, err
	}
	dueDay, hasDueDate, err := parseDueDate(in.DueDate)
	if err != nil {
		return model.Issue{}, 0, err
	}

	var labelIDs []uuid.UUID

	actor := p.Actor()
	var creatorID *uuid.UUID
	if p.UserID != uuid.Nil {
		id := p.UserID
		creatorID = &id
	} else {
		actor = authz.SystemActor()
	}

	var out model.Issue
	var version int64
	err = s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		team, err := s.requireTeamAccess(ctx, q, p, in.TeamID, authz.ActionIssueCreate)
		if err != nil {
			return err
		}

		live, err := q.CountNonArchivedIssuesForTeam(ctx, in.TeamID)
		if err != nil {
			return platform.Internal(err)
		}
		if live >= TeamIssueLimit {
			return platform.Conflict(fmt.Sprintf(
				"this team has reached the %d issue limit; archive or move issues before creating more",
				TeamIssueLimit))
		}

		member, err := q.IsTeamMember(ctx, store.IsTeamMemberParams{TeamID: in.TeamID, UserID: p.UserID})
		if err != nil {
			return platform.Internal(err)
		}

		if err := s.applyDefaultTemplate(ctx, q, p, team, member, &in); err != nil {
			return err
		}
		if in.TemplateID != nil {
			in.Description = UnwrapPlaceholders(in.Description)
		}
		if err := s.validateTemplate(ctx, q, p, in.TeamID, in.TemplateID); err != nil {
			return err
		}
		if err := s.validateFormTemplate(ctx, q, p, in.TeamID, in.FormTemplateID); err != nil {
			return err
		}

		childTitles, err := s.templateSubIssueTitles(ctx, q, in.TemplateID, in.ParentID)
		if err != nil {
			return err
		}
		if live+int64(1+len(childTitles)) > TeamIssueLimit {
			return platform.Conflict(fmt.Sprintf(
				"this team has reached the %d issue limit; archive or move issues before creating more",
				TeamIssueLimit))
		}
		labelIDs = dedupe(in.LabelIDs)

		intoTriage := in.FromTriage || (!member && team.TriageEnabled && in.StateID == nil)

		state, err := s.resolveInitialState(ctx, q, team, in.StateID, intoTriage)
		if err != nil {
			return err
		}

		if err := s.validateAssignee(ctx, q, p, in.TeamID, in.AssigneeID); err != nil {
			return err
		}

		if err := validateIssueCycle(ctx, q, in.TeamID, in.CycleID); err != nil {
			return err
		}

		// Takes a row lock on the team for the rest of the transaction, so two
		// simultaneous creations cannot claim the same number.
		number, err := q.AllocateIssueNumber(ctx, in.TeamID)
		if err != nil {
			return platform.Internal(err)
		}

		sortOrder, err := s.sortOrderFor(ctx, q, in.TeamID, state.ID, in.AfterIssueID)
		if err != nil {
			return err
		}

		id, err := issueIDFor(ctx, q, in.ID)
		if err != nil {
			return err
		}

		var siblingOrder *string
		if in.ParentID != nil {
			pos, err := s.resolveParent(ctx, q, p, in.TeamID, *in.ParentID)
			if err != nil {
				return err
			}
			siblingOrder = &pos
		}

		// A new issue may only be created in a backlog or unstarted status, so no
		// category timestamp can legitimately be set at creation time.
		params := store.CreateIssueParams{
			ID:                 id,
			WorkspaceID:        p.WorkspaceID,
			TeamID:             in.TeamID,
			Number:             number,
			Title:              in.Title,
			Description:        in.Description,
			StateID:            state.ID,
			AssigneeID:         in.AssigneeID,
			CreatorID:          creatorID,
			Priority:           int16(in.Priority),
			SortOrder:          sortOrder,
			StartedAt:          startedAtFor(state.Category, nil),
			CompletedAt:        completedAtFor(state.Category),
			CanceledAt:         canceledAtFor(state.Category),
			Estimate:           estimate,
			ParentID:           in.ParentID,
			SubIssueSortOrder:  siblingOrder,
			TemplateID:         in.TemplateID,
			FormTemplateID:     in.FormTemplateID,
			ProjectID:          in.ProjectID,
			ProjectMilestoneID: in.ProjectMilestoneID,
			CycleID:            in.CycleID,
		}
		if hasDueDate {
			params.DueDate = store.DateOf(dueDay)
		}

		row, err := q.CreateIssue(ctx, params)
		if err != nil {
			return mapParentTriggerError(err)
		}
		out = toIssue(store.AsIssueRow(row), team.Key)

		// No ChangedFields: an empty list is what marks a create, where every field is new
		// and the question "did this one move" has no meaning yet.
		if version, err = s.em.Emit(ctx, q, p.WorkspaceID, actor, Change{
			EntityType: "issue", EntityID: id, Op: OpUpsert, TeamID: &in.TeamID,
			Scope: authz.TeamScope(in.TeamID, team.Private), Payload: out,
		}); err != nil {
			return err
		}

		// Each label is its own row, its own change and its own version, so the version this
		// call reports is the last one it minted. A client waiting on it has therefore seen
		// the labels too, which is the point: reporting the issue's version would let the
		// client settle its optimistic state while its label chips were still in flight.
		for _, labelID := range labelIDs {
			if _, version, err = s.applyIssueLabel(ctx, q, p, id, in.TeamID, team.Private, labelID); err != nil {
				return err
			}
		}

		// You watch what you filed, what you were handed, and what names you.
		// Email intake has no user: the sender is not notified, and there is nobody to subscribe.
		if p.UserID != uuid.Nil {
			if err := s.SubscribeOnAction(ctx, q, p, id, p.UserID, model.SubscribedCreated); err != nil {
				return err
			}
		}
		if in.AssigneeID != nil {
			if err := s.SubscribeOnAction(ctx, q, p, id, *in.AssigneeID, model.SubscribedAssigned); err != nil {
				return err
			}
		}
		for _, mentioned := range notify.ParseMentions(in.Description) {
			if err := s.SubscribeOnAction(ctx, q, p, id, mentioned, model.SubscribedMentioned); err != nil {
				return err
			}
		}

		if in.RecurringCadence != nil {
			if err := s.attachRecurringOnCreate(ctx, q, p, team, &out, in); err != nil {
				return err
			}
			version, err = s.em.Emit(ctx, q, p.WorkspaceID, actor, Change{
				EntityType: "issue", EntityID: id, Op: OpUpsert, TeamID: &in.TeamID,
				Scope: authz.TeamScope(in.TeamID, team.Private), Payload: out,
			})
			if err != nil {
				return err
			}
		}

		if len(childTitles) > 0 {
			version, err = s.mintTemplateSubIssues(ctx, q, p, actor, team, out, in, childTitles)
			if err != nil {
				return err
			}
		}

		if err := s.applyMatchingSLA(ctx, q, p, id); err != nil {
			return err
		}
		refreshed, err := q.GetIssue(ctx, id)
		if err != nil {
			return platform.Internal(err)
		}
		out = toIssue(store.AsIssueRow(refreshed), team.Key)

		return s.em.History(ctx, q, p.WorkspaceID, actor, row.CreatedAt,
			HistoryEntry{IssueID: id, Kind: "created"})
	})
	if err != nil {
		// A one-per-group rejection cannot be phrased inside the transaction that raised it
		// — see errLabelGroupConflict — so it comes out of InTx unexplained and is named
		// here, the same way AddIssueLabel names it.
		var conflict errLabelGroupConflict
		if errors.As(err, &conflict) {
			return model.Issue{}, 0, s.explainGroupConflict(ctx, conflict)
		}
		return model.Issue{}, 0, err
	}
	return out, version, nil
}

// dedupe keeps the caller's order and drops repeats.
//
// A repeated label id would otherwise apply twice: the second write is an upsert that
// returns the same row, so it emits a second change for an entity that did not change, and
// every connected client re-renders a chip it already has.
func dedupe(ids []uuid.UUID) []uuid.UUID {
	if len(ids) == 0 {
		return nil
	}
	seen := make(map[uuid.UUID]struct{}, len(ids))
	out := make([]uuid.UUID, 0, len(ids))
	for _, id := range ids {
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		out = append(out, id)
	}
	return out
}

// validateTemplate refuses a template the caller cannot use for this team.
//
// A workspace template (no team of its own) is offered everywhere; a team's template is
// offered only in that team. Storing an id that fails that rule would leave the issue
// pointing at a template its team's create dialog never shows, and the "is this template
// still worth having" count it exists to answer would include filings the template could
// not have produced.
//
// The answer to an unreachable template is a validation error on the field rather than a
// not-found, because templateId is an input to filing an issue, not the thing being
// addressed — and it is the same message whether the id is wrong or the template belongs to
// a team the caller cannot see, so it cannot be used to probe for either.
func (s *Service) validateTemplate(
	ctx context.Context, q *store.Queries, p *authz.Principal, teamID uuid.UUID, templateID *uuid.UUID,
) error {
	if templateID == nil {
		return nil
	}
	row, err := s.requireTemplateAccess(ctx, q, p, *templateID)
	if err != nil {
		if platform.CodeOf(err) == platform.CodeNotFound {
			return platform.Validation("templateId", "no such template")
		}
		return err
	}
	if row.TeamID != nil && *row.TeamID != teamID {
		return platform.Validation("templateId", "that template belongs to another team")
	}
	return nil
}

type UpdateIssueInput struct {
	ID          uuid.UUID
	Title       *string
	Description *string
	StateID     *uuid.UUID
	Priority    *int

	// Assignee is three-state. A nil pointer leaves it alone; ClearAssignee unassigns.
	// Modelling "unassign" as a nil AssigneeID would make it indistinguishable from
	// "don't touch it", which is the classic partial-update bug.
	AssigneeID    *uuid.UUID
	ClearAssignee bool

	// The three below are three-state for exactly the same reason, and each is a case
	// where the missing third state would be silently wrong rather than merely awkward:
	// unestimated is not an estimate of zero, "no due date" is not the epoch, and an issue
	// with no parent is not a sub-issue of nothing. Removing any of them has to be said,
	// not implied by an absent value.
	Estimate      *int
	ClearEstimate bool

	DueDate      *model.Date
	ClearDueDate bool

	// Setting ParentID also gives the issue a place among its new siblings; clearing it
	// leaves that place behind, so an undo puts the issue back where it was rather than at
	// the bottom of the list.
	ParentID    *uuid.UUID
	ClearParent bool

	AfterIssueID *uuid.UUID
	MoveToTop    bool

	// AfterSiblingID places the issue directly below one of its parent's other children.
	//
	// A separate field from AfterIssueID because the two orders are separate sequences: a
	// parent's checklist has an order that has nothing to do with where its children sit in
	// their teams' backlogs, and one issue can be moved in either without touching the
	// other. Sending both in one call is legitimate — dragging a sub-issue up a checklist
	// while it also moves in the backlog — and each is applied to its own column.
	AfterSiblingID *uuid.UUID

	ProjectID          *uuid.UUID
	ClearProject       bool
	ProjectMilestoneID *uuid.UUID
	ClearMilestone     bool

	CycleID    *uuid.UUID
	ClearCycle bool
}

// UpdateIssue applies a partial update, derives the category timestamps, and records both
// the sync change and the activity-feed entries — all in one transaction.
func (s *Service) UpdateIssue(ctx context.Context, p *authz.Principal, in UpdateIssueInput) (model.Issue, int64, error) {
	if in.Title != nil {
		trimmed := strings.TrimSpace(*in.Title)
		if trimmed == "" {
			return model.Issue{}, 0, platform.Validation("title", "an issue needs a title")
		}
		if len(trimmed) > maxTitleLength {
			return model.Issue{}, 0, platform.Validation("title", "title is too long")
		}
		in.Title = &trimmed
	}
	if in.Description != nil && len(*in.Description) > maxDescriptionLength {
		return model.Issue{}, 0, platform.Validation("description", "description is too long")
	}
	if in.Priority != nil && (*in.Priority < 0 || *in.Priority > 4) {
		return model.Issue{}, 0, platform.Validation("priority", "priority must be 0 (none) to 4 (low)")
	}
	if in.AssigneeID != nil && in.ClearAssignee {
		return model.Issue{}, 0, platform.Validation("assigneeId", "cannot set and clear the assignee in one call")
	}
	// The same contradiction for each of the three-state properties. Resolving it silently
	// — letting the clear win, say — means a client with a stale form quietly wipes a value
	// the user had just typed, and nothing in the response says so.
	if in.Estimate != nil && in.ClearEstimate {
		return model.Issue{}, 0, platform.Validation("estimate", "cannot set and clear the estimate in one call")
	}
	if in.DueDate != nil && in.ClearDueDate {
		return model.Issue{}, 0, platform.Validation("dueDate", "cannot set and clear the due date in one call")
	}
	if in.ParentID != nil && in.ClearParent {
		return model.Issue{}, 0, platform.Validation("parentId", "cannot set and clear the parent in one call")
	}
	if in.ProjectID != nil && in.ClearProject {
		return model.Issue{}, 0, platform.Validation("projectId", "cannot set and clear the project in one call")
	}
	if in.ProjectMilestoneID != nil && in.ClearMilestone {
		return model.Issue{}, 0, platform.Validation("projectMilestoneId", "cannot set and clear the milestone in one call")
	}
	if in.CycleID != nil && in.ClearCycle {
		return model.Issue{}, 0, platform.Validation("cycleId", "cannot set and clear the cycle in one call")
	}
	if in.AfterSiblingID != nil && in.ClearParent {
		// A place among siblings the issue is about to stop having. Refusing says which of
		// the two the caller has to drop; applying one and ignoring the other would leave
		// them unable to tell which happened.
		return model.Issue{}, 0, platform.Validation("afterSiblingId",
			"cannot place an issue among its siblings while removing its parent")
	}
	estimate, err := validateEstimate(in.Estimate)
	if err != nil {
		return model.Issue{}, 0, err
	}
	dueDay, hasDueDate, err := parseDueDate(in.DueDate)
	if err != nil {
		return model.Issue{}, 0, err
	}

	var out model.Issue
	var version int64
	err = s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		// FOR UPDATE: the category timestamps are a read-modify-write, and two concurrent
		// status changes without this lock lose one of them.
		before, err := q.GetIssueForUpdate(ctx, in.ID)
		if err != nil {
			if store.IsNotFound(err) {
				return platform.NotFound("issue")
			}
			return platform.Internal(err)
		}

		team, err := s.requireTeamAccess(ctx, q, p, before.TeamID, authz.ActionIssueUpdate)
		if err != nil {
			return err
		}
		if before.DueDateSource == model.DueDateSLA && (in.DueDate != nil || in.ClearDueDate) {
			return platform.Validation("dueDate",
				"this date is set by an SLA, so it is not yours to move")
		}

		if err := validateIssueCycle(ctx, q, before.TeamID, in.CycleID); err != nil {
			return err
		}

		var (
			history       []HistoryEntry
			newState      *store.WorkflowState
			setTimestamps bool
			started       = before.StartedAt
			completed     = before.CompletedAt
			canceled      = before.CanceledAt

			// changed is what this mutation actually set, by column name, and it travels on
			// the change row. It is built here, beside the comparisons that decide it,
			// rather than recovered downstream by diffing payloads — see the field's comment
			// on domain.Change and migration 000018.
			//
			// Beside the history entries but not derived from them: the activity feed is
			// curated and suppresses its own entries, so a field can move without the feed
			// saying so, and a notification that depends on the feed's editorial decisions
			// is one that stops arriving for reasons nobody can trace.
			changed []string
		)

		if in.StateID != nil && *in.StateID != before.StateID {
			st, err := q.GetWorkflowState(ctx, *in.StateID)
			if err != nil {
				if store.IsNotFound(err) {
					return platform.Validation("stateId", "no such status")
				}
				return platform.Internal(err)
			}
			if st.TeamID != before.TeamID {
				return platform.Validation("stateId", "that status belongs to a different team")
			}
			newState = &st
			setTimestamps = true

			started = startedAtFor(st.Category, before.StartedAt)
			completed = completedAtFor(st.Category)
			canceled = canceledAtFor(st.Category)

			oldState, err := q.GetWorkflowState(ctx, before.StateID)
			if err != nil {
				return platform.Internal(err)
			}
			if oldState.Category == CategoryTriage && st.Category != CategoryTriage {
				priority := int(before.Priority)
				if in.Priority != nil {
					priority = *in.Priority
				}
				if err := requirePriorityToLeaveTriage(team, priority); err != nil {
					return err
				}
			}
			history = append(history, HistoryEntry{
				IssueID: in.ID, Kind: "state",
				FromValue: oldState.Name, ToValue: st.Name,
			})
			changed = append(changed, notify.FieldState)
		}

		if in.AssigneeID != nil {
			if err := s.validateAssignee(ctx, q, p, before.TeamID, in.AssigneeID); err != nil {
				return err
			}
			if before.AssigneeID == nil || *before.AssigneeID != *in.AssigneeID {
				history = append(history, HistoryEntry{
					IssueID: in.ID, Kind: "assignee",
					FromValue: before.AssigneeID, ToValue: in.AssigneeID,
				})
				changed = append(changed, notify.FieldAssignee)
			}
		}
		if in.ClearAssignee && before.AssigneeID != nil {
			history = append(history, HistoryEntry{
				IssueID: in.ID, Kind: "assignee", FromValue: before.AssigneeID, ToValue: nil,
			})
			changed = append(changed, notify.FieldAssignee)
		}

		if in.Priority != nil && int16(*in.Priority) != before.Priority {
			history = append(history, HistoryEntry{
				IssueID: in.ID, Kind: "priority",
				FromValue: int(before.Priority), ToValue: *in.Priority,
			})
			changed = append(changed, notify.FieldPriority)
		}
		if in.Title != nil && *in.Title != before.Title {
			history = append(history, HistoryEntry{
				IssueID: in.ID, Kind: "title", FromValue: before.Title, ToValue: *in.Title,
			})
			changed = append(changed, notify.FieldTitle)
		}
		if in.Description != nil && *in.Description != before.Description {
			changed = append(changed, notify.FieldDescription)
			// The feed records that the description changed, never its content: a diff of
			// a megabyte of markdown is not useful in a timeline, and version history is
			// a separate feature with its own storage.
			history = append(history, HistoryEntry{IssueID: in.ID, Kind: "description"})
		}

		if in.Estimate != nil || in.ClearEstimate {
			var to *int
			if !in.ClearEstimate {
				to = in.Estimate
			}
			from := intFromEstimate(before.Estimate)
			if !equalIntPtr(from, to) {
				history = append(history, HistoryEntry{
					IssueID: in.ID, Kind: "estimate", FromValue: from, ToValue: to,
				})
				changed = append(changed, notify.FieldEstimate)
			}
		}
		if in.DueDate != nil || in.ClearDueDate {
			var to *model.Date
			if !in.ClearDueDate {
				to = in.DueDate
			}
			from := dueDateOf(store.AsIssueRow(before))
			if !equalDatePtr(from, to) {
				history = append(history, HistoryEntry{
					IssueID: in.ID, Kind: "due_date", FromValue: from, ToValue: to,
				})
				changed = append(changed, notify.FieldDueDate)
			}
		}

		// Re-parenting has to mint a place among the new siblings before the write, because
		// sub_issue_sort_order is only meaningful relative to a parent: carrying the old key
		// across would drop the issue at an arbitrary point in a list it has never been in.
		var siblingOrder *string
		if in.ParentID != nil {
			pos, err := s.resolveParent(ctx, q, p, before.TeamID, *in.ParentID)
			if err != nil {
				return err
			}
			siblingOrder = &pos
		}
		// An explicit place among siblings overrides the append that a re-parent just minted,
		// which is what makes "drag this issue into that parent, third from the top" one call
		// rather than two — and the resolution is here rather than in the caller because
		// applying both in sequence would emit two changes for one gesture.
		if in.AfterSiblingID != nil {
			parentID := before.ParentID
			if in.ParentID != nil {
				parentID = in.ParentID
			}
			if parentID == nil {
				return platform.Validation("afterSiblingId",
					"that issue has no parent, so it has no siblings to be placed among")
			}
			pos, err := s.siblingPosition(ctx, q, p, *parentID, *in.AfterSiblingID)
			if err != nil {
				return err
			}
			siblingOrder = &pos
		}

		if in.ParentID != nil || in.ClearParent {
			var to *uuid.UUID
			if !in.ClearParent {
				to = in.ParentID
			}
			if !equalUUIDPtr(before.ParentID, to) {
				history = append(history, HistoryEntry{
					IssueID: in.ID, Kind: "parent", FromValue: before.ParentID, ToValue: to,
				})
				changed = append(changed, notify.FieldParent)
			}
		}

		var sortOrder *string
		if in.AfterIssueID != nil || in.MoveToTop {
			stateForOrder := before.StateID
			if newState != nil {
				stateForOrder = newState.ID
			}
			pos, err := s.reorderPosition(ctx, q, before.TeamID, stateForOrder, in.AfterIssueID, in.MoveToTop)
			if err != nil {
				return err
			}
			sortOrder = &pos
		} else if newState != nil {
			// Moving between columns without an explicit position lands at the bottom of
			// the new one; keeping the old key would drop it at an arbitrary point.
			pos, err := s.sortOrderFor(ctx, q, before.TeamID, newState.ID, nil)
			if err != nil {
				return err
			}
			sortOrder = &pos
		}

		var priority *int16
		if in.Priority != nil {
			v := int16(*in.Priority)
			priority = &v
		}
		var stateID *uuid.UUID
		if newState != nil {
			stateID = &newState.ID
		}

		params := store.UpdateIssueParams{
			ID:            in.ID,
			Title:         in.Title,
			Description:   in.Description,
			StateID:       stateID,
			Priority:      priority,
			SortOrder:     sortOrder,
			AssigneeID:    in.AssigneeID,
			ClearAssignee: in.ClearAssignee,
			SetTimestamps: setTimestamps,
			StartedAt:     started,
			CompletedAt:   completed,
			CanceledAt:    canceled,
			TeamID:        nil,
			Number:        nil,

			Estimate:           estimate,
			ClearEstimate:      in.ClearEstimate,
			ClearDueDate:       in.ClearDueDate,
			ParentID:           in.ParentID,
			ClearParent:        in.ClearParent,
			SubIssueSortOrder:  siblingOrder,
			ProjectID:          in.ProjectID,
			ClearProject:       in.ClearProject,
			ProjectMilestoneID: in.ProjectMilestoneID,
			ClearMilestone:     in.ClearMilestone,
			CycleID:            in.CycleID,
			ClearCycle:         in.ClearCycle,
			ClearSnooze:        before.SnoozedUntil != nil,
			ClearAutoClosed:    newState != nil && !isClosedCategory(newState.Category),
		}
		if hasDueDate {
			params.DueDate = store.DateOf(dueDay)
		}

		row, err := q.UpdateIssue(ctx, params)
		if err != nil {
			return mapParentTriggerError(err)
		}
		out = toIssue(store.AsIssueRow(row), team.Key)

		// A move has no history entry — the feed does not report reordering — but it is
		// still something this mutation set, and a changed-field list that omits what it
		// happens not to notify on is a list nobody can trust for anything else.
		if sortOrder != nil {
			changed = append(changed, notify.FieldSortOrder)
		}
		if siblingOrder != nil {
			changed = append(changed, notify.FieldSubIssueSortOrder)
		}

		if version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "issue", EntityID: in.ID, Op: OpUpsert, TeamID: &row.TeamID,
			Scope: authz.TeamScope(row.TeamID, team.Private), Payload: out,
			ChangedFields: changed,
		}); err != nil {
			return err
		}

		// Being handed an issue subscribes you to it, and so does being named in a
		// description somebody just rewrote. Both only on an actual change: re-saving an
		// issue must not re-subscribe people, and SubscribeOnAction would not resurrect an
		// explicit unsubscribe anyway.
		if in.AssigneeID != nil && (before.AssigneeID == nil || *before.AssigneeID != *in.AssigneeID) {
			if err := s.SubscribeOnAction(ctx, q, p, in.ID, *in.AssigneeID, model.SubscribedAssigned); err != nil {
				return err
			}
		}
		if in.Description != nil && *in.Description != before.Description {
			for _, mentioned := range notify.ParseMentions(*in.Description) {
				if err := s.SubscribeOnAction(ctx, q, p, in.ID, mentioned, model.SubscribedMentioned); err != nil {
					return err
				}
			}
		}

		if err := s.em.History(ctx, q, p.WorkspaceID, p.Actor(), before.CreatedAt, history...); err != nil {
			return err
		}
		if err := s.applyMatchingSLA(ctx, q, p, in.ID); err != nil {
			return err
		}
		refreshed, err := q.GetIssue(ctx, in.ID)
		if err != nil {
			return platform.Internal(err)
		}
		out = toIssue(store.AsIssueRow(refreshed), team.Key)
		return s.applyFamilyClose(ctx, q, p, team, store.AsIssueRow(row), newState, map[uuid.UUID]bool{})
	})
	return out, version, err
}

// ArchiveIssue hides an issue from every view without deleting it. Archived issues are
// never part of the bootstrap snapshot, which is what keeps a long-lived workspace's
// initial load bounded.
func (s *Service) ArchiveIssue(ctx context.Context, p *authz.Principal, id uuid.UUID, archived bool) (int64, error) {
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		before, err := q.GetIssueForUpdate(ctx, id)
		if err != nil {
			if store.IsNotFound(err) {
				return platform.NotFound("issue")
			}
			return platform.Internal(err)
		}
		team, err := s.requireTeamAccess(ctx, q, p, before.TeamID, authz.ActionIssueArchive)
		if err != nil {
			return err
		}

		kind := "unarchived"
		op := OpUpsert
		if archived {
			kind = "archived"
			// Archiving is a delete as far as the replica is concerned: the client drops
			// it from the local store, which is exactly what "never cached" requires.
			op = OpDelete
			if err := q.ArchiveIssue(ctx, id); err != nil {
				return platform.Internal(err)
			}
		} else if err := q.UnarchiveIssue(ctx, id); err != nil {
			return platform.Internal(err)
		}

		change := Change{
			EntityType: "issue", EntityID: id, Op: op, TeamID: &before.TeamID,
			Scope: authz.TeamScope(before.TeamID, team.Private),
			// Named rather than left empty, which would read as a create and tell the
			// notification engine that every field on the issue is new.
			ChangedFields: []string{notify.FieldArchived},
		}
		if !archived {
			after, err := q.GetIssue(ctx, id)
			if err != nil {
				return platform.Internal(err)
			}
			change.Payload = toIssue(store.AsIssueRow(after), team.Key)
		}

		if version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), change); err != nil {
			return err
		}
		return s.em.History(ctx, q, p.WorkspaceID, p.Actor(), before.CreatedAt,
			HistoryEntry{IssueID: id, Kind: kind})
	})
	return version, err
}

// DeleteIssue soft-deletes, leaving a 30-day recovery window. Hard deletion is a purge
// job, so that an accidental bulk delete is survivable.
func (s *Service) DeleteIssue(ctx context.Context, p *authz.Principal, id uuid.UUID) (int64, error) {
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		before, err := q.GetIssueForUpdate(ctx, id)
		if err != nil {
			if store.IsNotFound(err) {
				return platform.NotFound("issue")
			}
			return platform.Internal(err)
		}
		team, err := s.requireTeamAccess(ctx, q, p, before.TeamID, authz.ActionIssueDelete)
		if err != nil {
			return err
		}
		// Who did it, on the row rather than only in the activity feed. The feed holds it
		// too, but the trash lists issues whose feed it does not fetch — answering "who
		// deleted this" from history would be a query per row of a screen somebody opens in
		// a mild panic. The column takes a user id and every principal is one, agents
		// included: an installed app is a user row precisely so that actor, assignee and
		// mention keep one foreign key target.
		if err := q.SoftDeleteIssue(ctx, store.SoftDeleteIssueParams{
			ID: id, DeletedBy: &p.UserID,
		}); err != nil {
			return platform.Internal(err)
		}

		if version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "issue", EntityID: id, Op: OpDelete, TeamID: &before.TeamID,
			Scope:         authz.TeamScope(before.TeamID, team.Private),
			ChangedFields: []string{notify.FieldDeleted},
		}); err != nil {
			return err
		}
		return s.em.History(ctx, q, p.WorkspaceID, p.Actor(), before.CreatedAt,
			HistoryEntry{IssueID: id, Kind: "deleted"})
	})
	return version, err
}

func (s *Service) GetIssue(ctx context.Context, p *authz.Principal, id uuid.UUID) (model.Issue, error) {
	q := s.db.Queries()
	row, err := q.GetIssue(ctx, id)
	if err != nil {
		if store.IsNotFound(err) {
			return model.Issue{}, platform.NotFound("issue")
		}
		return model.Issue{}, platform.Internal(err)
	}
	team, err := q.GetTeam(ctx, row.TeamID)
	if err != nil {
		return model.Issue{}, platform.Internal(err)
	}
	// The same predicate the sync hub applies. Returning not-found rather than forbidden
	// keeps the existence of a private team's issues secret.
	if !authz.Visible(p, authz.TeamScope(row.TeamID, team.Private)) {
		return model.Issue{}, platform.NotFound("issue")
	}
	return toIssue(store.AsIssueRow(row), team.Key), nil
}

// GetIssueByRef accepts a UUID or an ENG-123 identifier. MCP tools and other
// integrations take whichever the caller has in hand; the GraphQL API already has
// both shapes as separate fields, and duplicating that fork at every tool would
// mean two code paths that disagree about private-team not-found.
func (s *Service) GetIssueByRef(ctx context.Context, p *authz.Principal, ref string) (model.Issue, error) {
	ref = strings.TrimSpace(ref)
	if id, err := uuid.Parse(ref); err == nil {
		return s.GetIssue(ctx, p, id)
	}
	found, err := s.lookupIssueByIdentifier(ctx, p.WorkspaceID, ref)
	if err != nil {
		return model.Issue{}, err
	}
	if found == nil {
		return model.Issue{}, platform.NotFound("issue")
	}
	team, err := s.db.Queries().GetTeam(ctx, found.TeamID)
	if err != nil {
		return model.Issue{}, platform.Internal(err)
	}
	if !authz.Visible(p, authz.TeamScope(found.TeamID, team.Private)) {
		return model.Issue{}, platform.NotFound("issue")
	}
	return *found, nil
}

func (s *Service) ListIssuesForTeam(ctx context.Context, p *authz.Principal, teamID uuid.UUID) ([]model.Issue, error) {
	q := s.db.Queries()
	team, err := q.GetTeam(ctx, teamID)
	if err != nil {
		if store.IsNotFound(err) {
			return nil, platform.NotFound("team")
		}
		return nil, platform.Internal(err)
	}
	if !authz.Visible(p, authz.TeamScope(teamID, team.Private)) {
		return nil, platform.NotFound("team")
	}

	rows, err := q.ListIssuesForTeam(ctx, teamID)
	if err != nil {
		return nil, platform.Internal(err)
	}
	out := make([]model.Issue, 0, len(rows))
	for _, r := range rows {
		out = append(out, toIssue(store.AsIssueRow(r), team.Key))
	}
	return out, nil
}

// resolveInitialState picks the status a new issue lands in.
//
// Outsiders filing into a team they can see but have not joined, and creates from the
// triage inbox, land in the triage status when the team has turned it on. Everyone else
// gets the team's default, or the status they asked for.
func (s *Service) resolveInitialState(
	ctx context.Context, q *store.Queries, team store.Team, requested *uuid.UUID, intoTriage bool,
) (store.WorkflowState, error) {
	if intoTriage {
		if !team.TriageEnabled {
			return store.WorkflowState{}, platform.Validation("fromTriage", "this team is not running triage")
		}
		st, err := q.GetWorkflowStateByTeamAndCategory(ctx, store.GetWorkflowStateByTeamAndCategoryParams{
			TeamID: team.ID, Category: CategoryTriage,
		})
		if err != nil {
			if store.IsNotFound(err) {
				return store.WorkflowState{}, platform.Internal(
					fmt.Errorf("team %s has triage on and no triage status", team.ID))
			}
			return store.WorkflowState{}, platform.Internal(err)
		}
		if st.ArchivedAt != nil {
			return store.WorkflowState{}, platform.Internal(
				fmt.Errorf("team %s has triage on and its triage status is archived", team.ID))
		}
		return st, nil
	}

	if requested == nil {
		st, err := q.GetDefaultWorkflowStateForTeam(ctx, team.ID)
		if err != nil {
			if store.IsNotFound(err) {
				return store.WorkflowState{}, platform.Internal(
					// Team creation seeds a default, so its absence is data corruption,
					// not something a user did.
					errNoDefaultState{team.ID})
			}
			return store.WorkflowState{}, platform.Internal(err)
		}
		return st, nil
	}

	st, err := q.GetWorkflowState(ctx, *requested)
	if err != nil {
		if store.IsNotFound(err) {
			return store.WorkflowState{}, platform.Validation("stateId", "no such status")
		}
		return store.WorkflowState{}, platform.Internal(err)
	}
	if st.TeamID != team.ID {
		return store.WorkflowState{}, platform.Validation("stateId", "that status belongs to a different team")
	}
	if st.Category == CategoryTriage && !team.TriageEnabled {
		return store.WorkflowState{}, platform.Validation("stateId", "this team is not running triage")
	}
	if st.Category == CategoryDuplicate {
		return store.WorkflowState{}, platform.Validation("stateId", "the duplicate status is reached by marking an issue as a duplicate")
	}
	return st, nil
}

type errNoDefaultState struct{ teamID uuid.UUID }

func (e errNoDefaultState) Error() string {
	return "team " + e.teamID.String() + " has no default workflow state"
}

// validateAssignee refuses assignees who cannot see the issue. Assigning work to somebody
// who then gets a 404 opening it is worse than refusing the assignment.
func (s *Service) validateAssignee(
	ctx context.Context, q *store.Queries, p *authz.Principal, teamID uuid.UUID, assignee *uuid.UUID,
) error {
	if assignee == nil {
		return nil
	}
	u, err := q.GetUser(ctx, *assignee)
	if err != nil {
		if store.IsNotFound(err) {
			return platform.Validation("assigneeId", "no such user")
		}
		return platform.Internal(err)
	}
	if u.WorkspaceID != p.WorkspaceID {
		return platform.Validation("assigneeId", "no such user")
	}
	if u.Status != "active" {
		return platform.Validation("assigneeId", "that user is suspended")
	}

	team, err := q.GetTeam(ctx, teamID)
	if err != nil {
		return platform.Internal(err)
	}
	// A public team accepts any workspace member; a private one only its own.
	if team.Private || u.Role == string(authz.RoleGuest) {
		member, err := q.IsTeamMember(ctx, store.IsTeamMemberParams{TeamID: teamID, UserID: *assignee})
		if err != nil {
			return platform.Internal(err)
		}
		if !member {
			return platform.Validation("assigneeId", "that user is not a member of this team")
		}
	}
	return nil
}

// sortOrderFor mints a key placing an issue after `after`, or at the bottom of the column.
func (s *Service) sortOrderFor(
	ctx context.Context, q *store.Queries, teamID, stateID uuid.UUID, after *uuid.UUID,
) (string, error) {
	if after == nil {
		last, err := q.GetLastSortOrderForState(ctx, store.GetLastSortOrderForStateParams{
			TeamID: teamID, StateID: stateID,
		})
		if err != nil {
			if store.IsNotFound(err) {
				return fractional.First(), nil
			}
			return "", platform.Internal(err)
		}
		return fractional.After(last), nil
	}
	return s.reorderPosition(ctx, q, teamID, stateID, after, false)
}

// reorderPosition computes the fractional key for a manual move.
func (s *Service) reorderPosition(
	ctx context.Context, q *store.Queries, teamID, stateID uuid.UUID, after *uuid.UUID, toTop bool,
) (string, error) {
	if toTop {
		rows, err := q.ListIssuesForTeam(ctx, teamID)
		if err != nil {
			return "", platform.Internal(err)
		}
		first := ""
		for _, r := range rows {
			if r.StateID != stateID {
				continue
			}
			if first == "" || r.SortOrder < first {
				first = r.SortOrder
			}
		}
		if first == "" {
			return fractional.First(), nil
		}
		return fractional.Before(first), nil
	}

	if after == nil {
		return fractional.First(), nil
	}

	anchor, err := q.GetIssue(ctx, *after)
	if err != nil {
		if store.IsNotFound(err) {
			return "", platform.Validation("afterIssueId", "no such issue")
		}
		return "", platform.Internal(err)
	}

	next, err := q.GetSortOrderAfter(ctx, store.GetSortOrderAfterParams{
		TeamID: teamID, StateID: stateID, SortOrder: anchor.SortOrder,
	})
	if err != nil && !store.IsNotFound(err) {
		return "", platform.Internal(err)
	}
	upper := ""
	if err == nil {
		upper = next
	}

	pos, err := fractional.Between(anchor.SortOrder, upper)
	if err != nil {
		return "", platform.Internal(err)
	}
	return pos, nil
}

// siblingPosition mints the key that puts an issue directly below one of its siblings.
//
// reorderPosition's twin, and separate from it because the two sequences are separate: a
// parent's children are ordered among themselves, in a list scoped to that parent, while
// sort_order orders a status column across a whole team. Reusing the one for the other would
// mint a key from neighbours in a list the issue is not in.
//
// The anchor has to be a child of the same parent, and saying so is not pedantry: an anchor
// from another parent's checklist would produce a key that sorts correctly against rows this
// issue will never be beside, which lands it in an order nobody chose and that no amount of
// dragging will explain.
func (s *Service) siblingPosition(
	ctx context.Context, q *store.Queries, p *authz.Principal, parentID, afterID uuid.UUID,
) (string, error) {
	anchor, err := q.GetIssue(ctx, afterID)
	if err != nil {
		if store.IsNotFound(err) {
			return "", platform.Validation("afterSiblingId", "no such issue")
		}
		return "", platform.Internal(err)
	}
	// The same not-found-shaped answer an unreachable issue gets everywhere else: the reader
	// already holds the parent, but the anchor may be in a team they cannot see, and an
	// error that distinguished the two would confirm it exists.
	if anchor.WorkspaceID != p.WorkspaceID || !authz.CanRelateIssues(p, anchor.TeamID, anchor.TeamID) {
		return "", platform.Validation("afterSiblingId", "no such issue")
	}
	if anchor.ParentID == nil || *anchor.ParentID != parentID {
		return "", platform.Validation("afterSiblingId", "that issue is not a sub-issue of the same parent")
	}
	if anchor.SubIssueSortOrder == nil {
		// Every child gets a key when it is attached, so a sibling without one is a row that
		// predates the column or was written around this package. There is nothing to
		// compute a position from, and guessing one would silently reorder the list.
		return "", platform.Internal(errNoSiblingOrder{anchor.ID})
	}

	next, err := q.GetSubIssueSortOrderAfter(ctx, store.GetSubIssueSortOrderAfterParams{
		ParentID:          &parentID,
		SubIssueSortOrder: anchor.SubIssueSortOrder,
	})
	if err != nil && !store.IsNotFound(err) {
		return "", platform.Internal(err)
	}
	upper := ""
	if err == nil && next != nil {
		upper = *next
	}

	pos, err := fractional.Between(*anchor.SubIssueSortOrder, upper)
	if err != nil {
		return "", platform.Internal(err)
	}
	return pos, nil
}

type errNoSiblingOrder struct{ issueID uuid.UUID }

func (e errNoSiblingOrder) Error() string {
	return "issue " + e.issueID.String() + " is a sub-issue with no sub_issue_sort_order"
}

// validateEstimate narrows a point value to the smallint the column holds.
//
// The range check is not a duplicate of issue_estimate_check, and the narrowing is the
// reason. estimate is a smallint; converting a Go int to int16 wraps silently, so an
// unchecked 65536 reaches the database as 0 — a value the CHECK is perfectly happy with,
// and one that nobody notices until a burndown is quietly wrong. Checking before the
// conversion is the last point at which the number is still the one the caller sent.
func validateEstimate(v *int) (*int16, error) {
	if v == nil {
		return nil, nil
	}
	if *v < 0 || *v > maxEstimate {
		return nil, platform.Validation("estimate", "an estimate must be between 0 and 1000 points")
	}
	n := int16(*v)
	return &n, nil
}

// parseDueDate accepts the calendar day the wire carries and refuses anything else.
//
// The column is a date, so a malformed string never survives to reach it — the driver fails
// first, and a typo would come back as an internal error. Parsing here is what turns that
// into a message naming the format. It returns a time rather than a driver value so the
// domain never has to name a pgx type; store.DateOf does the last step.
func parseDueDate(v *model.Date) (time.Time, bool, error) {
	if v == nil {
		return time.Time{}, false, nil
	}
	day, err := time.Parse(dateLayout, string(*v))
	if err != nil {
		return time.Time{}, false, platform.Validation("dueDate",
			"a due date is a calendar day written as 2006-01-02")
	}
	return day, true, nil
}

// resolveParent checks a proposed parent and mints the child's place among its siblings.
//
// Reachability is decided by CanRelateIssues, the same rule relations use, for the same
// reason: a parent link is visible from both ends, so being allowed to attach to an issue in
// a team you cannot see would confirm that issue exists and hand you its identifier. The
// answer when you may not is the one a missing issue gets, because "it exists but is not
// yours" is itself the leak.
//
// There is deliberately no cycle check here. issue_parent_acyclic walks the chain inside the
// same statement that writes the row; a second walk in Go would be a slower copy of it that
// can disagree under a concurrent re-parent, and the two of them disagreeing is worse than
// either alone. mapParentTriggerError turns its refusal into something readable.
func (s *Service) resolveParent(
	ctx context.Context, q *store.Queries, p *authz.Principal, childTeamID, parentID uuid.UUID,
) (string, error) {
	parent, err := q.GetIssue(ctx, parentID)
	if err != nil {
		if store.IsNotFound(err) {
			return "", platform.Validation("parentId", "no such issue")
		}
		return "", platform.Internal(err)
	}
	if parent.WorkspaceID != p.WorkspaceID || !authz.CanRelateIssues(p, childTeamID, parent.TeamID) {
		return "", platform.Validation("parentId", "no such issue")
	}

	last, err := q.GetLastSubIssueSortOrder(ctx, &parentID)
	if err != nil {
		if store.IsNotFound(err) {
			return fractional.First(), nil
		}
		return "", platform.Internal(err)
	}
	if last == nil {
		return fractional.First(), nil
	}
	return fractional.After(*last), nil
}

// mapParentTriggerError turns the parent-cycle trigger's refusal into a message.
//
// The trigger is the only thing that can see the whole ancestor chain at write time, so the
// check belongs to it — but its message names row ids, and a user who has just dropped an
// issue onto one of its own descendants needs to be told that, not handed a uuid. Every
// other failure of these statements is a bug on this side and stays internal.
func mapParentTriggerError(err error) error {
	if !store.IsRaisedException(err) {
		return platform.Internal(err)
	}
	msg := err.Error()
	if strings.Contains(msg, "cycle") && strings.Contains(msg, "does not exist") {
		return platform.Validation("cycleId", "no such cycle")
	}
	if strings.Contains(msg, "does not belong to team") {
		return platform.Validation("cycleId", "that cycle belongs to another team")
	}
	if strings.Contains(msg, "milestone requires a project") || strings.Contains(msg, "does not belong to project") {
		return platform.Validation("projectMilestoneId",
			"a milestone has to belong to the issue's project")
	}
	return platform.Validation("parentId",
		"that issue is below this one already, so it cannot also be its parent")
}

// The three comparisons below exist so the activity feed records a change only when there
// was one. Setting a due date to the date it already had is a no-op the user did not
// perform, and a feed that reports it teaches people to stop reading the feed.
func equalIntPtr(a, b *int) bool {
	if a == nil || b == nil {
		return a == b
	}
	return *a == *b
}

func equalDatePtr(a, b *model.Date) bool {
	if a == nil || b == nil {
		return a == b
	}
	return *a == *b
}

func equalUUIDPtr(a, b *uuid.UUID) bool {
	if a == nil || b == nil {
		return a == b
	}
	return *a == *b
}

// The three helpers below encode the status-transition rules in one place.
//
// startedAt is never cleared once set: cycle time and lead time are computed from it, and
// re-opening a finished issue must not erase the fact that work had begun.
func startedAtFor(category string, existing *time.Time) *time.Time {
	switch category {
	case CategoryStarted, CategoryCompleted:
		if existing != nil {
			return existing
		}
		now := time.Now()
		return &now
	default:
		return existing
	}
}

func completedAtFor(category string) *time.Time {
	if category != CategoryCompleted {
		return nil
	}
	now := time.Now()
	return &now
}

func canceledAtFor(category string) *time.Time {
	if category != CategoryCanceled && category != CategoryDuplicate {
		return nil
	}
	now := time.Now()
	return &now
}
