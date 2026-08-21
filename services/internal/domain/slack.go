package domain

import (
	"context"
	"fmt"
	"strings"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/entitlement"
	slackin "github.com/peixotolabs/polaris/services/internal/integrations/slack"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/store"
	"github.com/peixotolabs/polaris/services/internal/webhookout"
)

const maxSlackChannelName = 80

type CreateSlackConnectionInput struct {
	DefaultTeamID  uuid.UUID
	ChannelName    *string
	WebhookURL     *string
	NotifyIssues   *bool
	NotifyComments *bool
}

type UpdateSlackConnectionInput struct {
	DefaultTeamID    *uuid.UUID
	ChannelName      *string
	ClearChannelName bool
	WebhookURL       *string
	ClearWebhookURL  bool
	NotifyIssues     *bool
	NotifyComments   *bool
	AsksEnabled      *bool
	Enabled          *bool
}

type SlackInbound struct {
	CommandURL              string
	EventsURL               string
	WebhookConfigured       bool
	SigningSecretConfigured bool
	BotTokenConfigured      bool
}

type SlackSlashResult struct {
	Text string
}

func (s *Service) CreateSlackConnection(
	ctx context.Context, p *authz.Principal, in CreateSlackConnectionInput,
) (model.SlackConnection, int64, error) {
	if !authz.Can(p, authz.ActionSlackManage) {
		return model.SlackConnection{}, 0, platform.Forbidden("only admins can connect Slack")
	}
	channel, err := normaliseSlackChannelName(in.ChannelName, false)
	if err != nil {
		return model.SlackConnection{}, 0, err
	}
	webhook, err := normaliseSlackWebhookURL(in.WebhookURL, false)
	if err != nil {
		return model.SlackConnection{}, 0, err
	}
	notifyIssues := true
	if in.NotifyIssues != nil {
		notifyIssues = *in.NotifyIssues
	}
	notifyComments := true
	if in.NotifyComments != nil {
		notifyComments = *in.NotifyComments
	}

	var out model.SlackConnection
	var version int64
	err = s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		ent, err := entitlementSetFor(ctx, q, p.WorkspaceID)
		if err != nil {
			return err
		}
		if err := ent.Allow(entitlement.FeatureSlack); err != nil {
			return err
		}
		if err := s.requirePublicSlackTeam(ctx, q, p, in.DefaultTeamID); err != nil {
			return err
		}
		through, err := q.GetWorkspaceVersion(ctx, p.WorkspaceID)
		if err != nil {
			return platform.Internal(err)
		}
		id, err := uuid.NewV7()
		if err != nil {
			return platform.Internal(err)
		}
		now := s.now()
		row, err := q.CreateSlackConnection(ctx, store.CreateSlackConnectionParams{
			ID:             id,
			WorkspaceID:    p.WorkspaceID,
			CreatorID:      p.UserID,
			Enabled:        true,
			DefaultTeamID:  in.DefaultTeamID,
			ChannelName:    channel,
			NotifyIssues:   notifyIssues,
			NotifyComments: notifyComments,
			WebhookUrl:     webhook,
			NotifyCursor:   through,
			ConnectedAt:    &now,
		})
		if err != nil {
			if store.IsUniqueViolation(err, "slack_connection_workspace_id_key") {
				return platform.Conflict("Slack is already connected in this workspace")
			}
			return platform.Internal(err)
		}
		out = slackConnectionFromCreate(row)
		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "slackConnection", EntityID: out.ID, Op: OpUpsert,
			Scope: authz.WorkspaceScope(), Payload: out,
		})
		return err
	})
	if err != nil {
		return model.SlackConnection{}, 0, err
	}
	return out, version, nil
}

