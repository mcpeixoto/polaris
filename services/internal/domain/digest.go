package domain

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/mailer"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/store"
)

// Email delivery of what the inbox already holds.
//
// This is the other end of internal/notify: that package decides who is told what, this one
// decides who is told by email and when. Nothing here re-derives an event or re-reads an
// entity — the notifications are already written, already coalesced by (user_id, group_key),
// and already filtered by everything the recipient has muted. A digest that recomputed any of
// that would be the third definition of "what happened" in a codebase whose central
// commitment is that there is one.
//
// The delivery is at most once, and the database is what enforces it: the claim in
// ClaimNotificationsForEmail is a single UPDATE ... WHERE emailed_at IS NULL ... RETURNING,
// so the rows this pass describes are exactly the rows it took ownership of, and a second
// pass — a restarted worker, a second replica, the same job an hour later — matches nothing.
// The opposite choice was made for the fan-out, deliberately: a replayed inbox row folds into
// the one already there and costs nobody anything, while a second copy of this morning's
// digest is in somebody's mailbox forever. Migration 000019 carries the full reasoning.

const (
	// digestRecipientPageSize bounds one pass. Every person above it still has their
	// notifications waiting — nothing is skipped, only deferred to the next tick — and the
	// page is what keeps a workspace-wide event from turning one pass into an hour of SMTP.
	digestRecipientPageSize = 500

	// digestItemsPerEmail bounds one message. Somebody back from three weeks off has hundreds
	// of unread notifications and a list of hundreds is not read by anybody; the remainder
	// stays unclaimed, is counted in the "and N more" line, and goes out in the next digest.
	digestItemsPerEmail = 40

	// defaultDigestTick is what the job's period is assumed to be when a caller does not say.
	// It only affects the hysteresis in `due`.
	defaultDigestTick = time.Hour
)

// DigestOptions is what a delivery pass needs and the database does not hold.
type DigestOptions struct {
	// BaseURL is the absolute URL the product is reached on — platform.Config.PublicURL.
	// Every link in the message is built from it, and a wrong one produces a digest whose
	// links all lead to a login page on localhost.
	BaseURL string

	// Tick is how often the job runs, used only to keep a daily digest arriving at roughly
	// the same time each day. See `due`.
	Tick time.Duration

	// Now is the instant the pass runs at. Zero means time.Now(); a test sets it to make a
	// cadence assertion without sleeping for a day.
	Now time.Time
}

// DeliverNotificationDigests emails everybody who is due one, and returns how many messages
// were sent.
//
// The order per recipient is claim, send, record — and it is the order rather than the steps
// that matters. Claiming first is what makes a duplicate impossible. Recording last is what
// makes a crash cost a pass that finds nothing to do rather than a person who hears nothing
// for a day. And a relay that refuses the message releases the claim, so an hour of downtime
// delays digests instead of swallowing them.
//
// One failed recipient does not stop the others. The error that comes back is the first one
// seen, for the worker to log; a pass that abandoned everybody because one address bounced
// would turn one bad mailbox into a silent outage for the whole install.
func (s *Service) DeliverNotificationDigests(
	ctx context.Context, m mailer.Mailer, opts DigestOptions,
) (int, error) {
	now := opts.Now
	if now.IsZero() {
		now = time.Now()
	}
	tick := opts.Tick
	if tick <= 0 {
		tick = defaultDigestTick
	}
	base := strings.TrimRight(opts.BaseURL, "/")

	recipients, err := s.db.Queries().ListDigestRecipients(ctx, digestRecipientPageSize)
	if err != nil {
		return 0, platform.Internal(fmt.Errorf("list digest recipients: %w", err))
	}

	var (
		sent     int
		firstErr error
	)
	for _, r := range recipients {
		prefs := emailPrefsOf(r.NotificationPrefs)
		if !prefs.due(r.LastSentAt, now, tick) {
			continue
		}

		n, err := s.deliverOneDigest(ctx, m, r, prefs, base)
		sent += n
		if err != nil && firstErr == nil {
			firstErr = err
		}
	}
	return sent, firstErr
}

