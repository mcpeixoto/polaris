package domain

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/store"
	"github.com/peixotolabs/polaris/services/internal/webhookout"
)

// Outbound webhooks.
//
// Every delivery derives from a change_log row, the same source the inbox uses, so an
// integration never hears about a mutation the activity feed says never happened. The
// signing secret is stored (unlike API keys) because we have to HMAC the body; it is
// returned to the caller once and is never selected by a listing query.

const (
	webhookSecretPrefix = "whsec_"
	webhookSecretBytes  = 32

	webhookFanOutPageSize = 200
	webhookDeliveryPage   = 50
	maxWebhookAttempts    = 4
	webhookDeliveryRetain = 14 * 24 * time.Hour
)

// webhookRetrySchedule is the documented backoff after the first failed POST: 1 minute,
// 1 hour, 6 hours. A fourth failure disables the webhook.
var webhookRetrySchedule = []time.Duration{time.Minute, time.Hour, 6 * time.Hour}

// The GraphQL / settings names, mapped from change_log.entity_type.
var webhookChangeTypes = map[string]string{
	"issue":       "Issue",
	"comment":     "Comment",
	"issueLabel":  "IssueLabel",
	"attachment":  "Attachment",
	"project":     "Project",
	"cycle":       "Cycle",
}

var webhookAllowedTypes = map[string]bool{
	"Issue": true, "Comment": true, "IssueLabel": true,
	"Attachment": true, "Project": true, "Cycle": true,
}

type CreateWebhookInput struct {
	URL            string
	TeamID         *uuid.UUID
	AllPublicTeams bool
	ResourceTypes  []string
	Enabled        *bool
}

type UpdateWebhookInput struct {
	ID      uuid.UUID
	Enabled bool
}

type webhookEnvelope struct {
	Action           string          `json:"action"`
	Type             string          `json:"type"`
	Actor            *webhookActor   `json:"actor"`
	CreatedAt        time.Time       `json:"createdAt"`
	Data             json.RawMessage `json:"data,omitempty"`
	URL              string          `json:"url,omitempty"`
	OrganizationID   uuid.UUID       `json:"organizationId"`
	WebhookID        uuid.UUID       `json:"webhookId"`
	WebhookTimestamp int64           `json:"webhookTimestamp"`
}

type webhookActor struct {
	ID   uuid.UUID `json:"id"`
	Type string    `json:"type"`
}

func (s *Service) CreateWebhook(
	ctx context.Context, p *authz.Principal, in CreateWebhookInput,
) (model.Webhook, string, int64, error) {
	if !authz.Can(p, authz.ActionWebhookManage) {
		return model.Webhook{}, "", 0, platform.Forbidden("only admins can create webhooks")
	}
	if err := webhookout.ValidateHTTPSURL(in.URL); err != nil {
		return model.Webhook{}, "", 0, platform.Validation("url", err.Error())
	}
	if in.AllPublicTeams == (in.TeamID != nil) {
		return model.Webhook{}, "", 0, platform.Validation("teamId",
			"a webhook covers all public teams, or one team, not both and not neither")
	}
	types, err := normaliseWebhookTypes(in.ResourceTypes)
	if err != nil {
		return model.Webhook{}, "", 0, err
	}
	secret, err := newWebhookSecret()
	if err != nil {
		return model.Webhook{}, "", 0, err
	}
	enabled := true
	if in.Enabled != nil {
		enabled = *in.Enabled
	}

	var out model.Webhook
	var version int64
	err = s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		if in.TeamID != nil {
			team, err := q.GetTeam(ctx, *in.TeamID)
			if err != nil {
				if store.IsNotFound(err) {
					return platform.NotFound("team")
				}
				return platform.Internal(err)
			}
			if team.WorkspaceID != p.WorkspaceID {
				return platform.NotFound("team")
			}
		}
		id, err := uuid.NewV7()
		if err != nil {
			return platform.Internal(err)
		}
		row, err := q.CreateWebhook(ctx, store.CreateWebhookParams{
			ID:             id,
			WorkspaceID:    p.WorkspaceID,
			CreatorID:      p.UserID,
			Url:            strings.TrimSpace(in.URL),
			Secret:         secret,
			Enabled:        enabled,
			AllPublicTeams: in.AllPublicTeams,
			TeamID:         in.TeamID,
			ResourceTypes:  types,
		})
		if err != nil {
			if store.IsCheckViolation(err) {
				return platform.Validation("url", "that webhook cannot be stored")
			}
			return platform.Internal(err)
		}
		out = webhookFromCreate(row)

		// Do not replay history into a URL that has just appeared. The cursor is the
		// workspace's current version, so the first fan-out pass starts from here.
		current, err := q.GetWorkspaceVersion(ctx, p.WorkspaceID)
		if err != nil {
			return platform.Internal(err)
		}
		if err := q.EnsureWebhookCursorAtLeast(ctx, store.EnsureWebhookCursorAtLeastParams{
			WorkspaceID: p.WorkspaceID,
			Version:     current,
		}); err != nil {
			return platform.Internal(err)
		}
		version, err = syncWatermark(ctx, q, p.WorkspaceID)
		return err
	})
	if err != nil {
		return model.Webhook{}, "", 0, err
	}
	return out, secret, version, nil
}

