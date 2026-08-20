package domain

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/store"
)

const (
	sentryWebhookSecretPrefix = "sentry_"
	sentryWebhookSecretBytes  = 32
	maxSentryOrgSlugLength    = 64
)

type CreateSentryConnectionInput struct {
	DefaultTeamID    uuid.UUID
	OrganizationSlug *string
}

type UpdateSentryConnectionInput struct {
	DefaultTeamID    *uuid.UUID
	OrganizationSlug *string
	ClearOrgSlug     bool
	Enabled          *bool
	WebhookSecret    *string
}

type LinkSentryIssueInput struct {
	IssueID uuid.UUID
	URL     string
	Title   string
}

type IngestSentryIssueInput struct {
	URL         string
	Title       string
	Culprit     string
	Project     string
	Level       string
	ShortID     string
	Environment string
}

type IngestSentryIssueResult struct {
	Issue      *model.Issue
	Attachment *model.Attachment
	Ignored    string
}

func (s *Service) CreateSentryConnection(
	ctx context.Context, p *authz.Principal, in CreateSentryConnectionInput,
) (model.SentryConnection, string, int64, error) {
	if !authz.Can(p, authz.ActionSentryManage) {
		return model.SentryConnection{}, "", 0, platform.Forbidden("only admins can connect Sentry")
	}
	slug, err := normaliseSentryOrgSlug(in.OrganizationSlug, false)
	if err != nil {
		return model.SentryConnection{}, "", 0, err
	}
	secret, err := newSentryWebhookSecret()
	if err != nil {
		return model.SentryConnection{}, "", 0, err
	}

	var out model.SentryConnection
	var version int64
	err = s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		if err := s.requirePublicSentryTeam(ctx, q, p, in.DefaultTeamID); err != nil {
			return err
		}
		id, err := uuid.NewV7()
		if err != nil {
			return platform.Internal(err)
		}
		now := s.now()
		row, err := q.CreateSentryConnection(ctx, store.CreateSentryConnectionParams{
			ID:               id,
			WorkspaceID:      p.WorkspaceID,
			CreatorID:        p.UserID,
			Enabled:          true,
			DefaultTeamID:    in.DefaultTeamID,
			OrganizationSlug: slug,
			WebhookSecret:    secret,
			ConnectedAt:      &now,
		})
		if err != nil {
			if store.IsUniqueViolation(err, "sentry_connection_workspace_id_key") {
				return platform.Conflict("Sentry is already connected in this workspace")
			}
			return platform.Internal(err)
		}
		out = sentryConnectionFromCreate(row)
		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "sentryConnection", EntityID: out.ID, Op: OpUpsert,
			Scope: authz.WorkspaceScope(), Payload: out,
		})
		return err
	})
	if err != nil {
		return model.SentryConnection{}, "", 0, err
	}
	return out, secret, version, nil
}

func (s *Service) UpdateSentryConnection(
	ctx context.Context, p *authz.Principal, in UpdateSentryConnectionInput,
) (model.SentryConnection, int64, error) {
	if !authz.Can(p, authz.ActionSentryManage) {
		return model.SentryConnection{}, 0, platform.Forbidden("only admins can change Sentry settings")
	}
	var slug *string
	if in.OrganizationSlug != nil {
		s, err := normaliseSentryOrgSlug(in.OrganizationSlug, true)
		if err != nil {
			return model.SentryConnection{}, 0, err
		}
		slug = s
	}

	var out model.SentryConnection
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		if in.DefaultTeamID != nil {
			if err := s.requirePublicSentryTeam(ctx, q, p, *in.DefaultTeamID); err != nil {
				return err
			}
		}
		row, err := q.UpdateSentryConnection(ctx, store.UpdateSentryConnectionParams{
			DefaultTeamID:    in.DefaultTeamID,
			OrganizationSlug: slug,
			Enabled:          in.Enabled,
			WorkspaceID:      p.WorkspaceID,
		})
		if err != nil {
			if store.IsNotFound(err) {
				return platform.NotFound("sentryConnection")
			}
			return platform.Internal(err)
		}
		if in.ClearOrgSlug {
			if err := q.ClearSentryConnectionOrganizationSlug(ctx, p.WorkspaceID); err != nil {
				return platform.Internal(err)
			}
		}
		if in.WebhookSecret != nil {
			secret := strings.TrimSpace(*in.WebhookSecret)
			if secret == "" {
				return platform.Validation("webhookSecret", "a webhook secret cannot be blank")
			}
			if err := q.SetSentryConnectionSecret(ctx, store.SetSentryConnectionSecretParams{
				WebhookSecret: secret, WorkspaceID: p.WorkspaceID,
			}); err != nil {
				return platform.Internal(err)
			}
		}
		got, err := q.GetSentryConnection(ctx, p.WorkspaceID)
		if err != nil {
			return platform.Internal(err)
		}
		out = sentryConnectionFromGet(got)
		_ = row // applied the optional column writes; Get is the post-clear/secret view
		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType:    "sentryConnection",
			EntityID:      out.ID,
			Op:            OpUpsert,
			Scope:         authz.WorkspaceScope(),
			Payload:       out,
			ChangedFields: []string{"defaultTeamId", "organizationSlug", "enabled"},
		})
		return err
	})
	return out, version, err
}

