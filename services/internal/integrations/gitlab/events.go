// Package gitlab parses inbound GitLab webhook payloads.
//
// It calls nothing in store: the HTTP layer verifies the token, this package turns
// the JSON into domain input, and domain does the linking. That split is what keeps a
// GitLab-created attachment on the same path as one created from GraphQL.
package gitlab

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/peixotolabs/polaris/services/internal/domain"
)

// MergeRequestEvent is the subset of a GitLab Merge Request Hook this product reads.
type MergeRequestEvent struct {
	Action string
	Input  domain.LinkGitLabMergeRequestInput
}

// PushEvent is the subset of a GitLab Push Hook this product reads.
type PushEvent struct {
	Input domain.GitLabPushInput
}

type mergePayload struct {
	ObjectKind string `json:"object_kind"`
	Project    *struct {
		PathWithNamespace string `json:"path_with_namespace"`
		WebURL            string `json:"web_url"`
	} `json:"project"`
	ObjectAttributes *struct {
		IID          int    `json:"iid"`
		Title        string `json:"title"`
		Description  string `json:"description"`
		State        string `json:"state"`
		Action       string `json:"action"`
		SourceBranch string `json:"source_branch"`
		URL          string `json:"url"`
		Draft        bool   `json:"draft"`
		WIP          bool   `json:"work_in_progress"`
		MergeStatus  string `json:"merge_status"`
	} `json:"object_attributes"`
	Reviewers []struct {
		Username string `json:"username"`
	} `json:"reviewers"`
	Changes *struct {
		Reviewers *json.RawMessage `json:"reviewers"`
	} `json:"changes"`
}

type pushPayload struct {
	ObjectKind string `json:"object_kind"`
	Ref        string `json:"ref"`
	Project    *struct {
		PathWithNamespace string `json:"path_with_namespace"`
		WebURL            string `json:"web_url"`
		DefaultBranch     string `json:"default_branch"`
	} `json:"project"`
	Commits []struct {
		ID      string `json:"id"`
		URL     string `json:"url"`
		Message string `json:"message"`
	} `json:"commits"`
}

type pipelinePayload struct {
	ObjectKind       string `json:"object_kind"`
	ObjectAttributes *struct {
		Status string `json:"status"`
	} `json:"object_attributes"`
	MergeRequest *struct {
		IID          int    `json:"iid"`
		Title        string `json:"title"`
		Description  string `json:"description"`
		URL          string `json:"url"`
		SourceBranch string `json:"source_branch"`
		Draft        bool   `json:"draft"`
		State        string `json:"state"`
	} `json:"merge_request"`
	Project *struct {
		PathWithNamespace string `json:"path_with_namespace"`
	} `json:"project"`
}

// ParseMergeRequest reads a GitLab Merge Request Hook. Unknown actions still parse:
// the linker is idempotent, and skipping "update" would miss a magic word added after open.
func ParseMergeRequest(body []byte) (MergeRequestEvent, error) {
	var raw mergePayload
	if err := json.Unmarshal(body, &raw); err != nil {
		return MergeRequestEvent{}, fmt.Errorf("gitlab merge_request: %w", err)
	}
	if raw.ObjectAttributes == nil || strings.TrimSpace(raw.ObjectAttributes.URL) == "" {
		return MergeRequestEvent{}, fmt.Errorf("gitlab merge_request: missing object_attributes.url")
	}
	mr := raw.ObjectAttributes
	repo := ""
	if raw.Project != nil {
		repo = raw.Project.PathWithNamespace
	}
	action := strings.ToLower(strings.TrimSpace(mr.Action))
	merged := mr.State == "merged" || action == "merge"
	draft := mr.Draft || mr.WIP
	mergeable := mr.MergeStatus
	switch action {
	case "open", "reopen":
		mergeable = ""
	}
	reviewRequested := false
	if raw.Changes != nil && raw.Changes.Reviewers != nil && len(raw.Reviewers) > 0 {
		reviewRequested = action != "open" && action != "reopen" && action != "merge"
	}
	return MergeRequestEvent{
		Action: action,
		Input: domain.LinkGitLabMergeRequestInput{
			URL:             mr.URL,
			Title:           mr.Title,
			Body:            mr.Description,
			BranchName:      mr.SourceBranch,
			Repo:            repo,
			Number:          mr.IID,
			Draft:           draft,
			Merged:          merged,
			MergeableState:  mergeable,
			ReviewRequested: reviewRequested,
		},
	}, nil
}

// ParsePush reads a GitLab Push Hook. Commit URLs are rebuilt from the project web URL
// when the payload only carries an API URL, because the attachment the user sees should
// open in the browser.
func ParsePush(body []byte) (PushEvent, error) {
	var raw pushPayload
	if err := json.Unmarshal(body, &raw); err != nil {
		return PushEvent{}, fmt.Errorf("gitlab push: %w", err)
	}
	projectHTML := ""
	defaultBranch := ""
	if raw.Project != nil {
		projectHTML = strings.TrimRight(raw.Project.WebURL, "/")
		defaultBranch = raw.Project.DefaultBranch
	}
	onDefault := false
	if defaultBranch != "" {
		onDefault = strings.TrimPrefix(raw.Ref, "refs/heads/") == defaultBranch
	}
	commits := make([]domain.GitLabCommitInput, 0, len(raw.Commits))
	for _, c := range raw.Commits {
		url := strings.TrimSpace(c.URL)
		if projectHTML != "" && c.ID != "" {
			url = projectHTML + "/-/commit/" + c.ID
		}
		commits = append(commits, domain.GitLabCommitInput{
			SHA:             c.ID,
			URL:             url,
			Message:         c.Message,
			OnDefaultBranch: onDefault,
		})
	}
	return PushEvent{Input: domain.GitLabPushInput{Commits: commits}}, nil
}

// ParsePipelineReady reads a GitLab Pipeline Hook that completed successfully on a
// merge request. Other pipeline statuses return ok=false so the HTTP layer can ignore
// them without treating the payload as malformed.
func ParsePipelineReady(body []byte) (domain.LinkGitLabMergeRequestInput, bool, error) {
	var raw pipelinePayload
	if err := json.Unmarshal(body, &raw); err != nil {
		return domain.LinkGitLabMergeRequestInput{}, false, fmt.Errorf("gitlab pipeline: %w", err)
	}
	if raw.ObjectAttributes == nil || !strings.EqualFold(raw.ObjectAttributes.Status, "success") {
		return domain.LinkGitLabMergeRequestInput{}, false, nil
	}
	if raw.MergeRequest == nil || strings.TrimSpace(raw.MergeRequest.URL) == "" {
		return domain.LinkGitLabMergeRequestInput{}, false, nil
	}
	mr := raw.MergeRequest
	repo := ""
	if raw.Project != nil {
		repo = raw.Project.PathWithNamespace
	}
	if mr.State == "merged" {
		return domain.LinkGitLabMergeRequestInput{}, false, nil
	}
	return domain.LinkGitLabMergeRequestInput{
		URL:            mr.URL,
		Title:          mr.Title,
		Body:           mr.Description,
		BranchName:     mr.SourceBranch,
		Repo:           repo,
		Number:         mr.IID,
		Draft:          mr.Draft,
		MergeableState: "can_be_merged",
	}, true, nil
}
