package domain

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/url"
	"strconv"
	"strings"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/store"
)

const (
	githubCommitSecretPrefix = "ghsec_"
	githubCommitSecretBytes  = 32
	maxBranchFormat          = 256
)

type CreateGitHubConnectionInput struct {
	OrgLogin         *string
	InstallationID   *int64
	BranchNameFormat *string
	LinkCommits      *bool
	Linkbacks        *bool
}

type UpdateGitHubConnectionInput struct {
	OrgLogin         *string
	InstallationID   *int64
	BranchNameFormat *string
	LinkCommits      *bool
	Linkbacks        *bool
	Enabled          *bool
}

type CreateGitHubUserLinkInput struct {
	GitHubLogin  string
	GitHubUserID *int64
}

type LinkGitHubPullRequestInput struct {
	URL             string
	Title           string
	Body            string
	BranchName      string
	Repo            string
	Number          int
	Draft           bool
	Merged          bool
	MergeableState  string
	ReviewRequested bool
}

type GitHubPushInput struct {
	Commits []GitHubCommitInput
}

type GitHubCommitInput struct {
	SHA             string
	URL             string
	Message         string
	OnDefaultBranch bool
}

func (s *Service) CreateGitHubConnection(
	ctx context.Context, p *authz.Principal, in CreateGitHubConnectionInput,
) (model.GitHubConnection, string, int64, error) {
	if !authz.Can(p, authz.ActionGitHubManage) {
		return model.GitHubConnection{}, "", 0, platform.Forbidden("only admins can connect GitHub")
	}
	format, err := normaliseBranchFormat(in.BranchNameFormat)
	if err != nil {
		return model.GitHubConnection{}, "", 0, err
	}
	secret, err := newGitHubCommitSecret()
	if err != nil {
		return model.GitHubConnection{}, "", 0, err
	}
	linkCommits := false
	if in.LinkCommits != nil {
		linkCommits = *in.LinkCommits
	}
	linkbacks := true
	if in.Linkbacks != nil {
		linkbacks = *in.Linkbacks
	}
	org := trimPtr(in.OrgLogin)

	var out model.GitHubConnection
	var version int64
	err = s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		id, err := uuid.NewV7()
		if err != nil {
			return platform.Internal(err)
		}
		row, err := q.CreateGitHubConnection(ctx, store.CreateGitHubConnectionParams{
			ID:                  id,
			WorkspaceID:         p.WorkspaceID,
			CreatorID:           p.UserID,
			Enabled:             true,
			OrgLogin:            org,
			InstallationID:      in.InstallationID,
			BranchNameFormat:    format,
			LinkCommits:         linkCommits,
			Linkbacks:           linkbacks,
			CommitWebhookSecret: secret,
		})
		if err != nil {
			if store.IsUniqueViolation(err, "github_connection_workspace_id_key") {
				return platform.Conflict("GitHub is already connected in this workspace")
			}
			return platform.Internal(err)
		}
		out = gitHubConnectionFromCreate(row)
		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "githubConnection", EntityID: out.ID, Op: OpUpsert,
			Scope: authz.WorkspaceScope(), Payload: out,
		})
		return err
	})
	if err != nil {
		return model.GitHubConnection{}, "", 0, err
	}
	return out, secret, version, nil
}

