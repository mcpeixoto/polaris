package domain

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"unicode/utf8"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/push"
	"github.com/peixotolabs/polaris/services/internal/store"
)

// Web Push is a delivery channel for inbox rows that already exist.
//
// It does not decide who is told what — the fan-out and the due sweep did that, and a
// third opinion here would be a phone that disagrees with the inbox. What it decides is
// narrower: of the rows this person has not yet read, which of their devices should buzz,
// and only for the types they asked the phone to carry. A row they have already read is
// not news. The inbox won the race, the way the digest already treats a read row.

const (
	// pushPageSize bounds one pass. The job runs every few seconds; a page that did not
	// fit is the next pass's work, and the claim is what keeps the two from both sending.
	pushPageSize = 100

	// maxPushSubscriptions is how many devices one person may register. A browser that
	// re-subscribes replaces its own row, so this only stops a client that invents a new
	// endpoint on every call.
	maxPushSubscriptions = 10

	maxPushEndpointBytes = 2048
	maxPushKeyBytes      = 200
)

// PushTransport delivers one payload to one device. *push.Sender is the production one;
// tests pass a fake. Gone subscriptions are reported with push.ErrGone.
type PushTransport interface {
	Send(ctx context.Context, sub push.Subscription, payload []byte) error
}

// RegisterPushSubscription stores a browser's push endpoint for the caller.
//
// The endpoint is the device. The same endpoint registered again replaces the keys and
// moves the row to the caller, which is what a browser does when it rotates keys and what
// happens when somebody else was signed in on that browser before. created_at moves with
// it, so the new owner is not pushed the previous owner's recent inbox.
func (s *Service) RegisterPushSubscription(
	ctx context.Context, p *authz.Principal, endpoint, p256dh, authKey string,
) error {
	if err := validatePushSubscription(endpoint, p256dh, authKey); err != nil {
		return err
	}

	return s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		n, err := q.CountPushSubscriptions(ctx, p.UserID)
		if err != nil {
			return platform.Internal(err)
		}
		// Replacing an endpoint this person already holds does not grow the count. The
		// insert's conflict target is the endpoint, so a count taken before it is one too
		// high exactly when they are updating their own device — which is the common case
		// and the one the cap must not refuse.
		existing, err := q.ListPushSubscriptionsForUser(ctx, p.UserID)
		if err != nil {
			return platform.Internal(err)
		}
		replacing := false
		for _, row := range existing {
			if row.Endpoint == endpoint {
				replacing = true
				break
			}
		}
		if !replacing && n >= maxPushSubscriptions {
			return platform.Validation("endpoint", "too many devices are registered for notifications")
		}

		id, err := uuid.NewV7()
		if err != nil {
			return platform.Internal(err)
		}
		_, err = q.UpsertPushSubscription(ctx, store.UpsertPushSubscriptionParams{
			ID: id, UserID: p.UserID, Endpoint: endpoint, P256dh: p256dh, Auth: authKey,
		})
		if err != nil {
			return platform.Internal(err)
		}
		return nil
	})
}

// DeletePushSubscription forgets one of the caller's devices. Another person's endpoint
// is not this person's to delete, and a mismatch deletes nothing.
func (s *Service) DeletePushSubscription(ctx context.Context, p *authz.Principal, endpoint string) (bool, error) {
	if endpoint == "" || utf8.RuneCountInString(endpoint) > maxPushEndpointBytes {
		return false, platform.Validation("endpoint", "that is not a push endpoint")
	}
	n, err := s.db.Queries().DeletePushSubscription(ctx, store.DeletePushSubscriptionParams{
		UserID: p.UserID, Endpoint: endpoint,
	})
	if err != nil {
		return false, platform.Internal(err)
	}
	return n > 0, nil
}

func validatePushSubscription(endpoint, p256dh, authKey string) error {
	if utf8.RuneCountInString(endpoint) > maxPushEndpointBytes || endpoint == "" {
		return platform.Validation("endpoint", "that is not a push endpoint")
	}
	parsed, err := url.Parse(endpoint)
	if err != nil || parsed.Scheme != "https" || parsed.Host == "" {
		return platform.Validation("endpoint", "a push endpoint has to be an https URL")
	}
	if p256dh == "" || utf8.RuneCountInString(p256dh) > maxPushKeyBytes {
		return platform.Validation("p256dh", "that is not a push key")
	}
	if authKey == "" || utf8.RuneCountInString(authKey) > maxPushKeyBytes {
		return platform.Validation("auth", "that is not a push key")
	}
	return nil
}

