package domain

import (
	"context"
	"encoding/json"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/store"
)

// Recurring issues are a snapshot plus a cadence. The next occurrence is filed after
// the current due date has passed, at 00:01 in the team's timezone — not when the
// current issue is completed, and not by re-reading a source template. Editing that
// template later is why the snapshot exists.

var knownCadences = map[string]bool{
	model.CadenceDaily:     true,
	model.CadenceWeekly:    true,
	model.CadenceBiweekly:  true,
	model.CadenceMonthly:   true,
	model.CadenceQuarterly: true,
	model.CadenceYearly:    true,
}

type CreateRecurringIssueInput struct {
	TeamID uuid.UUID

	Title      string
	Body       string
	Properties json.RawMessage

	// TemplateID is provenance: which template this was converted from. Never consulted
	// when minting. Nil when the schedule was written by hand or converted from an issue.
	TemplateID *uuid.UUID

	Cadence      string
	FirstDueDate model.Date

	// SourceIssueID converts an existing issue into the first occurrence instead of
	// filing a new one. The issue must belong to TeamID, and becomes the current
	// occurrence — its due date is set to FirstDueDate if it has none.
	SourceIssueID *uuid.UUID
}

type UpdateRecurringIssueInput struct {
	ID          uuid.UUID
	Title       *string
	Body        *string
	Properties  json.RawMessage
	Cadence     *string
	NextDueDate *model.Date
}

func (s *Service) CreateRecurringIssue(
	ctx context.Context, p *authz.Principal, in CreateRecurringIssueInput,
) (model.RecurringIssue, int64, error) {
	title := strings.TrimSpace(in.Title)
	if title == "" {
		return model.RecurringIssue{}, 0, platform.Validation("title", "a recurring issue needs a title")
	}
	if len(title) > maxTitleLength {
		return model.RecurringIssue{}, 0, platform.Validation("title", "title is too long")
	}
	if len(in.Body) > maxDescriptionLength {
		return model.RecurringIssue{}, 0, platform.Validation("body", "body is too long")
	}
	if err := validateCadence(in.Cadence); err != nil {
		return model.RecurringIssue{}, 0, err
	}
	due, err := parseRequiredDueDate("firstDueDate", in.FirstDueDate)
	if err != nil {
		return model.RecurringIssue{}, 0, err
	}
	propertiesJSON, err := jsonObject("properties", in.Properties)
	if err != nil {
		return model.RecurringIssue{}, 0, err
	}
	if in.TemplateID != nil {
		if err := s.validateTemplate(ctx, s.db.Queries(), p, in.TeamID, in.TemplateID); err != nil {
			return model.RecurringIssue{}, 0, err
		}
	}

	var out model.RecurringIssue
	var version int64
	err = s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		team, err := s.requireTeamAccess(ctx, q, p, in.TeamID, authz.ActionIssueCreate)
		if err != nil {
			return err
		}

		id, err := uuid.NewV7()
		if err != nil {
			return platform.Internal(err)
		}

		now := time.Now()
		row, err := q.CreateRecurringIssue(ctx, store.CreateRecurringIssueParams{
			ID:            id,
			WorkspaceID:   p.WorkspaceID,
			TeamID:        in.TeamID,
			Title:         title,
			Body:          &in.Body,
			Properties:    propertiesJSON,
			TemplateID:    in.TemplateID,
			Cadence:       in.Cadence,
			NextDueDate:   store.DateOf(due),
			LastCreatedAt: &now,
			CreatedBy:     &p.UserID,
		})
		if err != nil {
			return platform.Internal(err)
		}
		out = toRecurringIssue(store.GetRecurringIssueRow(row))

		if version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "recurringIssue", EntityID: out.ID, Op: OpUpsert, TeamID: &in.TeamID,
			Scope: authz.TeamScope(in.TeamID, team.Private), Payload: out,
		}); err != nil {
			return err
		}

		if in.SourceIssueID != nil {
			return s.linkExistingOccurrence(ctx, q, p, team, *in.SourceIssueID, out, due)
		}
		_, version, err = s.mintOccurrence(ctx, q, p.WorkspaceID, team, out, due, now, p)
		return err
	})
	return out, version, err
}

