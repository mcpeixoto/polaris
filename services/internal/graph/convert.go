package graph

import (
	"encoding/json"
	"fmt"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/graph/generated"
	"github.com/peixotolabs/polaris/services/internal/platform"
)

// This file is the entire difference between what the sync stream carries and what the
// API returns.
//
// model.* is the single serialisation: the same struct is written into
// change_log.payload, streamed at bootstrap, and stored by the client in IndexedDB. The
// GraphQL types are a transport laid over it and they differ in exactly two ways — enums
// are uppercase on the wire and lowercase in the database, and the schema exposes nested
// relations that a stored row does not carry. Every other field is a copy, and
// schema_drift_test.go fails the build if that stops being true.
//
// The mappers here are mechanical and do no I/O. The relations are filled in by
// loaders.go, which is where the queries live.

func toWorkspace(w model.Workspace) generated.Workspace {
	return generated.Workspace{
		ID:                                w.ID,
		Name:                              w.Name,
		URLKey:                            w.URLKey,
		LogoURL:                           w.LogoURL,
		Plan:                              w.Plan,
		ProjectUpdateReminderIntervalDays: w.ProjectUpdateReminderIntervalDays,
		ProjectUpdateReminderWeekday:      w.ProjectUpdateReminderWeekday,
		ProjectUpdateReminderHour:         w.ProjectUpdateReminderHour,
		CreatedAt:                         w.CreatedAt,
		UpdatedAt:                         w.UpdatedAt,
		ArchivedAt:                        w.ArchivedAt,
	}
}

func toUser(u model.User) (generated.User, error) {
	role, err := toUserRole(u.Role)
	if err != nil {
		return generated.User{}, err
	}
	status, err := toUserStatus(u.Status)
	if err != nil {
		return generated.User{}, err
	}
	kind, err := toUserKind(u.Kind)
	if err != nil {
		return generated.User{}, err
	}
	return generated.User{
		ID:          u.ID,
		WorkspaceID: u.WorkspaceID,
		Name:        u.Name,
		DisplayName: u.DisplayName,
		AvatarURL:   u.AvatarURL,
		Timezone:    u.Timezone,
		Role:        role,
		Status:      status,
		Kind:        kind,
		Email:       u.Email,
		LastSeenAt:  u.LastSeenAt,
		// Passed through as stored, and nil stays nil. `{}` would be wrong here in a way it
		// is not for a view's filter: an empty bag of toggles is not the same statement as
		// "this account has never chosen", and the delivery rules read the difference.
		NotificationPrefs: u.NotificationPrefs,
		CreatedAt:         u.CreatedAt,
		UpdatedAt:         u.UpdatedAt,
		ArchivedAt:        u.ArchivedAt,
	}, nil
}

func toUsers(users []model.User) ([]generated.User, error) {
	out := make([]generated.User, 0, len(users))
	for _, u := range users {
		g, err := toUser(u)
		if err != nil {
			return nil, err
		}
		out = append(out, g)
	}
	return out, nil
}

func toTeam(t model.Team) (generated.Team, error) {
	scale, err := toEstimateScale(t.EstimateScale)
	if err != nil {
		return generated.Team{}, err
	}
	return generated.Team{
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
		// The estimate settings live on the team and the number lives on the issue. A client
		// that received the numbers without the scale would render 3 as "3 points" for a
		// team on t-shirt sizes, which is the one thing the split exists to prevent.
		EstimateScale:         scale,
		EstimateAllowZero:     t.EstimateAllowZero,
		EstimateExtended:      t.EstimateExtended,
		CyclesEnabled:         t.CyclesEnabled,
		CycleDurationWeeks:    t.CycleDurationWeeks,
		CycleCooldownWeeks:    t.CycleCooldownWeeks,
		CycleStartDay:         t.CycleStartDay,
		CycleUpcomingCount:    t.CycleUpcomingCount,
		CycleAutoAddStarted:   t.CycleAutoAddStarted,
		CycleAutoAddCompleted: t.CycleAutoAddCompleted,
		TriageEnabled:         t.TriageEnabled,
		TriageRequirePriority: t.TriageRequirePriority,
		AutoCloseDays:         t.AutoCloseDays,
		AutoArchiveDays:       t.AutoArchiveDays,
		AutoCloseParent:       t.AutoCloseParent,
		AutoCloseChildren:     t.AutoCloseChildren,
		DefaultTemplateForMembersID:    t.DefaultTemplateForMembersID,
		DefaultTemplateForNonMembersID: t.DefaultTemplateForNonMembersID,
		CreatedAt:                      t.CreatedAt,
		UpdatedAt:                      t.UpdatedAt,
		RetiredAt:                      t.RetiredAt,
		ArchivedAt:                     t.ArchivedAt,
		DeletedAt:                      t.DeletedAt,
	}, nil
}

