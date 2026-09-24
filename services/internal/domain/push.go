package domain

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/push"
	"github.com/peixotolabs/polaris/services/internal/store"
)

// Mobile push delivery of what the inbox already holds.
//
// Same architectural split as email (digest.go): internal/notify decides who is told what,
// this file decides who is told by APNs and when. Nothing here re-derives an event — the
// notifications are already written, coalesced and filtered by mute preferences. Device
// registration is the channel opt-in; muted types already kept the row out of the inbox.

const (
	pushRecipientPageSize = 500
	pushItemsPerPass      = 40
	// Above this many claimed rows for one person, collapse into one banner — the same
	// rule the desktop announcer uses, so a reconnect after a day offline does not dump
	// fifty alerts onto a locked phone.
	pushBurstLimit = 5
)

// RegisterPushDeviceInput is what the iOS client sends after APNs hands it a token.
type RegisterPushDeviceInput struct {
	Token       string
	Platform    string // "ios"
	AppBundle   string
	Environment string // "production" | "sandbox"
}

// RegisterPushDevice upserts the caller's device token.
//
// The token is unique install-wide: a reinstall or a workspace switch moves the row rather
// than leaving two owners both receiving the same pushes. Not on the change stream — a
// push credential belongs on this server and nowhere else.
func (s *Service) RegisterPushDevice(
	ctx context.Context, p *authz.Principal, in RegisterPushDeviceInput,
) (uuid.UUID, int64, error) {
	token := strings.TrimSpace(in.Token)
	if token == "" || len(token) > 512 {
		return uuid.Nil, 0, platform.Validation("token", "a push device token is required")
	}
	platformName := strings.TrimSpace(in.Platform)
	if platformName == "" {
		platformName = "ios"
	}
	if platformName != "ios" {
		return uuid.Nil, 0, platform.Validation("platform", "only ios push is supported")
	}
	bundle := strings.TrimSpace(in.AppBundle)
	if bundle == "" {
		bundle = "com.peixotolabs.polaris"
	}
	env := strings.TrimSpace(in.Environment)
	if env == "" {
		env = "production"
	}
	if env != "production" && env != "sandbox" {
		return uuid.Nil, 0, platform.Validation("environment", "environment must be production or sandbox")
	}

	id, err := uuid.NewV7()
	if err != nil {
		return uuid.Nil, 0, platform.Internal(err)
	}

	var version int64
	err = s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		_, err := q.UpsertPushDevice(ctx, store.UpsertPushDeviceParams{
			ID:          id,
			UserID:      p.UserID,
			WorkspaceID: p.WorkspaceID,
			Token:       token,
			Platform:    platformName,
			AppBundle:   bundle,
			Environment: env,
		})
		if err != nil {
			return platform.Internal(err)
		}
		version, err = syncWatermark(ctx, q, p.WorkspaceID)
		return err
	})
	if err != nil {
		return uuid.Nil, 0, err
	}
	return id, version, nil
}

// UnregisterPushDevice drops the caller's token. Idempotent: a token that is not theirs
// (or is already gone) is not-found only when it exists for somebody else — a missing
// token is success, so a sign-out that races a reinstall cannot fail the sign-out.
func (s *Service) UnregisterPushDevice(
	ctx context.Context, p *authz.Principal, token string,
) (uuid.UUID, int64, error) {
	token = strings.TrimSpace(token)
	if token == "" {
		return uuid.Nil, 0, platform.Validation("token", "a push device token is required")
	}
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		n, err := q.DeletePushDeviceByToken(ctx, store.DeletePushDeviceByTokenParams{
			Token:  token,
			UserID: p.UserID,
		})
		if err != nil {
			return platform.Internal(err)
		}
		_ = n
		version, err = syncWatermark(ctx, q, p.WorkspaceID)
		return err
	})
	if err != nil {
		return uuid.Nil, 0, err
	}
	// Return a stable id-shaped value for DeletePayload; the token itself is not a UUID.
	return p.UserID, version, nil
}

// DeliverPushNotifications sends APNs alerts for every person with both a registered
// device and unread, unpushed inbox rows. Returns how many alerts were accepted by APNs.
//
// Claim, send, keep-or-release — the same order as email, for the same reasons. A sender
// that is a no-op (APNs not configured) still claims nothing useful work-wise: the worker
// skips the job entirely when push.Config.Enabled is false, so this path assumes a live
// sender. One failed recipient does not stop the others.
func (s *Service) DeliverPushNotifications(ctx context.Context, sender push.Sender) (int, error) {
	if sender == nil {
		return 0, nil
	}
	recipients, err := s.db.Queries().ListPushRecipients(ctx, pushRecipientPageSize)
	if err != nil {
		return 0, platform.Internal(fmt.Errorf("list push recipients: %w", err))
	}

	sent := 0
	var firstErr error
	for _, r := range recipients {
		n, err := s.deliverPushTo(ctx, sender, r.UserID)
		sent += n
		if err != nil && firstErr == nil {
			firstErr = err
		}
	}
	return sent, firstErr
}