// DeliverPushes sends inbox rows that a registered phone has not yet been told about.
//
// sender nil means this process has no VAPID keys, and the call is a no-op rather than an
// error: push is optional, the way mail is. A row whose type the person has not asked the
// phone to carry is claimed and not sent, so it does not stay pending for the hour the
// query looks back. A row the push service refuses transiently is released, and the next
// pass tries it. A device the service says is gone is deleted.
func (s *Service) DeliverPushes(ctx context.Context, sender PushTransport) (int, error) {
	if sender == nil {
		return 0, nil
	}

	rows, err := s.db.Queries().ListNotificationsPendingPush(ctx, pushPageSize)
	if err != nil {
		return 0, platform.Internal(err)
	}

	prefs := map[uuid.UUID]json.RawMessage{}
	devices := map[uuid.UUID][]store.PushSubscription{}
	sent := 0

	for _, row := range rows {
		raw, ok := prefs[row.UserID]
		if !ok {
			user, err := s.db.Queries().GetUser(ctx, row.UserID)
			if err != nil {
				if store.IsNotFound(err) {
					continue
				}
				return sent, platform.Internal(err)
			}
			raw = user.NotificationPrefs
			prefs[row.UserID] = raw
		}

		if !wantsPush(raw, row.Type) {
			// Claimed and not sent. Leaving it pending would make every pass re-read a
			// type this person asked the phone not to carry, for the whole hour the
			// query looks back.
			if _, err := s.claimPush(ctx, row.ID); err != nil {
				return sent, err
			}
			continue
		}

		subs, ok := devices[row.UserID]
		if !ok {
			subs, err = s.db.Queries().ListPushSubscriptionsForUser(ctx, row.UserID)
			if err != nil {
				return sent, platform.Internal(err)
			}
			devices[row.UserID] = subs
		}
		if len(subs) == 0 {
			continue
		}

		claimed, err := s.claimPush(ctx, row.ID)
		if err != nil {
			return sent, err
		}
		if !claimed {
			continue
		}

		body, err := pushPayload(row)
		if err != nil {
			return sent, platform.Internal(err)
		}

		delivered := false
		transient := false
		for _, sub := range subs {
			err := sender.Send(ctx, push.Subscription{
				Endpoint: sub.Endpoint, P256dh: sub.P256dh, Auth: sub.Auth,
			}, body)
			switch {
			case err == nil:
				delivered = true
			case push.IsGone(err):
				if _, delErr := s.db.Queries().DeletePushSubscriptionByEndpoint(ctx, sub.Endpoint); delErr != nil {
					platform.Log(ctx).Warn("push: could not forget a gone subscription",
						"error", delErr)
				}
			default:
				transient = true
				platform.Log(ctx).Warn("push delivery failed", "error", err)
			}
		}
		// Nobody received it and a device might next time. Releasing the claim is what
		// makes the next pass try again; keeping it would swallow the row for good, and
		// the phone is the channel that was supposed to carry it.
		if !delivered && transient {
			if err := s.db.Queries().ReleaseNotificationPush(ctx, row.ID); err != nil {
				return sent, platform.Internal(err)
			}
			continue
		}
		if delivered {
			sent++
		}
	}
	return sent, nil
}

// claimPush reports whether this pass took the row. False means another pass already has.
func (s *Service) claimPush(ctx context.Context, id uuid.UUID) (bool, error) {
	n, err := s.db.Queries().ClaimNotificationPush(ctx, id)
	if err != nil {
		return false, platform.Internal(err)
	}
	return n > 0, nil
}

// pushPayload is what the service worker shows. The tag is the inbox row, so a later
// update of the same row replaces the banner instead of stacking a second one.
func pushPayload(row store.ListNotificationsPendingPushRow) ([]byte, error) {
	identifier := ""
	if row.TeamKey != "" && row.IssueNumber > 0 {
		identifier = model.Identifier(row.TeamKey, row.IssueNumber)
	}
	target := "/"
	if identifier != "" {
		target = "/issue/" + identifier
	}
	return json.Marshal(struct {
		Title string `json:"title"`
		Body  string `json:"body"`
		URL   string `json:"url"`
		Tag   string `json:"tag"`
	}{
		Title: pushTitle(row.Type, identifier, int(row.Count), row.Payload),
		Body:  row.IssueTitle,
		URL:   target,
		Tag:   row.ID.String(),
	})
}

func pushTitle(typ, identifier string, count int, payload []byte) string {
	if identifier == "" {
		identifier = "An issue"
	}
	extra := ""
	if others := count - 1; others == 1 {
		extra = " and 1 more"
	} else if others > 1 {
		extra = fmt.Sprintf(" and %d more", others)
	}

	switch typ {
	case model.NotifyIssueAssigned:
		return identifier + extra + " assigned to you"
	case model.NotifyMention:
		return "Mentioned in " + identifier + extra
	case model.NotifyIssuePriorityUp:
		return identifier + extra + " raised to urgent"
	case model.NotifyIssueBlocked:
		return identifier + extra + " is blocked"
	case model.NotifyIssueDue:
		// One row can name several issues, and "is" with "and 2 more" reads as a
		// mistake on the lock screen, which is the only place this sentence appears.
		verb := "is"
		if count > 1 {
			verb = "are"
		}
		if dueKind(payload) == "overdue" {
			return identifier + extra + " " + verb + " overdue"
		}
		return identifier + extra + " " + verb + " due today"
	case model.NotifyComment:
		return "New comment on " + identifier + extra
	case model.NotifyIssueStatusChanged:
		return "Status of " + identifier + extra + " changed"
	case model.NotifySubIssueCompleted:
		return "A sub-issue of " + identifier + extra + " was completed"
	default:
		return identifier + extra + " was updated"
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
