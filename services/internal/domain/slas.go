package domain

import (
	"context"
	"encoding/json"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/entitlement"
	"github.com/peixotolabs/polaris/services/internal/filter"
	"github.com/peixotolabs/polaris/services/internal/fractional"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/store"
)

type CreateSlaRuleInput struct {
	Filter          json.RawMessage
	Action          string
	DurationMinutes *int32
}

type UpdateSlaRuleInput struct {
	ID              uuid.UUID
	Filter          json.RawMessage
	Action          *string
	DurationMinutes *int32
	SetDuration     bool
	AfterID         *uuid.UUID
}

type SetIssueSLAInput struct {
	IssueID         uuid.UUID
	DurationMinutes int32
}

func (s *Service) CreateSlaRule(
	ctx context.Context, p *authz.Principal, in CreateSlaRuleInput,
) (model.SlaRule, int64, error) {
	if !authz.Can(p, authz.ActionWorkspaceUpdate) {
		return model.SlaRule{}, 0, platform.Forbidden("slaRule")
	}
	if err := s.requireSLAs(ctx, p); err != nil {
		return model.SlaRule{}, 0, err
	}
	action, duration, err := validateSlaAction(in.Action, in.DurationMinutes)
	if err != nil {
		return model.SlaRule{}, 0, err
	}
	filt, err := normalizeSlaFilter(in.Filter)
	if err != nil {
		return model.SlaRule{}, 0, err
	}

	id, err := uuid.NewV7()
	if err != nil {
		return model.SlaRule{}, 0, platform.Internal(err)
	}

	var out model.SlaRule
	var version int64
	err = s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		last, err := q.LastSlaRulePosition(ctx, p.WorkspaceID)
		if err != nil && !store.IsNotFound(err) {
			return platform.Internal(err)
		}
		pos := fractional.After(last)
		row, err := q.CreateSlaRule(ctx, store.CreateSlaRuleParams{
			ID:              id,
			WorkspaceID:     p.WorkspaceID,
			Position:        pos,
			Filter:          filt,
			Action:          action,
			DurationMinutes: duration,
		})
		if err != nil {
			return platform.Internal(err)
		}
		out = toSlaRule(row)
		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "slaRule", EntityID: id, Op: OpUpsert,
			Scope: authz.WorkspaceScope(), Payload: out,
		})
		return err
	})
	if err != nil {
		return model.SlaRule{}, 0, err
	}
	return out, version, nil
}

func (s *Service) UpdateSlaRule(
	ctx context.Context, p *authz.Principal, in UpdateSlaRuleInput,
) (model.SlaRule, int64, error) {
	if !authz.Can(p, authz.ActionWorkspaceUpdate) {
		return model.SlaRule{}, 0, platform.Forbidden("slaRule")
	}
	if err := s.requireSLAs(ctx, p); err != nil {
		return model.SlaRule{}, 0, err
	}

	var out model.SlaRule
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		row, err := q.GetSlaRuleForUpdate(ctx, in.ID)
		if err != nil {
			if store.IsNotFound(err) {
				return platform.NotFound("slaRule")
			}
			return platform.Internal(err)
		}
		if row.WorkspaceID != p.WorkspaceID {
			return platform.NotFound("slaRule")
		}

		action := row.Action
		duration := row.DurationMinutes
		if in.Action != nil {
			action, duration, err = validateSlaAction(*in.Action, in.DurationMinutes)
			if err != nil {
				return err
			}
		} else if in.SetDuration {
			action, duration, err = validateSlaAction(action, in.DurationMinutes)
			if err != nil {
				return err
			}
		}

		var filt []byte
		if len(in.Filter) > 0 {
			filt, err = normalizeSlaFilter(in.Filter)
			if err != nil {
				return err
			}
		}

		var position *string
		if in.AfterID != nil {
			pos, err := s.slaPositionAfter(ctx, q, p.WorkspaceID, *in.AfterID)
			if err != nil {
				return err
			}
			position = &pos
		}

		updated, err := q.UpdateSlaRule(ctx, store.UpdateSlaRuleParams{
			Filter:          filt,
			Action:          nullableString(action, in.Action != nil),
			SetDuration:     in.Action != nil || in.SetDuration,
			DurationMinutes: duration,
			Position:        position,
			ID:              in.ID,
		})
		if err != nil {
			return platform.Internal(err)
		}
		out = toSlaRule(updated)
		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "slaRule", EntityID: in.ID, Op: OpUpsert,
			Scope: authz.WorkspaceScope(), Payload: out,
		})
		return err
	})
	if err != nil {
		return model.SlaRule{}, 0, err
	}
	return out, version, nil
}

