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
	"time"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/store"
)

const (
	gitlabWebhookSecretPrefix  = "glsec_"
	gitlabWebhookSecretBytes   = 32
	DefaultGitLabInstanceURL   = "https://gitlab.com"
	maxGitLabInstanceURLLength = 512
)

type CreateGitLabConnectionInput struct {
	InstanceURL      *string
	AccessToken      *string
	BranchNameFormat *string
	LinkCommits      *bool
	Linkbacks        *bool
}

type UpdateGitLabConnectionInput struct {
	InstanceURL      *string
	AccessToken      *string
	BranchNameFormat *string
	LinkCommits      *bool
	Linkbacks        *bool
	Enabled          *bool
}

type CreateGitLabUserLinkInput struct {
	GitLabUsername string
	GitLabUserID   *int64
}

type LinkGitLabMergeRequestInput struct {
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

type GitLabPushInput struct {
	Commits []GitLabCommitInput
}

type GitLabCommitInput struct {
	SHA             string
	URL             string
	Message         string
	OnDefaultBranch bool
}

func (s *Service) CreateGitLabConnection(
	ctx context.Context, p *authz.Principal, in CreateGitLabConnectionInput,
) (model.GitLabConnection, string, int64, error) {
	if !authz.Can(p, authz.ActionGitLabManage) {
		return model.GitLabConnection{}, "", 0, platform.Forbidden("only admins can connect GitLab")
	}
	format, err := normaliseBranchFormat(in.BranchNameFormat)
	if err != nil {
		return model.GitLabConnection{}, "", 0, err
	}
	instance, err := normaliseGitLabInstanceURL(in.InstanceURL)
	if err != nil {
		return model.GitLabConnection{}, "", 0, err
	}
	secret, err := newGitLabWebhookSecret()
	if err != nil {
		return model.GitLabConnection{}, "", 0, err
	}
	linkCommits := false
	if in.LinkCommits != nil {
		linkCommits = *in.LinkCommits
	}
	linkbacks := true
	if in.Linkbacks != nil {
		linkbacks = *in.Linkbacks
	}
	var tokenPtr *string
	var connectedAt *time.Time
	if in.AccessToken != nil {
		if token := strings.TrimSpace(*in.AccessToken); token != "" {
			tokenPtr = &token
			now := s.now()
			connectedAt = &now
		}
	}

	var out model.GitLabConnection
	var version int64
	err = s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		id, err := uuid.NewV7()
		if err != nil {
			return platform.Internal(err)
		}
		row, err := q.CreateGitLabConnection(ctx, store.CreateGitLabConnectionParams{
			ID:               id,
			WorkspaceID:      p.WorkspaceID,
			CreatorID:        p.UserID,
			Enabled:          true,
			InstanceUrl:      instance,
			BranchNameFormat: format,
			LinkCommits:      linkCommits,
			Linkbacks:        linkbacks,
			WebhookSecret:    secret,
			AccessToken:      tokenPtr,
			ConnectedAt:      connectedAt,
		})
		if err != nil {
			if store.IsUniqueViolation(err, "gitlab_connection_workspace_id_key") {
				return platform.Conflict("GitLab is already connected in this workspace")
			}
			return platform.Internal(err)
		}
		out = gitLabConnectionFromCreate(row)
		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "gitlabConnection", EntityID: out.ID, Op: OpUpsert,
			Scope: authz.WorkspaceScope(), Payload: out,
		})
		return err
	})
	if err != nil {
		return model.GitLabConnection{}, "", 0, err
	}
	return out, secret, version, nil
}