// deliverOneDigest is one person's claim, send and record.
func (s *Service) deliverOneDigest(
	ctx context.Context, m mailer.Mailer, r store.ListDigestRecipientsRow, prefs emailPrefs, base string,
) (int, error) {
	var claimed []store.ClaimNotificationsForEmailRow
	// A transaction for one statement, because the pool hands out a connection per call and
	// the claim must be the unit that either happened or did not. It is also where the claim
	// timestamp comes from, which the release path needs.
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		rows, err := q.ClaimNotificationsForEmail(ctx, store.ClaimNotificationsForEmailParams{
			UserID:   r.UserID,
			PageSize: digestItemsPerEmail,
		})
		if err != nil {
			return platform.Internal(fmt.Errorf("claim notifications for email: %w", err))
		}
		claimed = rows
		return nil
	})
	if err != nil {
		return 0, err
	}
	if len(claimed) == 0 {
		// Somebody else's pass took them, or they were read in the app between the two
		// queries. Both mean there is nothing to say, and neither is worth a log line.
		return 0, nil
	}

	messages := buildDigestMessages(r, prefs, claimed, base)

	var sent int
	var sendErr error
	for i, out := range messages {
		if err := m.Send(ctx, out.msg); err != nil {
			// The recipient is not in the message. platform.NewLogger redacts a handful of
			// keys and an email address is not one of them, so the only reliable way to keep
			// an address out of the log is to keep it out of the error.
			sendErr = fmt.Errorf("send digest to user %s: %w", r.UserID, err)
			s.releaseDigestClaim(ctx, claimed, messages[i:])
			break
		}
		sent++
	}

	if sent > 0 {
		// After the send, in its own transaction, and best-effort. If this fails the next pass
		// considers the user due again and finds their notifications already claimed, so it
		// sends nothing — the error corrects itself and the only cost is one no-op.
		if err := s.db.Queries().AdvanceNotificationEmailCursor(ctx, store.AdvanceNotificationEmailCursorParams{
			UserID: r.UserID,
			SentAt: time.Now(),
		}); err != nil {
			platform.Log(ctx).Warn("digest: could not record delivery",
				"user", r.UserID, "error", err)
		}
	}
	return sent, sendErr
}

// releaseDigestClaim puts back the notifications that were claimed and never sent.
//
// Best-effort on purpose, and it must stay that way: this runs on the path where something is
// already failing, and turning a failed send into a failed pass would stop everybody else's
// digest because one relay said no. The cost of it failing too is the same as the cost of the
// process dying here — one digest's worth of notifications marked delivered when they were
// not — which is bounded, visible in the inbox, and preferable to the duplicate that the
// other ordering would produce.
func (s *Service) releaseDigestClaim(
	ctx context.Context, claimed []store.ClaimNotificationsForEmailRow, unsent []outboundDigest,
) {
	if len(unsent) == 0 {
		return
	}
	// The claim timestamp is one value for the whole statement, so any claimed row carries it.
	claimedAt := claimed[0].EmailedAt
	if claimedAt == nil {
		return
	}

	ids := make([]uuid.UUID, 0, len(unsent))
	for _, o := range unsent {
		ids = append(ids, o.ids...)
	}
	if _, err := s.db.Queries().ReleaseNotificationEmailClaim(ctx, store.ReleaseNotificationEmailClaimParams{
		Ids:       ids,
		ClaimedAt: claimedAt,
	}); err != nil {
		platform.Log(ctx).Warn("digest: could not release an unsent claim; those notifications will not be emailed again",
			"notifications", len(ids), "error", err)
	}
}

// outboundDigest is one message and the notifications it accounts for, so that a message that
// never reaches the relay can put its own rows back and no others.
type outboundDigest struct {
	msg mailer.Message
	ids []uuid.UUID
}

// buildDigestMessages turns one person's claimed notifications into the messages to send:
// one digest, or one message per notification for somebody who asked for that.
//
// A message that will not render is dropped rather than returned as an error. The rows it
// covered stay claimed and are not retried, which is the right trade for a rendering bug: the
// alternative is a pass that fails, retries, fails identically on the next tick and never
// delivers anybody else's digest either.
func buildDigestMessages(
	r store.ListDigestRecipientsRow, prefs emailPrefs, claimed []store.ClaimNotificationsForEmailRow, base string,
) []outboundDigest {
	to := mailer.Address{Name: r.DisplayName, Email: r.Email}

	if prefs.PerNotification {
		// One email per notification: the preference M1 describes as a preference and never a
		// default. It is the same rendering with one section in it, rather than a second
		// template, so the two cannot drift into saying different things about the same event.
		out := make([]outboundDigest, 0, len(claimed))
		for _, row := range claimed {
			d := digestFor(r, []store.ClaimNotificationsForEmailRow{row}, 0, base)
			msg, err := mailer.RenderDigest(to, d)
			if err != nil {
				continue
			}
			out = append(out, outboundDigest{msg: msg, ids: []uuid.UUID{row.ID}})
		}
		return out
	}

	remaining := int(r.Pending) - len(claimed)
	if remaining < 0 {
		remaining = 0
	}
	d := digestFor(r, claimed, remaining, base)
	msg, err := mailer.RenderDigest(to, d)
	if err != nil {
		return nil
	}
	ids := make([]uuid.UUID, 0, len(claimed))
	for _, row := range claimed {
		ids = append(ids, row.ID)
	}
	return []outboundDigest{{msg: msg, ids: ids}}
}