func (s *Service) deliverPushTo(ctx context.Context, sender push.Sender, userID uuid.UUID) (int, error) {
	claimed, err := s.db.Queries().ClaimNotificationsForPush(ctx, store.ClaimNotificationsForPushParams{
		UserID:   userID,
		PageSize: pushItemsPerPass,
	})
	if err != nil {
		return 0, platform.Internal(fmt.Errorf("claim push: %w", err))
	}
	if len(claimed) == 0 {
		return 0, nil
	}
	claimedAt := claimed[0].PushedAt
	if claimedAt == nil {
		return 0, platform.Internal(fmt.Errorf("claim push: missing pushed_at"))
	}

	devices, err := s.db.Queries().ListPushDevicesForUser(ctx, userID)
	if err != nil {
		return 0, platform.Internal(err)
	}
	if len(devices) == 0 {
		ids := make([]uuid.UUID, len(claimed))
		for i, row := range claimed {
			ids[i] = row.ID
		}
		_, _ = s.db.Queries().ReleasePushClaim(ctx, store.ReleasePushClaimParams{
			Ids: ids, ClaimedAt: claimedAt,
		})
		return 0, nil
	}

	alerts := pushAlertsFor(claimed)
	unread, err := s.db.Queries().CountUnreadNotifications(ctx, userID)
	if err != nil {
		unread = int64(len(claimed))
	}
	badge := int(unread)

	deliveredAny := false
	var sendErr error
	for _, alert := range alerts {
		for _, d := range devices {
			res := sender.Send(ctx, push.Notification{
				Token:       d.Token,
				Environment: push.Environment(d.Environment),
				Topic:       d.AppBundle,
				Title:       alert.Title,
				Body:        alert.Body,
				Badge:       &badge,
				CollapseID:  alert.CollapseID,
				ThreadID:    alert.ThreadID,
				Data:        alert.Data,
			})
			if res.Unregistered() {
				_, _ = s.db.Queries().DeletePushDeviceByID(ctx, d.ID)
				continue
			}
			if res.Err != nil || res.Status < 200 || res.Status >= 300 {
				if sendErr == nil {
					if res.Err != nil {
						sendErr = res.Err
					} else {
						sendErr = fmt.Errorf("apns status %d (%s)", res.Status, res.Reason)
					}
				}
				continue
			}
			deliveredAny = true
		}
	}

	if !deliveredAny {
		ids := make([]uuid.UUID, len(claimed))
		for i, row := range claimed {
			ids[i] = row.ID
		}
		if _, err := s.db.Queries().ReleasePushClaim(ctx, store.ReleasePushClaimParams{
			Ids: ids, ClaimedAt: claimedAt,
		}); err != nil && sendErr == nil {
			sendErr = platform.Internal(err)
		}
		return 0, sendErr
	}
	return len(alerts), sendErr
}

type pushAlert struct {
	Title      string
	Body       string
	CollapseID string
	ThreadID   string
	Data       map[string]string
}

func pushAlertsFor(rows []store.ClaimNotificationsForPushRow) []pushAlert {
	if len(rows) == 0 {
		return nil
	}
	if len(rows) > pushBurstLimit {
		return []pushAlert{{
			Title:      "Polaris",
			Body:       fmt.Sprintf("%d updates", len(rows)),
			CollapseID: "inbox-burst",
			ThreadID:   "inbox",
			Data:       map[string]string{"route": "inbox"},
		}}
	}
	out := make([]pushAlert, 0, len(rows))
	for _, row := range rows {
		body := describePushEvent(row.Type, row.IssueIdentifier, int64(row.Count), row.Payload)
		data := map[string]string{"route": "inbox", "notificationId": row.ID.String()}
		thread := "inbox"
		if row.IssueID != nil {
			data["issueId"] = row.IssueID.String()
			data["issueIdentifier"] = row.IssueIdentifier
			thread = row.IssueIdentifier
		}
		out = append(out, pushAlert{
			Title:      "Polaris",
			Body:       body,
			CollapseID: row.ID.String(),
			ThreadID:   thread,
			Data:       data,
		})
	}
	return out
}

// describePushEvent is the APNs body line. Kept in sync with web describeEvent's tone —
// short, past-tense, naming the issue.
func describePushEvent(typ, identifier string, count int64, payload []byte) string {
	if identifier == "" {
		identifier = "an issue"
	}
	others := ""
	if count > 1 {
		others = fmt.Sprintf(" (+%d)", count-1)
	}
	switch typ {
	case "issue_assigned":
		return "assigned " + identifier + " to you" + others
	case "issue_status_changed":
		return "changed the status of " + identifier + others
	case "issue_priority_raised":
		return "raised the priority of " + identifier + others
	case "issue_due":
		switch dueKind(payload) {
		case "overdue":
			return identifier + " is overdue" + others
		case "today":
			return identifier + " is due today" + others
		default:
			return identifier + " is due" + others
		}
	case "issue_blocked":
		return "blocked " + identifier + others
	case "comment":
		return "commented on " + identifier + others
	case "mention":
		return "mentioned you in " + identifier + others
	case "sub_issue_completed":
		return "completed a sub-issue of " + identifier + others
	default:
		return "updated " + identifier + others
	}
}

func dueKind(payload []byte) string {
	var bag struct {
		Kind string `json:"kind"`
	}
	if err := json.Unmarshal(payload, &bag); err != nil {
		return ""
	}
	return bag.Kind
}