func (s *Service) UpdateGitHubConnection(
	ctx context.Context, p *authz.Principal, in UpdateGitHubConnectionInput,
) (model.GitHubConnection, int64, error) {
	if !authz.Can(p, authz.ActionGitHubManage) {
		return model.GitHubConnection{}, 0, platform.Forbidden("only admins can change GitHub settings")
	}
	var format *string
	if in.BranchNameFormat != nil {
		f, err := normaliseBranchFormat(in.BranchNameFormat)
		if err != nil {
			return model.GitHubConnection{}, 0, err
		}
		format = &f
	}

	var out model.GitHubConnection
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		row, err := q.UpdateGitHubConnection(ctx, store.UpdateGitHubConnectionParams{
			OrgLogin:         trimPtr(in.OrgLogin),
			InstallationID:   in.InstallationID,
			BranchNameFormat: format,
			LinkCommits:      in.LinkCommits,
			Linkbacks:        in.Linkbacks,
			Enabled:          in.Enabled,
			WorkspaceID:      p.WorkspaceID,
		})
		if err != nil {
			if store.IsNotFound(err) {
				return platform.NotFound("githubConnection")
			}
			return platform.Internal(err)
		}
		out = gitHubConnectionFromUpdate(row)
		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType:    "githubConnection",
			EntityID:      out.ID,
			Op:            OpUpsert,
			Scope:         authz.WorkspaceScope(),
			Payload:       out,
			ChangedFields: []string{"orgLogin", "branchNameFormat", "linkCommits", "linkbacks", "enabled"},
		})
		return err
	})
	return out, version, err
}

func (s *Service) DeleteGitHubConnection(ctx context.Context, p *authz.Principal) (uuid.UUID, int64, error) {
	if !authz.Can(p, authz.ActionGitHubManage) {
		return uuid.Nil, 0, platform.Forbidden("only admins can disconnect GitHub")
	}
	var id uuid.UUID
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		row, err := q.GetGitHubConnection(ctx, p.WorkspaceID)
		if err != nil {
			if store.IsNotFound(err) {
				return platform.NotFound("githubConnection")
			}
			return platform.Internal(err)
		}
		id = row.ID
		if err := q.DeleteGitHubConnection(ctx, p.WorkspaceID); err != nil {
			return platform.Internal(err)
		}
		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "githubConnection", EntityID: id, Op: OpDelete,
			Scope: authz.WorkspaceScope(),
		})
		return err
	})
	return id, version, err
}

func (s *Service) GetGitHubConnection(ctx context.Context, p *authz.Principal) (model.GitHubConnection, error) {
	if !authz.Visible(p, authz.WorkspaceScope()) {
		return model.GitHubConnection{}, platform.NotFound("githubConnection")
	}
	row, err := s.db.Queries().GetGitHubConnection(ctx, p.WorkspaceID)
	if err != nil {
		if store.IsNotFound(err) {
			return model.GitHubConnection{}, platform.NotFound("githubConnection")
		}
		return model.GitHubConnection{}, platform.Internal(err)
	}
	return gitHubConnectionFromGet(row), nil
}

func (s *Service) GetGitHubCommitWebhookSecret(ctx context.Context, p *authz.Principal) (string, error) {
	if !authz.Can(p, authz.ActionGitHubManage) {
		return "", platform.Forbidden("only admins can read the GitHub webhook secret")
	}
	secret, err := s.db.Queries().GetGitHubConnectionSecret(ctx, p.WorkspaceID)
	if err != nil {
		if store.IsNotFound(err) {
			return "", platform.NotFound("githubConnection")
		}
		return "", platform.Internal(err)
	}
	return secret, nil
}

func (s *Service) CreateGitHubUserLink(
	ctx context.Context, p *authz.Principal, in CreateGitHubUserLinkInput,
) (model.GitHubUserLink, int64, error) {
	login := strings.TrimSpace(in.GitHubLogin)
	if login == "" {
		return model.GitHubUserLink{}, 0, platform.Validation("githubLogin", "a GitHub username is required")
	}
	if len(login) > 256 {
		return model.GitHubUserLink{}, 0, platform.Validation("githubLogin", "that username is too long")
	}

	var out model.GitHubUserLink
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		_, err := q.GetGitHubUserLink(ctx, store.GetGitHubUserLinkParams{
			WorkspaceID: p.WorkspaceID, UserID: p.UserID,
		})
		if err != nil && !store.IsNotFound(err) {
			return platform.Internal(err)
		}
		if err == nil {
			row, err := q.UpdateGitHubUserLink(ctx, store.UpdateGitHubUserLinkParams{
				GithubLogin:  login,
				GithubUserID: in.GitHubUserID,
				WorkspaceID:  p.WorkspaceID,
				UserID:       p.UserID,
			})
			if err != nil {
				return platform.Internal(err)
			}
			out = gitHubUserLinkFromUpdate(row)
			version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
				EntityType: "githubUserLink", EntityID: out.ID, Op: OpUpsert,
				Scope: authz.UserScope(p.UserID), Payload: out,
				ChangedFields: []string{"githubLogin", "githubUserId"},
			})
			return err
		}
		id, err := uuid.NewV7()
		if err != nil {
			return platform.Internal(err)
		}
		row, err := q.CreateGitHubUserLink(ctx, store.CreateGitHubUserLinkParams{
			ID: id, WorkspaceID: p.WorkspaceID, UserID: p.UserID,
			GithubLogin: login, GithubUserID: in.GitHubUserID,
		})
		if err != nil {
			return platform.Internal(err)
		}
		out = gitHubUserLinkFromCreate(row)
		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "githubUserLink", EntityID: out.ID, Op: OpUpsert,
			Scope: authz.UserScope(p.UserID), Payload: out,
		})
		return err
	})
	return out, version, err
}

