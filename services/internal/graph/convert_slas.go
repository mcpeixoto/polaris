package graph

import (
	"fmt"

	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/graph/generated"
	"github.com/peixotolabs/polaris/services/internal/platform"
)

func toSlaRule(row model.SlaRule) (generated.SLARule, error) {
	action, err := toSlaAction(row.Action)
	if err != nil {
		return generated.SLARule{}, err
	}
	return generated.SLARule{
		ID:              row.ID,
		WorkspaceID:     row.WorkspaceID,
		Position:        row.Position,
		Filter:          jsonOrEmptyObject(row.Filter),
		Action:          action,
		DurationMinutes: intFromInt32(row.DurationMinutes),
		CreatedAt:       row.CreatedAt,
		UpdatedAt:       row.UpdatedAt,
	}, nil
}

func toSlaAction(v string) (generated.SLAAction, error) {
	switch v {
	case model.SlaActionApply:
		return generated.SLAActionApply, nil
	case model.SlaActionRemove:
		return generated.SLAActionRemove, nil
	}
	return "", platform.Internal(fmt.Errorf("unknown sla action %q", v))
}

func fromSlaAction(s generated.SLAAction) string {
	switch s {
	case generated.SLAActionApply:
		return model.SlaActionApply
	case generated.SLAActionRemove:
		return model.SlaActionRemove
	}
	return string(s)
}

func fromSlaActionPtr(s *generated.SLAAction) *string {
	if s == nil {
		return nil
	}
	v := fromSlaAction(*s)
	return &v
}

func fromCreateSlaRuleInput(in generated.CreateSLARuleInput) domain.CreateSlaRuleInput {
	return domain.CreateSlaRuleInput{
		Filter:          in.Filter,
		Action:          fromSlaAction(in.Action),
		DurationMinutes: int32FromInt(in.DurationMinutes),
	}
}

func fromUpdateSlaRuleInput(in generated.UpdateSLARuleInput) domain.UpdateSlaRuleInput {
	action := fromSlaActionPtr(in.Action)
	setDuration := in.DurationMinutes != nil ||
		(action != nil && *action == model.SlaActionRemove)
	return domain.UpdateSlaRuleInput{
		ID:              in.ID,
		Filter:          in.Filter,
		Action:          action,
		DurationMinutes: int32FromInt(in.DurationMinutes),
		SetDuration:     setDuration,
		AfterID:         in.AfterID,
	}
}