func (s *Service) UpdateRecurringIssue(
	ctx context.Context, p *authz.Principal, in UpdateRecurringIssueInput,
) (model.RecurringIssue, int64, error) {
	var title *string
	if in.Title != nil {
		t := strings.TrimSpace(*in.Title)
		if t == "" {
			return model.RecurringIssue{}, 0, platform.Validation("title", "a recurring issue needs a title")
		}
		if len(t) > maxTitleLength {
			return model.RecurringIssue{}, 0, platform.Validation("title", "title is too long")
		}
		title = &t
	}
	if in.Body != nil && len(*in.Body) > maxDescriptionLength {
		return model.RecurringIssue{}, 0, platform.Validation("body", "body is too long")
	}
	if in.Cadence != nil {
		if err := validateCadence(*in.Cadence); err != nil {
			return model.RecurringIssue{}, 0, err
		}
	}
	var due *time.Time
	if in.NextDueDate != nil {
		d, err := parseRequiredDueDate("nextDueDate", *in.NextDueDate)
		if err != nil {
			return model.RecurringIssue{}, 0, err
		}
		due = &d
	}
	var propertiesJSON json.RawMessage
	if !isAbsentJSON(in.Properties) {
		props, err := jsonObject("properties", in.Properties)
		if err != nil {
			return model.RecurringIssue{}, 0, err
		}
		propertiesJSON = props
	}

	var out model.RecurringIssue
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		before, team, err := s.requireRecurringAccess(ctx, q, p, in.ID, authz.ActionIssueCreate)
		if err != nil {
			return err
		}

		params := store.UpdateRecurringIssueParams{
			ID:         in.ID,
			Title:      title,
			Body:       in.Body,
			Properties: propertiesJSON,
			Cadence:    in.Cadence,
		}
		if due != nil {
			params.NextDueDate = store.DateOf(*due)
		}
		row, err := q.UpdateRecurringIssue(ctx, params)
		if err != nil {
			if store.IsNotFound(err) {
				return platform.NotFound("recurring issue")
			}
			return platform.Internal(err)
		}
		out = toRecurringIssue(store.GetRecurringIssueRow(row))
		_ = before

		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "recurringIssue", EntityID: out.ID, Op: OpUpsert, TeamID: &out.TeamID,
			Scope: authz.TeamScope(out.TeamID, team.Private), Payload: out,
		})
		return err
	})
	return out, version, err
}

func (s *Service) ArchiveRecurringIssue(
	ctx context.Context, p *authz.Principal, id uuid.UUID, archived bool,
) (uuid.UUID, int64, error) {
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		before, team, err := s.loadRecurringForArchive(ctx, q, p, id, archived)
		if err != nil {
			return err
		}

		change := Change{
			EntityType: "recurringIssue", EntityID: id, Op: OpDelete,
			TeamID: &before.TeamID, Scope: authz.TeamScope(before.TeamID, team.Private),
		}
		if archived {
			if _, err := q.ArchiveRecurringIssue(ctx, id); err != nil {
				if store.IsNotFound(err) {
					return platform.NotFound("recurring issue")
				}
				return platform.Internal(err)
			}
		} else {
			row, err := q.UnarchiveRecurringIssue(ctx, id)
			if err != nil {
				if store.IsNotFound(err) {
					return platform.NotFound("recurring issue")
				}
				return platform.Internal(err)
			}
			change.Op = OpUpsert
			change.Payload = toRecurringIssue(store.GetRecurringIssueRow(row))
		}

		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), change)
		return err
	})
	return id, version, err
}

func (s *Service) ListRecurringIssues(
	ctx context.Context, p *authz.Principal, teamID uuid.UUID,
) ([]model.RecurringIssue, error) {
	q := s.db.Queries()
	if _, err := s.requireTeamAccess(ctx, q, p, teamID, authz.ActionIssueCreate); err != nil {
		return nil, err
	}
	rows, err := q.ListRecurringIssuesForTeam(ctx, teamID)
	if err != nil {
		return nil, platform.Internal(err)
	}
	out := make([]model.RecurringIssue, 0, len(rows))
	for _, r := range rows {
		out = append(out, toRecurringIssue(store.GetRecurringIssueRow(r)))
	}
	return out, nil
}