func (s *Service) UpdateWebhook(
	ctx context.Context, p *authz.Principal, in UpdateWebhookInput,
) (model.Webhook, int64, error) {
	if !authz.Can(p, authz.ActionWebhookManage) {
		return model.Webhook{}, 0, platform.Forbidden("only admins can update webhooks")
	}
	var out model.Webhook
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		row, err := q.UpdateWebhookEnabled(ctx, store.UpdateWebhookEnabledParams{
			Enabled:     in.Enabled,
			ID:          in.ID,
			WorkspaceID: p.WorkspaceID,
		})
		if err != nil {
			if store.IsNotFound(err) {
				return platform.NotFound("webhook")
			}
			return platform.Internal(err)
		}
		out = webhookFromUpdate(row)
		version, err = syncWatermark(ctx, q, p.WorkspaceID)
		return err
	})
	return out, version, err
}

func (s *Service) DeleteWebhook(ctx context.Context, p *authz.Principal, id uuid.UUID) (uuid.UUID, int64, error) {
	if !authz.Can(p, authz.ActionWebhookManage) {
		return uuid.Nil, 0, platform.Forbidden("only admins can delete webhooks")
	}
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		deleted, err := q.DeleteWebhook(ctx, store.DeleteWebhookParams{ID: id, WorkspaceID: p.WorkspaceID})
		if err != nil {
			if store.IsNotFound(err) {
				return platform.NotFound("webhook")
			}
			return platform.Internal(err)
		}
		version, err = syncWatermark(ctx, q, p.WorkspaceID)
		if err != nil {
			return err
		}
		id = deleted
		return nil
	})
	return id, version, err
}

func (s *Service) ListWebhooks(ctx context.Context, p *authz.Principal) ([]model.Webhook, error) {
	if !authz.Can(p, authz.ActionWebhookManage) {
		return nil, platform.Forbidden("only admins can list webhooks")
	}
	rows, err := s.db.Queries().ListWebhooks(ctx, p.WorkspaceID)
	if err != nil {
		return nil, platform.Internal(err)
	}
	out := make([]model.Webhook, 0, len(rows))
	for _, r := range rows {
		out = append(out, webhookFromList(r))
	}
	return out, nil
}

func (s *Service) ListWebhookDeliveries(
	ctx context.Context, p *authz.Principal, webhookID uuid.UUID, first int,
) ([]model.WebhookDelivery, error) {
	if !authz.Can(p, authz.ActionWebhookManage) {
		return nil, platform.Forbidden("only admins can read webhook deliveries")
	}
	if first <= 0 || first > 100 {
		first = 50
	}
	rows, err := s.db.Queries().ListWebhookDeliveries(ctx, store.ListWebhookDeliveriesParams{
		WebhookID:   webhookID,
		WorkspaceID: p.WorkspaceID,
		PageSize:    int32(first),
	})
	if err != nil {
		return nil, platform.Internal(err)
	}
	out := make([]model.WebhookDelivery, 0, len(rows))
	for _, r := range rows {
		out = append(out, toWebhookDelivery(r))
	}
	return out, nil
}

