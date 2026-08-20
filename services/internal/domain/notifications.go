package domain

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/notify"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/store"
)

// The notification engine, and the inbox it fills.
//
// Every notification derives from a change_log row. That is the architectural commitment of
// this milestone: "what happened" already has a definition — the change stream — and
// re-deriving it from entities produces a second one that disagrees within a month. The
// symptom is an inbox that tells you about a status change the activity feed says never
// happened, and by then neither can be believed.
//
// This file is the driver, not the policy. It reads the stream, gathers the facts a
// decision needs, and writes what internal/notify returns. The judgements — never the
// actor, one row per person per event, which reason wins — live there, where they are
// testable without a database.
//
// Ownership. Every inbox operation below is authorised by authz.OwnsResource and by
// nothing else. There is deliberately no admin override, unlike comments: an admin needs to
// be able to delete an abusive comment because a comment is visible to a team, and an admin
// has no business marking somebody else's notifications read. A workspace where they can is
// one nobody should mark an issue as read in.

const (
	// fanOutPageSize bounds one pass. A pass runs in one transaction and takes the
	// workspace's version lock when it emits, so it has to be a bite rather than a backlog:
	// a workspace catching up on a week of changes would otherwise block every writer in it
	// for the length of the catch-up. Whatever is above the page stays above the watermark
	// and is the next pass's work.
	fanOutPageSize = 500

	// The inbox page. The product caps an inbox at 2,000 open notifications, so a client
	// asking for everything is asking for a page, not for the table.
	defaultInboxPageSize = 50
	maxInboxPageSize     = 500

	// maxNotificationPrefsBytes bounds the preferences bag. It is read whole for every
	// candidate recipient of every change, so a user who pastes a megabyte into it would be
	// taxing the fan-out for the whole workspace, not only themselves.
	maxNotificationPrefsBytes = 8 << 10
)

// FanOut delivers every change the workspace has accumulated since its watermark, and
// returns how many deliveries it wrote — several of which may have folded into one inbox
// row, which is the point of coalescing.
//
// It is resumable, and the ordering here is what makes it so. Rows are written first, the
// watermark moves last, and both happen in one transaction: a worker killed mid-pass
// restarts from the position it had before the pass and re-processes versions it may have
// already delivered. That replay is free rather than duplicative because of the unique
// index on (user_id, group_key) and UpsertNotification's guard, which turns a re-delivery
// into a statement that updates nothing. Advancing the watermark first would be the other
// choice, and it loses notifications instead of repeating them — which nobody reports,
// because a notification that never arrives leaves no trace.
//
// The changes this emits are themselves change rows, read back on the next pass and
// discarded there: internal/notify skips the notification entity type, or the engine would
// notify people about being notified, forever.
func (s *Service) FanOut(ctx context.Context, workspaceID uuid.UUID) (int, error) {
	var delivered int
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		cursor, err := q.GetNotificationCursor(ctx, workspaceID)
		if err != nil {
			return platform.Internal(fmt.Errorf("read notification cursor: %w", err))
		}
		// The ceiling is read once, before anything is delivered. Changes committed while
		// this pass runs land above it and are next pass's work, so the watermark never
		// jumps over a version this pass did not actually look at.
		through, err := q.GetWorkspaceVersion(ctx, workspaceID)
		if err != nil {
			return platform.Internal(fmt.Errorf("read workspace version: %w", err))
		}
		if through <= cursor {
			return nil
		}

		rows, err := q.ReadChangesSince(ctx, store.ReadChangesSinceParams{
			WorkspaceID:    workspaceID,
			AfterVersion:   cursor,
			ThroughVersion: through,
			PageSize:       fanOutPageSize,
		})
		if err != nil {
			return platform.Internal(fmt.Errorf("read changes: %w", err))
		}
		if len(rows) == 0 {
			return nil
		}

		cache := newFanOutCache(q, workspaceID)

		// One change per inbox row rather than per delivery. Two hundred issues folding
		// into one notification is one thing the client has to learn about; emitting the
		// same row two hundred times would put the cost coalescing removes back on the
		// sync stream. The slice keeps the order stable so the deltas arrive in the order
		// the events did.
		var order []uuid.UUID
		latest := map[uuid.UUID]model.Notification{}

		highest := cursor
		for _, r := range rows {
			deliveries, err := deliveriesFor(ctx, cache, r)
			if err != nil {
				return err
			}
			for _, d := range deliveries {
				id, err := uuid.NewV7()
				if err != nil {
					return platform.Internal(err)
				}
				row, err := q.UpsertNotification(ctx, store.UpsertNotificationParams{
					ID:            id,
					WorkspaceID:   workspaceID,
					UserID:        d.UserID,
					Type:          d.Type,
					IssueID:       d.IssueID,
					CommentID:     d.CommentID,
					ActorType:     r.ActorType,
					ActorID:       r.ActorID,
					ChangeVersion: r.Version,
					GroupKey:      d.GroupKey,
					// No payload. The inbox row points at entities the client already
					// replicates, and copying a title in here would be a second copy that
					// goes stale the moment somebody renames the issue.
					Payload: nil,
				})
				if err != nil {
					if store.IsNotFound(err) {
						// The replay guard fired: this version was already delivered to
						// this person under this key, on a pass that committed. Nothing
						// changed, so nothing is emitted either.
						continue
					}
					return platform.Internal(fmt.Errorf("upsert notification: %w", err))
				}
				if _, seen := latest[row.ID]; !seen {
					order = append(order, row.ID)
				}
				latest[row.ID] = toNotification(row)
				delivered++
			}
			highest = r.Version
		}

		if len(order) > 0 {
			changes := make([]Change, 0, len(order))
			for _, id := range order {
				n := latest[id]
				// A user scope, so the row reaches exactly one person's sessions and can
				// never leak through the hub. A change with the wrong scope here would put
				// one person's inbox into everybody's replica.
				changes = append(changes, Change{
					EntityType: "notification", EntityID: id, Op: OpUpsert,
					Scope: authz.UserScope(n.UserID), Payload: n,
				})
			}
			// The engine acts as the system, not as whoever tripped it. Attributing an
			// inbox row to the person who commented would put their name on a write they
			// did not make, in the audit log and in every webhook.
			if _, err := s.em.Emit(ctx, q, workspaceID, authz.SystemActor(), changes...); err != nil {
				return err
			}
		}

		// Last, and only as far as the rows actually read. Everything above `highest` —
		// including the changes just emitted for these very notifications — is the next
		// pass's problem, and if this transaction rolls back the watermark rolls back with
		// it.
		if err := q.AdvanceNotificationCursor(ctx, store.AdvanceNotificationCursorParams{
			WorkspaceID: workspaceID,
			Version:     highest,
		}); err != nil {
			return platform.Internal(fmt.Errorf("advance notification cursor: %w", err))
		}
		return nil
	})
	if err != nil {
		// Nothing was written: the transaction rolled back and took the watermark with it.
		// Reporting the deliveries a failed pass attempted would put a number in the
		// worker's log for work that did not happen.
		return 0, err
	}
	return delivered, nil
}