func (s *Service) GetRecurringIssue(
	ctx context.Context, p *authz.Principal, id uuid.UUID,
) (model.RecurringIssue, error) {
	q := s.db.Queries()
	row, team, err := s.requireRecurringAccess(ctx, q, p, id, authz.ActionIssueCreate)
	if err != nil {
		return model.RecurringIssue{}, err
	}
	_ = team
	return toRecurringIssue(row), nil
}

// AdvanceRecurringIssues files the next occurrence of every schedule whose current due
// date has passed, in the team's timezone. now is injected so a test can stand a day
// ahead rather than wait.
//
// Idempotent: a pass while every due date is still today writes nothing. A row is locked
// before the decision, so two workers racing on midnight cannot mint twice.
func (s *Service) AdvanceRecurringIssues(ctx context.Context, now time.Time) (int, error) {
	rows, err := s.db.Queries().ListActiveRecurringIssues(ctx)
	if err != nil {
		return 0, platform.Internal(err)
	}
	minted := 0
	for _, r := range rows {
		n, err := s.advanceOne(ctx, store.GetRecurringIssueRow(r), now)
		if err != nil {
			return minted, err
		}
		minted += n
	}
	return minted, nil
}

func (s *Service) advanceOne(ctx context.Context, rec store.GetRecurringIssueRow, now time.Time) (int, error) {
	team, err := s.db.Queries().GetTeam(ctx, rec.TeamID)
	if err != nil {
		if store.IsNotFound(err) {
			return 0, nil
		}
		return 0, platform.Internal(err)
	}
	if team.DeletedAt != nil || team.ArchivedAt != nil || team.RetiredAt != nil {
		return 0, nil
	}

	today, err := calendarDayIn(now, team.Timezone)
	if err != nil {
		return 0, err
	}
	if !rec.NextDueDate.Valid || !rec.NextDueDate.Time.Before(today) {
		return 0, nil
	}

	next := addCadence(rec.NextDueDate.Time, rec.Cadence)
	var did int
	err = s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		locked, err := q.GetRecurringIssueForUpdate(ctx, rec.ID)
		if err != nil {
			if store.IsNotFound(err) {
				return nil
			}
			return platform.Internal(err)
		}
		if locked.ArchivedAt != nil || !locked.NextDueDate.Valid || !locked.NextDueDate.Time.Before(today) {
			return nil
		}
		schedule := toRecurringIssue(store.GetRecurringIssueRow(locked))
		due := addCadence(locked.NextDueDate.Time, locked.Cadence)
		_, _, err = s.mintOccurrence(ctx, q, team.WorkspaceID, team, schedule, due, now, nil)
		if err != nil {
			return err
		}
		did = 1
		next = due
		return nil
	})
	_ = next
	return did, err
}

