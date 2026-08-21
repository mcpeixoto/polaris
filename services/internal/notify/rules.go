// Package notify decides who is told what, from one change.
//
// It is pure policy over plain values, exactly like internal/authz and
// internal/entitlement, and for the same reason: the interesting part of a notification
// engine is not the writing of rows, it is the ladder of judgements above it — never the
// actor, one delivery per person per event, the most specific reason wins, an unsubscribe
// beats every reason there is. Every one of those is a product decision somebody will want
// to change, and none of them should need a database to test.
//
// It therefore imports no store and no domain: scripts/lint-imports.sh enforces the first
// and the import graph enforces the second, since internal/domain imports this package.
// The driver — domain/notifications.go — reads the change stream, gathers the facts these
// functions need, and writes what they return.
//
// The notification type strings come from internal/domain/model rather than being
// redeclared here. They are the values that reach notification.type in the database and
// the client's NotificationType union on the wire, and a second copy of them, living in the
// package that chooses between them, is precisely the kind of duplicate definition that
// drifts. model imports nothing of ours, so depending on it costs this package none of its
// independence.
package notify

import (
	"regexp"
	"strconv"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain/model"
)

// The ops are change_log.op's own values, constrained by change_log_op_check in migration
// 000010. Redeclared rather than imported from internal/domain because domain imports this
// package and the dependency cannot run both ways; the CHECK is what keeps the two honest.
const (
	OpUpsert = "upsert"
	OpDelete = "delete"
	OpRevoke = "revoke"
)

// The entity types this package needs to recognise by name, spelled as the emitter writes
// them onto change_log.entity_type. Every other type — teams, labels, views — reaches
// Deliveries with an empty Subject and produces nothing, so it needs no constant here.
const (
	EntityIssue        = "issue"
	EntityComment      = "comment"
	EntityRelation     = "issueRelation"
	EntityNotification = "notification"
)

// The fields a mutation can report having touched, as change_log.changed_fields carries
// them: database column names.
//
// Column names and not model field names, because the column name is the one identifier a
// field already has that is unique and survives a serialiser being rewritten. The mutation
// sites in internal/domain write these constants and the rules below match on them, so
// producer and consumer share one vocabulary and a typo is a compile error rather than a
// notification that silently stops arriving.
const (
	FieldAssignee    = "assignee_id"
	FieldState       = "state_id"
	FieldPriority    = "priority"
	FieldTitle       = "title"
	FieldDescription = "description"
	FieldParent      = "parent_id"
	FieldDueDate     = "due_date"
	FieldEstimate    = "estimate"
	FieldSortOrder   = "sort_order"
	// The order among a parent's children, which is its own sequence and moves
	// independently of sort_order. No rule below reacts to it — reordering a checklist is
	// not news — but it is still something a mutation set, and a changed-field list that
	// omits what nothing happens to notify on is a list nobody can trust for anything else.
	FieldSubIssueSortOrder = "sub_issue_sort_order"
	FieldArchived          = "archived_at"
	FieldDeleted           = "deleted_at"
	// Comments.
	FieldBody     = "body"
	FieldResolved = "resolved_at"
)

// PriorityUrgent is the only priority value the engine reacts to. The scale is fixed —
// 0 none, 1 urgent, 2 high, 3 medium, 4 low — and stated in schema/schema.graphql.
const PriorityUrgent = 1

// maxMentions caps how many people one piece of text can summon.
//
// A description naming two hundred people is not a mention, it is a broadcast, and the
// difference matters because a mention is the one notification that reaches somebody who
// never asked to hear about the issue at all. The cap is generous enough that no honest
// paragraph hits it and low enough that a paste of the company directory is not a fan-out.
const maxMentions = 50