func toMembership(m model.TeamMembership) (generated.TeamMembership, error) {
	role, err := toTeamRole(m.Role)
	if err != nil {
		return generated.TeamMembership{}, err
	}
	return generated.TeamMembership{
		ID:          m.ID,
		WorkspaceID: m.WorkspaceID,
		TeamID:      m.TeamID,
		UserID:      m.UserID,
		Role:        role,
		CreatedAt:   m.CreatedAt,
		UpdatedAt:   m.UpdatedAt,
	}, nil
}

func toWorkflowState(s model.WorkflowState) (generated.WorkflowState, error) {
	category, err := toStateCategory(s.Category)
	if err != nil {
		return generated.WorkflowState{}, err
	}
	return generated.WorkflowState{
		ID:          s.ID,
		WorkspaceID: s.WorkspaceID,
		TeamID:      s.TeamID,
		Name:        s.Name,
		Description: s.Description,
		Color:       s.Color,
		Category:    category,
		Position:    s.Position,
		IsDefault:   s.IsDefault,
		IsSystem:    s.IsSystem,
		CreatedAt:   s.CreatedAt,
		UpdatedAt:   s.UpdatedAt,
		ArchivedAt:  s.ArchivedAt,
	}, nil
}

func toWorkflowStates(states []model.WorkflowState) ([]generated.WorkflowState, error) {
	out := make([]generated.WorkflowState, 0, len(states))
	for _, s := range states {
		g, err := toWorkflowState(s)
		if err != nil {
			return nil, err
		}
		out = append(out, g)
	}
	return out, nil
}

// toIssue copies the identifier rather than rebuilding it. It is derived from the team key
// and the number in exactly one place — model.Identifier — and recomputing it here would
// be a second implementation of a format the client also derives locally.
//
// It returns an error only because dueDateSource is an enum. Every other field here is a
// copy, and the one that is not is the one that would otherwise reach a client as the empty
// string for a field the schema declares non-null — which gqlgen serialises without
// complaint, because a Go zero value is a perfectly good string.
func toIssue(i model.Issue) (generated.Issue, error) {
	source, err := toDueDateSource(i.DueDateSource)
	if err != nil {
		return generated.Issue{}, err
	}
	return generated.Issue{
		ID:          i.ID,
		WorkspaceID: i.WorkspaceID,
		TeamID:      i.TeamID,
		Number:      int(i.Number),
		Identifier:  i.Identifier,
		Title:       i.Title,
		Description: i.Description,
		StateID:     i.StateID,
		AssigneeID:  i.AssigneeID,
		CreatorID:   i.CreatorID,
		Priority:    i.Priority,
		SortOrder:   i.SortOrder,

		Estimate:          i.Estimate,
		DueDate:           fromDate(i.DueDate),
		DueDateSource:     source,
		ParentID:          i.ParentID,
		SubIssueSortOrder: i.SubIssueSortOrder,
		TemplateID:        i.TemplateID,
		FormTemplateID:    i.FormTemplateID,
		RecurringIssueID:  i.RecurringIssueID,
		ProjectID:         i.ProjectID,
		ProjectMilestoneID: i.ProjectMilestoneID,
		CycleID:            i.CycleID,
		SnoozedUntil:       i.SnoozedUntil,
		AutoClosedAt:       i.AutoClosedAt,

		StartedAt:   i.StartedAt,
		CompletedAt: i.CompletedAt,
		CanceledAt:  i.CanceledAt,
		ArchivedAt:  i.ArchivedAt,
		DeletedAt:   i.DeletedAt,
		DeletedBy:   i.DeletedBy,
		CreatedAt:   i.CreatedAt,
		UpdatedAt:   i.UpdatedAt,
	}, nil
}

func toComment(c model.Comment) (generated.Comment, error) {
	actor, err := toActor(c.Actor)
	if err != nil {
		return generated.Comment{}, err
	}
	return generated.Comment{
		ID:          c.ID,
		WorkspaceID: c.WorkspaceID,
		IssueID:     c.IssueID,
		ParentID:    c.ParentID,
		Body:        c.Body,
		Actor:       actor,
		EditedAt:    c.EditedAt,
		ResolvedAt:  c.ResolvedAt,
		ResolvedBy:  c.ResolvedBy,
		CreatedAt:   c.CreatedAt,
		UpdatedAt:   c.UpdatedAt,
	}, nil
}