// digestFor groups notifications into the sections the message is made of.
//
// Grouped by type and not by issue, because the type is what a reader is deciding on: "three
// issues were assigned to me" is a reason to open the app and "three things happened to
// ENG-14" usually is not. Order within a section is the order the notifications arrived, so
// the digest reads chronologically inside each heading.
func digestFor(
	r store.ListDigestRecipientsRow, rows []store.ClaimNotificationsForEmailRow, remaining int, base string,
) mailer.Digest {
	d := mailer.Digest{
		Workspace:      r.WorkspaceName,
		Recipient:      r.DisplayName,
		InboxURL:       base + "/inbox",
		PreferencesURL: base + "/settings/notifications",
		Remaining:      remaining,
	}

	index := map[string]int{}
	for _, row := range rows {
		i, seen := index[row.Type]
		if !seen {
			i = len(d.Sections)
			index[row.Type] = i
			d.Sections = append(d.Sections, mailer.Section{Type: row.Type})
		}
		// The count and not the row: one coalesced row stands for a whole bulk edit, and a
		// section that counted rows would tell somebody about "1 status change" when two
		// hundred issues moved.
		d.Sections[i].Count += int(row.Count)
		d.Sections[i].Items = append(d.Sections[i].Items, itemFor(row, d.InboxURL, base))
	}
	return d
}

func itemFor(row store.ClaimNotificationsForEmailRow, inboxURL, base string) mailer.Item {
	item := mailer.Item{
		Title: row.IssueTitle,
		URL:   inboxURL,
		// count is how many events folded into this row; the item names one of them and says
		// how many others there were, because naming the first of two hundred without saying
		// so would read as if two hundred issues were one.
		Others: int(row.Count) - 1,
	}
	if row.TeamKey == "" {
		// The issue is gone — deleted since the notification was written — and the row is
		// still in somebody's inbox, so it still has to be describable. It points at the inbox
		// rather than at a URL that 404s.
		item.Title = "an issue that has since been deleted"
		return item
	}
	item.Identifier = model.Identifier(row.TeamKey, row.IssueNumber)
	// The same path the desktop app's polaris://issue/ENG-123 deep link maps onto, so a link
	// in an email and a link in the app are the same link.
	item.URL = base + "/issue/" + item.Identifier
	return item
}

// ---------------------------------------------------------------------------------------
// Preferences.

// The preferences bag `updateNotificationPrefs` writes, in full as of this milestone:
//
//	{
//	  "muted": ["issue_status_changed"],
//	  "emailDigest": "daily",
//	  "emailPerNotification": false
//	}
//
//	muted                 read by the fan-out — see mutedTypes. A muted type never becomes a
//	                      notification, so it cannot reach a digest and nothing here has to
//	                      check it again.
//	emailDigest           how often the digest goes out: off, hourly, daily or weekly. Absent
//	                      means daily, which is the default M1 asks for: digest first, and
//	                      quiet enough that nobody's first act is to turn it off.
//	emailPerNotification  one email per notification instead of a digest. False by default and
//	                      deliberately so — "per-notification email is a preference, not a
//	                      default" is the line in docs/07-milestones/01-milestone-1.md that
//	                      this whole file exists to satisfy.
//
// The struct, the cadences and the decoding all live in notification_prefs.go, because the
// bag had three definitions — one here, one in the notification engine and one in the client
// — and two of them disagreed.

// due reports whether this person should hear from us on this pass.
//
// The hysteresis — half a tick — is what keeps a daily digest daily. The job runs on a fixed
// period, so a strict "24 hours since the last one" would find the user a few seconds short
// on the tick that falls exactly a day later and send on the next one instead, walking the
// delivery an hour later every day until it arrives at three in the morning.
//
// What this deliberately is not is a fixed hour in the recipient's own timezone, which is what
// "daily digest" eventually has to mean and what people will ask for. That needs the tz
// database present in the image and a "have we already sent today, there" question that a
// single watermark cannot answer, and it is a change to this function and nothing else — the
// claim, the release and the cursor are all indifferent to how due is decided.
func (p emailPrefs) due(lastSentAt, now time.Time, tick time.Duration) bool {
	if p.PerNotification {
		// Per-notification email is not on a cadence: it goes out on the first pass after the
		// notification exists. The job's period is the only delay, which is what "immediate"
		// honestly means for something delivered by a job.
		return true
	}
	if p.Cadence == cadenceOff {
		return false
	}
	return now.Sub(lastSentAt) >= p.interval()-tick/2
}