// Event is one row of the change stream, reduced to what a delivery decision needs.
type Event struct {
	Version    int64
	EntityType string
	EntityID   uuid.UUID
	Op         string
	Actor      authz.Actor

	// ChangedFields is what the mutation set, by column name. Empty means a create —
	// everything is new. It is recorded by the mutation and never derived by comparing
	// payloads; see migration 000018.
	ChangedFields []string

	// BatchKey identifies the mutation when one mutation produced many changes, and is
	// empty when it produced one. It is what makes a bulk edit of two hundred issues one
	// inbox row per person carrying a count.
	BatchKey string
}

// Subject is what the change was about: facts gathered from the entities it names.
//
// Gathered, never compared. The driver reads the issue as it stands now and reports what it
// finds; what moved is Event.ChangedFields, which the mutation recorded. Nothing here is
// derived from an earlier copy of anything.
type Subject struct {
	IssueID    *uuid.UUID
	ParentID   *uuid.UUID
	AssigneeID *uuid.UUID
	// CommentID set is what makes this a comment event rather than an issue one.
	CommentID *uuid.UUID

	// Mentions is who the text names, in the order it names them.
	Mentions []uuid.UUID

	// Completed says the issue is now in a completed status. It is what turns a status
	// change on a child into "a sub-issue finished" on the parent.
	Completed bool

	// PriorityRaised says the issue is now Urgent.
	//
	// "Raised to urgent" and not "raised" in general, because that is the only priority
	// move the product notifies on — see the notification grouping in
	// docs/01-features/10-inbox-notifications-my-issues.md — and, conveniently, it is the
	// only one decidable from the row as it stands. Anything comparative would need the
	// previous value, which the change stream deliberately does not carry.
	PriorityRaised bool

	// BlockedIssueID is the issue a newly created `blocks` relation blocks. Only that
	// direction is stored: `issue_id blocks related_issue_id`, so this is the far end.
	BlockedIssueID *uuid.UUID
}

// Audience is who is listening, and what they have asked not to hear.
type Audience struct {
	// Subscribers are the people watching the issue who still want to hear. The query that
	// produces it is partial on unsubscribed = false, so an explicit unsubscribe is already
	// missing from this list.
	Subscribers []uuid.UUID
	// ParentSubscribers are the people watching the parent of a sub-issue.
	ParentSubscribers []uuid.UUID
	// BlockedSubscribers are the people watching the issue that just became blocked.
	BlockedSubscribers []uuid.UUID

	// Unsubscribed is who has explicitly said "not this issue".
	//
	// Needed separately from the lists above because those lists cannot tell "nobody
	// subscribed them" from "they said no", and the difference decides whether a mention
	// reaches somebody who has switched the issue off.
	Unsubscribed map[uuid.UUID]bool

	// Muted is what each person has switched off, by notification type.
	Muted map[uuid.UUID]map[string]bool
}

// Delivery is one inbox row to write.
type Delivery struct {
	UserID uuid.UUID
	Type   string
	// GroupKey is the coalescing key, and the unique index on (user_id, group_key) is what
	// makes writing it idempotent.
	GroupKey  string
	IssueID   *uuid.UUID
	CommentID *uuid.UUID
	// Payload is for rows that do not point at an issue — a project update, a customer
	// request with no issue yet. Issue-backed rows leave it empty: the inbox already
	// has the issue.
	Payload []byte
}

// precedence is the order one event's candidate deliveries are considered in, and the whole
// of the "one row per person per event" rule: the first reason a person appears under is
// the one they are told, and the rest are dropped.
//
// Most specific first, where specific means "how directly this is about you":
//
//	mention              somebody typed your name
//	issue_assigned       the work is now yours
//	issue_blocked        something you watch cannot move
//	comment              somebody said something
//	issue_priority_up    a property moved, and that property is urgency
//	issue_status_changed a property moved
//	sub_issue_completed  a property moved on something underneath what you watch
//
// Being mentioned in a comment on an issue you already watch is the case this exists for.
// Two rows there — "you were mentioned" and "there is a new comment" — is the same event
// told twice, and the inbox is the one screen where that is unforgivable.
//
// issue_due is deliberately absent. A due date arriving is not something anybody did, so it
// has no change row and never reaches this function; it comes from a scheduled sweep.
var precedence = []string{
	model.NotifyMention,
	model.NotifyIssueAssigned,
	model.NotifyIssueBlocked,
	model.NotifyComment,
	model.NotifyIssuePriorityUp,
	model.NotifyIssueStatusChanged,
	model.NotifySubIssueCompleted,
}