func (s *Service) DeleteGitHubUserLink(ctx context.Context, p *authz.Principal) (uuid.UUID, int64, error) {
	var id uuid.UUID
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		row, err := q.GetGitHubUserLink(ctx, store.GetGitHubUserLinkParams{
			WorkspaceID: p.WorkspaceID, UserID: p.UserID,
		})
		if err != nil {
			if store.IsNotFound(err) {
				return platform.NotFound("githubUserLink")
			}
			return platform.Internal(err)
		}
		id = row.ID
		if err := q.DeleteGitHubUserLink(ctx, store.DeleteGitHubUserLinkParams{
			WorkspaceID: p.WorkspaceID, UserID: p.UserID,
		}); err != nil {
			return platform.Internal(err)
		}
		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "githubUserLink", EntityID: id, Op: OpDelete,
			Scope: authz.UserScope(p.UserID),
		})
		return err
	})
	return id, version, err
}

func (s *Service) GetGitHubUserLink(ctx context.Context, p *authz.Principal) (model.GitHubUserLink, error) {
	row, err := s.db.Queries().GetGitHubUserLink(ctx, store.GetGitHubUserLinkParams{
		WorkspaceID: p.WorkspaceID, UserID: p.UserID,
	})
	if err != nil {
		if store.IsNotFound(err) {
			return model.GitHubUserLink{}, platform.NotFound("githubUserLink")
		}
		return model.GitHubUserLink{}, platform.Internal(err)
	}
	return gitHubUserLinkFromGet(row), nil
}

func (s *Service) LinkGitHubPullRequest(
	ctx context.Context, p *authz.Principal, in LinkGitHubPullRequestInput,
) ([]model.Attachment, int64, error) {
	parsed, repo, number, err := parseGitHubPullURL(in.URL)
	if err != nil {
		return nil, 0, err
	}
	if in.Repo != "" {
		repo = in.Repo
	}
	if in.Number > 0 {
		number = in.Number
	}

	targets, err := s.resolveGitHubTargets(ctx, p, in.Title, in.Body, in.BranchName)
	if err != nil {
		return nil, 0, err
	}

	title := strings.TrimSpace(in.Title)
	if title == "" {
		title = fmt.Sprintf("%s#%d", repo, number)
	}

	var lastVersion int64
	var out []model.Attachment
	for _, t := range targets {
		already, err := s.attachmentExistsForURL(ctx, p, t.issue.ID, parsed.String())
		if err != nil {
			return nil, 0, err
		}
		meta, _ := json.Marshal(githubAttachmentMeta{
			Source:     "github",
			Kind:       "pull_request",
			Repo:       repo,
			Number:     number,
			BranchName: in.BranchName,
			MagicClass: string(t.class),
			Merged:     in.Merged,
			Draft:      in.Draft,
		})
		att, version, err := s.CreateAttachment(ctx, p, CreateAttachmentInput{
			IssueID:  t.issue.ID,
			URL:      parsed.String(),
			Title:    fmt.Sprintf("%s#%d", repo, number),
			Subtitle: &title,
			Metadata: meta,
		})
		if err != nil {
			return nil, 0, err
		}
		lastVersion = version
		out = append(out, att)

		if t.issue.AssigneeID == nil {
			if _, _, err := s.UpdateIssue(ctx, p, UpdateIssueInput{
				ID: t.issue.ID, AssigneeID: &p.UserID,
			}); err != nil {
				return nil, 0, err
			}
		}
		if err := s.applyGitHubPRStatus(ctx, p, t, in); err != nil {
			return nil, 0, err
		}
		if !already {
			s.postGitHubPRLinkback(ctx, p, t.issue, repo, number)
		}
	}
	return out, lastVersion, nil
}