func (s *Service) UpdateGitLabConnection(
	ctx context.Context, p *authz.Principal, in UpdateGitLabConnectionInput,
) (model.GitLabConnection, int64, error) {
	if !authz.Can(p, authz.ActionGitLabManage) {
		return model.GitLabConnection{}, 0, platform.Forbidden("only admins can change GitLab settings")
	}
	var format *string
	if in.BranchNameFormat != nil {
		f, err := normaliseBranchFormat(in.BranchNameFormat)
		if err != nil {
			return model.GitLabConnection{}, 0, err
		}
		format = &f
	}
	var instance *string
	if in.InstanceURL != nil {
		u, err := normaliseGitLabInstanceURL(in.InstanceURL)
		if err != nil {
			return model.GitLabConnection{}, 0, err
		}
		instance = &u
	}

	var out model.GitLabConnection
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		row, err := q.UpdateGitLabConnection(ctx, store.UpdateGitLabConnectionParams{
			InstanceUrl:      instance,
			BranchNameFormat: format,
			LinkCommits:      in.LinkCommits,
			Linkbacks:        in.Linkbacks,
			Enabled:          in.Enabled,
			WorkspaceID:      p.WorkspaceID,
		})
		if err != nil {
			if store.IsNotFound(err) {
				return platform.NotFound("gitlabConnection")
			}
			return platform.Internal(err)
		}
		if in.AccessToken != nil {
			token := strings.TrimSpace(*in.AccessToken)
			if err := q.SetGitLabConnectionAccessToken(ctx, store.SetGitLabConnectionAccessTokenParams{
				AccessToken: &token, WorkspaceID: p.WorkspaceID,
			}); err != nil {
				return platform.Internal(err)
			}
			got, err := q.GetGitLabConnection(ctx, p.WorkspaceID)
			if err != nil {
				return platform.Internal(err)
			}
			out = gitLabConnectionFromGet(got)
		} else {
			out = gitLabConnectionFromUpdate(row)
		}
		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType:    "gitlabConnection",
			EntityID:      out.ID,
			Op:            OpUpsert,
			Scope:         authz.WorkspaceScope(),
			Payload:       out,
			ChangedFields: []string{"instanceUrl", "branchNameFormat", "linkCommits", "linkbacks", "enabled"},
		})
		return err
	})
	return out, version, err
}

func (s *Service) DeleteGitLabConnection(ctx context.Context, p *authz.Principal) (uuid.UUID, int64, error) {
	if !authz.Can(p, authz.ActionGitLabManage) {
		return uuid.Nil, 0, platform.Forbidden("only admins can disconnect GitLab")
	}
	var id uuid.UUID
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		row, err := q.GetGitLabConnection(ctx, p.WorkspaceID)
		if err != nil {
			if store.IsNotFound(err) {
				return platform.NotFound("gitlabConnection")
			}
			return platform.Internal(err)
		}
		id = row.ID
		if err := q.DeleteGitLabConnection(ctx, p.WorkspaceID); err != nil {
			return platform.Internal(err)
		}
		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "gitlabConnection", EntityID: id, Op: OpDelete,
			Scope: authz.WorkspaceScope(),
		})
		return err
	})
	return id, version, err
}

func (s *Service) GetGitLabConnection(ctx context.Context, p *authz.Principal) (model.GitLabConnection, error) {
	if !authz.Visible(p, authz.WorkspaceScope()) {
		return model.GitLabConnection{}, platform.NotFound("gitlabConnection")
	}
	row, err := s.db.Queries().GetGitLabConnection(ctx, p.WorkspaceID)
	if err != nil {
		if store.IsNotFound(err) {
			return model.GitLabConnection{}, platform.NotFound("gitlabConnection")
		}
		return model.GitLabConnection{}, platform.Internal(err)
	}
	return gitLabConnectionFromGet(row), nil
}

func (s *Service) GetGitLabWebhookSecret(ctx context.Context, p *authz.Principal) (string, error) {
	if !authz.Can(p, authz.ActionGitLabManage) {
		return "", platform.Forbidden("only admins can read the GitLab webhook secret")
	}
	secret, err := s.db.Queries().GetGitLabConnectionSecret(ctx, p.WorkspaceID)
	if err != nil {
		if store.IsNotFound(err) {
			return "", platform.NotFound("gitlabConnection")
		}
		return "", platform.Internal(err)
	}
	return secret, nil
}