func (s *Service) UpdateSlackConnection(
	ctx context.Context, p *authz.Principal, in UpdateSlackConnectionInput,
) (model.SlackConnection, int64, error) {
	if !authz.Can(p, authz.ActionSlackManage) {
		return model.SlackConnection{}, 0, platform.Forbidden("only admins can change Slack settings")
	}
	var channel *string
	if in.ChannelName != nil {
		c, err := normaliseSlackChannelName(in.ChannelName, true)
		if err != nil {
			return model.SlackConnection{}, 0, err
		}
		channel = c
	}
	var webhook *string
	if in.WebhookURL != nil {
		w, err := normaliseSlackWebhookURL(in.WebhookURL, true)
		if err != nil {
			return model.SlackConnection{}, 0, err
		}
		webhook = w
	}

	var out model.SlackConnection
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		if in.DefaultTeamID != nil {
			if err := s.requirePublicSlackTeam(ctx, q, p, *in.DefaultTeamID); err != nil {
				return err
			}
		}
		if _, err := q.UpdateSlackConnection(ctx, store.UpdateSlackConnectionParams{
			DefaultTeamID:  in.DefaultTeamID,
			ChannelName:    channel,
			NotifyIssues:   in.NotifyIssues,
			NotifyComments: in.NotifyComments,
			AsksEnabled:    in.AsksEnabled,
			Enabled:        in.Enabled,
			WorkspaceID:    p.WorkspaceID,
		}); err != nil {
			if store.IsNotFound(err) {
				return platform.NotFound("slackConnection")
			}
			return platform.Internal(err)
		}
		if in.ClearChannelName {
			if err := q.ClearSlackConnectionChannelName(ctx, p.WorkspaceID); err != nil {
				return platform.Internal(err)
			}
		}
		if in.ClearWebhookURL {
			if err := q.SetSlackConnectionWebhookURL(ctx, store.SetSlackConnectionWebhookURLParams{
				WebhookUrl:  nil,
				WorkspaceID: p.WorkspaceID,
			}); err != nil {
				return platform.Internal(err)
			}
		} else if webhook != nil {
			if err := q.SetSlackConnectionWebhookURL(ctx, store.SetSlackConnectionWebhookURLParams{
				WebhookUrl:  webhook,
				WorkspaceID: p.WorkspaceID,
			}); err != nil {
				return platform.Internal(err)
			}
		}
		got, err := q.GetSlackConnection(ctx, p.WorkspaceID)
		if err != nil {
			return platform.Internal(err)
		}
		out = slackConnectionFromGet(got)
		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType:    "slackConnection",
			EntityID:      out.ID,
			Op:            OpUpsert,
			Scope:         authz.WorkspaceScope(),
			Payload:       out,
			ChangedFields: []string{"slack"},
		})
		return err
	})
	if err != nil {
		return model.SlackConnection{}, 0, err
	}
	return out, version, nil
}

func (s *Service) DeleteSlackConnection(ctx context.Context, p *authz.Principal) (uuid.UUID, int64, error) {
	if !authz.Can(p, authz.ActionSlackManage) {
		return uuid.Nil, 0, platform.Forbidden("only admins can disconnect Slack")
	}
	var id uuid.UUID
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		row, err := q.GetSlackConnection(ctx, p.WorkspaceID)
		if err != nil {
			if store.IsNotFound(err) {
				return platform.NotFound("slackConnection")
			}
			return platform.Internal(err)
		}
		id = row.ID
		if err := q.DeleteSlackConnection(ctx, p.WorkspaceID); err != nil {
			return platform.Internal(err)
		}
		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "slackConnection", EntityID: id, Op: OpDelete,
			Scope: authz.WorkspaceScope(),
		})
		return err
	})
	return id, version, err
}

func (s *Service) GetSlackConnection(ctx context.Context, p *authz.Principal) (model.SlackConnection, error) {
	if p == nil {
		return model.SlackConnection{}, platform.NotFound("slackConnection")
	}
	row, err := s.db.Queries().GetSlackConnection(ctx, p.WorkspaceID)
	if err != nil {
		if store.IsNotFound(err) {
			return model.SlackConnection{}, platform.NotFound("slackConnection")
		}
		return model.SlackConnection{}, platform.Internal(err)
	}
	return slackConnectionFromGet(row), nil
}