// mintOccurrence files one issue from a schedule snapshot. p is the person who created
// the schedule (first occurrence); nil means the worker, which emits as system.
func (s *Service) mintOccurrence(
	ctx context.Context, q *store.Queries,
	workspaceID uuid.UUID, team store.Team, rec model.RecurringIssue,
	due time.Time, now time.Time, p *authz.Principal,
) (model.Issue, int64, error) {
	props, err := decodeTemplateProperties(rec.Properties)
	if err != nil {
		return model.Issue{}, 0, err
	}

	actor := authz.SystemActor()
	var creator *uuid.UUID
	if p != nil {
		actor = p.Actor()
		creator = &p.UserID
	} else if rec.CreatedBy != nil {
		creator = rec.CreatedBy
	}

	intoTriage := false
	state, err := s.resolveInitialState(ctx, q, team, props.StateID, intoTriage)
	if err != nil {
		return model.Issue{}, 0, err
	}

	number, err := q.AllocateIssueNumber(ctx, rec.TeamID)
	if err != nil {
		return model.Issue{}, 0, platform.Internal(err)
	}
	sortOrder, err := s.sortOrderFor(ctx, q, rec.TeamID, state.ID, nil)
	if err != nil {
		return model.Issue{}, 0, err
	}
	id, err := uuid.NewV7()
	if err != nil {
		return model.Issue{}, 0, platform.Internal(err)
	}

	params := store.CreateIssueParams{
		ID:               id,
		WorkspaceID:      workspaceID,
		TeamID:           rec.TeamID,
		Number:           number,
		Title:            rec.Title,
		Description:      rec.Body,
		StateID:          state.ID,
		AssigneeID:       props.AssigneeID,
		CreatorID:        creator,
		Priority:         int16(props.priorityValue()),
		SortOrder:        sortOrder,
		StartedAt:        startedAtFor(state.Category, nil),
		CompletedAt:      completedAtFor(state.Category),
		CanceledAt:       canceledAtFor(state.Category),
		Estimate:         int16ptr(props.Estimate),
		ParentID:         nil,
		TemplateID:       rec.TemplateID,
		ProjectID:        props.ProjectID,
		CycleID:          props.CycleID,
		RecurringIssueID: &rec.ID,
		DueDate:          store.DateOf(due),
	}

	row, err := q.CreateIssue(ctx, params)
	if err != nil {
		return model.Issue{}, 0, platform.Internal(err)
	}
	out := toIssue(store.AsIssueRow(row), team.Key)

	version, err := s.em.Emit(ctx, q, workspaceID, actor, Change{
		EntityType: "issue", EntityID: id, Op: OpUpsert, TeamID: &rec.TeamID,
		Scope: authz.TeamScope(rec.TeamID, team.Private), Payload: out,
	})
	if err != nil {
		return model.Issue{}, 0, err
	}

	principal := p
	if principal == nil {
		uid := uuid.Nil
		if rec.CreatedBy != nil {
			uid = *rec.CreatedBy
		}
		principal = &authz.Principal{WorkspaceID: workspaceID, UserID: uid}
	}
	for _, labelID := range props.LabelIDs {
		if _, version, err = s.applyIssueLabel(ctx, q, principal, id, rec.TeamID, team.Private, labelID); err != nil {
			// A label that has since been archived or moved must not abort the mint:
			// the schedule's job is to keep filing, not to wait for a taxonomy edit.
			if platform.CodeOf(err) == platform.CodeValidation || platform.CodeOf(err) == platform.CodeNotFound {
				continue
			}
			return model.Issue{}, 0, err
		}
	}

	advanced, err := q.AdvanceRecurringIssue(ctx, store.AdvanceRecurringIssueParams{
		ID:            rec.ID,
		NextDueDate:   store.DateOf(due),
		LastCreatedAt: &now,
	})
	if err != nil {
		return model.Issue{}, 0, platform.Internal(err)
	}
	rec = toRecurringIssue(store.GetRecurringIssueRow(advanced))
	if version, err = s.em.Emit(ctx, q, workspaceID, actor, Change{
		EntityType: "recurringIssue", EntityID: rec.ID, Op: OpUpsert, TeamID: &rec.TeamID,
		Scope: authz.TeamScope(rec.TeamID, team.Private), Payload: rec,
	}); err != nil {
		return model.Issue{}, 0, err
	}

	if props.AssigneeID != nil {
		_ = s.SubscribeOnAction(ctx, q, principal, id, *props.AssigneeID, model.SubscribedAssigned)
	}
	if creator != nil {
		_ = s.SubscribeOnAction(ctx, q, principal, id, *creator, model.SubscribedCreated)
	}
	return out, version, nil
}