func (s *Service) IngestGitHubPush(
	ctx context.Context, workspaceID uuid.UUID, in GitHubPushInput,
) (int64, []model.Attachment, error) {
	p, conn, err := s.principalForGitHubWorkspace(ctx, workspaceID)
	if err != nil || p == nil {
		return 0, nil, err
	}
	if !conn.Enabled || !conn.LinkCommits {
		return 0, nil, nil
	}

	var lastVersion int64
	var out []model.Attachment
	for _, c := range in.Commits {
		msg := strings.TrimSpace(c.Message)
		if msg == "" || strings.TrimSpace(c.URL) == "" {
			continue
		}
		for _, link := range ParseMagicLinks(msg) {
			if link.Class == MagicSuppress || link.Class == MagicNew || link.Identifier == "" {
				continue
			}
			issue, err := s.lookupIssueByIdentifier(ctx, workspaceID, link.Identifier)
			if err != nil || issue == nil {
				continue
			}
			already, err := s.attachmentExistsForURL(ctx, p, issue.ID, c.URL)
			if err != nil {
				return 0, nil, err
			}
			sha := c.SHA
			if len(sha) > 7 {
				sha = sha[:7]
			}
			sub := firstLine(msg)
			meta, _ := json.Marshal(githubAttachmentMeta{
				Source:     "github",
				Kind:       "commit",
				SHA:        c.SHA,
				MagicClass: string(link.Class),
				Merged:     c.OnDefaultBranch,
			})
			att, version, err := s.CreateAttachment(ctx, p, CreateAttachmentInput{
				IssueID:  issue.ID,
				URL:      c.URL,
				Title:    sha,
				Subtitle: &sub,
				Metadata: meta,
			})
			if err != nil {
				return 0, nil, err
			}
			lastVersion = version
			out = append(out, att)
			if err := s.applyGitHubCommitStatus(ctx, p, *issue, link.Class, c.OnDefaultBranch); err != nil {
				return 0, nil, err
			}
			if !already {
				s.postGitHubCommitLinkback(ctx, p, *issue, c)
			}
		}
	}
	return lastVersion, out, nil
}

func (s *Service) IngestGitHubPullRequest(
	ctx context.Context, workspaceID uuid.UUID, in LinkGitHubPullRequestInput,
) ([]model.Attachment, int64, error) {
	p, conn, err := s.principalForGitHubWorkspace(ctx, workspaceID)
	if err != nil || p == nil {
		return nil, 0, err
	}
	if !conn.Enabled {
		return nil, 0, nil
	}
	return s.LinkGitHubPullRequest(ctx, p, in)
}

func (s *Service) GetGitHubConnectionByInstallation(ctx context.Context, installationID int64) (model.GitHubConnection, error) {
	id := installationID
	row, err := s.db.Queries().GetGitHubConnectionByInstallation(ctx, &id)
	if err != nil {
		if store.IsNotFound(err) {
			return model.GitHubConnection{}, platform.NotFound("githubConnection")
		}
		return model.GitHubConnection{}, platform.Internal(err)
	}
	return gitHubConnectionFromInstall(row), nil
}

func (s *Service) VerifyGitHubCommitWebhook(ctx context.Context, workspaceID uuid.UUID, body []byte, signature string) error {
	stored, err := s.db.Queries().GetGitHubConnectionSecret(ctx, workspaceID)
	if err != nil {
		if store.IsNotFound(err) {
			return platform.NotFound("githubConnection")
		}
		return platform.Internal(err)
	}
	if !platform.GitHubSignatureOK(stored, body, signature) {
		return platform.Unauthorized("bad github webhook signature")
	}
	return nil
}