func (s *Service) SlackWebhookConfigured(ctx context.Context, p *authz.Principal) (bool, error) {
	if !authz.Can(p, authz.ActionSlackManage) {
		return false, platform.Forbidden("only admins can read Slack credentials")
	}
	url, err := s.db.Queries().GetSlackConnectionWebhookURL(ctx, p.WorkspaceID)
	if err != nil {
		if store.IsNotFound(err) {
			return false, platform.NotFound("slackConnection")
		}
		return false, platform.Internal(err)
	}
	return url != nil && strings.TrimSpace(*url) != "", nil
}

func (s *Service) VerifySlackRequest(
	ctx context.Context, workspaceID uuid.UUID, body []byte, timestamp, signature, signingSecret string,
) error {
	if !platform.SlackTimestampOK(timestamp, s.now()) {
		return platform.Unauthorized("stale slack request timestamp")
	}
	if !platform.SlackSignatureOK(signingSecret, timestamp, body, signature) {
		return platform.Unauthorized("bad slack signature")
	}
	row, err := s.db.Queries().GetSlackConnection(ctx, workspaceID)
	if err != nil {
		if store.IsNotFound(err) {
			return platform.NotFound("slackConnection")
		}
		return platform.Internal(err)
	}
	if !row.Enabled {
		return platform.Forbidden("Slack is disabled in this workspace")
	}
	return nil
}

func (s *Service) HandleSlackSlash(
	ctx context.Context, workspaceID uuid.UUID, slash slackin.Slash, publicURL string,
) (SlackSlashResult, error) {
	p, conn, err := s.principalForSlackWorkspace(ctx, workspaceID)
	if err != nil {
		return SlackSlashResult{}, err
	}
	if p == nil {
		return SlackSlashResult{Text: "Slack is not connected."}, nil
	}
	if !conn.Enabled {
		return SlackSlashResult{Text: "Slack is disabled in this workspace."}, nil
	}

	parsed := slackin.ParseText(slash.Text)
	from := slackFrom(slash.UserName, slash.ChannelName)
	if slackin.IsAsksCommand(slash.Command) {
		return s.handleAsksSlash(ctx, workspaceID, conn, strings.TrimSpace(slash.Text), from, publicURL)
	}
	switch parsed.Kind {
	case slackin.KindHelp:
		return SlackSlashResult{Text: slackHelpText()}, nil
	case slackin.KindAsk:
		return s.handleAsksSlash(ctx, workspaceID, conn, parsed.Title, from, publicURL)
	case slackin.KindCreate:
		// Bare "fixes ENG-123" is a linkback, not a new issue titled after the magic phrase.
		if parsed.Title == strings.TrimSpace(slash.Text) {
			if links := ParseMagicLinksWithOptions(parsed.Title, MagicOptions{BareIdentifiers: true}); len(links) > 0 {
				if err := s.linkbackMagic(ctx, p, parsed.Title, from); err != nil {
					return SlackSlashResult{}, err
				}
				return SlackSlashResult{Text: "Linked from Slack."}, nil
			}
		}
		issue, err := s.createIssueFromSlack(ctx, p, conn.DefaultTeamID, parsed.Title, from)
		if err != nil {
			return SlackSlashResult{}, err
		}
		_ = s.linkbackMagic(ctx, p, parsed.Title, from)
		return SlackSlashResult{Text: slackIssueLine(issue, publicURL) + " created."}, nil
	case slackin.KindComment:
		issue, err := s.lookupIssueByIdentifier(ctx, workspaceID, parsed.Identifier)
		if err != nil {
			return SlackSlashResult{}, err
		}
		if issue == nil {
			return SlackSlashResult{Text: "No issue " + parsed.Identifier + " in this workspace."}, nil
		}
		if _, _, err := s.CreateComment(ctx, p, CreateCommentInput{
			IssueID: issue.ID,
			Body:    slackLinkbackBody(from, parsed.Body),
		}); err != nil {
			return SlackSlashResult{}, err
		}
		return SlackSlashResult{Text: "Commented on " + slackIssueLine(issue, publicURL) + "."}, nil
	case slackin.KindShow:
		issue, err := s.lookupIssueByIdentifier(ctx, workspaceID, parsed.Identifier)
		if err != nil {
			return SlackSlashResult{}, err
		}
		if issue == nil {
			return SlackSlashResult{Text: "No issue " + parsed.Identifier + " in this workspace."}, nil
		}
		return SlackSlashResult{Text: slackIssueLine(issue, publicURL) + " — " + issue.Title}, nil
	}
	return SlackSlashResult{Text: slackHelpText()}, nil
}