func (s *Service) linkExistingOccurrence(
	ctx context.Context, q *store.Queries, p *authz.Principal,
	team store.Team, issueID uuid.UUID, rec model.RecurringIssue, due time.Time,
) error {
	issue, err := q.GetIssueForUpdate(ctx, issueID)
	if err != nil {
		if store.IsNotFound(err) {
			return platform.NotFound("issue")
		}
		return platform.Internal(err)
	}
	if issue.WorkspaceID != p.WorkspaceID || issue.TeamID != rec.TeamID {
		return platform.NotFound("issue")
	}
	if issue.RecurringIssueID != nil {
		return platform.Validation("sourceIssueId", "that issue is already recurring")
	}

	if !issue.DueDate.Valid {
		if _, err = q.UpdateIssue(ctx, store.UpdateIssueParams{
			ID:      issueID,
			DueDate: store.DateOf(due),
		}); err != nil {
			return platform.Internal(err)
		}
	}

	row, err := q.SetIssueRecurringIssueID(ctx, store.SetIssueRecurringIssueIDParams{
		ID:               issueID,
		RecurringIssueID: &rec.ID,
	})
	if err != nil {
		return platform.Internal(err)
	}

	_, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
		EntityType: "issue", EntityID: issueID, Op: OpUpsert, TeamID: &rec.TeamID,
		Scope: authz.TeamScope(rec.TeamID, team.Private), Payload: toIssue(store.AsIssueRow(row), team.Key),
	})
	return err
}

func (s *Service) requireRecurringAccess(
	ctx context.Context, q *store.Queries, p *authz.Principal, id uuid.UUID, action authz.Action,
) (store.GetRecurringIssueRow, store.Team, error) {
	row, err := q.GetRecurringIssue(ctx, id)
	if err != nil {
		if store.IsNotFound(err) {
			return store.GetRecurringIssueRow{}, store.Team{}, platform.NotFound("recurring issue")
		}
		return store.GetRecurringIssueRow{}, store.Team{}, platform.Internal(err)
	}
	if row.WorkspaceID != p.WorkspaceID || row.ArchivedAt != nil {
		return store.GetRecurringIssueRow{}, store.Team{}, platform.NotFound("recurring issue")
	}
	team, err := s.requireTeamAccess(ctx, q, p, row.TeamID, action)
	if err != nil {
		return store.GetRecurringIssueRow{}, store.Team{}, err
	}
	return row, team, nil
}

func (s *Service) loadRecurringForArchive(
	ctx context.Context, q *store.Queries, p *authz.Principal, id uuid.UUID, archived bool,
) (store.GetRecurringIssueRow, store.Team, error) {
	if archived {
		return s.requireRecurringAccess(ctx, q, p, id, authz.ActionIssueCreate)
	}
	row, err := q.GetRecurringIssue(ctx, id)
	if err != nil {
		if store.IsNotFound(err) {
			return store.GetRecurringIssueRow{}, store.Team{}, platform.NotFound("recurring issue")
		}
		return store.GetRecurringIssueRow{}, store.Team{}, platform.Internal(err)
	}
	if row.WorkspaceID != p.WorkspaceID || row.ArchivedAt == nil {
		return store.GetRecurringIssueRow{}, store.Team{}, platform.NotFound("recurring issue")
	}
	team, err := s.requireTeamAccess(ctx, q, p, row.TeamID, authz.ActionIssueCreate)
	if err != nil {
		return store.GetRecurringIssueRow{}, store.Team{}, err
	}
	return row, team, nil
}

func validateCadence(cadence string) error {
	if !knownCadences[cadence] {
		return platform.Validation("cadence", "cadence must be daily, weekly, biweekly, monthly, quarterly or yearly")
	}
	return nil
}

func parseRequiredDueDate(field string, d model.Date) (time.Time, error) {
	if string(d) == "" {
		return time.Time{}, platform.Validation(field, "a due date is required")
	}
	t, ok, err := parseDueDate(&d)
	if err != nil {
		return time.Time{}, err
	}
	if !ok {
		return time.Time{}, platform.Validation(field, "a due date is required")
	}
	return t, nil
}

func calendarDayIn(now time.Time, timezone string) (time.Time, error) {
	loc, err := time.LoadLocation(timezone)
	if err != nil {
		loc = time.UTC
	}
	local := now.In(loc)
	return time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, time.UTC), nil
}

