package domain

import (
	"context"
	"time"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/notify"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/store"
)

// Auto-close and auto-archive are team settings and a worker. The blocking conditions
// (active cycle, unfinished project, future due date, open children; and for archive:
// open parent, open children, open project) are the product, not polish — archiving a
// closed issue out from under an open project is how a project's graph goes missing.

type UpdateTeamArchiveInput struct {
	TeamID            uuid.UUID
	AutoCloseDays     *int
	AutoArchiveDays   *int
	AutoCloseParent   *bool
	AutoCloseChildren *bool
}

func (s *Service) UpdateTeamArchive(
	ctx context.Context, p *authz.Principal, in UpdateTeamArchiveInput,
) (model.Team, int64, error) {
	if err := validateArchivePeriod("autoCloseDays", in.AutoCloseDays, autoCloseDays); err != nil {
		return model.Team{}, 0, err
	}
	if err := validateArchivePeriod("autoArchiveDays", in.AutoArchiveDays, autoArchiveDays); err != nil {
		return model.Team{}, 0, err
	}

	var out model.Team
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		if _, err := s.requireTeamAccess(ctx, q, p, in.TeamID, authz.ActionTeamUpdate); err != nil {
			return err
		}
		row, err := q.UpdateTeamArchive(ctx, store.UpdateTeamArchiveParams{
			ID:                in.TeamID,
			AutoCloseDays:     int16ptr(in.AutoCloseDays),
			AutoArchiveDays:   int16ptr(in.AutoArchiveDays),
			AutoCloseParent:   in.AutoCloseParent,
			AutoCloseChildren: in.AutoCloseChildren,
		})
		if err != nil {
			return platform.Internal(err)
		}
		out = toTeam(row)
		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "team", EntityID: out.ID, Op: OpUpsert, TeamID: &out.ID,
			Scope: authz.TeamScope(out.ID, out.Private), Payload: out,
		})
		return err
	})
	return out, version, err
}

var (
	autoCloseDays   = []int{0, 30, 60, 90, 180}
	autoArchiveDays = []int{0, 30, 60, 90, 180, 365}
)

func validateArchivePeriod(field string, value *int, allowed []int) error {
	if value == nil {
		return nil
	}
	for _, n := range allowed {
		if *value == n {
			return nil
		}
	}
	return platform.Validation(field, "not an offered period")
}

// AutoCloseIssues moves stale open issues into a completed status, unless a load-bearing
// skip applies. now is injected so a test can stand 31 days ahead rather than wait.
func (s *Service) AutoCloseIssues(ctx context.Context, now time.Time) (int, error) {
	teams, err := s.db.Queries().ListTeamsWithAutoClose(ctx)
	if err != nil {
		return 0, platform.Internal(err)
	}
	closed := 0
	for _, team := range teams {
		n, err := s.autoCloseTeam(ctx, team, now)
		if err != nil {
			return closed, err
		}
		closed += n
	}
	return closed, nil
}

func (s *Service) autoCloseTeam(ctx context.Context, team store.Team, now time.Time) (int, error) {
	cutoff := now.AddDate(0, 0, -int(team.AutoCloseDays))
	dest, err := firstCompletedState(ctx, s.db.Queries(), team.ID)
	if err != nil {
		return 0, err
	}

	candidates, err := s.db.Queries().ListStaleOpenIssues(ctx, store.ListStaleOpenIssuesParams{
		TeamID: team.ID, Cutoff: cutoff,
	})
	if err != nil {
		return 0, platform.Internal(err)
	}

	closed := 0
	for _, issue := range candidates {
		skip, err := s.autoCloseBlocked(ctx, s.db.Queries(), store.AsIssueRow(issue), now)
		if err != nil {
			return closed, err
		}
		if skip {
			continue
		}
		if err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
			_, err := s.moveIssueToState(ctx, q, authz.SystemActor(), team, store.AsIssueRow(issue), dest, now, true)
			return err
		}); err != nil {
			return closed, err
		}
		closed++
	}
	return closed, nil
}

