package domain

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/store"
)

const maxTemplateSubIssues = 50

func normalizeSubIssues(items []model.TemplateSubIssue) ([]model.TemplateSubIssue, error) {
	if len(items) > maxTemplateSubIssues {
		return nil, platform.Validation("subIssues", "a template can name at most 50 sub-issues")
	}
	out := make([]model.TemplateSubIssue, 0, len(items))
	for i, item := range items {
		title := strings.TrimSpace(item.Title)
		if title == "" {
			return nil, platform.Validation("subIssues", fmt.Sprintf("sub-issue %d needs a title", i+1))
		}
		if len(title) > maxTitleLength {
			return nil, platform.Validation("subIssues", "a sub-issue title is too long")
		}
		out = append(out, model.TemplateSubIssue{Title: title})
	}
	return out, nil
}

func decodeSubIssues(raw json.RawMessage) ([]model.TemplateSubIssue, error) {
	if len(raw) == 0 || string(raw) == "null" {
		return []model.TemplateSubIssue{}, nil
	}
	var items []model.TemplateSubIssue
	if err := json.Unmarshal(raw, &items); err != nil {
		return nil, platform.Validation("subIssues", "subIssues must be a list")
	}
	return normalizeSubIssues(items)
}

func encodeSubIssues(items []model.TemplateSubIssue) (json.RawMessage, error) {
	if items == nil {
		items = []model.TemplateSubIssue{}
	}
	raw, err := json.Marshal(items)
	if err != nil {
		return nil, platform.Internal(err)
	}
	return raw, nil
}

// mustDecodeSubIssues is for rows that already passed the column CHECK. A corrupt
// payload would mean the database itself is wrong, so the empty list is the honest
// replica shape rather than refusing to stream the rest of the template.
func mustDecodeSubIssues(raw json.RawMessage) []model.TemplateSubIssue {
	items, err := decodeSubIssues(raw)
	if err != nil {
		return []model.TemplateSubIssue{}
	}
	return items
}

func (s *Service) templateSubIssueTitles(
	ctx context.Context, q *store.Queries, templateID, parentID *uuid.UUID,
) ([]string, error) {
	if templateID == nil {
		return nil, nil
	}
	row, err := q.GetIssueTemplate(ctx, *templateID)
	if err != nil {
		if store.IsNotFound(err) {
			return nil, nil
		}
		return nil, platform.Internal(err)
	}
	items, err := decodeSubIssues(row.SubIssues)
	if err != nil {
		return nil, err
	}
	if len(items) == 0 {
		return nil, nil
	}
	if parentID != nil {
		return nil, platform.Validation("templateId", "a template with sub-issues cannot be applied to a sub-issue")
	}
	titles := make([]string, len(items))
	for i, item := range items {
		titles[i] = item.Title
	}
	return titles, nil
}

func (s *Service) mintTemplateSubIssues(
	ctx context.Context,
	q *store.Queries,
	p *authz.Principal,
	actor authz.Actor,
	team store.Team,
	parent model.Issue,
	in CreateIssueInput,
	titles []string,
) (int64, error) {
	state, err := s.resolveInitialState(ctx, q, team, nil, false)
	if err != nil {
		return 0, err
	}

	var creatorID *uuid.UUID
	if p.UserID != uuid.Nil {
		id := p.UserID
		creatorID = &id
	}

	var version int64
	parentID := parent.ID
	for _, title := range titles {
		number, err := q.AllocateIssueNumber(ctx, in.TeamID)
		if err != nil {
			return 0, platform.Internal(err)
		}
		sortOrder, err := s.sortOrderFor(ctx, q, in.TeamID, state.ID, nil)
		if err != nil {
			return 0, err
		}
		siblingOrder, err := s.resolveParent(ctx, q, p, in.TeamID, parentID)
		if err != nil {
			return 0, err
		}
		childID, err := uuid.NewV7()
		if err != nil {
			return 0, platform.Internal(err)
		}

		row, err := q.CreateIssue(ctx, store.CreateIssueParams{
			ID:                childID,
			WorkspaceID:       p.WorkspaceID,
			TeamID:            in.TeamID,
			Number:            number,
			Title:             title,
			StateID:           state.ID,
			CreatorID:         creatorID,
			Priority:          int16(in.Priority),
			SortOrder:         sortOrder,
			StartedAt:         startedAtFor(state.Category, nil),
			CompletedAt:       completedAtFor(state.Category),
			CanceledAt:        canceledAtFor(state.Category),
			ParentID:          &parentID,
			SubIssueSortOrder: &siblingOrder,
			ProjectID:         in.ProjectID,
			CycleID:           in.CycleID,
		})
		if err != nil {
			return 0, mapParentTriggerError(err)
		}
		child := toIssue(store.AsIssueRow(row), team.Key)
		version, err = s.em.Emit(ctx, q, p.WorkspaceID, actor, Change{
			EntityType: "issue", EntityID: childID, Op: OpUpsert, TeamID: &in.TeamID,
			Scope: authz.TeamScope(in.TeamID, team.Private), Payload: child,
		})
		if err != nil {
			return 0, err
		}
		if p.UserID != uuid.Nil {
			if err := s.SubscribeOnAction(ctx, q, p, childID, p.UserID, model.SubscribedCreated); err != nil {
				return 0, err
			}
		}
		if err := s.em.History(ctx, q, p.WorkspaceID, actor, row.CreatedAt,
			HistoryEntry{IssueID: childID, Kind: "created"}); err != nil {
			return 0, err
		}
	}
	return version, nil
}