// addCadence advances a calendar day. Monthly/quarterly/yearly clamp to the last day
// of the target month rather than overflowing into the next — 31 January plus one
// month is 28 February, not 3 March, because a due date that silently jumps a month
// is how a monthly report is missed.
func addCadence(d time.Time, cadence string) time.Time {
	switch cadence {
	case model.CadenceDaily:
		return d.AddDate(0, 0, 1)
	case model.CadenceWeekly:
		return d.AddDate(0, 0, 7)
	case model.CadenceBiweekly:
		return d.AddDate(0, 0, 14)
	case model.CadenceMonthly:
		return addClampedMonths(d, 1)
	case model.CadenceQuarterly:
		return addClampedMonths(d, 3)
	case model.CadenceYearly:
		return addClampedMonths(d, 12)
	default:
		return d.AddDate(0, 0, 7)
	}
}

func addClampedMonths(d time.Time, months int) time.Time {
	y, m, day := d.Date()
	first := time.Date(y, m+time.Month(months), 1, 0, 0, 0, 0, time.UTC)
	last := first.AddDate(0, 1, -1).Day()
	if day > last {
		day = last
	}
	return time.Date(first.Year(), first.Month(), day, 0, 0, 0, 0, time.UTC)
}

func (s *Service) attachRecurringOnCreate(
	ctx context.Context, q *store.Queries, p *authz.Principal,
	team store.Team, issue *model.Issue, in CreateIssueInput,
) error {
	cadence := strings.ToLower(strings.TrimSpace(*in.RecurringCadence))
	if err := validateCadence(cadence); err != nil {
		return err
	}
	first := in.RecurringFirstDueDate
	if first == nil {
		first = in.DueDate
	}
	if first == nil {
		return platform.Validation("recurringFirstDueDate", "a first due date is required")
	}
	due, err := parseRequiredDueDate("recurringFirstDueDate", *first)
	if err != nil {
		return err
	}

	props, err := json.Marshal(templateProperties{
		StateID:    in.StateID,
		AssigneeID: in.AssigneeID,
		Priority:   intPtrIfSet(in.Priority),
		Estimate:   in.Estimate,
		LabelIDs:   in.LabelIDs,
		ProjectID:  in.ProjectID,
		CycleID:    in.CycleID,
	})
	if err != nil {
		return platform.Internal(err)
	}

	id, err := uuid.NewV7()
	if err != nil {
		return platform.Internal(err)
	}
	now := time.Now()
	row, err := q.CreateRecurringIssue(ctx, store.CreateRecurringIssueParams{
		ID:            id,
		WorkspaceID:   p.WorkspaceID,
		TeamID:        in.TeamID,
		Title:         issue.Title,
		Body:          &issue.Description,
		Properties:    props,
		TemplateID:    in.TemplateID,
		Cadence:       cadence,
		NextDueDate:   store.DateOf(due),
		LastCreatedAt: &now,
		CreatedBy:     &p.UserID,
	})
	if err != nil {
		return platform.Internal(err)
	}
	rec := toRecurringIssue(store.GetRecurringIssueRow(row))
	if _, err := s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
		EntityType: "recurringIssue", EntityID: rec.ID, Op: OpUpsert, TeamID: &in.TeamID,
		Scope: authz.TeamScope(in.TeamID, team.Private), Payload: rec,
	}); err != nil {
		return err
	}

	if issue.DueDate == nil {
		updated, err := q.UpdateIssue(ctx, store.UpdateIssueParams{
			ID:      issue.ID,
			DueDate: store.DateOf(due),
		})
		if err != nil {
			return platform.Internal(err)
		}
		*issue = toIssue(store.AsIssueRow(updated), team.Key)
	}

	linked, err := q.SetIssueRecurringIssueID(ctx, store.SetIssueRecurringIssueIDParams{
		ID:               issue.ID,
		RecurringIssueID: &rec.ID,
	})
	if err != nil {
		return platform.Internal(err)
	}
	*issue = toIssue(store.AsIssueRow(linked), team.Key)
	return nil
}

func intPtrIfSet(n int) *int {
	if n == 0 {
		return nil
	}
	return &n
}