func toComments(comments []model.Comment) ([]generated.Comment, error) {
	out := make([]generated.Comment, 0, len(comments))
	for _, c := range comments {
		g, err := toComment(c)
		if err != nil {
			return nil, err
		}
		out = append(out, g)
	}
	return out, nil
}

func toAttachment(a model.Attachment) generated.Attachment {
	return generated.Attachment{
		ID:          a.ID,
		WorkspaceID: a.WorkspaceID,
		IssueID:     a.IssueID,
		TeamID:      a.TeamID,
		URL:         a.URL,
		Title:       a.Title,
		Subtitle:    a.Subtitle,
		IconURL:     a.IconURL,
		Metadata:    a.Metadata,
		CreatorID:   a.CreatorID,
		CreatedAt:   a.CreatedAt,
		UpdatedAt:   a.UpdatedAt,
	}
}

func toAttachments(rows []model.Attachment) []generated.Attachment {
	out := make([]generated.Attachment, 0, len(rows))
	for _, a := range rows {
		out = append(out, toAttachment(a))
	}
	return out
}

func toDocument(d model.Document) generated.Document {
	return generated.Document{
		ID:          d.ID,
		WorkspaceID: d.WorkspaceID,
		TeamID:      d.TeamID,
		ProjectID:   d.ProjectID,
		Title:       d.Title,
		Body:        d.Body,
		SortOrder:   d.SortOrder,
		CreatorID:   d.CreatorID,
		UpdatedBy:   d.UpdatedBy,
		CreatedAt:   d.CreatedAt,
		UpdatedAt:   d.UpdatedAt,
		ArchivedAt:  d.ArchivedAt,
		DeletedAt:   d.DeletedAt,
	}
}

func toHistoryEntry(e model.IssueHistoryEntry) (generated.IssueHistoryEntry, error) {
	actor, err := toActor(e.Actor)
	if err != nil {
		return generated.IssueHistoryEntry{}, err
	}
	from, err := toRawJSON(e.FromValue)
	if err != nil {
		return generated.IssueHistoryEntry{}, err
	}
	to, err := toRawJSON(e.ToValue)
	if err != nil {
		return generated.IssueHistoryEntry{}, err
	}
	return generated.IssueHistoryEntry{
		ID:        e.ID,
		IssueID:   e.IssueID,
		Actor:     actor,
		Kind:      e.Kind,
		FromValue: from,
		ToValue:   to,
		CreatedAt: e.CreatedAt,
	}, nil
}

func toHistory(entries []model.IssueHistoryEntry) ([]generated.IssueHistoryEntry, error) {
	out := make([]generated.IssueHistoryEntry, 0, len(entries))
	for _, e := range entries {
		g, err := toHistoryEntry(e)
		if err != nil {
			return nil, err
		}
		out = append(out, g)
	}
	return out, nil
}

func toActor(a model.Actor) (*generated.Actor, error) {
	t, err := toActorType(a.Type)
	if err != nil {
		return nil, err
	}
	return &generated.Actor{Type: t, ID: a.ID}, nil
}

// toRawJSON passes a history entry's before/after value through untouched when it is
// already JSON — a string has to stay a string and a uuid a uuid — and encodes anything
// else rather than dropping it.
func toRawJSON(v any) (json.RawMessage, error) {
	if v == nil {
		return nil, nil
	}
	if raw, ok := v.(json.RawMessage); ok {
		return raw, nil
	}
	b, err := json.Marshal(v)
	if err != nil {
		return nil, platform.Internal(fmt.Errorf("encode history value: %w", err))
	}
	return b, nil
}

// --- enums ----------------------------------------------------------------------
//
// Every mapping below is written out by hand instead of upper-casing the stored string.
// An unrecognised value must fail rather than land on the zero enum: coercing it would
// hand a client the role OWNER for a value the server did not understand, and the bug
// would surface months later as a permissions question nobody can reproduce. It is an
// internal error rather than a validation one because the offending value came out of our
// own database, not out of the request.

func toUserRole(v string) (generated.UserRole, error) {
	switch authz.Role(v) {
	case authz.RoleOwner:
		return generated.UserRoleOwner, nil
	case authz.RoleAdmin:
		return generated.UserRoleAdmin, nil
	case authz.RoleMember:
		return generated.UserRoleMember, nil
	case authz.RoleGuest:
		return generated.UserRoleGuest, nil
	}
	return "", platform.Internal(fmt.Errorf("unknown user role %q", v))
}