// FanOutWebhooks writes a delivery row for every change the workspace has accumulated
// since its webhook cursor, matching enabled subscriptions. HTTP happens later, in
// DeliverDueWebhooks: holding the version lock while waiting on a stranger's server is
// how one slow consumer stops the inbox.
func (s *Service) FanOutWebhooks(ctx context.Context, workspaceID uuid.UUID, baseURL string) (int, error) {
	var queued int
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		cursor, err := q.GetWebhookCursor(ctx, workspaceID)
		if err != nil {
			return platform.Internal(fmt.Errorf("read webhook cursor: %w", err))
		}
		through, err := q.GetWorkspaceVersion(ctx, workspaceID)
		if err != nil {
			return platform.Internal(fmt.Errorf("read workspace version: %w", err))
		}
		if through <= cursor {
			return nil
		}
		hooks, err := q.ListEnabledWebhooks(ctx, workspaceID)
		if err != nil {
			return platform.Internal(err)
		}
		if len(hooks) == 0 {
			return q.AdvanceWebhookCursor(ctx, store.AdvanceWebhookCursorParams{
				WorkspaceID: workspaceID, Version: through,
			})
		}

		rows, err := q.ReadChangesSince(ctx, store.ReadChangesSinceParams{
			WorkspaceID:    workspaceID,
			AfterVersion:   cursor,
			ThroughVersion: through,
			PageSize:       webhookFanOutPageSize,
		})
		if err != nil {
			return platform.Internal(fmt.Errorf("read changes: %w", err))
		}
		if len(rows) == 0 {
			return nil
		}

		teams := map[uuid.UUID]store.Team{}
		highest := cursor
		now := time.Now()
		for _, r := range rows {
			highest = r.Version
			eventType, ok := webhookChangeTypes[r.EntityType]
			if !ok || r.Op == string(OpRevoke) {
				continue
			}
			private := false
			if r.TeamID != nil {
				team, seen := teams[*r.TeamID]
				if !seen {
					team, err = q.GetTeam(ctx, *r.TeamID)
					if err != nil {
						if store.IsNotFound(err) {
							continue
						}
						return platform.Internal(err)
					}
					teams[*r.TeamID] = team
				}
				private = team.Private
			}
			for _, hook := range hooks {
				if !webhookMatches(hook, eventType, r.TeamID, private) {
					continue
				}
				body, err := marshalWebhookEnvelope(r, hook.ID, workspaceID, eventType, baseURL, now)
				if err != nil {
					return err
				}
				id, err := uuid.NewV7()
				if err != nil {
					return platform.Internal(err)
				}
				_, err = q.InsertWebhookDelivery(ctx, store.InsertWebhookDeliveryParams{
					ID:            id,
					WorkspaceID:   workspaceID,
					WebhookID:     hook.ID,
					ChangeVersion: r.Version,
					EntityType:    eventType,
					EntityID:      r.EntityID,
					Op:            r.Op,
					Payload:       body,
				})
				if err != nil {
					if store.IsNotFound(err) {
						continue
					}
					return platform.Internal(fmt.Errorf("insert webhook delivery: %w", err))
				}
				queued++
			}
		}
		return q.AdvanceWebhookCursor(ctx, store.AdvanceWebhookCursorParams{
			WorkspaceID: workspaceID, Version: highest,
		})
	})
	if err != nil {
		return 0, err
	}
	return queued, nil
}

func (s *Service) FanOutWebhooksAll(ctx context.Context, baseURL string) (int, error) {
	workspaces, err := s.db.Queries().ListWorkspacesWithPendingWebhooks(ctx)
	if err != nil {
		return 0, platform.Internal(err)
	}
	total := 0
	for _, workspaceID := range workspaces {
		n, err := s.FanOutWebhooks(ctx, workspaceID, baseURL)
		if err != nil {
			platform.Log(ctx).Error("webhook fan-out failed for a workspace",
				"workspace", workspaceID, "error", err)
			continue
		}
		total += n
	}
	return total, nil
}