// Deliveries returns the inbox rows one change should produce, at most one per person.
//
// The three filters — never the actor, never somebody who unsubscribed, never a muted
// type — are applied as candidates are collected rather than to the result, and that
// ordering is load-bearing: somebody who mutes mentions but not comments should still hear
// about the comment they were mentioned in, which only works if the muted candidate never
// becomes the delivery in the first place.
func Deliveries(e Event, s Subject, a Audience) []Delivery {
	// A notification is an entity on the change stream like any other, so fanning one out
	// would produce a notification about a notification, whose change row would produce
	// another. This is not hypothetical: the engine emits a change for every inbox row it
	// writes and then reads its own output on the next pass.
	if e.EntityType == EntityNotification {
		return nil
	}

	// Deletes and revokes are the entity going away. There is nothing to tell somebody
	// about an issue they can no longer open, and a revoke carries no payload precisely
	// because the recipient is losing access — notifying them on the way out would hand
	// back a fragment of what was taken away.
	if e.Op != OpUpsert {
		return nil
	}

	byType := make(map[string][]Delivery, len(precedence))
	add := func(typ string, user uuid.UUID, issue, comment *uuid.UUID) {
		// Never the actor. This is the first thing a user notices about a notification
		// system, and being told about your own typing is how one stops being trusted.
		if e.Actor.ID != nil && *e.Actor.ID == user {
			return
		}
		// An explicit unsubscribe silences the issue completely, mentions and assignment
		// included. The button says "unsubscribe from this issue" and a back door for one
		// event type is a button that does not mean what it says. Work assigned to somebody
		// who has switched an issue off is still on their My Issues list, which is where
		// "what is mine" is answered.
		if a.Unsubscribed[user] {
			return
		}
		if a.Muted[user][typ] {
			return
		}
		byType[typ] = append(byType[typ], Delivery{
			UserID:    user,
			Type:      typ,
			GroupKey:  GroupKey(e, typ),
			IssueID:   issue,
			CommentID: comment,
		})
	}
	addAll := func(typ string, users []uuid.UUID, issue, comment *uuid.UUID) {
		for _, u := range users {
			add(typ, u, issue, comment)
		}
	}

	// An empty field list is a create: everything about the entity is new, so every rule
	// that asks "did this field move" is answered yes for all of them at once.
	created := len(e.ChangedFields) == 0

	// A mention fires when the text that names you was written or rewritten — a
	// description on an issue, a body on a comment.
	//
	// Rewriting therefore re-notifies people the text already named, and that is the
	// deliberate cost of not diffing: telling "newly mentioned" from "still mentioned"
	// needs the previous text, and reconstructing it downstream is the second definition of
	// what happened this milestone exists to avoid. One extra row per edit is a smaller
	// price than a mention that never arrives because a diff decided nothing changed.
	if created || touched(e, FieldDescription) || touched(e, FieldBody) {
		addAll(model.NotifyMention, s.Mentions, s.IssueID, s.CommentID)
	}

	// Being given the work. Not sent to subscribers: an assignment concerns the assignee,
	// and M1 acceptance test 3 says exactly one row exists for them and none for anybody
	// else.
	if s.AssigneeID != nil && (created || touched(e, FieldAssignee)) {
		add(model.NotifyIssueAssigned, *s.AssigneeID, s.IssueID, nil)
	}

	// A new `blocks` relation. The people who care are the ones watching the issue that
	// just stopped being able to move, so the row points at it rather than at the blocker.
	if s.BlockedIssueID != nil && created {
		addAll(model.NotifyIssueBlocked, a.BlockedSubscribers, s.BlockedIssueID, nil)
	}

	// A new comment, and only a new one: an edit carries FieldBody, which re-fires
	// mentions above but must not tell the whole thread that something was said again.
	if s.CommentID != nil && created {
		addAll(model.NotifyComment, a.Subscribers, s.IssueID, s.CommentID)
	}

	if s.PriorityRaised && (created || touched(e, FieldPriority)) {
		addAll(model.NotifyIssuePriorityUp, a.Subscribers, s.IssueID, nil)
	}

	if touched(e, FieldState) {
		addAll(model.NotifyIssueStatusChanged, a.Subscribers, s.IssueID, nil)
	}

	// A child finishing is progress on the parent, and it is reported against the parent.
	// Sub-issues may live in a team the parent's watchers cannot see, so a row pointing at
	// the child would open a 404 for exactly the people it was meant to inform.
	if s.ParentID != nil && s.Completed && touched(e, FieldState) {
		addAll(model.NotifySubIssueCompleted, a.ParentSubscribers, s.ParentID, nil)
	}

	out := make([]Delivery, 0, len(byType))
	seen := make(map[uuid.UUID]bool, len(byType))
	for _, typ := range precedence {
		for _, d := range byType[typ] {
			if seen[d.UserID] {
				continue
			}
			seen[d.UserID] = true
			out = append(out, d)
		}
	}
	return out
}