func (s *Service) CreateGitLabUserLink(
	ctx context.Context, p *authz.Principal, in CreateGitLabUserLinkInput,
) (model.GitLabUserLink, int64, error) {
	login := strings.TrimSpace(in.GitLabUsername)
	if login == "" {
		return model.GitLabUserLink{}, 0, platform.Validation("gitlabUsername", "a GitLab username is required")
	}
	if len(login) > 256 {
		return model.GitLabUserLink{}, 0, platform.Validation("gitlabUsername", "that username is too long")
	}

	var out model.GitLabUserLink
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		_, err := q.GetGitLabUserLink(ctx, store.GetGitLabUserLinkParams{
			WorkspaceID: p.WorkspaceID, UserID: p.UserID,
		})
		if err != nil && !store.IsNotFound(err) {
			return platform.Internal(err)
		}
		if err == nil {
			row, err := q.UpdateGitLabUserLink(ctx, store.UpdateGitLabUserLinkParams{
				GitlabUsername: login,
				GitlabUserID:   in.GitLabUserID,
				WorkspaceID:    p.WorkspaceID,
				UserID:         p.UserID,
			})
			if err != nil {
				return platform.Internal(err)
			}
			out = gitLabUserLinkFromStore(row)
			version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
				EntityType: "gitlabUserLink", EntityID: out.ID, Op: OpUpsert,
				Scope: authz.UserScope(p.UserID), Payload: out,
				ChangedFields: []string{"gitlabUsername", "gitlabUserId"},
			})
			return err
		}
		id, err := uuid.NewV7()
		if err != nil {
			return platform.Internal(err)
		}
		row, err := q.CreateGitLabUserLink(ctx, store.CreateGitLabUserLinkParams{
			ID: id, WorkspaceID: p.WorkspaceID, UserID: p.UserID,
			GitlabUsername: login, GitlabUserID: in.GitLabUserID,
		})
		if err != nil {
			return platform.Internal(err)
		}
		out = gitLabUserLinkFromStore(row)
		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "gitlabUserLink", EntityID: out.ID, Op: OpUpsert,
			Scope: authz.UserScope(p.UserID), Payload: out,
		})
		return err
	})
	return out, version, err
}

func (s *Service) DeleteGitLabUserLink(ctx context.Context, p *authz.Principal) (uuid.UUID, int64, error) {
	var id uuid.UUID
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		row, err := q.GetGitLabUserLink(ctx, store.GetGitLabUserLinkParams{
			WorkspaceID: p.WorkspaceID, UserID: p.UserID,
		})
		if err != nil {
			if store.IsNotFound(err) {
				return platform.NotFound("gitlabUserLink")
			}
			return platform.Internal(err)
		}
		id = row.ID
		if err := q.DeleteGitLabUserLink(ctx, store.DeleteGitLabUserLinkParams{
			WorkspaceID: p.WorkspaceID, UserID: p.UserID,
		}); err != nil {
			return platform.Internal(err)
		}
		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "gitlabUserLink", EntityID: id, Op: OpDelete,
			Scope: authz.UserScope(p.UserID),
		})
		return err
	})
	return id, version, err
}

func (s *Service) GetGitLabUserLink(ctx context.Context, p *authz.Principal) (model.GitLabUserLink, error) {
	row, err := s.db.Queries().GetGitLabUserLink(ctx, store.GetGitLabUserLinkParams{
		WorkspaceID: p.WorkspaceID, UserID: p.UserID,
	})
	if err != nil {
		if store.IsNotFound(err) {
			return model.GitLabUserLink{}, platform.NotFound("gitlabUserLink")
		}
		return model.GitLabUserLink{}, platform.Internal(err)
	}
	return gitLabUserLinkFromStore(row), nil
}