func (s *Service) DeleteSentryConnection(ctx context.Context, p *authz.Principal) (uuid.UUID, int64, error) {
	if !authz.Can(p, authz.ActionSentryManage) {
		return uuid.Nil, 0, platform.Forbidden("only admins can disconnect Sentry")
	}
	var id uuid.UUID
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		row, err := q.GetSentryConnection(ctx, p.WorkspaceID)
		if err != nil {
			if store.IsNotFound(err) {
				return platform.NotFound("sentryConnection")
			}
			return platform.Internal(err)
		}
		id = row.ID
		if err := q.DeleteSentryConnection(ctx, p.WorkspaceID); err != nil {
			return platform.Internal(err)
		}
		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "sentryConnection", EntityID: id, Op: OpDelete,
			Scope: authz.WorkspaceScope(),
		})
		return err
	})
	return id, version, err
}

func (s *Service) GetSentryConnection(ctx context.Context, p *authz.Principal) (model.SentryConnection, error) {
	if !authz.Visible(p, authz.WorkspaceScope()) {
		return model.SentryConnection{}, platform.NotFound("sentryConnection")
	}
	row, err := s.db.Queries().GetSentryConnection(ctx, p.WorkspaceID)
	if err != nil {
		if store.IsNotFound(err) {
			return model.SentryConnection{}, platform.NotFound("sentryConnection")
		}
		return model.SentryConnection{}, platform.Internal(err)
	}
	return sentryConnectionFromGet(row), nil
}

func (s *Service) GetSentryWebhookSecret(ctx context.Context, p *authz.Principal) (string, error) {
	if !authz.Can(p, authz.ActionSentryManage) {
		return "", platform.Forbidden("only admins can read the Sentry webhook secret")
	}
	secret, err := s.db.Queries().GetSentryConnectionSecret(ctx, p.WorkspaceID)
	if err != nil {
		if store.IsNotFound(err) {
			return "", platform.NotFound("sentryConnection")
		}
		return "", platform.Internal(err)
	}
	return secret, nil
}

func (s *Service) LinkSentryIssue(
	ctx context.Context, p *authz.Principal, in LinkSentryIssueInput,
) (model.Issue, model.Attachment, int64, error) {
	canonical, err := canonicalSentryIssueURL(in.URL)
	if err != nil {
		return model.Issue{}, model.Attachment{}, 0, err
	}
	title := strings.TrimSpace(in.Title)
	if title == "" {
		title = "Sentry"
	}
	issue, err := s.GetIssue(ctx, p, in.IssueID)
	if err != nil {
		return model.Issue{}, model.Attachment{}, 0, err
	}
	att, version, err := s.CreateAttachment(ctx, p, CreateAttachmentInput{
		IssueID:  in.IssueID,
		URL:      canonical,
		Title:    title,
		Metadata: sentryAttachmentMeta(in.Title, ""),
	})
	if err != nil {
		return model.Issue{}, model.Attachment{}, 0, err
	}
	return issue, att, version, nil
}

