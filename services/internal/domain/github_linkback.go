package domain

import (
	"context"
	"fmt"
	"strings"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/platform"
)

// GitHubComment is one linkback to post onto GitHub. Repo is "owner/name".
// Number is set for pull requests; SHA is set for commits.
type GitHubComment struct {
	Repo   string
	Number int
	SHA    string
	Body   string
}

// GitHubCommentPoster posts linkbacks. The HTTP client lives in integrations/github so
// domain never speaks GitHub's wire format. Nil on Service means "do not post" — tests
// that are not about linkbacks leave it unset.
type GitHubCommentPoster interface {
	Post(ctx context.Context, token string, comment GitHubComment) error
}

func (s *Service) postGitHubPRLinkback(ctx context.Context, p *authz.Principal, issue model.Issue, repo string, number int) {
	body := s.gitHubLinkbackBody(ctx, p, issue)
	if body == "" {
		return
	}
	s.postGitHubLinkback(ctx, p, GitHubComment{Repo: repo, Number: number, Body: body})
}

func (s *Service) postGitHubCommitLinkback(ctx context.Context, p *authz.Principal, issue model.Issue, c GitHubCommitInput) {
	body := s.gitHubLinkbackBody(ctx, p, issue)
	if body == "" {
		return
	}
	repo := repoFromGitHubURL(c.URL)
	s.postGitHubLinkback(ctx, p, GitHubComment{Repo: repo, SHA: c.SHA, Body: body})
}

func (s *Service) postGitHubLinkback(ctx context.Context, p *authz.Principal, comment GitHubComment) {
	if s.githubComments == nil || comment.Repo == "" {
		return
	}
	conn, err := s.GetGitHubConnection(ctx, p)
	if err != nil || !conn.Linkbacks {
		return
	}
	token, err := s.db.Queries().GetGitHubConnectionAccessToken(ctx, p.WorkspaceID)
	if err != nil {
		platform.Log(ctx).Error("github linkback: read token", "error", err)
		return
	}
	if err := s.githubComments.Post(ctx, token, comment); err != nil {
		platform.Log(ctx).Error("github linkback failed", "error", err, "repo", comment.Repo)
	}
}

func (s *Service) gitHubLinkbackBody(ctx context.Context, p *authz.Principal, issue model.Issue) string {
	ws, err := s.db.Queries().GetWorkspace(ctx, p.WorkspaceID)
	if err != nil {
		return ""
	}
	url := strings.TrimRight(s.PublicURL, "/") + "/" + ws.UrlKey + "/issue/" + issue.Identifier
	if s.PublicURL == "" {
		url = "/" + ws.UrlKey + "/issue/" + issue.Identifier
	}
	team, err := s.db.Queries().GetTeam(ctx, issue.TeamID)
	if err != nil {
		return url
	}
	if team.Private {
		return url
	}
	return fmt.Sprintf("%s: %s\n%s", issue.Identifier, issue.Title, url)
}

func repoFromGitHubURL(raw string) string {
	const marker = "github.com/"
	i := strings.Index(strings.ToLower(raw), marker)
	if i < 0 {
		return ""
	}
	rest := strings.Trim(raw[i+len(marker):], "/")
	parts := strings.Split(rest, "/")
	if len(parts) < 2 {
		return ""
	}
	return parts[0] + "/" + parts[1]
}