func (s *Service) DeleteSlaRule(ctx context.Context, p *authz.Principal, id uuid.UUID) (int64, error) {
	if !authz.Can(p, authz.ActionWorkspaceUpdate) {
		return 0, platform.Forbidden("slaRule")
	}
	if err := s.requireSLAs(ctx, p); err != nil {
		return 0, err
	}
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		row, err := q.GetSlaRuleForUpdate(ctx, id)
		if err != nil {
			if store.IsNotFound(err) {
				return platform.NotFound("slaRule")
			}
			return platform.Internal(err)
		}
		if row.WorkspaceID != p.WorkspaceID {
			return platform.NotFound("slaRule")
		}
		if err := q.DeleteSlaRule(ctx, id); err != nil {
			return platform.Internal(err)
		}
		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "slaRule", EntityID: id, Op: OpDelete,
			Scope: authz.WorkspaceScope(), Payload: toSlaRule(row),
		})
		return err
	})
	return version, err
}

func (s *Service) ListSlaRules(ctx context.Context, p *authz.Principal) ([]model.SlaRule, error) {
	if !authz.Visible(p, authz.WorkspaceScope()) {
		return nil, platform.Forbidden("slaRule")
	}
	rows, err := s.db.Queries().ListSlaRulesInWorkspace(ctx, p.WorkspaceID)
	if err != nil {
		return nil, platform.Internal(err)
	}
	out := make([]model.SlaRule, 0, len(rows))
	for _, row := range rows {
		out = append(out, toSlaRule(row))
	}
	return out, nil
}

func (s *Service) SetIssueSLA(
	ctx context.Context, p *authz.Principal, in SetIssueSLAInput,
) (model.Issue, int64, error) {
	if in.DurationMinutes <= 0 {
		return model.Issue{}, 0, platform.Validation("durationMinutes", "duration must be a positive number of minutes")
	}
	if err := s.requireSLAs(ctx, p); err != nil {
		return model.Issue{}, 0, err
	}

	var out model.Issue
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		before, err := q.GetIssueForUpdate(ctx, in.IssueID)
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
		source := model.DueDateSLA
		due := slaDueDay(s.now(), team.Timezone, int(in.DurationMinutes))
		row, err := q.UpdateIssue(ctx, store.UpdateIssueParams{
			DueDateSource: &source,
			DueDate:       store.DateOf(due),
			ID:            in.IssueID,
		})
		if err != nil {
			return platform.Internal(err)
		}
		out = toIssue(store.AsIssueRow(row), team.Key)
		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "issue", EntityID: in.IssueID, Op: OpUpsert,
			TeamID: &before.TeamID, Scope: authz.TeamScope(before.TeamID, team.Private),
			Payload:       out,
			ChangedFields: []string{"dueDate", "dueDateSource"},
		})
		return err
	})
	if err != nil {
		return model.Issue{}, 0, err
	}
	return out, version, nil
}

func (s *Service) ClearIssueSLA(
	ctx context.Context, p *authz.Principal, issueID uuid.UUID,
) (model.Issue, int64, error) {
	if err := s.requireSLAs(ctx, p); err != nil {
		return model.Issue{}, 0, err
	}

	var out model.Issue
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		before, err := q.GetIssueForUpdate(ctx, issueID)
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
		if before.DueDateSource != model.DueDateSLA {
			out = toIssue(store.AsIssueRow(before), team.Key)
			return nil
		}
		source := model.DueDateManual
		row, err := q.UpdateIssue(ctx, store.UpdateIssueParams{
			DueDateSource: &source,
			ClearDueDate:  true,
			ID:            issueID,
		})
		if err != nil {
			return platform.Internal(err)
		}
		out = toIssue(store.AsIssueRow(row), team.Key)
		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "issue", EntityID: issueID, Op: OpUpsert,
			TeamID: &before.TeamID, Scope: authz.TeamScope(before.TeamID, team.Private),
			Payload:       out,
			ChangedFields: []string{"dueDate", "dueDateSource"},
		})
		return err
	})
	if err != nil {
		return model.Issue{}, 0, err
	}
	return out, version, nil
}

