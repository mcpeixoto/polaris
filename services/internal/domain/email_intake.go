package domain

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"net/mail"
	"net/url"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/store"
)

const (
	emailIntakeTokenBytes = 10
	// Linear refuses bodies over ~250,000 characters; attachments over 25 MB are a
	// mail-routing concern and never reach this JSON stub.
	maxEmailBodyRunes = 250_000
)

// InboundEmail is the parsed form of an inbound message. The HTTP webhook and a future
// SMTP listener both produce this; neither talks to store.
type InboundEmail struct {
	To         string
	From       string
	Subject    string
	Text       string
	HTML       string
	MessageID  string
	InReplyTo  string
	References string
	// Links to attach as cards. Binary files are out of scope for the JSON stub.
	Attachments []InboundEmailLink
}

type InboundEmailLink struct {
	URL   string
	Title string
}

type IngestInboundEmailResult struct {
	Issue   *model.Issue
	Ignored string
}

type UpdateTeamEmailIntakeInput struct {
	TeamID  uuid.UUID
	Enabled bool
}

type UpdateIssueTemplateEmailIntakeInput struct {
	TemplateID uuid.UUID
	Enabled    bool
}

func (s *Service) UpdateTeamEmailIntake(
	ctx context.Context, p *authz.Principal, in UpdateTeamEmailIntakeInput,
) (model.Team, int64, error) {
	var out model.Team
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		before, err := s.requireTeamAccess(ctx, q, p, in.TeamID, authz.ActionTeamUpdate)
		if err != nil {
			return err
		}

		params := store.UpdateTeamEmailIntakeParams{
			ID:                 in.TeamID,
			EmailIntakeEnabled: in.Enabled,
		}
		if in.Enabled && (before.EmailIntakeToken == nil || *before.EmailIntakeToken == "") {
			token, addr, err := mintEmailIntakeAddress(s.PublicURL)
			if err != nil {
				return err
			}
			params.EmailIntakeToken = &token
			params.EmailIntakeAddress = &addr
		}

		row, err := q.UpdateTeamEmailIntake(ctx, params)
		if err != nil {
			return platform.Internal(err)
		}
		out = toTeam(row)
		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "team", EntityID: out.ID, Op: OpUpsert, TeamID: &out.ID,
			Scope: authz.TeamScope(out.ID, out.Private), Payload: out,
		})
		return err
	})
	return out, version, err
}

func (s *Service) UpdateIssueTemplateEmailIntake(
	ctx context.Context, p *authz.Principal, in UpdateIssueTemplateEmailIntakeInput,
) (model.IssueTemplate, int64, error) {
	var out model.IssueTemplate
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		row, err := s.requireTemplateAccess(ctx, q, p, in.TemplateID)
		if err != nil {
			return err
		}
		if row.TeamID == nil {
			return platform.Validation("templateId", "only a team template can have an email address")
		}
		scope, err := s.requireTemplateScope(ctx, q, p, row.TeamID)
		if err != nil {
			return err
		}

		params := store.UpdateIssueTemplateEmailIntakeParams{
			ID:                 in.TemplateID,
			EmailIntakeEnabled: in.Enabled,
		}
		if in.Enabled && (row.EmailIntakeToken == nil || *row.EmailIntakeToken == "") {
			token, addr, err := mintEmailIntakeAddress(s.PublicURL)
			if err != nil {
				return err
			}
			params.EmailIntakeToken = &token
			params.EmailIntakeAddress = &addr
		}

		updated, err := q.UpdateIssueTemplateEmailIntake(ctx, params)
		if err != nil {
			return platform.Internal(err)
		}
		out = toIssueTemplate(store.GetIssueTemplateRow(updated))
		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "issueTemplate", EntityID: out.ID, Op: OpUpsert, TeamID: out.TeamID,
			Scope: scope, Payload: out,
		})
		return err
	})
	return out, version, err
}

