package graph

import (
	"fmt"
	"strings"

	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/graph/generated"
	"github.com/peixotolabs/polaris/services/internal/platform"
)

func toRecurringIssue(r model.RecurringIssue) (generated.RecurringIssue, error) {
	cadence, err := toRecurringCadence(r.Cadence)
	if err != nil {
		return generated.RecurringIssue{}, err
	}
	return generated.RecurringIssue{
		ID:            r.ID,
		WorkspaceID:   r.WorkspaceID,
		TeamID:        r.TeamID,
		Title:         r.Title,
		Body:          r.Body,
		Properties:    jsonOrEmptyObject(r.Properties),
		TemplateID:    r.TemplateID,
		Cadence:       cadence,
		NextDueDate:   string(r.NextDueDate),
		LastCreatedAt: r.LastCreatedAt,
		CreatedBy:     r.CreatedBy,
		CreatedAt:     r.CreatedAt,
		UpdatedAt:     r.UpdatedAt,
		ArchivedAt:    r.ArchivedAt,
	}, nil
}

func toRecurringIssues(rows []model.RecurringIssue) ([]generated.RecurringIssue, error) {
	out := make([]generated.RecurringIssue, 0, len(rows))
	for _, r := range rows {
		g, err := toRecurringIssue(r)
		if err != nil {
			return nil, err
		}
		out = append(out, g)
	}
	return out, nil
}

func toRecurringCadence(v string) (generated.RecurringCadence, error) {
	c := generated.RecurringCadence(strings.ToUpper(v))
	if !c.IsValid() {
		return "", platform.Internal(fmt.Errorf("unknown recurring cadence %q", v))
	}
	return c, nil
}

func fromRecurringCadence(c generated.RecurringCadence) string {
	return strings.ToLower(string(c))
}

func fromOptionalCadence(c *generated.RecurringCadence) *string {
	if c == nil {
		return nil
	}
	s := fromRecurringCadence(*c)
	return &s
}