// DeliverDueWebhooks POSTs every due row. Failures schedule the documented backoff;
// exhausting it disables the webhook.
func (s *Service) DeliverDueWebhooks(ctx context.Context, sender webhookout.Sender, now time.Time) (int, error) {
	if now.IsZero() {
		now = time.Now()
	}
	due, err := s.db.Queries().ListDueWebhookDeliveries(ctx, store.ListDueWebhookDeliveriesParams{
		Now:      now,
		PageSize: webhookDeliveryPage,
	})
	if err != nil {
		return 0, platform.Internal(err)
	}

	delivered := 0
	for _, row := range due {
		res := sender.Send(ctx, webhookout.Destination{
			URL:        row.Url,
			Secret:     row.Secret,
			Event:      row.EntityType,
			DeliveryID: row.ID,
			Timestamp:  now,
			Body:       row.Payload,
		})
		ok := res.Err == nil && res.Status >= 200 && res.Status < 300
		attempt := int(row.Attempt) + 1
		dur := int32(res.Duration.Milliseconds())
		status := int32(res.Status)
		var snippet *string
		if res.Snippet != "" {
			s := res.Snippet
			snippet = &s
		}

		if ok {
			if err := s.db.Queries().MarkWebhookDeliveryDelivered(ctx, store.MarkWebhookDeliveryDeliveredParams{
				Attempt:        int32(attempt),
				LastStatus:     &status,
				LastDurationMs: &dur,
				LastSnippet:    snippet,
				ID:             row.ID,
			}); err != nil {
				return delivered, platform.Internal(err)
			}
			if err := s.db.Queries().RecordWebhookSuccess(ctx, row.WebhookID); err != nil {
				return delivered, platform.Internal(err)
			}
			delivered++
			continue
		}

		var errText *string
		if res.Err != nil {
			m := res.Err.Error()
			errText = &m
		} else {
			m := fmt.Sprintf("HTTP %d", res.Status)
			errText = &m
		}
		var statusPtr *int32
		if res.Status != 0 {
			statusPtr = &status
		}

		next, retry := webhookNextAttempt(attempt, now)
		if !retry {
			if err := s.db.Queries().MarkWebhookDeliveryFailed(ctx, store.MarkWebhookDeliveryFailedParams{
				Attempt:        int32(attempt),
				NextAttemptAt:  now,
				LastStatus:     statusPtr,
				LastError:      errText,
				LastDurationMs: &dur,
				LastSnippet:    snippet,
				ID:             row.ID,
			}); err != nil {
				return delivered, platform.Internal(err)
			}
			if err := s.db.Queries().DisableWebhook(ctx, row.WebhookID); err != nil {
				return delivered, platform.Internal(err)
			}
			continue
		}
		if err := s.db.Queries().MarkWebhookDeliveryFailed(ctx, store.MarkWebhookDeliveryFailedParams{
			Attempt:        int32(attempt),
			NextAttemptAt:  next,
			LastStatus:     statusPtr,
			LastError:      errText,
			LastDurationMs: &dur,
			LastSnippet:    snippet,
			ID:             row.ID,
		}); err != nil {
			return delivered, platform.Internal(err)
		}
		if _, err := s.db.Queries().RecordWebhookFailure(ctx, row.WebhookID); err != nil {
			return delivered, platform.Internal(err)
		}
	}
	return delivered, nil
}

func (s *Service) PruneWebhookDeliveries(ctx context.Context) (int64, error) {
	n, err := s.db.Queries().PruneWebhookDeliveries(ctx, time.Now().Add(-webhookDeliveryRetain))
	if err != nil {
		return 0, platform.Internal(err)
	}
	return n, nil
}

func webhookMatches(hook store.ListEnabledWebhooksRow, eventType string, teamID *uuid.UUID, private bool) bool {
	want := false
	for _, t := range hook.ResourceTypes {
		if t == eventType {
			want = true
			break
		}
	}
	if !want {
		return false
	}
	if hook.AllPublicTeams {
		if private {
			return false
		}
		return true
	}
	if hook.TeamID == nil || teamID == nil {
		return false
	}
	return *hook.TeamID == *teamID
}

func marshalWebhookEnvelope(
	r store.ChangeLog, webhookID, workspaceID uuid.UUID, eventType, baseURL string, now time.Time,
) (json.RawMessage, error) {
	action := "update"
	switch r.Op {
	case string(OpDelete):
		action = "remove"
	case string(OpUpsert):
		if len(r.ChangedFields) == 0 {
			action = "create"
		}
	}
	var actor *webhookActor
	if r.ActorID != nil {
		actor = &webhookActor{ID: *r.ActorID, Type: r.ActorType}
	}
	env := webhookEnvelope{
		Action:           action,
		Type:             eventType,
		Actor:            actor,
		CreatedAt:        r.CreatedAt,
		Data:             json.RawMessage(r.Payload),
		URL:              entityURL(baseURL, eventType, r.Payload),
		OrganizationID:   workspaceID,
		WebhookID:        webhookID,
		WebhookTimestamp: now.UnixMilli(),
	}
	if len(r.Payload) == 0 {
		env.Data = nil
	}
	body, err := json.Marshal(env)
	if err != nil {
		return nil, platform.Internal(err)
	}
	return body, nil
}