// FanOutAll runs one pass for every workspace that has changes it has not seen, and returns
// the total delivered. This is what the worker schedules; FanOut on its own is the unit.
//
// It exists because FanOut takes a workspace and the job has none — the same shape as
// PurgeExpiredIssues, and for the same reason. Until this, nothing called FanOut outside its
// own tests: six jobs were registered in cmd/worker and none was this one, so on a live
// system `notification` stayed empty forever and the inbox, the unread badge and every
// toggle on the preferences screen were inert. The engine was complete, tested, documented
// and never invoked.
//
// One pass per workspace per call, not a loop to exhaustion. FanOut is capped at
// fanOutPageSize changes, so a workspace with a real backlog is drained across several
// calls — which is what the driving query is for, and what keeps a single tick from holding
// one workspace's version lock while every other workspace waits its turn.
//
// A workspace that fails is logged and skipped rather than returned: this runs unattended on
// a short interval, and one workspace's bad row must not stop everybody else's inbox. The
// next pass picks it up, because the cursor did not move.
func (s *Service) FanOutAll(ctx context.Context) (int, error) {
	workspaces, err := s.db.Queries().ListWorkspacesWithPendingNotifications(ctx)
	if err != nil {
		return 0, platform.Internal(err)
	}

	total := 0
	for _, workspaceID := range workspaces {
		delivered, err := s.FanOut(ctx, workspaceID)
		if err != nil {
			platform.Log(ctx).Error("notification fan-out failed for a workspace",
				"workspace", workspaceID, "error", err)
			continue
		}
		total += delivered
	}
	return total, nil
}