func (s *Service) autoCloseBlocked(ctx context.Context, q *store.Queries, issue store.GetIssueRow, now time.Time) (bool, error) {
	if issue.CycleID != nil {
		cycle, err := q.GetCycle(ctx, *issue.CycleID)
		if err != nil && !store.IsNotFound(err) {
			return false, platform.Internal(err)
		}
		if err == nil && cycle.CompletedAt == nil && !now.Before(cycle.StartsAt) && now.Before(cycle.EndsAt) {
			return true, nil
		}
	}
	if issue.ProjectID != nil {
		project, err := q.GetProject(ctx, *issue.ProjectID)
		if err != nil && !store.IsNotFound(err) {
			return false, platform.Internal(err)
		}
		if err == nil {
			st, err := q.GetProjectStatus(ctx, project.StatusID)
			if err != nil {
				return false, platform.Internal(err)
			}
			if st.Category != model.ProjectCategoryCompleted && st.Category != model.ProjectCategoryCanceled {
				return true, nil
			}
		}
	}
	if issue.DueDate.Valid {
		today := calendarDay(now)
		due := calendarDay(issue.DueDate.Time)
		if due.After(today) {
			return true, nil
		}
	}
	open, err := s.hasOpenChildren(ctx, q, issue.ID)
	if err != nil {
		return false, err
	}
	return open, nil
}

// AutoArchive hides stale completed work — issues, then the projects that own them, then
// cycles. Issues in an open project are never archived on their own: the project takes
// them when it itself becomes archivable.
func (s *Service) AutoArchive(ctx context.Context, now time.Time) (int, error) {
	teams, err := s.db.Queries().ListTeamsWithAutoArchive(ctx)
	if err != nil {
		return 0, platform.Internal(err)
	}
	archived := 0
	for _, team := range teams {
		n, err := s.autoArchiveTeam(ctx, team, now)
		if err != nil {
			return archived, err
		}
		archived += n
	}
	return archived, nil
}

func (s *Service) autoArchiveTeam(ctx context.Context, team store.Team, now time.Time) (int, error) {
	cutoff := now.AddDate(0, 0, -int(team.AutoArchiveDays))
	archived := 0

	issues, err := s.db.Queries().ListStaleClosedIssues(ctx, store.ListStaleClosedIssuesParams{
		TeamID: team.ID, Cutoff: cutoff,
	})
	if err != nil {
		return 0, platform.Internal(err)
	}
	for _, issue := range issues {
		if issue.ProjectID != nil {
			continue
		}
		ok, err := s.issueGraphClear(ctx, s.db.Queries(), store.AsIssueRow(issue))
		if err != nil {
			return archived, err
		}
		if !ok {
			continue
		}
		if err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
			return s.archiveIssueLocked(ctx, q, team, store.AsIssueRow(issue), authz.SystemActor(), true)
		}); err != nil {
			return archived, err
		}
		archived++
	}

	projects, err := s.db.Queries().ListStaleClosedProjectsForTeam(ctx, store.ListStaleClosedProjectsForTeamParams{
		TeamID: team.ID, Cutoff: cutoff,
	})
	if err != nil {
		return archived, platform.Internal(err)
	}
	for _, project := range projects {
		n, err := s.autoArchiveProject(ctx, team, project, cutoff)
		if err != nil {
			return archived, err
		}
		archived += n
	}

	cycles, err := s.db.Queries().ListStaleCompletedCycles(ctx, store.ListStaleCompletedCyclesParams{
		TeamID: team.ID, Cutoff: &cutoff,
	})
	if err != nil {
		return archived, platform.Internal(err)
	}
	for _, cycle := range cycles {
		if err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
			_, err := s.archiveCycleLocked(ctx, q, team, cycle, authz.SystemActor(), true)
			return err
		}); err != nil {
			return archived, err
		}
		archived++
	}
	return archived, nil
}

func (s *Service) autoArchiveProject(ctx context.Context, team store.Team, project store.Project, cutoff time.Time) (int, error) {
	issues, err := s.db.Queries().ListIssuesForProject(ctx, &project.ID)
	if err != nil {
		return 0, platform.Internal(err)
	}
	for _, issue := range issues {
		if !issue.UpdatedAt.Before(cutoff) {
			return 0, nil
		}
		st, err := s.db.Queries().GetWorkflowState(ctx, issue.StateID)
		if err != nil {
			return 0, platform.Internal(err)
		}
		if !isClosedCategory(st.Category) {
			return 0, nil
		}
		ok, err := s.issueGraphClear(ctx, s.db.Queries(), store.AsIssueRow(issue))
		if err != nil {
			return 0, err
		}
		if !ok {
			return 0, nil
		}
	}

	n := 0
	err = s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		for _, issue := range issues {
			issueTeam := team
			if issue.TeamID != team.ID {
				issueTeam, err = q.GetTeam(ctx, issue.TeamID)
				if err != nil {
					return platform.Internal(err)
				}
			}
			if err := s.archiveIssueLocked(ctx, q, issueTeam, store.AsIssueRow(issue), authz.SystemActor(), true); err != nil {
				return err
			}
			n++
		}
		if _, err := s.archiveProjectLocked(ctx, q, project, authz.SystemActor(), true); err != nil {
			return err
		}
		n++
		return nil
	})
	return n, err
}

