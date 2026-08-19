// Package github parses inbound GitHub App and commit-webhook payloads.
//
// It calls nothing in store: the HTTP layer verifies the signature, this package
// turns the JSON into domain input, and domain does the linking. That split is what
// keeps a GitHub-created attachment on the same path as one created from GraphQL.
package github

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/peixotolabs/polaris/services/internal/domain"
)

// PullRequestEvent is the subset of a GitHub pull_request webhook this product reads.
type PullRequestEvent struct {
	Action       string
	Installation int64
	Input        domain.LinkGitHubPullRequestInput
}

// PushEvent is the subset of a GitHub push webhook this product reads.
type PushEvent struct {
	Input domain.GitHubPushInput
}

type pullPayload struct {
	Action       string `json:"action"`
	Installation *struct {
		ID int64 `json:"id"`
	} `json:"installation"`
	PullRequest *struct {
		HTMLURL string `json:"html_url"`
		Title   string `json:"title"`
		Body    string `json:"body"`
		Number  int    `json:"number"`
		Head    struct {
			Ref string `json:"ref"`
		} `json:"head"`
		Base struct {
			Repo struct {
				FullName string `json:"full_name"`
			} `json:"repo"`
		} `json:"base"`
	} `json:"pull_request"`
}

type pushPayload struct {
	Repository *struct {
		FullName string `json:"full_name"`
		HTMLURL  string `json:"html_url"`
	} `json:"repository"`
	Commits []struct {
		ID      string `json:"id"`
		URL     string `json:"url"`
		Message string `json:"message"`
	} `json:"commits"`
}

// ParsePullRequest reads a GitHub pull_request event. Unknown actions still parse: the
// linker is idempotent, and skipping "edited" would miss a magic word added after open.
func ParsePullRequest(body []byte) (PullRequestEvent, error) {
	var raw pullPayload
	if err := json.Unmarshal(body, &raw); err != nil {
		return PullRequestEvent{}, fmt.Errorf("github pull_request: %w", err)
	}
	if raw.PullRequest == nil || strings.TrimSpace(raw.PullRequest.HTMLURL) == "" {
		return PullRequestEvent{}, fmt.Errorf("github pull_request: missing pull_request.html_url")
	}
	var installation int64
	if raw.Installation != nil {
		installation = raw.Installation.ID
	}
	pr := raw.PullRequest
	return PullRequestEvent{
		Action:       raw.Action,
		Installation: installation,
		Input: domain.LinkGitHubPullRequestInput{
			URL:        pr.HTMLURL,
			Title:      pr.Title,
			Body:       pr.Body,
			BranchName: pr.Head.Ref,
			Repo:       pr.Base.Repo.FullName,
			Number:     pr.Number,
		},
	}, nil
}

// ParsePush reads a GitHub push event. Commit URLs are built from the repo when the
// payload only carries the API URL, because the attachment the user sees should open
// in the browser.
func ParsePush(body []byte) (PushEvent, error) {
	var raw pushPayload
	if err := json.Unmarshal(body, &raw); err != nil {
		return PushEvent{}, fmt.Errorf("github push: %w", err)
	}
	repoHTML := ""
	if raw.Repository != nil {
		repoHTML = strings.TrimRight(raw.Repository.HTMLURL, "/")
	}
	commits := make([]domain.GitHubCommitInput, 0, len(raw.Commits))
	for _, c := range raw.Commits {
		url := strings.TrimSpace(c.URL)
		if repoHTML != "" && c.ID != "" {
			url = repoHTML + "/commit/" + c.ID
		}
		commits = append(commits, domain.GitHubCommitInput{
			SHA:     c.ID,
			URL:     url,
			Message: c.Message,
		})
	}
	return PushEvent{Input: domain.GitHubPushInput{Commits: commits}}, nil
}
