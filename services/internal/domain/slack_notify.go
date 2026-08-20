package domain

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/store"
	"github.com/peixotolabs/polaris/services/internal/webhookout"
)

const slackNotifyFanOutPage = 200

// FanOutSlack posts issue and comment events to each workspace's Slack incoming webhook.
//
// Same change_log source as outbound webhooks. Failures are logged and the cursor still
// advances: a Slack outage must not stall the worker on the same rows forever, and the
// next event still notifies.
func (s *Service) FanOutSlack(ctx context.Context, workspaceID uuid.UUID, baseURL string, sender webhookout.Sender) (int, error) {
	row, err := s.db.Queries().GetSlackConnectionForNotify(ctx, workspaceID)
	if err != nil {
		if store.IsNotFound(err) {
			return 0, nil
		}
		return 0, platform.Internal(err)
	}
	if !row.Enabled || row.WebhookUrl == nil || strings.TrimSpace(*row.WebhookUrl) == "" {
		return 0, nil
	}

	through, err := s.db.Queries().GetWorkspaceVersion(ctx, workspaceID)
	if err != nil {
		return 0, platform.Internal(fmt.Errorf("read workspace version: %w", err))
	}
	if through <= row.NotifyCursor {
		return 0, nil
	}

	changes, err := s.db.Queries().ReadChangesSince(ctx, store.ReadChangesSinceParams{
		WorkspaceID:    workspaceID,
		AfterVersion:   row.NotifyCursor,
		ThroughVersion: through,
		PageSize:       slackNotifyFanOutPage,
	})
	if err != nil {
		return 0, platform.Internal(fmt.Errorf("read changes: %w", err))
	}

	posted := 0
	highest := row.NotifyCursor
	now := time.Now()
	for _, ch := range changes {
		highest = ch.Version
		if ch.Op == string(OpRevoke) {
			continue
		}
		text := ""
		switch ch.EntityType {
		case "issue":
			if !row.NotifyIssues {
				continue
			}
			text = slackIssueNotifyText(ch, baseURL)
		case "comment":
			if !row.NotifyComments {
				continue
			}
			text = s.slackCommentNotifyText(ctx, workspaceID, ch, baseURL)
		default:
			continue
		}
		if text == "" {
			continue
		}
		body, err := json.Marshal(map[string]string{"text": text})
		if err != nil {
			return posted, platform.Internal(err)
		}
		id, err := uuid.NewV7()
		if err != nil {
			return posted, platform.Internal(err)
		}
		res := sender.Send(ctx, webhookout.Destination{
			URL:        *row.WebhookUrl,
			Event:      "slack." + ch.EntityType,
			DeliveryID: id,
			Timestamp:  now,
			Body:       body,
		})
		if res.Err != nil || res.Status < 200 || res.Status >= 300 {
			platform.Log(ctx).Warn("slack notify failed",
				"workspace", workspaceID, "version", ch.Version, "status", res.Status, "error", res.Err)
			continue
		}
		posted++
	}
	if err := s.db.Queries().AdvanceSlackNotifyCursor(ctx, store.AdvanceSlackNotifyCursorParams{
		NotifyCursor: highest,
		WorkspaceID:  workspaceID,
	}); err != nil {
		return posted, platform.Internal(err)
	}
	return posted, nil
}

func (s *Service) FanOutSlackAll(ctx context.Context, baseURL string, sender webhookout.Sender) (int, error) {
	workspaces, err := s.db.Queries().ListWorkspacesWithPendingSlack(ctx)
	if err != nil {
		return 0, platform.Internal(err)
	}
	total := 0
	for _, workspaceID := range workspaces {
		n, err := s.FanOutSlack(ctx, workspaceID, baseURL, sender)
		if err != nil {
			platform.Log(ctx).Error("slack fan-out failed for a workspace",
				"workspace", workspaceID, "error", err)
			continue
		}
		total += n
	}
	return total, nil
}

func slackIssueNotifyText(ch store.ChangeLog, baseURL string) string {
	var payload struct {
		Identifier string `json:"identifier"`
		Title      string `json:"title"`
	}
	_ = json.Unmarshal(ch.Payload, &payload)
	if payload.Identifier == "" {
		return ""
	}
	action := "updated"
	if ch.Op == string(OpUpsert) && len(ch.ChangedFields) == 0 {
		action = "created"
	}
	if ch.Op == string(OpDelete) {
		action = "deleted"
	}
	line := "*" + payload.Identifier + "*"
	if payload.Title != "" {
		line += " " + payload.Title
	}
	line += " " + action
	if u := issueURL(baseURL, payload.Identifier); u != "" {
		line += " — " + u
	}
	return line
}

func (s *Service) slackCommentNotifyText(ctx context.Context, workspaceID uuid.UUID, ch store.ChangeLog, baseURL string) string {
	var payload struct {
		IssueID uuid.UUID `json:"issueId"`
		Body    string    `json:"body"`
	}
	_ = json.Unmarshal(ch.Payload, &payload)
	if payload.IssueID == uuid.Nil {
		return ""
	}
	if slackIsLinkback(payload.Body) {
		return ""
	}
	issue, err := s.db.Queries().GetIssue(ctx, payload.IssueID)
	if err != nil {
		return ""
	}
	team, err := s.db.Queries().GetTeam(ctx, issue.TeamID)
	if err != nil {
		return ""
	}
	ident := model.Identifier(team.Key, issue.Number)
	snippet := clipSlackText(payload.Body, 160)
	line := "Comment on *" + ident + "*"
	if snippet != "" {
		line += ": " + snippet
	}
	if u := issueURL(baseURL, ident); u != "" {
		line += " — " + u
	}
	return line
}

func slackIsLinkback(body string) bool {
	b := strings.TrimSpace(body)
	return strings.HasPrefix(b, "Mentioned in Slack") || strings.HasPrefix(b, "Created from Slack")
}