func (s *Service) principalForGitHubWorkspace(
	ctx context.Context, workspaceID uuid.UUID,
) (*authz.Principal, model.GitHubConnection, error) {
	row, err := s.db.Queries().GetGitHubConnection(ctx, workspaceID)
	if err != nil {
		if store.IsNotFound(err) {
			return nil, model.GitHubConnection{}, nil
		}
		return nil, model.GitHubConnection{}, platform.Internal(err)
	}
	conn := gitHubConnectionFromGet(row)
	creator, err := s.db.Queries().GetUser(ctx, conn.CreatorID)
	if err != nil {
		return nil, model.GitHubConnection{}, platform.Internal(err)
	}
	if creator.AccountID == nil {
		return nil, model.GitHubConnection{}, platform.Internal(fmt.Errorf("github connection creator has no account"))
	}
	p, err := s.ResolvePrincipal(ctx, *creator.AccountID, workspaceID)
	if err != nil {
		return nil, model.GitHubConnection{}, err
	}
	return p, conn, nil
}

type gitHubTarget struct {
	issue model.Issue
	class MagicClass
}

func (s *Service) resolveGitHubTargets(
	ctx context.Context, p *authz.Principal, title, body, branch string,
) ([]gitHubTarget, error) {
	combined := title + "\n" + body
	parsed := ParseMagicLinksWithOptions(combined, MagicOptions{BareIdentifiers: true})
	suppressed := map[string]bool{}
	for _, l := range parsed {
		if l.Class == MagicSuppress && l.Identifier != "" {
			suppressed[l.Identifier] = true
		}
	}

	seen := map[string]bool{}
	var out []gitHubTarget
	var newTeam string
	for _, l := range parsed {
		if l.Class == MagicNew && l.NewTeamKey != "" && newTeam == "" {
			newTeam = l.NewTeamKey
			continue
		}
		if l.Identifier == "" || l.Class == MagicSuppress || suppressed[l.Identifier] {
			continue
		}
		if seen[l.Identifier] {
			continue
		}
		issue, err := s.lookupIssueByIdentifier(ctx, p.WorkspaceID, l.Identifier)
		if err != nil {
			return nil, err
		}
		if issue == nil {
			continue
		}
		seen[l.Identifier] = true
		out = append(out, gitHubTarget{issue: *issue, class: l.Class})
	}

	for _, id := range ParseIssueIDsInBranch(branch) {
		if suppressed[id] || seen[id] {
			continue
		}
		issue, err := s.lookupIssueByIdentifier(ctx, p.WorkspaceID, id)
		if err != nil {
			return nil, err
		}
		if issue == nil {
			continue
		}
		seen[id] = true
		out = append(out, gitHubTarget{issue: *issue, class: MagicBare})
	}

	if newTeam != "" && len(out) == 0 {
		issue, err := s.createIssueFromGitHub(ctx, p, newTeam, strings.TrimSpace(title), body)
		if err != nil {
			return nil, err
		}
		if issue != nil {
			out = append(out, gitHubTarget{issue: *issue, class: MagicNew})
		}
	}
	return out, nil
}

func (s *Service) lookupIssueByIdentifier(ctx context.Context, workspaceID uuid.UUID, identifier string) (*model.Issue, error) {
	key, number, err := parseIssueIdentifier(identifier)
	if err != nil {
		return nil, nil
	}
	q := s.db.Queries()
	team, err := q.GetTeamByKey(ctx, store.GetTeamByKeyParams{WorkspaceID: workspaceID, Key: key})
	if err != nil {
		if store.IsNotFound(err) {
			return nil, nil
		}
		return nil, platform.Internal(err)
	}
	row, err := q.GetIssueByTeamAndNumber(ctx, store.GetIssueByTeamAndNumberParams{
		TeamID: team.ID, Number: number,
	})
	if err != nil {
		if store.IsNotFound(err) {
			return nil, nil
		}
		return nil, platform.Internal(err)
	}
	issue := toIssue(store.AsIssueRow(row), team.Key)
	return &issue, nil
}