func (s *Service) requireSLAs(ctx context.Context, p *authz.Principal) error {
	ent, err := s.EntitlementSet(ctx, p)
	if err != nil {
		return err
	}
	return ent.Allow(entitlement.FeatureSLAs)
}

func (s *Service) applyMatchingSLA(
	ctx context.Context, q *store.Queries, p *authz.Principal, issueID uuid.UUID,
) error {
	ent, err := entitlementSetFor(ctx, q, p.WorkspaceID)
	if err != nil {
		return err
	}
	if err := ent.Allow(entitlement.FeatureSLAs); err != nil {
		return nil
	}

	rules, err := q.ListSlaRulesInWorkspace(ctx, p.WorkspaceID)
	if err != nil {
		return platform.Internal(err)
	}
	if len(rules) == 0 {
		return nil
	}

	issue, err := q.GetIssue(ctx, issueID)
	if err != nil {
		return platform.Internal(err)
	}
	team, err := q.GetTeam(ctx, issue.TeamID)
	if err != nil {
		return platform.Internal(err)
	}
	loc, err := time.LoadLocation(team.Timezone)
	if err != nil {
		loc = time.UTC
	}

	for _, rule := range rules {
		ok, err := s.issueMatchesSlaRule(ctx, q, issueID, rule.Filter, loc)
		if err != nil {
			return err
		}
		if !ok {
			continue
		}
		return s.applySlaRule(ctx, q, p, issue, team, rule)
	}
	return nil
}

func (s *Service) issueMatchesSlaRule(
	ctx context.Context, q *store.Queries, issueID uuid.UUID, raw json.RawMessage, loc *time.Location,
) (bool, error) {
	node, err := filter.Parse(raw)
	if err != nil {
		return false, platform.Validation("filter", err.Error())
	}
	compiled, err := filter.Compile(node, filter.Options{
		Alias:     "issue",
		Now:       s.now(),
		Location:  loc,
		ArgOffset: 1,
	})
	if err != nil {
		return false, platform.Validation("filter", err.Error())
	}
	ok, err := q.IssueMatchesFilter(ctx, issueID, compiled.SQL, compiled.Args)
	if err != nil {
		return false, platform.Internal(err)
	}
	return ok, nil
}

func (s *Service) applySlaRule(
	ctx context.Context, q *store.Queries, p *authz.Principal,
	issue store.GetIssueRow, team store.Team, rule store.SlaRule,
) error {
	switch rule.Action {
	case model.SlaActionRemove:
		if issue.DueDateSource != model.DueDateSLA {
			return nil
		}
		source := model.DueDateManual
		row, err := q.UpdateIssue(ctx, store.UpdateIssueParams{
			DueDateSource: &source,
			ClearDueDate:  true,
			ID:            issue.ID,
		})
		if err != nil {
			return platform.Internal(err)
		}
		out := toIssue(store.AsIssueRow(row), team.Key)
		_, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "issue", EntityID: issue.ID, Op: OpUpsert,
			TeamID: &issue.TeamID, Scope: authz.TeamScope(issue.TeamID, team.Private),
			Payload:       out,
			ChangedFields: []string{"dueDate", "dueDateSource"},
		})
		return err
	case model.SlaActionApply:
		if issue.DueDateSource == model.DueDateSLA {
			return nil
		}
		if rule.DurationMinutes == nil {
			return nil
		}
		source := model.DueDateSLA
		due := slaDueDay(s.now(), team.Timezone, int(*rule.DurationMinutes))
		row, err := q.UpdateIssue(ctx, store.UpdateIssueParams{
			DueDateSource: &source,
			DueDate:       store.DateOf(due),
			ID:            issue.ID,
		})
		if err != nil {
			return platform.Internal(err)
		}
		out := toIssue(store.AsIssueRow(row), team.Key)
		_, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "issue", EntityID: issue.ID, Op: OpUpsert,
			TeamID: &issue.TeamID, Scope: authz.TeamScope(issue.TeamID, team.Private),
			Payload:       out,
			ChangedFields: []string{"dueDate", "dueDateSource"},
		})
		return err
	}
	return nil
}