func (s *Service) issueGraphClear(ctx context.Context, q *store.Queries, issue store.GetIssueRow) (bool, error) {
	if issue.ParentID != nil {
		closed, err := s.issueIsClosed(ctx, q, *issue.ParentID)
		if err != nil {
			return false, err
		}
		if !closed {
			return false, nil
		}
	}
	open, err := s.hasOpenChildren(ctx, q, issue.ID)
	if err != nil {
		return false, err
	}
	return !open, nil
}

func (s *Service) hasOpenChildren(ctx context.Context, q *store.Queries, parentID uuid.UUID) (bool, error) {
	children, err := q.ListChildIssues(ctx, &parentID)
	if err != nil {
		return false, platform.Internal(err)
	}
	for _, child := range children {
		closed, err := s.issueRowClosed(ctx, q, store.AsIssueRow(child))
		if err != nil {
			return false, err
		}
		if !closed {
			return true, nil
		}
	}
	return false, nil
}

func (s *Service) issueIsClosed(ctx context.Context, q *store.Queries, id uuid.UUID) (bool, error) {
	row, err := q.GetIssue(ctx, id)
	if err != nil {
		if store.IsNotFound(err) {
			return true, nil
		}
		return false, platform.Internal(err)
	}
	return s.issueRowClosed(ctx, q, row)
}

func (s *Service) issueRowClosed(ctx context.Context, q *store.Queries, row store.GetIssueRow) (bool, error) {
	if row.ArchivedAt != nil {
		return true, nil
	}
	st, err := q.GetWorkflowState(ctx, row.StateID)
	if err != nil {
		return false, platform.Internal(err)
	}
	return isClosedCategory(st.Category), nil
}

func isClosedCategory(category string) bool {
	return category == CategoryCompleted || category == CategoryCanceled || category == CategoryDuplicate
}

func firstCompletedState(ctx context.Context, q *store.Queries, teamID uuid.UUID) (store.WorkflowState, error) {
	states, err := q.ListWorkflowStatesForTeam(ctx, teamID)
	if err != nil {
		return store.WorkflowState{}, platform.Internal(err)
	}
	var canceled *store.WorkflowState
	for i := range states {
		switch states[i].Category {
		case CategoryCompleted:
			return states[i], nil
		case CategoryCanceled:
			if canceled == nil {
				canceled = &states[i]
			}
		}
	}
	if canceled != nil {
		return *canceled, nil
	}
	return store.WorkflowState{}, platform.Validation("stateId", "this team has no completed status")
}

func calendarDay(t time.Time) time.Time {
	y, m, d := t.Date()
	return time.Date(y, m, d, 0, 0, 0, 0, time.UTC)
}

func (s *Service) moveIssueToState(
	ctx context.Context, q *store.Queries, actor authz.Actor, team store.Team,
	before store.GetIssueRow, dest store.WorkflowState, now time.Time, autoClosed bool,
) (store.GetIssueRow, error) {
	sortOrder, err := s.sortOrderFor(ctx, q, before.TeamID, dest.ID, nil)
	if err != nil {
		return store.GetIssueRow{}, err
	}
	oldState, err := q.GetWorkflowState(ctx, before.StateID)
	if err != nil {
		return store.GetIssueRow{}, platform.Internal(err)
	}

	params := store.UpdateIssueParams{
		ID:            before.ID,
		StateID:       &dest.ID,
		SortOrder:     &sortOrder,
		SetTimestamps: true,
		StartedAt:     startedAtFor(dest.Category, before.StartedAt),
		CompletedAt:   completedAtFor(dest.Category),
		CanceledAt:    canceledAtFor(dest.Category),
		ClearSnooze:   before.SnoozedUntil != nil,
	}
	if autoClosed {
		params.AutoClosedAt = &now
	}
	row, err := q.UpdateIssue(ctx, params)
	if err != nil {
		return store.GetIssueRow{}, platform.Internal(err)
	}

	out := toIssue(store.AsIssueRow(row), team.Key)
	if _, err := s.em.Emit(ctx, q, team.WorkspaceID, actor, Change{
		EntityType: "issue", EntityID: row.ID, Op: OpUpsert, TeamID: &row.TeamID,
		Scope:         authz.TeamScope(row.TeamID, team.Private),
		Payload:       out,
		ChangedFields: []string{notify.FieldState},
	}); err != nil {
		return store.GetIssueRow{}, err
	}
	if err := s.em.History(ctx, q, team.WorkspaceID, actor, before.CreatedAt, HistoryEntry{
		IssueID: row.ID, Kind: "state", FromValue: oldState.Name, ToValue: dest.Name,
	}); err != nil {
		return store.GetIssueRow{}, err
	}
	return store.AsIssueRow(row), nil
}