// deliveriesFor turns one change row into inbox rows, by gathering what the rules need and
// asking internal/notify.
//
// What the change was about comes from the change row's own payload — the entity exactly as
// it stood at that version, written by the mutation that made it — and not from reading the
// entity now. The fan-out runs afterwards and asynchronously, so "now" is a different
// moment: an issue created unassigned and assigned a second later would, read live, make the
// creation look like an assignment and notify its assignee twice. The payload is already
// stored for the sync stream, so this costs nothing and removes the whole class of the
// engine seeing the future.
//
// It is not a diff. Nothing here compares two versions of anything; what moved is in
// r.ChangedFields, recorded by the mutation itself.
//
// Only the audience is read live, and that is right: the people to tell are the ones
// watching now, not the ones who were watching when somebody typed.
func deliveriesFor(ctx context.Context, c *fanOutCache, r store.ChangeLog) ([]notify.Delivery, error) {
	ev := notify.Event{
		Version:       r.Version,
		EntityType:    r.EntityType,
		EntityID:      r.EntityID,
		Op:            r.Op,
		Actor:         authz.Actor{Type: authz.ActorType(r.ActorType), ID: r.ActorID},
		ChangedFields: r.ChangedFields,
	}
	if r.BatchKey != nil {
		ev.BatchKey = *r.BatchKey
	}

	var (
		subject  notify.Subject
		audience notify.Audience
		err      error
	)
	// A delete or revoke carries no payload by design, and tells nobody anything anyway —
	// notify.Deliveries answers that, so the switch only has to avoid decoding what is not
	// there.
	if len(r.Payload) > 0 {
		switch r.EntityType {
		case notify.EntityIssue:
			subject, audience, err = c.forIssue(ctx, r.Payload)
		case notify.EntityComment:
			subject, audience, err = c.forComment(ctx, r.Payload)
		case notify.EntityRelation:
			subject, audience, err = c.forRelation(ctx, r.Payload)
		default:
			// Everything else — teams, labels, views, and the engine's own notification
			// rows — concerns nobody's inbox. It is still handed to notify.Deliveries
			// rather than skipped here, because which changes notify is that package's
			// decision and not this switch's.
		}
	}
	if err != nil {
		return nil, err
	}
	deliveries := notify.Deliveries(ev, subject, audience)
	if r.EntityType == notify.EntityIssue && len(r.Payload) > 0 {
		var issue model.Issue
		if err := json.Unmarshal(r.Payload, &issue); err == nil {
			category, err := c.categoryOf(ctx, issue.StateID)
			if err != nil {
				return nil, err
			}
			extra, err := viewSubscriptionDeliveries(ctx, c, r, issue, category)
			if err != nil {
				return nil, err
			}
			deliveries = append(deliveries, extra...)
		}
	}
	return deliveries, nil
}

// fanOutCache memoises the reads one pass makes over and over.
//
// A bulk edit of two hundred issues asks for the same subscribers, the same statuses and
// the same delivery preferences two hundred times, and M1 acceptance test 8 gives the whole
// pass two seconds. The cache lives for one pass only: it is a picture of the workspace
// taken inside one transaction, and keeping it beyond that would make the engine act on
// subscriptions that had since been cancelled.
type fanOutCache struct {
	q           *store.Queries
	workspaceID uuid.UUID

	subscribers map[uuid.UUID][]uuid.UUID
	category    map[uuid.UUID]string
	// recipient records whether an id names somebody in this workspace, and muted what
	// they have switched off. Both are filled by keep.
	recipient      map[uuid.UUID]bool
	muted          map[uuid.UUID]map[string]bool
	viewSubs       []store.ListViewSubscriptionsForFanOutRow
	viewSubsLoaded bool
}

func newFanOutCache(q *store.Queries, workspaceID uuid.UUID) *fanOutCache {
	return &fanOutCache{
		q:           q,
		workspaceID: workspaceID,
		subscribers: map[uuid.UUID][]uuid.UUID{},
		category:    map[uuid.UUID]string{},
		recipient:   map[uuid.UUID]bool{},
		muted:       map[uuid.UUID]map[string]bool{},
	}
}

func (c *fanOutCache) forIssue(ctx context.Context, payload json.RawMessage) (notify.Subject, notify.Audience, error) {
	var (
		subject  notify.Subject
		audience notify.Audience
	)

	var issue model.Issue
	if err := json.Unmarshal(payload, &issue); err != nil {
		// The payload was written by this codebase's own serialiser, so a decode failure is
		// a bug here rather than bad input, and it must not stall the whole workspace's
		// inbox behind one row.
		platform.Log(ctx).Error("fan-out: undecodable issue payload; skipping",
			"workspace", c.workspaceID, "error", err)
		return subject, audience, nil
	}

	category, err := c.categoryOf(ctx, issue.StateID)
	if err != nil {
		return subject, audience, err
	}

	subject = notify.Subject{
		IssueID:        &issue.ID,
		ParentID:       issue.ParentID,
		AssigneeID:     issue.AssigneeID,
		Completed:      category == CategoryCompleted,
		PriorityRaised: issue.Priority == notify.PriorityUrgent,
	}

	mentions, err := c.keep(ctx, notify.ParseMentions(issue.Description))
	if err != nil {
		return subject, audience, err
	}
	subject.Mentions = mentions

	subscribers, err := c.subscribersOf(ctx, issue.ID)
	if err != nil {
		return subject, audience, err
	}
	audience.Subscribers = subscribers

	// Only gathered when it can matter. A parent's watchers hear about a child finishing,
	// not about every keystroke on it, and reading their subscriptions for a title edit
	// would double the queries this pass makes for nothing.
	if issue.ParentID != nil && subject.Completed {
		parents, err := c.subscribersOf(ctx, *issue.ParentID)
		if err != nil {
			return subject, audience, err
		}
		audience.ParentSubscribers = parents
	}

	direct := subject.Mentions
	if issue.AssigneeID != nil {
		if kept, err := c.keep(ctx, []uuid.UUID{*issue.AssigneeID}); err != nil {
			return subject, audience, err
		} else if len(kept) == 0 {
			subject.AssigneeID = nil
		} else {
			direct = append(direct, *issue.AssigneeID)
		}
	}
	unsubscribed, err := c.unsubscribedFrom(ctx, issue.ID, direct)
	if err != nil {
		return subject, audience, err
	}
	audience.Unsubscribed = unsubscribed
	audience.Muted = c.muted

	return subject, audience, nil
}