func (s *Service) HandleSlackMessage(
	ctx context.Context, workspaceID uuid.UUID, event slackin.Event,
) error {
	if event.FromBot() || strings.TrimSpace(event.Text) == "" {
		return nil
	}
	p, conn, err := s.principalForSlackWorkspace(ctx, workspaceID)
	if err != nil {
		return err
	}
	if p == nil || !conn.Enabled {
		return nil
	}
	from := slackFrom(event.User, event.Channel)
	if conn.AsksEnabled {
		if title, body, ok := slackin.TicketAsk(event.Text); ok {
			_, err := s.createAskFromSlack(ctx, workspaceID, conn.DefaultTeamID, title, from, body)
			return err
		}
	}
	return s.linkbackMagic(ctx, p, event.Text, from)
}

func (s *Service) SlackUnfurls(
	ctx context.Context, workspaceID uuid.UUID, urls []string, publicURL string,
) (map[string]slackin.UnfurlCard, error) {
	p, conn, err := s.principalForSlackWorkspace(ctx, workspaceID)
	if err != nil {
		return nil, err
	}
	if p == nil || !conn.Enabled {
		return map[string]slackin.UnfurlCard{}, nil
	}
	cards := map[string]slackin.UnfurlCard{}
	for _, raw := range urls {
		id := issueIDFromURL(raw)
		if id == "" {
			continue
		}
		issue, err := s.lookupIssueByIdentifier(ctx, workspaceID, id)
		if err != nil {
			return nil, err
		}
		if issue == nil {
			continue
		}
		link := issueURL(publicURL, issue.Identifier)
		cards[raw] = slackin.UnfurlCard{
			Color:     "#5e6ad2",
			Title:     issue.Identifier + " " + issue.Title,
			TitleLink: link,
			Text:      clipSlackText(issue.Description, 280),
		}
	}
	return cards, nil
}