func (s *Service) createIssueFromGitHub(
	ctx context.Context, p *authz.Principal, teamKey, title, body string,
) (*model.Issue, error) {
	if title == "" {
		title = "Issue from GitHub"
	}
	q := s.db.Queries()
	team, err := q.GetTeamByKey(ctx, store.GetTeamByKeyParams{WorkspaceID: p.WorkspaceID, Key: teamKey})
	if err != nil {
		if store.IsNotFound(err) {
			return nil, nil
		}
		return nil, platform.Internal(err)
	}
	created, _, err := s.CreateIssue(ctx, p, CreateIssueInput{
		TeamID: team.ID, Title: title, Description: strings.TrimSpace(body),
	})
	if err != nil {
		return nil, err
	}
	states, err := q.ListWorkflowStatesForTeam(ctx, team.ID)
	if err != nil {
		return nil, platform.Internal(err)
	}
	for _, st := range states {
		if st.Category == CategoryStarted && st.ArchivedAt == nil {
			updated, _, err := s.UpdateIssue(ctx, p, UpdateIssueInput{
				ID: created.ID, StateID: &st.ID,
			})
			if err != nil {
				return nil, err
			}
			return &updated, nil
		}
	}
	return &created, nil
}

func parseGitHubPullURL(raw string) (*url.URL, string, int, error) {
	u, err := parseAttachmentURL(raw)
	if err != nil {
		return nil, "", 0, err
	}
	host := strings.ToLower(u.Host)
	if host != "github.com" && host != "www.github.com" {
		return nil, "", 0, platform.Validation("url", "that is not a GitHub pull request URL")
	}
	parts := strings.Split(strings.Trim(u.Path, "/"), "/")
	if len(parts) < 4 || parts[2] != "pull" {
		return nil, "", 0, platform.Validation("url", "that is not a GitHub pull request URL")
	}
	n, err := strconv.Atoi(parts[3])
	if err != nil || n <= 0 {
		return nil, "", 0, platform.Validation("url", "that is not a GitHub pull request URL")
	}
	repo := parts[0] + "/" + parts[1]
	return u, repo, n, nil
}

func parseIssueIdentifier(identifier string) (string, int64, error) {
	return ParseIssueIdentifier(identifier)
}

func normaliseBranchFormat(raw *string) (string, error) {
	if raw == nil || strings.TrimSpace(*raw) == "" {
		return DefaultGitBranchFormat, nil
	}
	s := strings.TrimSpace(*raw)
	if len(s) > maxBranchFormat {
		return "", platform.Validation("branchNameFormat", "that format is too long")
	}
	return s, nil
}

func newGitHubCommitSecret() (string, error) {
	buf := make([]byte, githubCommitSecretBytes)
	if _, err := rand.Read(buf); err != nil {
		return "", platform.Internal(err)
	}
	return githubCommitSecretPrefix + base64.RawURLEncoding.EncodeToString(buf), nil
}

func trimPtr(s *string) *string {
	if s == nil {
		return nil
	}
	t := strings.TrimSpace(*s)
	if t == "" {
		return nil
	}
	return &t
}

func firstLine(s string) string {
	if i := strings.IndexByte(s, '\n'); i >= 0 {
		s = s[:i]
	}
	return strings.TrimSpace(s)
}

func gitHubConnectionFromCreate(r store.CreateGitHubConnectionRow) model.GitHubConnection {
	return model.GitHubConnection{
		ID: r.ID, WorkspaceID: r.WorkspaceID, CreatorID: r.CreatorID, Enabled: r.Enabled,
		OrgLogin: r.OrgLogin, BranchNameFormat: r.BranchNameFormat,
		LinkCommits: r.LinkCommits, Linkbacks: r.Linkbacks,
		ConnectedAt: r.ConnectedAt, CreatedAt: r.CreatedAt, UpdatedAt: r.UpdatedAt,
	}
}