func (c *fanOutCache) forComment(ctx context.Context, payload json.RawMessage) (notify.Subject, notify.Audience, error) {
	var (
		subject  notify.Subject
		audience notify.Audience
	)

	var comment model.Comment
	if err := json.Unmarshal(payload, &comment); err != nil {
		platform.Log(ctx).Error("fan-out: undecodable comment payload; skipping",
			"workspace", c.workspaceID, "error", err)
		return subject, audience, nil
	}

	subject = notify.Subject{IssueID: &comment.IssueID, CommentID: &comment.ID}

	mentions, err := c.keep(ctx, notify.ParseMentions(comment.Body))
	if err != nil {
		return subject, audience, err
	}
	subject.Mentions = mentions

	subscribers, err := c.subscribersOf(ctx, comment.IssueID)
	if err != nil {
		return subject, audience, err
	}
	audience.Subscribers = subscribers

	unsubscribed, err := c.unsubscribedFrom(ctx, comment.IssueID, mentions)
	if err != nil {
		return subject, audience, err
	}
	audience.Unsubscribed = unsubscribed
	audience.Muted = c.muted

	return subject, audience, nil
}

func (c *fanOutCache) forRelation(ctx context.Context, payload json.RawMessage) (notify.Subject, notify.Audience, error) {
	var (
		subject  notify.Subject
		audience notify.Audience
	)

	var relation model.IssueRelation
	if err := json.Unmarshal(payload, &relation); err != nil {
		platform.Log(ctx).Error("fan-out: undecodable relation payload; skipping",
			"workspace", c.workspaceID, "error", err)
		return subject, audience, nil
	}
	// `related` and `duplicate` are links, not obstructions. Only a block stops work, and
	// only the people watching the work that stopped need telling.
	if relation.Type != model.RelationBlocks {
		return subject, audience, nil
	}

	// The stored direction is `issue_id blocks related_issue_id`, so the far end is the one
	// that just became blocked.
	subject = notify.Subject{IssueID: &relation.IssueID, BlockedIssueID: &relation.RelatedIssueID}

	blocked, err := c.subscribersOf(ctx, relation.RelatedIssueID)
	if err != nil {
		return subject, audience, err
	}
	audience.BlockedSubscribers = blocked
	audience.Muted = c.muted

	return subject, audience, nil
}

// subscribersOf is who is watching an issue and still wants to hear. The query is partial
// on unsubscribed = false, so people who have switched the issue off are already absent —
// which is exactly why unsubscribedFrom exists for the ones who were never on the list.
func (c *fanOutCache) subscribersOf(ctx context.Context, issueID uuid.UUID) ([]uuid.UUID, error) {
	if cached, ok := c.subscribers[issueID]; ok {
		return cached, nil
	}
	rows, err := c.q.ListIssueSubscribers(ctx, issueID)
	if err != nil {
		return nil, platform.Internal(fmt.Errorf("fan-out: read subscribers: %w", err))
	}
	ids := make([]uuid.UUID, 0, len(rows))
	for _, r := range rows {
		ids = append(ids, r.UserID)
	}
	kept, err := c.keep(ctx, ids)
	if err != nil {
		return nil, err
	}
	c.subscribers[issueID] = kept
	return kept, nil
}