func (s *Service) slaPositionAfter(
	ctx context.Context, q *store.Queries, workspaceID, afterID uuid.UUID,
) (string, error) {
	after, err := q.GetSlaRule(ctx, afterID)
	if err != nil {
		if store.IsNotFound(err) {
			return "", platform.NotFound("slaRule")
		}
		return "", platform.Internal(err)
	}
	if after.WorkspaceID != workspaceID {
		return "", platform.NotFound("slaRule")
	}
	rows, err := q.ListSlaRulesInWorkspace(ctx, workspaceID)
	if err != nil {
		return "", platform.Internal(err)
	}
	var next string
	found := false
	for _, row := range rows {
		if found {
			next = row.Position
			break
		}
		if row.ID == afterID {
			found = true
		}
	}
	if !found {
		return "", platform.NotFound("slaRule")
	}
	if next == "" {
		return fractional.After(after.Position), nil
	}
	return fractional.Between(after.Position, next)
}

func (s *Service) GetSlaRule(ctx context.Context, p *authz.Principal, id uuid.UUID) (model.SlaRule, error) {
	if !authz.Visible(p, authz.WorkspaceScope()) {
		return model.SlaRule{}, platform.Forbidden("slaRule")
	}
	row, err := s.db.Queries().GetSlaRule(ctx, id)
	if err != nil {
		if store.IsNotFound(err) {
			return model.SlaRule{}, platform.NotFound("slaRule")
		}
		return model.SlaRule{}, platform.Internal(err)
	}
	if row.WorkspaceID != p.WorkspaceID {
		return model.SlaRule{}, platform.NotFound("slaRule")
	}
	return toSlaRule(row), nil
}

func validateSlaAction(action string, duration *int32) (string, *int32, error) {
	switch strings.TrimSpace(action) {
	case model.SlaActionApply:
		if duration == nil || *duration <= 0 {
			return "", nil, platform.Validation("durationMinutes", "an apply rule needs a positive duration")
		}
		return model.SlaActionApply, duration, nil
	case model.SlaActionRemove:
		return model.SlaActionRemove, nil, nil
	case "":
		return "", nil, platform.Validation("action", "action is apply or remove")
	default:
		return "", nil, platform.Validation("action", "action is apply or remove")
	}
}

func normalizeSlaFilter(raw json.RawMessage) (json.RawMessage, error) {
	if len(raw) == 0 {
		return json.RawMessage(`{}`), nil
	}
	node, err := filter.Parse(raw)
	if err != nil {
		return nil, platform.Validation("filter", err.Error())
	}
	out, err := json.Marshal(node)
	if err != nil {
		return nil, platform.Internal(err)
	}
	return out, nil
}

func slaDueDay(now time.Time, timezone string, minutes int) time.Time {
	loc, err := time.LoadLocation(timezone)
	if err != nil {
		loc = time.UTC
	}
	at := now.In(loc).Add(time.Duration(minutes) * time.Minute)
	y, m, d := at.Date()
	return time.Date(y, m, d, 0, 0, 0, 0, time.UTC)
}

func nullableString(value string, set bool) *string {
	if !set {
		return nil
	}
	return &value
}

func toSlaRule(row store.SlaRule) model.SlaRule {
	return model.SlaRule{
		ID:              row.ID,
		WorkspaceID:     row.WorkspaceID,
		Position:        row.Position,
		Filter:          row.Filter,
		Action:          row.Action,
		DurationMinutes: row.DurationMinutes,
		CreatedAt:       row.CreatedAt,
		UpdatedAt:       row.UpdatedAt,
	}
}