func (s *Service) applyFamilyClose(
	ctx context.Context, q *store.Queries, p *authz.Principal, team store.Team,
	issue store.GetIssueRow, newState *store.WorkflowState, visited map[uuid.UUID]bool,
) error {
	if newState == nil || !isClosedCategory(newState.Category) {
		return nil
	}
	if visited[issue.ID] {
		return nil
	}
	visited[issue.ID] = true

	if team.AutoCloseChildren {
		children, err := q.ListChildIssues(ctx, &issue.ID)
		if err != nil {
			return platform.Internal(err)
		}
		for _, child := range children {
			closed, err := s.issueRowClosed(ctx, q, store.AsIssueRow(child))
			if err != nil {
				return err
			}
			if closed {
				continue
			}
			childTeam := team
			if child.TeamID != team.ID {
				childTeam, err = q.GetTeam(ctx, child.TeamID)
				if err != nil {
					return platform.Internal(err)
				}
			}
			dest, err := firstCompletedState(ctx, q, child.TeamID)
			if err != nil {
				return err
			}
			row, err := s.moveIssueToState(ctx, q, p.Actor(), childTeam, store.AsIssueRow(child), dest, time.Now(), false)
			if err != nil {
				return err
			}
			if err := s.applyFamilyClose(ctx, q, p, childTeam, row, &dest, visited); err != nil {
				return err
			}
		}
	}

	if team.AutoCloseParent && issue.ParentID != nil {
		open, err := s.hasOpenChildren(ctx, q, *issue.ParentID)
		if err != nil {
			return err
		}
		if open {
			return nil
		}
		parent, err := q.GetIssue(ctx, *issue.ParentID)
		if err != nil {
			if store.IsNotFound(err) {
				return nil
			}
			return platform.Internal(err)
		}
		closed, err := s.issueRowClosed(ctx, q, parent)
		if err != nil {
			return err
		}
		if closed {
			return nil
		}
		parentTeam, err := q.GetTeam(ctx, parent.TeamID)
		if err != nil {
			return platform.Internal(err)
		}
		dest, err := firstCompletedState(ctx, q, parent.TeamID)
		if err != nil {
			return err
		}
		row, err := s.moveIssueToState(ctx, q, p.Actor(), parentTeam, parent, dest, time.Now(), false)
		if err != nil {
			return err
		}
		return s.applyFamilyClose(ctx, q, p, parentTeam, row, &dest, visited)
	}
	return nil
}

func (s *Service) archiveIssueLocked(
	ctx context.Context, q *store.Queries, team store.Team, before store.GetIssueRow, actor authz.Actor, archived bool,
) error {
	if archived {
		if err := q.ArchiveIssue(ctx, before.ID); err != nil {
			return platform.Internal(err)
		}
	} else if err := q.UnarchiveIssue(ctx, before.ID); err != nil {
		return platform.Internal(err)
	}

	change := Change{
		EntityType: "issue", EntityID: before.ID, TeamID: &before.TeamID,
		Scope:         authz.TeamScope(before.TeamID, team.Private),
		ChangedFields: []string{notify.FieldArchived},
	}
	kind := "unarchived"
	if archived {
		kind = "archived"
		change.Op = OpDelete
	} else {
		change.Op = OpUpsert
		after, err := q.GetIssue(ctx, before.ID)
		if err != nil {
			return platform.Internal(err)
		}
		change.Payload = toIssue(store.AsIssueRow(after), team.Key)
	}
	if _, err := s.em.Emit(ctx, q, team.WorkspaceID, actor, change); err != nil {
		return err
	}
	return s.em.History(ctx, q, team.WorkspaceID, actor, before.CreatedAt, HistoryEntry{
		IssueID: before.ID, Kind: kind,
	})
}

func (s *Service) ArchiveCycle(ctx context.Context, p *authz.Principal, id uuid.UUID, archived bool) (int64, error) {
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		cycle, err := q.GetCycle(ctx, id)
		if err != nil {
			if store.IsNotFound(err) {
				return platform.NotFound("cycle")
			}
			return platform.Internal(err)
		}
		team, err := s.requireTeamAccess(ctx, q, p, cycle.TeamID, authz.ActionTeamUpdate)
		if err != nil {
			return err
		}
		version, err = s.archiveCycleLocked(ctx, q, team, cycle, p.Actor(), archived)
		return err
	})
	return version, err
}

