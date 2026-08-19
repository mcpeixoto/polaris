package domain

import (
	"context"
	"encoding/json"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/store"
)

type githubPREvent string

const (
	githubPRDrafted         githubPREvent = "drafted"
	githubPROpened          githubPREvent = "opened"
	githubPRReviewRequested githubPREvent = "review_requested"
	githubPRReadyForMerge   githubPREvent = "ready_for_merge"
	githubPRMerged          githubPREvent = "merged"
)

// githubAttachmentMeta is stored on GitHub-created attachment cards so a later webhook
// can tell a pull request from a commit, and whether every linked PR has merged.
type githubAttachmentMeta struct {
	Source     string `json:"source"`
	Kind       string `json:"kind"`
	Repo       string `json:"repo,omitempty"`
	Number     int    `json:"number,omitempty"`
	BranchName string `json:"branchName,omitempty"`
	SHA        string `json:"sha,omitempty"`
	MagicClass string `json:"magicClass,omitempty"`
	Merged     bool   `json:"merged,omitempty"`
	Draft      bool   `json:"draft,omitempty"`
}

func parseGitHubMeta(raw json.RawMessage) githubAttachmentMeta {
	var m githubAttachmentMeta
	_ = json.Unmarshal(raw, &m)
	return m
}

func (s *Service) applyGitHubPRStatus(
	ctx context.Context, p *authz.Principal, t gitHubTarget, in LinkGitHubPullRequestInput,
) error {
	ev := githubPRAutomationEvent(in)
	auto, err := s.loadGitHubTeamAutomation(ctx, t.issue.WorkspaceID, t.issue.TeamID)
	if err != nil {
		return err
	}
	if auto.Configured {
		target := auto.mappedState(ev)
		if target == nil {
			return nil
		}
		if ev == githubPRMerged {
			if !closesOnMerge(t.class) {
				return nil
			}
			done, err := s.allGitHubPRsMerged(ctx, p, t.issue.ID)
			if err != nil || !done {
				return err
			}
		}
		return s.applyMappedWorkflowState(ctx, p, t.issue.ID, *target)
	}

	if ev == githubPRDrafted || ev == githubPRReviewRequested || ev == githubPRReadyForMerge {
		return nil
	}
	if ev == githubPRMerged {
		if !closesOnMerge(t.class) {
			return nil
		}
		done, err := s.allGitHubPRsMerged(ctx, p, t.issue.ID)
		if err != nil {
			return err
		}
		if done {
			return s.moveIssueToCategory(ctx, p, t.issue.ID, CategoryCompleted)
		}
		return nil
	}
	return s.moveIssueToCategory(ctx, p, t.issue.ID, CategoryStarted)
}

func (s *Service) applyMappedWorkflowState(ctx context.Context, p *authz.Principal, issueID, stateID uuid.UUID) error {
	issue, err := s.GetIssue(ctx, p, issueID)
	if err != nil {
		return err
	}
	if issue.StateID == stateID {
		return nil
	}
	st, err := s.db.Queries().GetWorkflowState(ctx, stateID)
	if err != nil {
		if store.IsNotFound(err) {
			return nil
		}
		return platform.Internal(err)
	}
	if st.TeamID != issue.TeamID || st.ArchivedAt != nil {
		return nil
	}
	cur, err := s.db.Queries().GetWorkflowState(ctx, issue.StateID)
	if err != nil {
		return platform.Internal(err)
	}
	if cur.Category == CategoryCanceled || cur.Category == CategoryDuplicate {
		return nil
	}
	_, _, err = s.UpdateIssue(ctx, p, UpdateIssueInput{ID: issueID, StateID: &stateID})
	return err
}

func (s *Service) applyGitHubCommitStatus(
	ctx context.Context, p *authz.Principal, issue model.Issue, class MagicClass, onDefault bool,
) error {
	if onDefault && closesOnMerge(class) {
		return s.moveIssueToCategory(ctx, p, issue.ID, CategoryCompleted)
	}
	return s.moveIssueToCategory(ctx, p, issue.ID, CategoryStarted)
}

func closesOnMerge(class MagicClass) bool {
	return class == MagicClosing || class == MagicNew
}

func (s *Service) allGitHubPRsMerged(ctx context.Context, p *authz.Principal, issueID uuid.UUID) (bool, error) {
	atts, err := s.ListAttachments(ctx, p, issueID)
	if err != nil {
		return false, err
	}
	found := false
	for _, a := range atts {
		m := parseGitHubMeta(a.Metadata)
		if m.Source != "github" || m.Kind != "pull_request" {
			continue
		}
		found = true
		if !m.Merged {
			return false, nil
		}
	}
	return found, nil
}

func (s *Service) moveIssueToCategory(ctx context.Context, p *authz.Principal, issueID uuid.UUID, category string) error {
	issue, err := s.GetIssue(ctx, p, issueID)
	if err != nil {
		return err
	}
	st, err := s.db.Queries().GetWorkflowState(ctx, issue.StateID)
	if err != nil {
		return platform.Internal(err)
	}
	if st.Category == category || st.Category == CategoryCanceled || st.Category == CategoryDuplicate {
		return nil
	}
	if category == CategoryStarted && st.Category == CategoryCompleted {
		// A new open PR on a done issue is more work; a merge event never takes this branch.
	}
	target, err := s.firstLiveState(ctx, issue.TeamID, category)
	if err != nil || target == nil {
		return err
	}
	_, _, err = s.UpdateIssue(ctx, p, UpdateIssueInput{ID: issueID, StateID: target})
	return err
}

func (s *Service) firstLiveState(ctx context.Context, teamID uuid.UUID, category string) (*uuid.UUID, error) {
	states, err := s.db.Queries().ListWorkflowStatesForTeam(ctx, teamID)
	if err != nil {
		return nil, platform.Internal(err)
	}
	for i := range states {
		if states[i].Category == category && states[i].ArchivedAt == nil {
			id := states[i].ID
			return &id, nil
		}
	}
	return nil, nil
}

func (s *Service) attachmentExistsForURL(ctx context.Context, p *authz.Principal, issueID uuid.UUID, rawURL string) (bool, error) {
	listed, err := s.ListAttachmentsForURL(ctx, p, rawURL)
	if err != nil {
		return false, err
	}
	for _, a := range listed {
		if a.IssueID == issueID {
			return true, nil
		}
	}
	return false, nil
}
