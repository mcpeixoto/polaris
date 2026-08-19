package domain

import (
	"context"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/store"
)

// The converters below are the single serialisation boundary between the database row
// and everything outside this package. GraphQL responses, change_log payloads and
// bootstrap lines all come from here, so a field added to a model struct reaches every
// surface at once — and a field that exists in the database but not in a model is, by
// construction, private to the server.

func toWorkspace(w store.Workspace) model.Workspace {
	return model.Workspace{
		ID:         w.ID,
		Name:       w.Name,
		URLKey:     w.UrlKey,
		LogoURL:    w.LogoUrl,
		Plan:       w.Plan,
		CreatedAt:  w.CreatedAt,
		UpdatedAt:  w.UpdatedAt,
		ArchivedAt: w.ArchivedAt,
	}
}

// toUser deliberately omits the email. The caller adds it back only for the viewer
// themselves and for admins — a member listing a workspace's people does not receive
// everybody's address, and defaulting to "included" is how that leaks.
func toUser(u store.User) model.User {
	return model.User{
		ID:          u.ID,
		WorkspaceID: u.WorkspaceID,
		Name:        u.Name,
		DisplayName: u.DisplayName,
		AvatarURL:   u.AvatarUrl,
		Timezone:    u.Timezone,
		Role:        u.Role,
		Status:      u.Status,
		Kind:        u.Kind,
		LastSeenAt:  u.LastSeenAt,
		CreatedAt:   u.CreatedAt,
		UpdatedAt:   u.UpdatedAt,
		ArchivedAt:  u.ArchivedAt,
	}
}

func toTeam(t store.Team) model.Team {
	return model.Team{
		ID:           t.ID,
		WorkspaceID:  t.WorkspaceID,
		Key:          t.Key,
		Name:         t.Name,
		Description:  t.Description,
		Icon:         t.Icon,
		Color:        t.Color,
		Timezone:     t.Timezone,
		ParentTeamID: t.ParentTeamID,
		Private:      t.Private,

		EstimateScale:     t.EstimateScale,
		EstimateAllowZero: t.EstimateAllowZero,
		EstimateExtended:  t.EstimateExtended,

		CyclesEnabled:         t.CyclesEnabled,
		CycleDurationWeeks:    int(t.CycleDurationWeeks),
		CycleCooldownWeeks:    int(t.CycleCooldownWeeks),
		CycleStartDay:         t.CycleStartDay,
		CycleUpcomingCount:    int(t.CycleUpcomingCount),
		CycleAutoAddStarted:   t.CycleAutoAddStarted,
		CycleAutoAddCompleted: t.CycleAutoAddCompleted,

		TriageEnabled:         t.TriageEnabled,
		TriageRequirePriority: t.TriageRequirePriority,

		AutoCloseDays:     int(t.AutoCloseDays),
		AutoArchiveDays:   int(t.AutoArchiveDays),
		AutoCloseParent:   t.AutoCloseParent,
		AutoCloseChildren: t.AutoCloseChildren,

		CreatedAt:  t.CreatedAt,
		UpdatedAt:  t.UpdatedAt,
		RetiredAt:  t.RetiredAt,
		ArchivedAt: t.ArchivedAt,
	}
}

func toMembership(m store.TeamMembership) model.TeamMembership {
	return model.TeamMembership{
		ID:          m.ID,
		WorkspaceID: m.WorkspaceID,
		TeamID:      m.TeamID,
		UserID:      m.UserID,
		Role:        m.Role,
		CreatedAt:   m.CreatedAt,
		UpdatedAt:   m.UpdatedAt,
	}
}

func toWorkflowState(s store.WorkflowState) model.WorkflowState {
	return model.WorkflowState{
		ID:          s.ID,
		WorkspaceID: s.WorkspaceID,
		TeamID:      s.TeamID,
		Name:        s.Name,
		Description: s.Description,
		Color:       s.Color,
		Category:    s.Category,
		Position:    s.Position,
		IsDefault:   s.IsDefault,
		IsSystem:    s.IsSystem,
		CreatedAt:   s.CreatedAt,
		UpdatedAt:   s.UpdatedAt,
		ArchivedAt:  s.ArchivedAt,
	}
}