// GroupKey is the coalescing key: what the unique index on (user_id, group_key) collapses.
//
// A batch's key for a batch, so two hundred issues moved to Done in one action become one
// inbox row carrying a count of two hundred — M1 acceptance test 8, satisfied by the shape
// of the key rather than by a later optimisation. A single change has no batch and uses its
// version, which is already unique per workspace and therefore per recipient.
//
// The type is part of the key in both cases. Without it a bulk edit that both reassigns and
// re-statuses would fold "you were assigned nine issues" into the same row as "nine issues
// changed status", and the row would have to pick one of the two things to say.
func GroupKey(e Event, typ string) string {
	if e.BatchKey != "" {
		return e.BatchKey + ":" + typ
	}
	return "v" + strconv.FormatInt(e.Version, 10) + ":" + typ
}

func touched(e Event, field string) bool {
	for _, f := range e.ChangedFields {
		if f == field {
			return true
		}
	}
	return false
}

// ---------------------------------------------------------------------------------------
// Mentions.

// mentionPattern matches the stored form of an @mention: @[Display Name](user:<uuid>).
//
// The id is what is stored and the name is only what was typed, so a mention keeps working
// when somebody changes their display name, and a client that knows nothing about mentions
// still renders an ordinary markdown link rather than a broken token.
//
// Deliberately not a bare @name. Display names are neither unique nor stable, so resolving
// one at delivery time would notify whoever holds that name today rather than the person
// who was meant — and it would do it silently, weeks later.
var mentionPattern = regexp.MustCompile(
	`@\[[^\]]*\]\(user:([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\)`)

// ParseMentions returns the users a piece of text names, in the order it names them, with
// repeats removed and at most maxMentions of them.
//
// One definition of "who is named in this text", shared by the description path and the
// comment path. Two would eventually disagree about the same paragraph, and the symptom
// would be a mention that notifies from a comment and not from a description.
func ParseMentions(text string) []uuid.UUID {
	matches := mentionPattern.FindAllStringSubmatch(text, -1)
	if len(matches) == 0 {
		return nil
	}

	out := make([]uuid.UUID, 0, len(matches))
	seen := make(map[uuid.UUID]bool, len(matches))
	for _, m := range matches {
		id, err := uuid.Parse(m[1])
		if err != nil {
			// The pattern already constrains the shape, so this is a hex string that is not
			// a uuid. Skipping is the only sane answer: the text belongs to a person, not
			// to this package, and one malformed token must not cost the other mentions.
			continue
		}
		if seen[id] {
			continue
		}
		seen[id] = true
		out = append(out, id)
		if len(out) == maxMentions {
			break
		}
	}
	return out
}
