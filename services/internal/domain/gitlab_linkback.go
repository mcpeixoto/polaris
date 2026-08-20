package domain

import (
	"context"
	"fmt"
	"strings"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/platform"
)

// GitLabComment is one linkback to post onto GitLab. Project is the
// path_with_namespace. Number is set for merge requests; SHA is set for commits.
type GitLabComment struct {
	InstanceURL string
	Project     string
	Number      int
	SHA         string
	Body        string
}

// GitLabCommentPoster posts linkbacks. The HTTP client lives in integrations/gitlab so
// domain never speaks GitLab's wire format. Nil on Service means "do not post" — tests
// that are not about linkbacks leave it unset.
type GitLabCommentPoster interface {
	Post(ctx context.Context, token string, comment GitLabComment) error
}

func (s *Service) postGitLabMRLinkback(ctx context.Context, p *authz.Principal, issue model.Issue, project string, number int) {
	body := s.gitLabLinkbackBody(ctx, p, issue)
	if body == "" {
		return
	}
	s.postGitLabLinkback(ctx, p, GitLabComment{Project: project, Number: number, Body: body})
}

func (s *Service) postGitLabCommitLinkback(ctx context.Context, p *authz.Principal, issue model.Issue, c GitLabCommitInput) {
	body := s.gitLabLinkbackBody(ctx, p, issue)
	if body == "" {
		return
	}
	s.postGitLabLinkback(ctx, p, GitLabComment{Project: projectFromGitLabURL(c.URL), SHA: c.SHA, Body: body})
}

func (s *Service) postGitLabLinkback(ctx context.Context, p *authz.Principal, comment GitLabComment) {
	if s.gitlabComments == nil || comment.Project == "" {
		return
	}
	conn, err := s.GetGitLabConnection(ctx, p)
	if err != nil || !conn.Linkbacks {
		return
	}
	comment.InstanceURL = conn.InstanceURL
	token, err := s.db.Queries().GetGitLabConnectionAccessToken(ctx, p.WorkspaceID)
	if err != nil {
		platform.Log(ctx).Error("gitlab linkback: read token", "error", err)
		return
	}
	if err := s.gitlabComments.Post(ctx, token, comment); err != nil {
		platform.Log(ctx).Error("gitlab linkback failed", "error", err, "project", comment.Project)
	}
}

func (s *Service) gitLabLinkbackBody(ctx context.Context, p *authz.Principal, issue model.Issue) string {
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

func projectFromGitLabURL(raw string) string {
	u := strings.TrimSpace(raw)
	i := strings.Index(u, "/-/")
	if i < 0 {
		return ""
	}
	rest := u[:i]
	scheme := strings.Index(rest, "://")
	if scheme < 0 {
		return ""
	}
	hostStart := scheme + 3
	slash := strings.Index(rest[hostStart:], "/")
	if slash < 0 {
		return ""
	}
	return strings.Trim(rest[hostStart+slash:], "/")
}