func entityURL(base, eventType string, payload []byte) string {
	base = strings.TrimRight(base, "/")
	if base == "" {
		return ""
	}
	var ident struct {
		Identifier string `json:"identifier"`
		ID         string `json:"id"`
	}
	_ = json.Unmarshal(payload, &ident)
	switch eventType {
	case "Issue":
		if ident.Identifier != "" {
			return base + "/issue/" + ident.Identifier
		}
	case "Project":
		if ident.ID != "" {
			return base + "/project/" + ident.ID
		}
	case "Cycle":
		if ident.ID != "" {
			return base + "/cycle/" + ident.ID
		}
	}
	return ""
}

func webhookNextAttempt(attempt int, now time.Time) (time.Time, bool) {
	if attempt <= 0 || attempt > len(webhookRetrySchedule) {
		return time.Time{}, false
	}
	return now.Add(webhookRetrySchedule[attempt-1]), true
}

func normaliseWebhookTypes(in []string) ([]string, error) {
	if len(in) == 0 {
		return nil, platform.Validation("resourceTypes", "subscribe to at least one resource type")
	}
	seen := map[string]bool{}
	var out []string
	for _, raw := range in {
		t := strings.TrimSpace(raw)
		if !webhookAllowedTypes[t] {
			return nil, platform.Validation("resourceTypes", "unknown resource type "+t)
		}
		if seen[t] {
			continue
		}
		seen[t] = true
		out = append(out, t)
	}
	return out, nil
}

func newWebhookSecret() (string, error) {
	buf := make([]byte, webhookSecretBytes)
	if _, err := rand.Read(buf); err != nil {
		return "", platform.Internal(err)
	}
	return webhookSecretPrefix + base64.RawURLEncoding.EncodeToString(buf), nil
}

func webhookFromCreate(r store.CreateWebhookRow) model.Webhook {
	return model.Webhook{
		ID: r.ID, WorkspaceID: r.WorkspaceID, CreatorID: r.CreatorID, URL: r.Url,
		Enabled: r.Enabled, AllPublicTeams: r.AllPublicTeams, TeamID: r.TeamID,
		ResourceTypes: r.ResourceTypes, ConsecutiveFailures: int(r.ConsecutiveFailures),
		DisabledAt: r.DisabledAt, CreatedAt: r.CreatedAt, UpdatedAt: r.UpdatedAt,
	}
}

func webhookFromList(r store.ListWebhooksRow) model.Webhook {
	return model.Webhook{
		ID: r.ID, WorkspaceID: r.WorkspaceID, CreatorID: r.CreatorID, URL: r.Url,
		Enabled: r.Enabled, AllPublicTeams: r.AllPublicTeams, TeamID: r.TeamID,
		ResourceTypes: r.ResourceTypes, ConsecutiveFailures: int(r.ConsecutiveFailures),
		DisabledAt: r.DisabledAt, CreatedAt: r.CreatedAt, UpdatedAt: r.UpdatedAt,
	}
}

func webhookFromUpdate(r store.UpdateWebhookEnabledRow) model.Webhook {
	return model.Webhook{
		ID: r.ID, WorkspaceID: r.WorkspaceID, CreatorID: r.CreatorID, URL: r.Url,
		Enabled: r.Enabled, AllPublicTeams: r.AllPublicTeams, TeamID: r.TeamID,
		ResourceTypes: r.ResourceTypes, ConsecutiveFailures: int(r.ConsecutiveFailures),
		DisabledAt: r.DisabledAt, CreatedAt: r.CreatedAt, UpdatedAt: r.UpdatedAt,
	}
}

func toWebhookDelivery(r store.WebhookDelivery) model.WebhookDelivery {
	var status *int
	if r.LastStatus != nil {
		v := int(*r.LastStatus)
		status = &v
	}
	var dur *int
	if r.LastDurationMs != nil {
		v := int(*r.LastDurationMs)
		dur = &v
	}
	return model.WebhookDelivery{
		ID: r.ID, WebhookID: r.WebhookID, ChangeVersion: r.ChangeVersion,
		EntityType: r.EntityType, Attempt: int(r.Attempt), LastStatus: status,
		LastError: r.LastError, LastDurationMs: dur, DeliveredAt: r.DeliveredAt,
		CreatedAt: r.CreatedAt,
	}
}