func (s *Service) IngestSentryIssue(
	ctx context.Context, workspaceID uuid.UUID, in IngestSentryIssueInput,
) (IngestSentryIssueResult, error) {
	canonical, err := canonicalSentryIssueURL(in.URL)
	if err != nil {
		return IngestSentryIssueResult{}, err
	}
	p, conn, err := s.principalForSentryWorkspace(ctx, workspaceID)
	if err != nil {
		return IngestSentryIssueResult{}, err
	}
	if p == nil {
		return IngestSentryIssueResult{Ignored: "not-connected"}, nil
	}
	if !conn.Enabled {
		return IngestSentryIssueResult{Ignored: "disabled"}, nil
	}

	existing, err := s.ListAttachmentsForURL(ctx, p, canonical)
	if err != nil {
		return IngestSentryIssueResult{}, err
	}
	if len(existing) > 0 {
		issue, err := s.GetIssue(ctx, p, existing[0].IssueID)
		if err != nil {
			return IngestSentryIssueResult{}, err
		}
		att := existing[0]
		return IngestSentryIssueResult{Issue: &issue, Attachment: &att}, nil
	}

	title := strings.TrimSpace(in.Title)
	if title == "" {
		title = "Sentry issue"
	}
	issue, _, err := s.CreateIssue(ctx, p, CreateIssueInput{
		TeamID:              conn.DefaultTeamID,
		Title:               title,
		Description:         sentryIssueDescription(in, canonical),
		SkipDefaultTemplate: true,
	})
	if err != nil {
		return IngestSentryIssueResult{}, err
	}
	subtitle := strings.TrimSpace(in.Culprit)
	var subtitlePtr *string
	if subtitle != "" {
		subtitlePtr = &subtitle
	}
	att, _, err := s.CreateAttachment(ctx, p, CreateAttachmentInput{
		IssueID:  issue.ID,
		URL:      canonical,
		Title:    firstNonBlank(in.ShortID, "Sentry"),
		Subtitle: subtitlePtr,
		Metadata: sentryAttachmentMeta(in.Project, in.Level),
	})
	if err != nil {
		return IngestSentryIssueResult{}, err
	}
	return IngestSentryIssueResult{Issue: &issue, Attachment: &att}, nil
}

func (s *Service) VerifySentryWebhook(
	ctx context.Context, workspaceID uuid.UUID, body []byte, signature, token, timestamp string,
) error {
	stored, err := s.db.Queries().GetSentryConnectionSecret(ctx, workspaceID)
	if err != nil {
		if store.IsNotFound(err) {
			return platform.NotFound("sentryConnection")
		}
		return platform.Internal(err)
	}
	if !platform.SentryTimestampOK(timestamp, s.now()) {
		return platform.Unauthorized("stale sentry webhook timestamp")
	}
	if platform.SentrySignatureOK(stored, body, signature) {
		return nil
	}
	if platform.SentryTokenOK(stored, token) {
		return nil
	}
	return platform.Unauthorized("bad sentry webhook signature")
}

func (s *Service) principalForSentryWorkspace(
	ctx context.Context, workspaceID uuid.UUID,
) (*authz.Principal, model.SentryConnection, error) {
	row, err := s.db.Queries().GetSentryConnection(ctx, workspaceID)
	if err != nil {
		if store.IsNotFound(err) {
			return nil, model.SentryConnection{}, nil
		}
		return nil, model.SentryConnection{}, platform.Internal(err)
	}
	conn := sentryConnectionFromGet(row)
	team, err := s.db.Queries().GetTeam(ctx, conn.DefaultTeamID)
	if err != nil {
		if store.IsNotFound(err) {
			return nil, conn, nil
		}
		return nil, model.SentryConnection{}, platform.Internal(err)
	}
	if team.Private || team.DeletedAt != nil || team.ArchivedAt != nil || team.RetiredAt != nil {
		return nil, conn, platform.Validation("defaultTeamId", "Sentry can only create issues in a public team")
	}
	creator, err := s.db.Queries().GetUser(ctx, conn.CreatorID)
	if err != nil {
		return nil, model.SentryConnection{}, platform.Internal(err)
	}
	if creator.AccountID == nil {
		return nil, model.SentryConnection{}, platform.Internal(fmt.Errorf("sentry connection creator has no account"))
	}
	p, err := s.ResolvePrincipal(ctx, *creator.AccountID, workspaceID)
	if err != nil {
		return nil, model.SentryConnection{}, err
	}
	return p, conn, nil
}

func (s *Service) requirePublicSentryTeam(
	ctx context.Context, q *store.Queries, p *authz.Principal, teamID uuid.UUID,
) error {
	team, err := q.GetTeam(ctx, teamID)
	if err != nil {
		if store.IsNotFound(err) {
			return platform.NotFound("team")
		}
		return platform.Internal(err)
	}
	if team.WorkspaceID != p.WorkspaceID {
		return platform.NotFound("team")
	}
	if team.DeletedAt != nil || team.ArchivedAt != nil || team.RetiredAt != nil {
		return platform.NotFound("team")
	}
	if team.Private {
		return platform.Validation("defaultTeamId", "Sentry can only create issues in a public team")
	}
	if !authz.Visible(p, authz.TeamScope(team.ID, team.Private)) {
		return platform.NotFound("team")
	}
	return nil
}