func (c *fanOutCache) categoryOf(ctx context.Context, stateID uuid.UUID) (string, error) {
	if cached, ok := c.category[stateID]; ok {
		return cached, nil
	}
	state, err := c.q.GetWorkflowState(ctx, stateID)
	if err != nil {
		if store.IsNotFound(err) {
			// The status a change referred to is gone. Only the completed category means
			// anything here, so an unclassifiable status simply is not one — and a workspace
			// whose inbox stops entirely because of one deleted row is a worse answer than a
			// sub-issue rollup that misses one event.
			c.category[stateID] = ""
			return "", nil
		}
		return "", platform.Internal(fmt.Errorf("fan-out: read workflow state: %w", err))
	}
	c.category[stateID] = state.Category
	return state.Category, nil
}

// keep returns the ids that name somebody in this workspace, and records what each of them
// has muted along the way.
//
// Mentions are why this exists. The ids in a description are whatever a person typed or
// pasted, so one naming nobody must drop that mention rather than fail the pass on a
// foreign key violation — which would stall the whole workspace's inbox behind a typo
// nobody can see, let alone fix.
//
// Preferences are read here, before the rules run, rather than filtered out of the result
// afterwards. The precedence ladder has to be able to fall through: somebody who mutes
// mentions but not comments should still hear about the comment they were mentioned in, and
// that only works if the muted candidate never becomes the delivery.
func (c *fanOutCache) keep(ctx context.Context, ids []uuid.UUID) ([]uuid.UUID, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	out := make([]uuid.UUID, 0, len(ids))
	for _, id := range ids {
		known, seen := c.recipient[id]
		if !seen {
			user, err := c.q.GetUser(ctx, id)
			switch {
			case err != nil && store.IsNotFound(err):
				known = false
			case err != nil:
				return nil, platform.Internal(fmt.Errorf("fan-out: read recipient: %w", err))
			default:
				// A user id from another workspace is somebody else's person entirely.
				known = user.WorkspaceID == c.workspaceID
				if known {
					c.muted[id] = mutedTypes(user.NotificationPrefs)
				}
			}
			c.recipient[id] = known
		}
		if known {
			out = append(out, id)
		}
	}
	return out, nil
}

// unsubscribedFrom answers, for people who are not on an issue's subscriber list, whether
// they are absent because nobody subscribed them or because they said no.
//
// The subscriber query cannot tell the two apart — it is partial on unsubscribed = false —
// and the difference is the whole meaning of the button: an unsubscribe has to survive
// being mentioned, or it is a setting that lasts until the next person types your name.
func (c *fanOutCache) unsubscribedFrom(ctx context.Context, issueID uuid.UUID, users []uuid.UUID) (map[uuid.UUID]bool, error) {
	if len(users) == 0 {
		return nil, nil
	}
	out := make(map[uuid.UUID]bool, len(users))
	for _, u := range users {
		if _, done := out[u]; done {
			continue
		}
		row, err := c.q.GetIssueSubscription(ctx, store.GetIssueSubscriptionParams{
			IssueID: issueID, UserID: u,
		})
		if err != nil {
			if store.IsNotFound(err) {
				out[u] = false
				continue
			}
			return nil, platform.Internal(fmt.Errorf("fan-out: read subscription: %w", err))
		}
		out[u] = row.Unsubscribed
	}
	return out, nil
}

// ---------------------------------------------------------------------------------------
// Subscriptions.

// SubscribeOnAction subscribes somebody to an issue because of something they just did or
// something that was just done to them: they created it, were assigned it, were mentioned
// in it, or commented on it.
//
// It runs inside the caller's transaction — hence the *store.Queries — so that being
// assigned an issue and being subscribed to it are one atomic fact. A subscription written
// afterwards, outside, is one that a crash can lose while the assignment stands.
//
// It never resurrects an explicit unsubscribe. An existing row is left exactly as it is,
// which is the difference between an unsubscribe button and an unsubscribe button that
// works for four minutes: the next comment would otherwise re-subscribe the person who had
// just switched the issue off.
func (s *Service) SubscribeOnAction(
	ctx context.Context, q *store.Queries, p *authz.Principal, issueID, userID uuid.UUID, reason string,
) error {
	// A row already exists, saying either "watching" or "explicitly not". Both are answers
	// this function must not overwrite, and neither is a change, so neither is emitted.
	if _, err := q.GetIssueSubscription(ctx, store.GetIssueSubscriptionParams{
		IssueID: issueID, UserID: userID,
	}); err == nil {
		return nil
	} else if !store.IsNotFound(err) {
		return platform.Internal(err)
	}

	// A mention naming somebody who is not in this workspace is not something the person
	// who typed it can fix from where they are standing, and it must not fail their
	// comment. It subscribes nobody instead.
	user, err := q.GetUser(ctx, userID)
	if err != nil {
		if store.IsNotFound(err) {
			return nil
		}
		return platform.Internal(err)
	}
	if user.WorkspaceID != p.WorkspaceID {
		return nil
	}

	id, err := uuid.NewV7()
	if err != nil {
		return platform.Internal(err)
	}
	row, err := q.EnsureIssueSubscription(ctx, store.EnsureIssueSubscriptionParams{
		ID:          id,
		WorkspaceID: p.WorkspaceID,
		IssueID:     issueID,
		UserID:      userID,
		Reason:      reason,
	})
	if err != nil {
		return platform.Internal(err)
	}

	// A second version block inside the caller's transaction, deliberately. The version the
	// caller hands back to the client is the one its own write landed at; this row commits
	// with it and arrives in the same delta batch, so the client learns it is subscribed
	// without the mutation's answer being about something it did not ask for.
	_, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
		EntityType: "issueSubscription", EntityID: row.ID, Op: OpUpsert,
		Scope: authz.UserScope(userID), Payload: toIssueSubscription(row),
	})
	return err
}