// IngestInboundEmail turns a parsed message into an issue for the team (or team
// template) named by the To address. Replies and unknown addresses are ignored rather
// than refused, so a mail provider retrying a reply does not mint a second issue and so
// probing addresses is not an oracle.
func (s *Service) IngestInboundEmail(ctx context.Context, mail InboundEmail) (IngestInboundEmailResult, error) {
	if isEmailReply(mail) {
		return IngestInboundEmailResult{Ignored: "reply"}, nil
	}

	token := emailIntakeToken(mail.To)
	if token == "" {
		return IngestInboundEmailResult{Ignored: "no-address"}, nil
	}

	q := s.db.Queries()
	team, template, err := s.lookupEmailIntake(ctx, q, token)
	if err != nil {
		return IngestInboundEmailResult{}, err
	}
	if team == nil {
		return IngestInboundEmailResult{Ignored: "unknown-address"}, nil
	}

	subject := strings.TrimSpace(mail.Subject)
	body := strings.TrimSpace(mail.Text)
	if body == "" {
		body = strings.TrimSpace(mail.HTML)
	}
	if utf8.RuneCountInString(body) > maxEmailBodyRunes {
		return IngestInboundEmailResult{}, platform.Validation("text", "email body must be under 250,000 characters")
	}
	if subject == "" {
		if from := strings.TrimSpace(mail.From); from != "" {
			subject = "Email from " + from
		} else {
			subject = "(no subject)"
		}
	}

	messageID := strings.TrimSpace(mail.MessageID)
	if messageID != "" {
		existing, err := q.GetInboundEmailByMessageID(ctx, store.GetInboundEmailByMessageIDParams{
			WorkspaceID: team.WorkspaceID,
			MessageID:   messageID,
		})
		if err == nil {
			issue, err := s.GetIssue(ctx, emailIntakePrincipal(team.WorkspaceID, team.ID), existing.IssueID)
			if err != nil {
				return IngestInboundEmailResult{}, err
			}
			return IngestInboundEmailResult{Issue: &issue}, nil
		}
		if !store.IsNotFound(err) {
			return IngestInboundEmailResult{}, platform.Internal(err)
		}
	}

	in := CreateIssueInput{
		TeamID:              team.ID,
		Title:               subject,
		Description:         body,
		SkipDefaultTemplate: true,
	}
	if template != nil {
		props, err := decodeTemplateProperties(template.Properties)
		if err != nil {
			return IngestInboundEmailResult{}, err
		}
		props.applyTo(&in)
		id := template.ID
		in.TemplateID = &id
	}

	p := emailIntakePrincipal(team.WorkspaceID, team.ID)
	issue, _, err := s.CreateIssue(ctx, p, in)
	if err != nil {
		return IngestInboundEmailResult{}, err
	}

	if err := s.attachOriginalEmail(ctx, p, issue, mail, messageID); err != nil {
		return IngestInboundEmailResult{}, err
	}
	for _, link := range mail.Attachments {
		if strings.TrimSpace(link.URL) == "" {
			continue
		}
		title := strings.TrimSpace(link.Title)
		if _, _, err := s.CreateAttachment(ctx, p, CreateAttachmentInput{
			IssueID: issue.ID,
			URL:     link.URL,
			Title:   title,
		}); err != nil {
			if platform.CodeOf(err) == platform.CodeValidation {
				continue
			}
			return IngestInboundEmailResult{}, err
		}
	}

	if messageID != "" {
		id, err := uuid.NewV7()
		if err != nil {
			return IngestInboundEmailResult{}, platform.Internal(err)
		}
		if _, err := q.InsertInboundEmail(ctx, store.InsertInboundEmailParams{
			ID:          id,
			WorkspaceID: team.WorkspaceID,
			IssueID:     issue.ID,
			MessageID:   messageID,
		}); err != nil {
			if store.IsUniqueViolation(err, "inbound_email_message_key") {
				return IngestInboundEmailResult{Issue: &issue}, nil
			}
			return IngestInboundEmailResult{}, platform.Internal(err)
		}
	}

	return IngestInboundEmailResult{Issue: &issue}, nil
}