func toUserStatus(v string) (generated.UserStatus, error) {
	switch v {
	case "active":
		return generated.UserStatusActive, nil
	case "suspended":
		return generated.UserStatusSuspended, nil
	}
	return "", platform.Internal(fmt.Errorf("unknown user status %q", v))
}

func toUserKind(v string) (generated.UserKind, error) {
	switch v {
	case "human":
		return generated.UserKindHuman, nil
	case "app":
		return generated.UserKindApp, nil
	}
	return "", platform.Internal(fmt.Errorf("unknown user kind %q", v))
}

func toTeamRole(v string) (generated.TeamRole, error) {
	switch v {
	case "owner":
		return generated.TeamRoleOwner, nil
	case "member":
		return generated.TeamRoleMember, nil
	}
	return "", platform.Internal(fmt.Errorf("unknown team role %q", v))
}

func toStateCategory(v string) (generated.StateCategory, error) {
	switch v {
	case domain.CategoryTriage:
		return generated.StateCategoryTriage, nil
	case domain.CategoryBacklog:
		return generated.StateCategoryBacklog, nil
	case domain.CategoryUnstarted:
		return generated.StateCategoryUnstarted, nil
	case domain.CategoryStarted:
		return generated.StateCategoryStarted, nil
	case domain.CategoryCompleted:
		return generated.StateCategoryCompleted, nil
	case domain.CategoryCanceled:
		return generated.StateCategoryCanceled, nil
	case domain.CategoryDuplicate:
		return generated.StateCategoryDuplicate, nil
	}
	return "", platform.Internal(fmt.Errorf("unknown status category %q", v))
}

func toActorType(v string) (generated.ActorType, error) {
	switch authz.ActorType(v) {
	case authz.ActorUser:
		return generated.ActorTypeUser, nil
	case authz.ActorAppUser:
		return generated.ActorTypeAppUser, nil
	case authz.ActorIntegration:
		return generated.ActorTypeIntegration, nil
	case authz.ActorSystem:
		return generated.ActorTypeSystem, nil
	}
	return "", platform.Internal(fmt.Errorf("unknown actor type %q", v))
}

// The reverse direction. gqlgen has already checked the value against the schema, so an
// unknown one here means the schema and the domain's vocabulary have drifted apart —
// which is a validation error from the caller's point of view, because the only thing
// they can do about it is send a different value.

func fromStateCategory(c generated.StateCategory) (string, error) {
	switch c {
	case generated.StateCategoryTriage:
		return domain.CategoryTriage, nil
	case generated.StateCategoryBacklog:
		return domain.CategoryBacklog, nil
	case generated.StateCategoryUnstarted:
		return domain.CategoryUnstarted, nil
	case generated.StateCategoryStarted:
		return domain.CategoryStarted, nil
	case generated.StateCategoryCompleted:
		return domain.CategoryCompleted, nil
	case generated.StateCategoryCanceled:
		return domain.CategoryCanceled, nil
	case generated.StateCategoryDuplicate:
		// Accepted here and refused by the domain, so the reason ("system-managed") is
		// stated once, in the layer that owns the rule.
		return domain.CategoryDuplicate, nil
	}
	return "", platform.Validation("category", fmt.Sprintf("unknown status category %q", c))
}

func fromUserRole(r generated.UserRole) (string, error) {
	switch r {
	case generated.UserRoleOwner:
		return string(authz.RoleOwner), nil
	case generated.UserRoleAdmin:
		return string(authz.RoleAdmin), nil
	case generated.UserRoleMember:
		return string(authz.RoleMember), nil
	case generated.UserRoleGuest:
		return string(authz.RoleGuest), nil
	}
	return "", platform.Validation("role", fmt.Sprintf("unknown role %q", r))
}

// fromTeamRole maps an optional role. A nil argument leaves the choice to the domain,
// which defaults to member.
func fromTeamRole(r *generated.TeamRole) (string, error) {
	if r == nil {
		return "", nil
	}
	switch *r {
	case generated.TeamRoleOwner:
		return "owner", nil
	case generated.TeamRoleMember:
		return "member", nil
	}
	return "", platform.Validation("role", fmt.Sprintf("unknown team role %q", *r))
}

// --- optional inputs ------------------------------------------------------------

func deref[T any](p *T) T {
	if p == nil {
		var zero T
		return zero
	}
	return *p
}