func canonicalSentryIssueURL(raw string) (string, error) {
	u, err := parseAttachmentURL(raw)
	if err != nil {
		return "", err
	}
	host := strings.ToLower(u.Host)
	if host != "sentry.io" && !strings.HasSuffix(host, ".sentry.io") {
		return "", platform.Validation("url", "Sentry v1 is cloud-only; that is not a sentry.io URL")
	}
	parts := strings.Split(strings.Trim(u.Path, "/"), "/")
	issueIdx := -1
	for i, part := range parts {
		if part == "issues" && i+1 < len(parts) && parts[i+1] != "" {
			issueIdx = i
			break
		}
	}
	if issueIdx < 0 {
		return "", platform.Validation("url", "that is not a Sentry issue URL")
	}
	u.Path = "/" + strings.Join(parts[:issueIdx+2], "/") + "/"
	u.RawQuery = ""
	u.Fragment = ""
	return u.String(), nil
}

func sentryIssueDescription(in IngestSentryIssueInput, canonical string) string {
	var b strings.Builder
	b.WriteString("Created from [Sentry](")
	b.WriteString(canonical)
	b.WriteString(").")
	writeMeta := func(label, value string) {
		if strings.TrimSpace(value) == "" {
			return
		}
		b.WriteString("\n\n**")
		b.WriteString(label)
		b.WriteString(":** ")
		b.WriteString(strings.TrimSpace(value))
	}
	writeMeta("Project", in.Project)
	writeMeta("Culprit", in.Culprit)
	writeMeta("Level", in.Level)
	writeMeta("Environment", in.Environment)
	if in.ShortID != "" {
		writeMeta("Issue", in.ShortID)
	}
	return b.String()
}

func sentryAttachmentMeta(project, level string) json.RawMessage {
	obj := map[string]any{"source": "sentry"}
	if strings.TrimSpace(project) != "" {
		obj["project"] = strings.TrimSpace(project)
	}
	if strings.TrimSpace(level) != "" {
		obj["level"] = strings.TrimSpace(level)
	}
	b, err := json.Marshal(obj)
	if err != nil {
		return json.RawMessage(`{"source":"sentry"}`)
	}
	return b
}

func normaliseSentryOrgSlug(raw *string, allowEmpty bool) (*string, error) {
	if raw == nil {
		return nil, nil
	}
	s := strings.TrimSpace(*raw)
	if s == "" {
		if allowEmpty {
			return nil, nil
		}
		return nil, nil
	}
	if len(s) > maxSentryOrgSlugLength {
		return nil, platform.Validation("organizationSlug", "that organization slug is too long")
	}
	for _, r := range s {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '-' || r == '_' {
			continue
		}
		return nil, platform.Validation("organizationSlug", "use letters, numbers, hyphens, or underscores")
	}
	out := strings.ToLower(s)
	return &out, nil
}

func newSentryWebhookSecret() (string, error) {
	buf := make([]byte, sentryWebhookSecretBytes)
	if _, err := rand.Read(buf); err != nil {
		return "", platform.Internal(err)
	}
	return sentryWebhookSecretPrefix + base64.RawURLEncoding.EncodeToString(buf), nil
}

func firstNonBlank(values ...string) string {
	for _, v := range values {
		if s := strings.TrimSpace(v); s != "" {
			return s
		}
	}
	return ""
}

func sentryConnectionFromCreate(r store.CreateSentryConnectionRow) model.SentryConnection {
	return model.SentryConnection{
		ID: r.ID, WorkspaceID: r.WorkspaceID, CreatorID: r.CreatorID, Enabled: r.Enabled,
		DefaultTeamID: r.DefaultTeamID, OrganizationSlug: r.OrganizationSlug,
		ConnectedAt: r.ConnectedAt, CreatedAt: r.CreatedAt, UpdatedAt: r.UpdatedAt,
	}
}

func sentryConnectionFromGet(r store.GetSentryConnectionRow) model.SentryConnection {
	return model.SentryConnection{
		ID: r.ID, WorkspaceID: r.WorkspaceID, CreatorID: r.CreatorID, Enabled: r.Enabled,
		DefaultTeamID: r.DefaultTeamID, OrganizationSlug: r.OrganizationSlug,
		ConnectedAt: r.ConnectedAt, CreatedAt: r.CreatedAt, UpdatedAt: r.UpdatedAt,
	}
}

func sentryConnectionFromStream(r store.StreamSentryConnectionsForBootstrapRow) model.SentryConnection {
	return model.SentryConnection{
		ID: r.ID, WorkspaceID: r.WorkspaceID, CreatorID: r.CreatorID, Enabled: r.Enabled,
		DefaultTeamID: r.DefaultTeamID, OrganizationSlug: r.OrganizationSlug,
		ConnectedAt: r.ConnectedAt, CreatedAt: r.CreatedAt, UpdatedAt: r.UpdatedAt,
	}
}