func (s *Service) LinkGitLabMergeRequest(
	ctx context.Context, p *authz.Principal, in LinkGitLabMergeRequestInput,
) ([]model.Attachment, int64, error) {
	parsed, repo, number, err := parseGitLabMergeURL(in.URL)
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
		title = fmt.Sprintf("%s!%d", repo, number)
	}

	var lastVersion int64
	var out []model.Attachment
	for _, t := range targets {
		already, err := s.attachmentExistsForURL(ctx, p, t.issue.ID, parsed.String())
		if err != nil {
			return nil, 0, err
		}
		meta, _ := json.Marshal(gitlabAttachmentMeta{
			Source:     "gitlab",
			Kind:       "merge_request",
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
			Title:    fmt.Sprintf("%s!%d", repo, number),
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
		if err := s.applyGitLabMRStatus(ctx, p, t, in); err != nil {
			return nil, 0, err
		}
		if !already {
			s.postGitLabMRLinkback(ctx, p, t.issue, repo, number)
		}
	}
	return out, lastVersion, nil
}

func (s *Service) IngestGitLabPush(
	ctx context.Context, workspaceID uuid.UUID, in GitLabPushInput,
) (int64, []model.Attachment, error) {
	p, conn, err := s.principalForGitLabWorkspace(ctx, workspaceID)
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
			meta, _ := json.Marshal(gitlabAttachmentMeta{
				Source:     "gitlab",
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
			if err := s.applyGitLabCommitStatus(ctx, p, *issue, link.Class, c.OnDefaultBranch); err != nil {
				return 0, nil, err
			}
			if !already {
				s.postGitLabCommitLinkback(ctx, p, *issue, c)
			}
		}
	}
	return lastVersion, out, nil
}

func (s *Service) IngestGitLabMergeRequest(
	ctx context.Context, workspaceID uuid.UUID, in LinkGitLabMergeRequestInput,
) ([]model.Attachment, int64, error) {
	p, conn, err := s.principalForGitLabWorkspace(ctx, workspaceID)
	if err != nil || p == nil {
		return nil, 0, err
	}
	if !conn.Enabled {
		return nil, 0, nil
	}
	return s.LinkGitLabMergeRequest(ctx, p, in)
}

func (s *Service) VerifyGitLabWebhook(ctx context.Context, workspaceID uuid.UUID, token string) error {
	stored, err := s.db.Queries().GetGitLabConnectionSecret(ctx, workspaceID)
	if err != nil {
		if store.IsNotFound(err) {
			return platform.NotFound("gitlabConnection")
		}
		return platform.Internal(err)
	}
	if !platform.GitLabTokenOK(stored, token) {
		return platform.Unauthorized("bad gitlab webhook token")
	}
	return nil
}

func (s *Service) principalForGitLabWorkspace(
	ctx context.Context, workspaceID uuid.UUID,
) (*authz.Principal, model.GitLabConnection, error) {
	row, err := s.db.Queries().GetGitLabConnection(ctx, workspaceID)
	if err != nil {
		if store.IsNotFound(err) {
			return nil, model.GitLabConnection{}, nil
		}
		return nil, model.GitLabConnection{}, platform.Internal(err)
	}
	conn := gitLabConnectionFromGet(row)
	creator, err := s.db.Queries().GetUser(ctx, conn.CreatorID)
	if err != nil {
		return nil, model.GitLabConnection{}, platform.Internal(err)
	}
	if creator.AccountID == nil {
		return nil, model.GitLabConnection{}, platform.Internal(fmt.Errorf("gitlab connection creator has no account"))
	}
	p, err := s.ResolvePrincipal(ctx, *creator.AccountID, workspaceID)
	if err != nil {
		return nil, model.GitLabConnection{}, err
	}
	return p, conn, nil
}

func parseGitLabMergeURL(raw string) (*url.URL, string, int, error) {
	u, err := parseAttachmentURL(raw)
	if err != nil {
		return nil, "", 0, err
	}
	parts := strings.Split(strings.Trim(u.Path, "/"), "/")
	marker := -1
	for i := 0; i+2 < len(parts); i++ {
		if parts[i] == "-" && parts[i+1] == "merge_requests" {
			marker = i
			break
		}
	}
	if marker <= 0 {
		return nil, "", 0, platform.Validation("url", "that is not a GitLab merge request URL")
	}
	n, err := strconv.Atoi(parts[marker+2])
	if err != nil || n <= 0 {
		return nil, "", 0, platform.Validation("url", "that is not a GitLab merge request URL")
	}
	repo := strings.Join(parts[:marker], "/")
	if repo == "" {
		return nil, "", 0, platform.Validation("url", "that is not a GitLab merge request URL")
	}
	return u, repo, n, nil
}

func normaliseGitLabInstanceURL(raw *string) (string, error) {
	if raw == nil || strings.TrimSpace(*raw) == "" {
		return DefaultGitLabInstanceURL, nil
	}
	s := strings.TrimSpace(*raw)
	if len(s) > maxGitLabInstanceURLLength {
		return "", platform.Validation("instanceUrl", "that URL is too long")
	}
	u, err := url.Parse(s)
	if err != nil || u.Host == "" {
		return "", platform.Validation("instanceUrl", "that is not a GitLab instance URL")
	}
	if u.Scheme != "https" && u.Scheme != "http" {
		return "", platform.Validation("instanceUrl", "the instance URL must be http or https")
	}
	if u.Path != "" && u.Path != "/" {
		return "", platform.Validation("instanceUrl", "the instance URL must not include a path")
	}
	if u.RawQuery != "" || u.Fragment != "" {
		return "", platform.Validation("instanceUrl", "the instance URL must not include a query")
	}
	return strings.ToLower(u.Scheme) + "://" + u.Host, nil
}

func newGitLabWebhookSecret() (string, error) {
	buf := make([]byte, gitlabWebhookSecretBytes)
	if _, err := rand.Read(buf); err != nil {
		return "", platform.Internal(err)
	}
	return gitlabWebhookSecretPrefix + base64.RawURLEncoding.EncodeToString(buf), nil
}

func gitLabConnectionFromCreate(r store.CreateGitLabConnectionRow) model.GitLabConnection {
	return model.GitLabConnection{
		ID: r.ID, WorkspaceID: r.WorkspaceID, CreatorID: r.CreatorID, Enabled: r.Enabled,
		InstanceURL: r.InstanceUrl, BranchNameFormat: r.BranchNameFormat,
		LinkCommits: r.LinkCommits, Linkbacks: r.Linkbacks,
		ConnectedAt: r.ConnectedAt, CreatedAt: r.CreatedAt, UpdatedAt: r.UpdatedAt,
	}
}

func gitLabConnectionFromGet(r store.GetGitLabConnectionRow) model.GitLabConnection {
	return model.GitLabConnection{
		ID: r.ID, WorkspaceID: r.WorkspaceID, CreatorID: r.CreatorID, Enabled: r.Enabled,
		InstanceURL: r.InstanceUrl, BranchNameFormat: r.BranchNameFormat,
		LinkCommits: r.LinkCommits, Linkbacks: r.Linkbacks,
		ConnectedAt: r.ConnectedAt, CreatedAt: r.CreatedAt, UpdatedAt: r.UpdatedAt,
	}
}

func gitLabConnectionFromUpdate(r store.UpdateGitLabConnectionRow) model.GitLabConnection {
	return model.GitLabConnection{
		ID: r.ID, WorkspaceID: r.WorkspaceID, CreatorID: r.CreatorID, Enabled: r.Enabled,
		InstanceURL: r.InstanceUrl, BranchNameFormat: r.BranchNameFormat,
		LinkCommits: r.LinkCommits, Linkbacks: r.Linkbacks,
		ConnectedAt: r.ConnectedAt, CreatedAt: r.CreatedAt, UpdatedAt: r.UpdatedAt,
	}
}

func gitLabConnectionFromStream(r store.StreamGitLabConnectionsForBootstrapRow) model.GitLabConnection {
	return model.GitLabConnection{
		ID: r.ID, WorkspaceID: r.WorkspaceID, CreatorID: r.CreatorID, Enabled: r.Enabled,
		InstanceURL: r.InstanceUrl, BranchNameFormat: r.BranchNameFormat,
		LinkCommits: r.LinkCommits, Linkbacks: r.Linkbacks,
		ConnectedAt: r.ConnectedAt, CreatedAt: r.CreatedAt, UpdatedAt: r.UpdatedAt,
	}
}

func gitLabUserLinkFromStore(r store.GitlabUserLink) model.GitLabUserLink {
	return model.GitLabUserLink{
		ID: r.ID, WorkspaceID: r.WorkspaceID, UserID: r.UserID, GitLabUsername: r.GitlabUsername,
		CreatedAt: r.CreatedAt, UpdatedAt: r.UpdatedAt,
	}
}