func (s *Service) archiveCycleLocked(
	ctx context.Context, q *store.Queries, team store.Team, cycle store.Cycle, actor authz.Actor, archived bool,
) (int64, error) {
	if archived {
		if err := q.ArchiveCycle(ctx, cycle.ID); err != nil {
			return 0, platform.Internal(err)
		}
	} else {
		row, err := q.UnarchiveCycle(ctx, cycle.ID)
		if err != nil {
			return 0, platform.Internal(err)
		}
		cycle = row
	}
	change := Change{
		EntityType: "cycle", EntityID: cycle.ID, TeamID: &cycle.TeamID,
		Scope: authz.TeamScope(cycle.TeamID, team.Private),
	}
	if archived {
		change.Op = OpDelete
	} else {
		change.Op = OpUpsert
		change.Payload = toCycle(cycle)
	}
	return s.em.Emit(ctx, q, team.WorkspaceID, actor, change)
}

func (s *Service) ArchiveProject(ctx context.Context, p *authz.Principal, id uuid.UUID, archived bool) (int64, error) {
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		project, _, err := s.requireProjectWrite(ctx, q, p, id, authz.ActionProjectUpdate)
		if err != nil {
			return err
		}
		version, err = s.archiveProjectLocked(ctx, q, project, p.Actor(), archived)
		return err
	})
	return version, err
}

func (s *Service) archiveProjectLocked(
	ctx context.Context, q *store.Queries, project store.Project, actor authz.Actor, archived bool,
) (int64, error) {
	scope, err := s.projectScope(ctx, q, project.ID)
	if err != nil {
		return 0, err
	}
	if archived {
		if err := q.ArchiveProject(ctx, project.ID); err != nil {
			return 0, platform.Internal(err)
		}
		if err := emitProjectSubscriptionDeletes(ctx, s.em, q, project.WorkspaceID, project.ID); err != nil {
			return 0, err
		}
	} else {
		row, err := q.UnarchiveProject(ctx, project.ID)
		if err != nil {
			return 0, platform.Internal(err)
		}
		project = row
	}
	change := Change{
		EntityType: "project", EntityID: project.ID, Scope: scope,
	}
	if archived {
		change.Op = OpDelete
	} else {
		change.Op = OpUpsert
		change.Payload = toProject(project)
	}
	return s.em.Emit(ctx, q, project.WorkspaceID, actor, change)
}

func (s *Service) ListArchivedIssues(ctx context.Context, p *authz.Principal, teamID uuid.UUID) ([]model.Issue, error) {
	q := s.db.Queries()
	team, err := s.requireTeamAccess(ctx, q, p, teamID, authz.ActionIssueArchive)
	if err != nil {
		return nil, err
	}
	rows, err := q.ListArchivedIssuesForTeam(ctx, teamID)
	if err != nil {
		return nil, platform.Internal(err)
	}
	out := make([]model.Issue, 0, len(rows))
	for _, r := range rows {
		out = append(out, toIssue(store.AsIssueRow(r), team.Key))
	}
	return out, nil
}

func (s *Service) ListArchivedCycles(ctx context.Context, p *authz.Principal, teamID uuid.UUID) ([]model.Cycle, error) {
	q := s.db.Queries()
	if _, err := s.requireTeamAccess(ctx, q, p, teamID, authz.ActionIssueArchive); err != nil {
		return nil, err
	}
	rows, err := q.ListArchivedCyclesForTeam(ctx, teamID)
	if err != nil {
		return nil, platform.Internal(err)
	}
	out := make([]model.Cycle, 0, len(rows))
	for _, r := range rows {
		out = append(out, toCycle(r))
	}
	return out, nil
}

func (s *Service) ListArchivedProjects(ctx context.Context, p *authz.Principal, teamID uuid.UUID) ([]model.Project, error) {
	q := s.db.Queries()
	if _, err := s.requireTeamAccess(ctx, q, p, teamID, authz.ActionIssueArchive); err != nil {
		return nil, err
	}
	rows, err := q.ListArchivedProjectsForTeam(ctx, teamID)
	if err != nil {
		return nil, platform.Internal(err)
	}
	out := make([]model.Project, 0, len(rows))
	for _, r := range rows {
		out = append(out, toProject(r))
	}
	return out, nil
}
