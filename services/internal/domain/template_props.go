package domain

import (
	"encoding/json"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/platform"
)

// templateProperties is the bag issue templates and recurring snapshots share.
// Keys are the same names createIssue takes.
type templateProperties struct {
	StateID    *uuid.UUID  `json:"stateId,omitempty"`
	AssigneeID *uuid.UUID  `json:"assigneeId,omitempty"`
	Priority   *int        `json:"priority,omitempty"`
	Estimate   *int        `json:"estimate,omitempty"`
	LabelIDs   []uuid.UUID `json:"labelIds,omitempty"`
	ProjectID  *uuid.UUID  `json:"projectId,omitempty"`
	CycleID    *uuid.UUID  `json:"cycleId,omitempty"`
}

func decodeTemplateProperties(raw json.RawMessage) (templateProperties, error) {
	if len(raw) == 0 || string(raw) == "null" {
		return templateProperties{}, nil
	}
	var props templateProperties
	if err := json.Unmarshal(raw, &props); err != nil {
		return templateProperties{}, platform.Validation("properties", "properties must be an object")
	}
	return props, nil
}

func (p templateProperties) priorityValue() int {
	if p.Priority == nil {
		return 0
	}
	return *p.Priority
}

func (p templateProperties) applyTo(in *CreateIssueInput) {
	if in.StateID == nil && p.StateID != nil {
		in.StateID = p.StateID
	}
	if in.AssigneeID == nil && p.AssigneeID != nil {
		in.AssigneeID = p.AssigneeID
	}
	if in.Priority == 0 && p.Priority != nil {
		in.Priority = *p.Priority
	}
	if in.Estimate == nil && p.Estimate != nil {
		in.Estimate = p.Estimate
	}
	if len(in.LabelIDs) == 0 && len(p.LabelIDs) > 0 {
		in.LabelIDs = p.LabelIDs
	}
	if in.ProjectID == nil && p.ProjectID != nil {
		in.ProjectID = p.ProjectID
	}
	if in.CycleID == nil && p.CycleID != nil {
		in.CycleID = p.CycleID
	}
}