func (s *Service) linkbackMagic(ctx context.Context, p *authz.Principal, text, from string) error {
	links := ParseMagicLinksWithOptions(text, MagicOptions{BareIdentifiers: true})
	seen := map[string]bool{}
	for _, link := range links {
		if link.Identifier == "" || seen[link.Identifier] {
			continue
		}
		seen[link.Identifier] = true
		issue, err := s.lookupIssueByIdentifier(ctx, p.WorkspaceID, link.Identifier)
		if err != nil {
			return err
		}
		if issue == nil {
			continue
		}
		if _, _, err := s.CreateComment(ctx, p, CreateCommentInput{
			IssueID: issue.ID,
			Body:    slackLinkbackBody(from, strings.TrimSpace(text)),
		}); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) handleAsksSlash(
	ctx context.Context, workspaceID uuid.UUID, conn model.SlackConnection, title, from, publicURL string,
) (SlackSlashResult, error) {
	if !conn.AsksEnabled {
		return SlackSlashResult{Text: "Asks Slack is off. An admin can turn it on in Settings → Asks."}, nil
	}
	title = strings.TrimSpace(title)
	if title == "" {
		return SlackSlashResult{Text: "Usage: `/asks Title` — files a triage issue. A message starting with 🎫 does the same."}, nil
	}
	issue, err := s.createAskFromSlack(ctx, workspaceID, conn.DefaultTeamID, title, from, "")
	if err != nil {
		return SlackSlashResult{}, err
	}
	return SlackSlashResult{Text: slackIssueLine(issue, publicURL) + " filed as an Ask."}, nil
}

func (s *Service) createAskFromSlack(
	ctx context.Context, workspaceID, teamID uuid.UUID, title, from, body string,
) (*model.Issue, error) {
	title = clipSlackAskTitle(title)
	var b strings.Builder
	if from != "" {
		fmt.Fprintf(&b, "Submitted by %s via Slack Asks.\n", from)
	} else {
		b.WriteString("Submitted via Slack Asks.\n")
	}
	extra := strings.TrimSpace(body)
	if extra != "" {
		b.WriteString("\n")
		b.WriteString(extra)
	}
	p := askIntakePrincipal(workspaceID, teamID)
	issue, _, err := s.CreateIssue(ctx, p, CreateIssueInput{
		TeamID:              teamID,
		Title:               title,
		Description:         b.String(),
		SkipDefaultTemplate: true,
	})
	if err != nil {
		return nil, err
	}
	return &issue, nil
}

func clipSlackAskTitle(title string) string {
	title = strings.TrimSpace(title)
	if title == "" {
		return "Ask from Slack"
	}
	runes := []rune(title)
	if len(runes) > maxTitleLength {
		return string(runes[:maxTitleLength])
	}
	return title
}

func (s *Service) createIssueFromSlack(
	ctx context.Context, p *authz.Principal, teamID uuid.UUID, title, from string,
) (*model.Issue, error) {
	title = strings.TrimSpace(title)
	if title == "" {
		title = "Issue from Slack"
	}
	desc := "Created from Slack"
	if from != "" {
		desc = "Created from Slack (" + from + ")."
	}
	issue, _, err := s.CreateIssue(ctx, p, CreateIssueInput{
		TeamID:              teamID,
		Title:               title,
		Description:         desc,
		SkipDefaultTemplate: true,
	})
	if err != nil {
		return nil, err
	}
	return &issue, nil
}

func (s *Service) principalForSlackWorkspace(
	ctx context.Context, workspaceID uuid.UUID,
) (*authz.Principal, model.SlackConnection, error) {
	row, err := s.db.Queries().GetSlackConnection(ctx, workspaceID)
	if err != nil {
		if store.IsNotFound(err) {
			return nil, model.SlackConnection{}, nil
		}
		return nil, model.SlackConnection{}, platform.Internal(err)
	}
	conn := slackConnectionFromGet(row)
	team, err := s.db.Queries().GetTeam(ctx, conn.DefaultTeamID)
	if err != nil {
		if store.IsNotFound(err) {
			return nil, conn, nil
		}
		return nil, model.SlackConnection{}, platform.Internal(err)
	}
	if team.Private || team.DeletedAt != nil || team.ArchivedAt != nil || team.RetiredAt != nil {
		return nil, conn, platform.Validation("defaultTeamId", "Slack can only create issues in a public team")
	}
	creator, err := s.db.Queries().GetUser(ctx, conn.CreatorID)
	if err != nil {
		return nil, model.SlackConnection{}, platform.Internal(err)
	}
	if creator.AccountID == nil {
		return nil, model.SlackConnection{}, platform.Internal(fmt.Errorf("slack connection creator has no account"))
	}
	p, err := s.ResolvePrincipal(ctx, *creator.AccountID, workspaceID)
	if err != nil {
		return nil, model.SlackConnection{}, err
	}
	return p, conn, nil
}

func (s *Service) requirePublicSlackTeam(
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
		return platform.Validation("defaultTeamId", "Slack can only create issues in a public team")
	}
	if !authz.Visible(p, authz.TeamScope(team.ID, team.Private)) {
		return platform.NotFound("team")
	}
	return nil
}

func normaliseSlackChannelName(raw *string, allowEmpty bool) (*string, error) {
	if raw == nil {
		return nil, nil
	}
	s := strings.TrimSpace(*raw)
	s = strings.TrimPrefix(s, "#")
	if s == "" {
		if allowEmpty {
			return nil, nil
		}
		return nil, nil
	}
	if len(s) > maxSlackChannelName {
		return nil, platform.Validation("channelName", "that channel name is too long")
	}
	return &s, nil
}