func (s *Service) lookupEmailIntake(
	ctx context.Context, q *store.Queries, token string,
) (*store.Team, *store.GetIssueTemplateRow, error) {
	team, err := q.GetTeamByEmailIntakeToken(ctx, &token)
	if err == nil {
		return &team, nil, nil
	}
	if !store.IsNotFound(err) {
		return nil, nil, platform.Internal(err)
	}

	tpl, err := q.GetIssueTemplateByEmailIntakeToken(ctx, &token)
	if err != nil {
		if store.IsNotFound(err) {
			return nil, nil, nil
		}
		return nil, nil, platform.Internal(err)
	}
	if tpl.TeamID == nil {
		return nil, nil, nil
	}
	team, err = q.GetTeam(ctx, *tpl.TeamID)
	if err != nil {
		if store.IsNotFound(err) {
			return nil, nil, nil
		}
		return nil, nil, platform.Internal(err)
	}
	if team.DeletedAt != nil || team.ArchivedAt != nil || team.RetiredAt != nil {
		return nil, nil, nil
	}
	row := store.GetIssueTemplateRow(tpl)
	return &team, &row, nil
}

func (s *Service) attachOriginalEmail(
	ctx context.Context, p *authz.Principal, issue model.Issue, mail InboundEmail, messageID string,
) error {
	base := strings.TrimRight(s.PublicURL, "/")
	if base == "" {
		base = "https://inbound.local"
	}
	key := messageID
	if key == "" {
		key = issue.ID.String()
	}
	link := base + "/inbound/email/" + url.PathEscape(key)
	meta, err := json.Marshal(map[string]any{
		"title": mail.Subject,
		"messages": []map[string]string{{
			"subject": mail.Subject,
			"body":    mail.Text,
		}},
		"attributes": []map[string]string{
			{"name": "From", "value": mail.From},
			{"name": "To", "value": mail.To},
		},
	})
	if err != nil {
		return platform.Internal(err)
	}
	title := strings.TrimSpace(mail.Subject)
	if title == "" {
		title = "Original email"
	}
	_, _, err = s.CreateAttachment(ctx, p, CreateAttachmentInput{
		IssueID:  issue.ID,
		URL:      link,
		Title:    title,
		Metadata: meta,
	})
	return err
}

func emailIntakePrincipal(workspaceID, teamID uuid.UUID) *authz.Principal {
	return &authz.Principal{
		WorkspaceID: workspaceID,
		Role:        authz.RoleMember,
		Teams:       authz.NewTeamSet(teamID),
	}
}

func mintEmailIntakeAddress(publicURL string) (token, address string, err error) {
	var raw [emailIntakeTokenBytes]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return "", "", platform.Internal(err)
	}
	token = hex.EncodeToString(raw[:])
	host := "local"
	if u, err := url.Parse(strings.TrimSpace(publicURL)); err == nil {
		if h := u.Hostname(); h != "" {
			host = h
		}
	}
	return token, token + "@inbound." + host, nil
}

func emailIntakeToken(to string) string {
	to = strings.TrimSpace(to)
	if to == "" {
		return ""
	}
	addresses := splitAddresses(to)
	for _, raw := range addresses {
		parsed, err := mail.ParseAddress(raw)
		if err != nil {
			// Bare local-part, or "Name <addr>" that ParseAddress rejected: take before @.
			local, _, ok := strings.Cut(strings.TrimSpace(raw), "@")
			if ok {
				return strings.ToLower(strings.TrimSpace(local))
			}
			continue
		}
		local, _, ok := strings.Cut(parsed.Address, "@")
		if ok {
			return strings.ToLower(local)
		}
	}
	return ""
}

func splitAddresses(to string) []string {
	if strings.Contains(to, ",") {
		parts := strings.Split(to, ",")
		out := make([]string, 0, len(parts))
		for _, p := range parts {
			if s := strings.TrimSpace(p); s != "" {
				out = append(out, s)
			}
		}
		return out
	}
	return []string{to}
}

func isEmailReply(mail InboundEmail) bool {
	if strings.TrimSpace(mail.InReplyTo) != "" || strings.TrimSpace(mail.References) != "" {
		return true
	}
	subj := strings.TrimSpace(mail.Subject)
	lower := strings.ToLower(subj)
	return strings.HasPrefix(lower, "re:") || strings.HasPrefix(lower, "fwd:") || strings.HasPrefix(lower, "fw:")
}