func gitHubConnectionFromGet(r store.GetGitHubConnectionRow) model.GitHubConnection {
	return model.GitHubConnection{
		ID: r.ID, WorkspaceID: r.WorkspaceID, CreatorID: r.CreatorID, Enabled: r.Enabled,
		OrgLogin: r.OrgLogin, BranchNameFormat: r.BranchNameFormat,
		LinkCommits: r.LinkCommits, Linkbacks: r.Linkbacks,
		ConnectedAt: r.ConnectedAt, CreatedAt: r.CreatedAt, UpdatedAt: r.UpdatedAt,
	}
}

func gitHubConnectionFromUpdate(r store.UpdateGitHubConnectionRow) model.GitHubConnection {
	return model.GitHubConnection{
		ID: r.ID, WorkspaceID: r.WorkspaceID, CreatorID: r.CreatorID, Enabled: r.Enabled,
		OrgLogin: r.OrgLogin, BranchNameFormat: r.BranchNameFormat,
		LinkCommits: r.LinkCommits, Linkbacks: r.Linkbacks,
		ConnectedAt: r.ConnectedAt, CreatedAt: r.CreatedAt, UpdatedAt: r.UpdatedAt,
	}
}

func gitHubConnectionFromInstall(r store.GetGitHubConnectionByInstallationRow) model.GitHubConnection {
	return model.GitHubConnection{
		ID: r.ID, WorkspaceID: r.WorkspaceID, CreatorID: r.CreatorID, Enabled: r.Enabled,
		OrgLogin: r.OrgLogin, BranchNameFormat: r.BranchNameFormat,
		LinkCommits: r.LinkCommits, Linkbacks: r.Linkbacks,
		ConnectedAt: r.ConnectedAt, CreatedAt: r.CreatedAt, UpdatedAt: r.UpdatedAt,
	}
}

func gitHubConnectionFromStream(r store.StreamGitHubConnectionsForBootstrapRow) model.GitHubConnection {
	return model.GitHubConnection{
		ID: r.ID, WorkspaceID: r.WorkspaceID, CreatorID: r.CreatorID, Enabled: r.Enabled,
		OrgLogin: r.OrgLogin, BranchNameFormat: r.BranchNameFormat,
		LinkCommits: r.LinkCommits, Linkbacks: r.Linkbacks,
		ConnectedAt: r.ConnectedAt, CreatedAt: r.CreatedAt, UpdatedAt: r.UpdatedAt,
	}
}

func gitHubUserLinkFromCreate(r store.CreateGitHubUserLinkRow) model.GitHubUserLink {
	return model.GitHubUserLink{
		ID: r.ID, WorkspaceID: r.WorkspaceID, UserID: r.UserID, GitHubLogin: r.GithubLogin,
		CreatedAt: r.CreatedAt, UpdatedAt: r.UpdatedAt,
	}
}

func gitHubUserLinkFromGet(r store.GetGitHubUserLinkRow) model.GitHubUserLink {
	return model.GitHubUserLink{
		ID: r.ID, WorkspaceID: r.WorkspaceID, UserID: r.UserID, GitHubLogin: r.GithubLogin,
		CreatedAt: r.CreatedAt, UpdatedAt: r.UpdatedAt,
	}
}

func gitHubUserLinkFromUpdate(r store.UpdateGitHubUserLinkRow) model.GitHubUserLink {
	return model.GitHubUserLink{
		ID: r.ID, WorkspaceID: r.WorkspaceID, UserID: r.UserID, GitHubLogin: r.GithubLogin,
		CreatedAt: r.CreatedAt, UpdatedAt: r.UpdatedAt,
	}
}

func gitHubUserLinkFromStream(r store.StreamGitHubUserLinksForBootstrapRow) model.GitHubUserLink {
	return model.GitHubUserLink{
		ID: r.ID, WorkspaceID: r.WorkspaceID, UserID: r.UserID, GitHubLogin: r.GithubLogin,
		CreatedAt: r.CreatedAt, UpdatedAt: r.UpdatedAt,
	}
}