func normaliseSlackWebhookURL(raw *string, allowEmpty bool) (*string, error) {
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
	if err := webhookout.ValidateHTTPSURL(s); err != nil {
		return nil, platform.Validation("webhookUrl", err.Error())
	}
	return &s, nil
}

func slackFrom(user, channel string) string {
	var parts []string
	if user != "" {
		parts = append(parts, "@"+strings.TrimPrefix(user, "@"))
	}
	if channel != "" {
		parts = append(parts, "#"+strings.TrimPrefix(channel, "#"))
	}
	return strings.Join(parts, ", ")
}

func slackLinkbackBody(from, text string) string {
	text = strings.TrimSpace(text)
	if from == "" {
		return "Mentioned in Slack.\n\n" + text
	}
	return "Mentioned in Slack (" + from + ").\n\n" + text
}

func slackHelpText() string {
	return "Polaris: `/polaris create Title`, `/polaris ask Title`, `/polaris ENG-123`, `/polaris comment ENG-123 text`, or paste an issue id. `/asks Title` files a triage Ask. Magic words (`fixes ENG-123`) post a linkback."
}

func slackIssueLine(issue *model.Issue, publicURL string) string {
	if issue == nil {
		return ""
	}
	u := issueURL(publicURL, issue.Identifier)
	if u == "" {
		return issue.Identifier
	}
	return "<" + u + "|" + issue.Identifier + ">"
}

func issueURL(base, identifier string) string {
	base = strings.TrimRight(strings.TrimSpace(base), "/")
	if base == "" || identifier == "" {
		return ""
	}
	return base + "/issue/" + identifier
}

func issueIDFromURL(raw string) string {
	m := issueURLPattern.FindStringSubmatch(raw)
	if len(m) < 2 {
		return ""
	}
	return strings.ToUpper(m[1])
}

func clipSlackText(s string, n int) string {
	s = strings.TrimSpace(s)
	if s == "" || n <= 0 {
		return ""
	}
	runes := []rune(s)
	if len(runes) <= n {
		return s
	}
	return string(runes[:n-1]) + "…"
}

func slackConnectionFromCreate(r store.CreateSlackConnectionRow) model.SlackConnection {
	return model.SlackConnection{
		ID: r.ID, WorkspaceID: r.WorkspaceID, CreatorID: r.CreatorID, Enabled: r.Enabled,
		DefaultTeamID: r.DefaultTeamID, ChannelName: r.ChannelName,
		NotifyIssues: r.NotifyIssues, NotifyComments: r.NotifyComments, AsksEnabled: r.AsksEnabled,
		ConnectedAt: r.ConnectedAt, CreatedAt: r.CreatedAt, UpdatedAt: r.UpdatedAt,
	}
}

func slackConnectionFromGet(r store.GetSlackConnectionRow) model.SlackConnection {
	return model.SlackConnection{
		ID: r.ID, WorkspaceID: r.WorkspaceID, CreatorID: r.CreatorID, Enabled: r.Enabled,
		DefaultTeamID: r.DefaultTeamID, ChannelName: r.ChannelName,
		NotifyIssues: r.NotifyIssues, NotifyComments: r.NotifyComments, AsksEnabled: r.AsksEnabled,
		ConnectedAt: r.ConnectedAt, CreatedAt: r.CreatedAt, UpdatedAt: r.UpdatedAt,
	}
}

func slackConnectionFromStream(r store.StreamSlackConnectionsForBootstrapRow) model.SlackConnection {
	return model.SlackConnection{
		ID: r.ID, WorkspaceID: r.WorkspaceID, CreatorID: r.CreatorID, Enabled: r.Enabled,
		DefaultTeamID: r.DefaultTeamID, ChannelName: r.ChannelName,
		NotifyIssues: r.NotifyIssues, NotifyComments: r.NotifyComments, AsksEnabled: r.AsksEnabled,
		ConnectedAt: r.ConnectedAt, CreatedAt: r.CreatedAt, UpdatedAt: r.UpdatedAt,
	}
}
