package domain

import (
	"context"
	"encoding/json"
	"strings"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain/model"
)

type gitlabMREvent string

const (
	gitlabMRDrafted         gitlabMREvent = "drafted"
	gitlabMROpened          gitlabMREvent = "opened"
	gitlabMRReviewRequested gitlabMREvent = "review_requested"
	gitlabMRReadyForMerge   gitlabMREvent = "ready_for_merge"
	gitlabMRMerged          gitlabMREvent = "merged"
)

// gitlabAttachmentMeta is stored on GitLab-created attachment cards so a later webhook
// can tell a merge request from a commit, and whether every linked MR has merged.
type gitlabAttachmentMeta struct {
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

func parseGitLabMeta(raw json.RawMessage) gitlabAttachmentMeta {
	var m gitlabAttachmentMeta
	_ = json.Unmarshal(raw, &m)
	return m
}

func (s *Service) applyGitLabMRStatus(
	ctx context.Context, p *authz.Principal, t gitHubTarget, in LinkGitLabMergeRequestInput,
) error {
	ev := gitlabMRAutomationEvent(in)
	auto, err := s.loadGitLabTeamAutomation(ctx, t.issue.WorkspaceID, t.issue.TeamID)
	if err != nil {
		return err
	}
	if auto.Configured {
		target := auto.mappedState(ev)
		if target == nil {
			return nil
		}
		if ev == gitlabMRMerged {
			if !closesOnMerge(t.class) {
				return nil
			}
			done, err := s.allGitLabMRsMerged(ctx, p, t.issue.ID)
			if err != nil || !done {
				return err
			}
		}
		return s.applyMappedWorkflowState(ctx, p, t.issue.ID, *target)
	}

	if ev == gitlabMRDrafted || ev == gitlabMRReviewRequested || ev == gitlabMRReadyForMerge {
		return nil
	}
	if ev == gitlabMRMerged {
		if !closesOnMerge(t.class) {
			return nil
		}
		done, err := s.allGitLabMRsMerged(ctx, p, t.issue.ID)
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

func (s *Service) applyGitLabCommitStatus(
	ctx context.Context, p *authz.Principal, issue model.Issue, class MagicClass, onDefault bool,
) error {
	if onDefault && closesOnMerge(class) {
		return s.moveIssueToCategory(ctx, p, issue.ID, CategoryCompleted)
	}
	return s.moveIssueToCategory(ctx, p, issue.ID, CategoryStarted)
}

func (s *Service) allGitLabMRsMerged(ctx context.Context, p *authz.Principal, issueID uuid.UUID) (bool, error) {
	atts, err := s.ListAttachments(ctx, p, issueID)
	if err != nil {
		return false, err
	}
	found := false
	for _, a := range atts {
		m := parseGitLabMeta(a.Metadata)
		if m.Source != "gitlab" || m.Kind != "merge_request" {
			continue
		}
		found = true
		if !m.Merged {
			return false, nil
		}
	}
	return found, nil
}

func gitlabMRAutomationEvent(in LinkGitLabMergeRequestInput) gitlabMREvent {
	switch {
	case in.Merged:
		return gitlabMRMerged
	case in.Draft:
		return gitlabMRDrafted
	case in.ReviewRequested:
		return gitlabMRReviewRequested
	case strings.EqualFold(strings.TrimSpace(in.MergeableState), "can_be_merged"):
		return gitlabMRReadyForMerge
	default:
		return gitlabMROpened
	}
}