// SetIssueSubscription is the button: the one place a subscription's `unsubscribed` flag
// may change, because it is the one place the user said so.
//
// The user id comes from the principal and never from the caller, so there is no shape of
// request that can subscribe somebody else — the strongest form of the rule
// authz.OwnsResource states for the inbox operations below.
func (s *Service) SetIssueSubscription(
	ctx context.Context, p *authz.Principal, issueID uuid.UUID, subscribed bool,
) (model.IssueSubscription, int64, error) {
	var out model.IssueSubscription
	var version int64

	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		issue, err := q.GetIssue(ctx, issueID)
		if err != nil {
			if store.IsNotFound(err) {
				return platform.NotFound("issue")
			}
			return platform.Internal(err)
		}
		team, err := q.GetTeam(ctx, issue.TeamID)
		if err != nil {
			return platform.Internal(err)
		}
		// Not-found rather than forbidden, for the reason GetIssue gives: telling somebody
		// that an issue exists in a team they cannot see is itself the leak.
		if !authz.Visible(p, authz.TeamScope(issue.TeamID, team.Private)) {
			return platform.NotFound("issue")
		}

		id, err := uuid.NewV7()
		if err != nil {
			return platform.Internal(err)
		}
		row, err := q.SetIssueSubscription(ctx, store.SetIssueSubscriptionParams{
			ID:           id,
			WorkspaceID:  p.WorkspaceID,
			IssueID:      issueID,
			UserID:       p.UserID,
			Unsubscribed: !subscribed,
		})
		if err != nil {
			return platform.Internal(err)
		}
		out = toIssueSubscription(row)

		// User-scoped, and with no team id: who watches what is nobody else's business, and
		// a team-scoped change here would put one person's subscriptions in every
		// teammate's replica.
		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "issueSubscription", EntityID: row.ID, Op: OpUpsert,
			Scope: authz.UserScope(p.UserID), Payload: out,
		})
		return err
	})
	return out, version, err
}

// ---------------------------------------------------------------------------------------
// The inbox.

// ownedNotification loads one of the caller's own notifications, and is the only way this
// file reaches one.
//
// authz.OwnsResource is the entire authorisation story for an inbox — no role, no admin
// override — and stating it in one place is what makes that answerable without reading five
// mutations. The queries are scoped by user_id as well, so the rule survives a later call
// site that forgets to come through here; this is where a reader finds out that it is a
// rule rather than an accident of how the SQL was written.
func ownedNotification(
	ctx context.Context, q *store.Queries, p *authz.Principal, id uuid.UUID,
) (store.Notification, error) {
	row, err := q.GetNotification(ctx, store.GetNotificationParams{ID: id, UserID: p.UserID})
	if err != nil {
		if store.IsNotFound(err) {
			// Not-found covers both "no such notification" and "not yours". An admin asking
			// about somebody else's inbox gets the same answer as somebody asking about a
			// row that never existed, which is the point.
			return store.Notification{}, platform.NotFound("notification")
		}
		return store.Notification{}, platform.Internal(err)
	}
	if !authz.OwnsResource(p, row.UserID) {
		return store.Notification{}, platform.NotFound("notification")
	}
	return row, nil
}

func (s *Service) MarkNotificationRead(
	ctx context.Context, p *authz.Principal, id uuid.UUID, read bool,
) (model.Notification, int64, error) {
	var out model.Notification
	var version int64

	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		if _, err := ownedNotification(ctx, q, p, id); err != nil {
			return err
		}
		row, err := q.MarkNotificationRead(ctx, store.MarkNotificationReadParams{
			Read: read, ID: id, UserID: p.UserID,
		})
		if err != nil {
			return platform.Internal(err)
		}
		out = toNotification(row)

		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "notification", EntityID: row.ID, Op: OpUpsert,
			Scope: authz.UserScope(p.UserID), Payload: out,
		})
		return err
	})
	return out, version, err
}