// toIssue needs the team key because the identifier (ENG-123) is derived rather than
// stored — see the comment on the issue table. Callers that already hold the team pass
// its key; the ones that do not look it up once and reuse it across a batch.
func toIssue(i store.Issue, teamKey string) model.Issue {
	out := model.Issue{
		ID:          i.ID,
		WorkspaceID: i.WorkspaceID,
		TeamID:      i.TeamID,
		Number:      i.Number,
		Identifier:  model.Identifier(teamKey, i.Number),
		Title:       i.Title,
		Description: i.Description,
		StateID:     i.StateID,
		AssigneeID:  i.AssigneeID,
		CreatorID:   i.CreatorID,
		Priority:    int(i.Priority),
		SortOrder:   i.SortOrder,

		DueDateSource:     i.DueDateSource,
		ParentID:          i.ParentID,
		SubIssueSortOrder: i.SubIssueSortOrder,
		TemplateID:        i.TemplateID,
		ProjectID:         i.ProjectID,
		ProjectMilestoneID: i.ProjectMilestoneID,
		CycleID:           i.CycleID,
		SnoozedUntil:      i.SnoozedUntil,
		AutoClosedAt:      i.AutoClosedAt,

		StartedAt:   i.StartedAt,
		CompletedAt: i.CompletedAt,
		CanceledAt:  i.CanceledAt,
		ArchivedAt:  i.ArchivedAt,
		// Both nil on every live issue, so they cost nothing on the sync stream — the only
		// caller that sees them set is the trash listing. See model.Issue.
		DeletedAt: i.DeletedAt,
		DeletedBy: i.DeletedBy,
		CreatedAt: i.CreatedAt,
		UpdatedAt: i.UpdatedAt,
	}

	// The two below widen out of the database's shapes rather than being copied across.
	out.Estimate = intFromEstimate(i.Estimate)
	out.DueDate = dueDateOf(i)

	return out
}

func toCycle(c store.Cycle) model.Cycle {
	return model.Cycle{
		ID:          c.ID,
		WorkspaceID: c.WorkspaceID,
		TeamID:      c.TeamID,
		Number:      int(c.Number),
		Name:        c.Name,
		Description: c.Description,
		StartsAt:    c.StartsAt,
		EndsAt:      c.EndsAt,
		CompletedAt: c.CompletedAt,
		ArchivedAt:  c.ArchivedAt,
		CreatedAt:   c.CreatedAt,
		UpdatedAt:   c.UpdatedAt,
	}
}

// intFromEstimate widens the smallint the column holds — a point value never needs more —
// into the Int the API returns. nil stays nil, because unestimated is not an estimate of
// zero and a caller that treated it as one would sum it into a burndown.
func intFromEstimate(v *int16) *int {
	if v == nil {
		return nil
	}
	n := int(*v)
	return &n
}

// dueDateOf renders a date column as the calendar day the wire carries.
//
// A date column arrives as a driver value with a validity flag, and invalid means the column
// was NULL — no due date, rather than the zero day. Formatting it here rather than shipping
// an instant is what keeps the timezone out of it: the day the setter chose is the day every
// reader sees, wherever they are.
func dueDateOf(i store.Issue) *model.Date {
	if !i.DueDate.Valid {
		return nil
	}
	d := model.Date(i.DueDate.Time.Format(dateLayout))
	return &d
}

// toIssueRelation carries both team ids through untouched. They are denormalised by a
// trigger precisely so that this conversion — and the sync hub after it — never has to
// re-read an issue that may already be gone.
func toIssueRelation(r store.IssueRelation) model.IssueRelation {
	return model.IssueRelation{
		ID:             r.ID,
		WorkspaceID:    r.WorkspaceID,
		IssueID:        r.IssueID,
		RelatedIssueID: r.RelatedIssueID,
		Type:           r.Type,
		TeamID:         r.TeamID,
		RelatedTeamID:  r.RelatedTeamID,
		CreatedBy:      r.CreatedBy,
		CreatedAt:      r.CreatedAt,
	}
}

func toComment(c store.Comment) model.Comment {
	return model.Comment{
		ID:          c.ID,
		WorkspaceID: c.WorkspaceID,
		IssueID:     c.IssueID,
		ParentID:    c.ParentID,
		Body:        c.Body,
		Actor:       model.Actor{Type: c.ActorType, ID: c.ActorID},
		EditedAt:    c.EditedAt,
		ResolvedAt:  c.ResolvedAt,
		ResolvedBy:  c.ResolvedBy,
		CreatedAt:   c.CreatedAt,
		UpdatedAt:   c.UpdatedAt,
	}
}

func toAttachment(a store.Attachment) model.Attachment {
	return model.Attachment{
		ID:          a.ID,
		WorkspaceID: a.WorkspaceID,
		IssueID:     a.IssueID,
		TeamID:      a.TeamID,
		URL:         a.Url,
		Title:       a.Title,
		Subtitle:    a.Subtitle,
		IconURL:     a.IconUrl,
		Metadata:    a.Metadata,
		CreatorID:   a.CreatorID,
		CreatedAt:   a.CreatedAt,
		UpdatedAt:   a.UpdatedAt,
	}
}

// teamKeys maps every team in a workspace to its key, for deriving issue identifiers.
//
// One read for every key rather than one per issue. An identifier is the team key plus the
// number, and a result set spanning a handful of teams would otherwise read those same
// teams once per row — which is invisible on a list of ten and is the whole query on a list
// of five hundred.
func teamKeys(ctx context.Context, q *store.Queries, workspaceID uuid.UUID) (map[uuid.UUID]string, error) {
	teams, err := q.ListTeamsInWorkspace(ctx, workspaceID)
	if err != nil {
		return nil, platform.Internal(err)
	}
	keys := make(map[uuid.UUID]string, len(teams))
	for _, t := range teams {
		keys[t.ID] = t.Key
	}
	return keys, nil
}