// MarkAllNotificationsRead clears the badge in one statement and one version block.
//
// Marking a thousand rows read one at a time would mint a thousand versions and hold the
// workspace's row lock for the length of all of them — which is a write pause for everybody
// else in the workspace, caused by one person pressing a key.
func (s *Service) MarkAllNotificationsRead(
	ctx context.Context, p *authz.Principal,
) ([]model.Notification, int64, error) {
	var out []model.Notification
	var version int64

	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		rows, err := q.MarkAllNotificationsRead(ctx, p.UserID)
		if err != nil {
			return platform.Internal(err)
		}
		if len(rows) == 0 {
			// Nothing changed, so nothing is emitted. An empty version block would still
			// take the workspace lock, and this is a button people press twice.
			out = []model.Notification{}
			return nil
		}

		out = make([]model.Notification, 0, len(rows))
		changes := make([]Change, 0, len(rows))
		for _, r := range rows {
			n := toNotification(r)
			out = append(out, n)
			changes = append(changes, Change{
				EntityType: "notification", EntityID: r.ID, Op: OpUpsert,
				Scope: authz.UserScope(p.UserID), Payload: n,
			})
		}
		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), changes...)
		return err
	})
	return out, version, err
}

// SnoozeNotification hides a notification until a chosen time. A nil `until` wakes it now.
//
// The row reappears on its own when the time passes, without anything sweeping the table:
// the inbox query compares against now() rather than reading a flag somebody has to clear.
func (s *Service) SnoozeNotification(
	ctx context.Context, p *authz.Principal, id uuid.UUID, until *time.Time,
) (model.Notification, int64, error) {
	if until != nil && !until.After(time.Now()) {
		// A snooze into the past is already awake, so accepting it would mark a
		// notification read and change nothing else — a button that appears to work and
		// does not.
		return model.Notification{}, 0, platform.Validation("until", "a snooze has to be for a time in the future")
	}

	var out model.Notification
	var version int64

	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		if _, err := ownedNotification(ctx, q, p, id); err != nil {
			return err
		}
		row, err := q.SnoozeNotification(ctx, store.SnoozeNotificationParams{
			SnoozedUntil: until, ID: id, UserID: p.UserID,
		})
		if err != nil {
			return platform.Internal(err)
		}
		out = toNotification(row)

		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "notification", EntityID: row.ID, Op: OpUpsert,
			Scope: authz.UserScope(p.UserID), Payload: out,
		})
		return err
	})
	return out, version, err
}

// DeleteNotification removes a row from the inbox.
//
// Soft, not a DELETE. The unique index on (user_id, group_key) is what makes the fan-out
// idempotent, and removing the row would let a replayed version deliver a second copy of
// something the user had already dismissed.
func (s *Service) DeleteNotification(
	ctx context.Context, p *authz.Principal, id uuid.UUID,
) (uuid.UUID, int64, error) {
	var version int64

	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		if _, err := ownedNotification(ctx, q, p, id); err != nil {
			return err
		}
		row, err := q.DeleteNotification(ctx, store.DeleteNotificationParams{ID: id, UserID: p.UserID})
		if err != nil {
			return platform.Internal(err)
		}

		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "notification", EntityID: row.ID, Op: OpDelete,
			Scope: authz.UserScope(p.UserID),
		})
		return err
	})
	return id, version, err
}

// UpdateNotificationPrefs replaces the caller's delivery preferences whole.
//
// Whole rather than merged because a per-key patch cannot express "turn this off": jsonb
// has no way to say "remove this key" in a merge, and a toggle that can only ever be
// switched on is not a preference.
func (s *Service) UpdateNotificationPrefs(
	ctx context.Context, p *authz.Principal, prefs json.RawMessage,
) (model.User, int64, error) {
	if len(prefs) > maxNotificationPrefsBytes {
		return model.User{}, 0, platform.Validation("prefs", "those preferences are too large")
	}
	// Decoded into a map rather than merely checked for valid JSON: the bag is read as an
	// object by everything downstream, and storing a bare array or string here would make
	// every later read fail on a value only this call could have written.
	var probe map[string]json.RawMessage
	if err := json.Unmarshal(prefs, &probe); err != nil {
		return model.User{}, 0, platform.Validation("prefs", "preferences must be a JSON object")
	}

	var out model.User
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		row, err := q.UpdateUserNotificationPrefs(ctx, store.UpdateUserNotificationPrefsParams{
			ID:                p.UserID,
			NotificationPrefs: prefs,
		})
		if err != nil {
			return platform.Internal(err)
		}
		out = toUser(row)
		// The only place the bag is attached to a user payload. toUser leaves it off, so
		// the workspace-scoped user changes everybody receives carry a person's name and
		// avatar and not their notification settings.
		out.NotificationPrefs = row.NotificationPrefs

		// User-scoped for the same reason, even though every other change to a user row is
		// workspace-scoped: this payload carries something only its owner may read.
		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "user", EntityID: row.ID, Op: OpUpsert,
			Scope: authz.UserScope(p.UserID), Payload: out,
		})
		return err
	})
	return out, version, err
}

// ListNotifications is the inbox. Snoozed rows are excluded until they wake.
func (s *Service) ListNotifications(
	ctx context.Context, p *authz.Principal, includeRead, includeSnoozed bool, first int,
) ([]model.Notification, error) {
	if first <= 0 {
		first = defaultInboxPageSize
	}
	if first > maxInboxPageSize {
		first = maxInboxPageSize
	}

	rows, err := s.db.Queries().ListNotifications(ctx, store.ListNotificationsParams{
		UserID:         p.UserID,
		IncludeRead:    includeRead,
		IncludeSnoozed: includeSnoozed,
		PageSize:       int32(first),
	})
	if err != nil {
		return nil, platform.Internal(err)
	}
	out := make([]model.Notification, 0, len(rows))
	for _, r := range rows {
		out = append(out, toNotification(r))
	}
	return out, nil
}

// UnreadNotificationCount is the badge, read on every page load.
func (s *Service) UnreadNotificationCount(ctx context.Context, p *authz.Principal) (int, error) {
	n, err := s.db.Queries().CountUnreadNotifications(ctx, p.UserID)
	if err != nil {
		return 0, platform.Internal(err)
	}
	return int(n), nil
}

// MyIssues is everything assigned to the caller, across every team they can reach.
//
// The teams come from the principal rather than from a fresh query, for the reason
// ResolvePrincipal gives: permissions are resolved once per request, and a list that
// re-read them could return issues from a team the caller lost access to half a response
// ago.
func (s *Service) MyIssues(ctx context.Context, p *authz.Principal, includeCompleted bool) ([]model.Issue, error) {
	teamIDs := p.Teams.IDs()
	if len(teamIDs) == 0 {
		return []model.Issue{}, nil
	}

	q := s.db.Queries()
	rows, err := q.ListMyIssues(ctx, store.ListMyIssuesParams{
		WorkspaceID:      p.WorkspaceID,
		AssigneeID:       &p.UserID,
		TeamIds:          teamIDs,
		IncludeCompleted: includeCompleted,
	})
	if err != nil {
		return nil, platform.Internal(err)
	}
	if len(rows) == 0 {
		return []model.Issue{}, nil
	}

	// One lookup for the whole page. The identifier (ENG-123) is derived from the team key
	// rather than stored, so every issue needs one — and asking per issue would be a query
	// per row for a value that repeats.
	teams, err := q.ListTeamsInWorkspace(ctx, p.WorkspaceID)
	if err != nil {
		return nil, platform.Internal(err)
	}
	keys := make(map[uuid.UUID]string, len(teams))
	for _, t := range teams {
		keys[t.ID] = t.Key
	}

	out := make([]model.Issue, 0, len(rows))
	for _, r := range rows {
		out = append(out, toIssue(store.AsIssueRow(r), keys[r.TeamID]))
	}
	return out, nil
}

// ---------------------------------------------------------------------------------------

func toNotification(n store.Notification) model.Notification {
	out := model.Notification{
		ID:            n.ID,
		WorkspaceID:   n.WorkspaceID,
		UserID:        n.UserID,
		Type:          n.Type,
		IssueID:       n.IssueID,
		CommentID:     n.CommentID,
		Actor:         model.Actor{Type: n.ActorType, ID: n.ActorID},
		ChangeVersion: n.ChangeVersion,
		GroupKey:      n.GroupKey,
		Count:         int(n.Count),
		ReadAt:        n.ReadAt,
		SnoozedUntil:  n.SnoozedUntil,
		CreatedAt:     n.CreatedAt,
		UpdatedAt:     n.UpdatedAt,
	}
	// Already JSON in the column; handed through untouched rather than decoded and
	// re-encoded, which would be pure cost and a chance to drift.
	if len(n.Payload) > 0 {
		out.Payload = n.Payload
	}
	return out
}

func toIssueSubscription(s store.IssueSubscription) model.IssueSubscription {
	return model.IssueSubscription{
		ID:           s.ID,
		WorkspaceID:  s.WorkspaceID,
		IssueID:      s.IssueID,
		UserID:       s.UserID,
		Reason:       s.Reason,
		Unsubscribed: s.Unsubscribed,
		CreatedAt:    s.CreatedAt,
		UpdatedAt:    s.UpdatedAt,
	}
}
