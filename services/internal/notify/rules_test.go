package notify_test

import (
	"fmt"
	"testing"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/notify"
)

// These tests need no database, and that is the reason the package exists. Every judgement
// below is one somebody will want to argue about — whether an unsubscribe beats a mention,
// whether being assigned outranks being mentioned — and an argument settled in a test that
// takes a millisecond is one that gets settled.

var (
	alice = uuid.MustParse("00000000-0000-7000-8000-00000000a11c")
	bob   = uuid.MustParse("00000000-0000-7000-8000-00000000b0b0")
	carol = uuid.MustParse("00000000-0000-7000-8000-00000000ca01")

	issueID   = uuid.MustParse("00000000-0000-7000-8000-000000001111")
	parentID  = uuid.MustParse("00000000-0000-7000-8000-000000002222")
	commentID = uuid.MustParse("00000000-0000-7000-8000-000000003333")
	blockedID = uuid.MustParse("00000000-0000-7000-8000-000000004444")
)

// issueEvent is an update by alice that touched the named fields.
func issueEvent(fields ...string) notify.Event {
	return notify.Event{
		Version:       7,
		EntityType:    notify.EntityIssue,
		EntityID:      issueID,
		Op:            notify.OpUpsert,
		Actor:         authz.UserActor(alice),
		ChangedFields: fields,
	}
}

func typesFor(t *testing.T, ds []notify.Delivery, user uuid.UUID) []string {
	t.Helper()
	var out []string
	for _, d := range ds {
		if d.UserID == user {
			out = append(out, d.Type)
		}
	}
	return out
}

func TestDeliveries_NeverNotifiesTheActor(t *testing.T) {
	// Alice changes the status of an issue she is watching, and mentions herself in the
	// description while she is at it. Being told about your own typing is the first thing
	// anybody notices about a notification system, and the fastest way to have it muted.
	ds := notify.Deliveries(
		issueEvent(notify.FieldState, notify.FieldDescription),
		notify.Subject{IssueID: &issueID, Mentions: []uuid.UUID{alice, bob}},
		notify.Audience{Subscribers: []uuid.UUID{alice, bob}},
	)

	if got := typesFor(t, ds, alice); len(got) != 0 {
		t.Fatalf("the actor was notified about their own change: %v", got)
	}
	if len(ds) != 1 || ds[0].UserID != bob {
		t.Fatalf("expected exactly one delivery, to bob; got %+v", ds)
	}
}

func TestDeliveries_OneRowPerPersonPerEvent(t *testing.T) {
	// Bob is mentioned in a comment on an issue he already watches. Two rows here — "you
	// were mentioned" and "there is a new comment" — is the same event told twice, on the
	// one screen where that is unforgivable.
	ds := notify.Deliveries(
		notify.Event{
			Version: 12, EntityType: notify.EntityComment, EntityID: commentID,
			Op: notify.OpUpsert, Actor: authz.UserActor(alice),
		},
		notify.Subject{IssueID: &issueID, CommentID: &commentID, Mentions: []uuid.UUID{bob}},
		notify.Audience{Subscribers: []uuid.UUID{bob, carol}},
	)

	got := typesFor(t, ds, bob)
	if len(got) != 1 {
		t.Fatalf("bob got %d deliveries for one event: %v", len(got), got)
	}
	// The more specific reason wins: he was named, not merely present.
	if got[0] != model.NotifyMention {
		t.Errorf("expected the mention to outrank the comment, got %q", got[0])
	}
	if types := typesFor(t, ds, carol); len(types) != 1 || types[0] != model.NotifyComment {
		t.Errorf("carol, who only watches the issue, should get the comment: %v", types)
	}
}

func TestDeliveries_AssignmentReachesOnlyTheAssignee(t *testing.T) {
	// M1 acceptance test 3, at the level of the rule. An assignment concerns the person it
	// lands on; the rest of the watchers find out by looking at the issue.
	ds := notify.Deliveries(
		issueEvent(notify.FieldAssignee),
		notify.Subject{IssueID: &issueID, AssigneeID: &bob},
		notify.Audience{Subscribers: []uuid.UUID{alice, carol}},
	)

	if len(ds) != 1 {
		t.Fatalf("expected exactly one delivery, got %+v", ds)
	}
	if ds[0].UserID != bob || ds[0].Type != model.NotifyIssueAssigned {
		t.Fatalf("expected an assignment for bob, got %+v", ds[0])
	}
}

func TestDeliveries_EditingAnAssignedIssueIsNotAnAssignment(t *testing.T) {
	// The distinction changed_fields exists for. Without it, every edit of an issue that
	// happens to have an assignee would tell them they had just been given it.
	ds := notify.Deliveries(
		issueEvent(notify.FieldTitle),
		notify.Subject{IssueID: &issueID, AssigneeID: &bob},
		notify.Audience{Subscribers: []uuid.UUID{bob}},
	)

	if len(ds) != 0 {
		t.Fatalf("a title edit produced %+v", ds)
	}
}

func TestDeliveries_CreateNotifiesTheAssigneeAndTheMentioned(t *testing.T) {
	// An empty field list is a create: everything is new, so every "did this move" question
	// is answered yes at once.
	ds := notify.Deliveries(
		issueEvent(),
		notify.Subject{IssueID: &issueID, AssigneeID: &bob, Mentions: []uuid.UUID{carol}},
		notify.Audience{},
	)

	if len(ds) != 2 {
		t.Fatalf("expected two deliveries, got %+v", ds)
	}
	if types := typesFor(t, ds, bob); len(types) != 1 || types[0] != model.NotifyIssueAssigned {
		t.Errorf("the assignee of a new issue should be told: %v", types)
	}
	if types := typesFor(t, ds, carol); len(types) != 1 || types[0] != model.NotifyMention {
		t.Errorf("somebody named in a new issue should be told: %v", types)
	}
}

func TestDeliveries_AnUnsubscribeBeatsEveryReason(t *testing.T) {
	// The button says "unsubscribe from this issue". A back door for mentions is a button
	// that works until the next person types your name — the single most commonly
	// rediscovered bug in notification systems, arriving one layer up from the schema that
	// already guards against it.
	ds := notify.Deliveries(
		notify.Event{
			Version: 3, EntityType: notify.EntityComment, EntityID: commentID,
			Op: notify.OpUpsert, Actor: authz.UserActor(alice),
		},
		notify.Subject{IssueID: &issueID, CommentID: &commentID, Mentions: []uuid.UUID{bob}},
		notify.Audience{Unsubscribed: map[uuid.UUID]bool{bob: true}},
	)

	if len(ds) != 0 {
		t.Fatalf("an unsubscribed user was notified: %+v", ds)
	}
}

func TestDeliveries_MutedTypeFallsThroughToTheNextReason(t *testing.T) {
	// Muting is per type, and the ladder has to be able to fall through it. Somebody who
	// has switched mentions off but not comments still wants the comment they were named
	// in — which only works because the muted candidate never becomes the delivery.
	ds := notify.Deliveries(
		notify.Event{
			Version: 4, EntityType: notify.EntityComment, EntityID: commentID,
			Op: notify.OpUpsert, Actor: authz.UserActor(alice),
		},
		notify.Subject{IssueID: &issueID, CommentID: &commentID, Mentions: []uuid.UUID{bob}},
		notify.Audience{
			Subscribers: []uuid.UUID{bob},
			Muted:       map[uuid.UUID]map[string]bool{bob: {model.NotifyMention: true}},
		},
	)

	if len(ds) != 1 || ds[0].Type != model.NotifyComment {
		t.Fatalf("expected the comment to survive a muted mention, got %+v", ds)
	}
}

func TestDeliveries_SkipsItsOwnEntity(t *testing.T) {
	// A notification is an entity on the change stream like any other, and the engine emits
	// a change for every inbox row it writes. Without this the second pass notifies people
	// about being notified, and the third about that.
	ds := notify.Deliveries(
		notify.Event{
			Version: 99, EntityType: notify.EntityNotification, EntityID: uuid.New(),
			Op: notify.OpUpsert, Actor: authz.SystemActor(),
		},
		notify.Subject{IssueID: &issueID, Mentions: []uuid.UUID{bob}},
		notify.Audience{Subscribers: []uuid.UUID{bob, carol}},
	)

	if len(ds) != 0 {
		t.Fatalf("a notification about a notification: %+v", ds)
	}
}

func TestDeliveries_DeletionsTellNobody(t *testing.T) {
	ds := notify.Deliveries(
		notify.Event{
			Version: 5, EntityType: notify.EntityIssue, EntityID: issueID,
			Op: notify.OpDelete, Actor: authz.UserActor(alice),
			ChangedFields: []string{notify.FieldDeleted},
		},
		notify.Subject{IssueID: &issueID, AssigneeID: &bob},
		notify.Audience{Subscribers: []uuid.UUID{bob, carol}},
	)

	if len(ds) != 0 {
		t.Fatalf("a delete produced deliveries: %+v", ds)
	}
}

func TestDeliveries_SubIssueCompletionIsReportedAgainstTheParent(t *testing.T) {
	// Sub-issues may live in a team the parent's watchers cannot see, so a row pointing at
	// the child would open a 404 for exactly the people it was meant to inform.
	ds := notify.Deliveries(
		issueEvent(notify.FieldState),
		notify.Subject{IssueID: &issueID, ParentID: &parentID, Completed: true},
		notify.Audience{ParentSubscribers: []uuid.UUID{carol}},
	)

	if len(ds) != 1 {
		t.Fatalf("expected one delivery, got %+v", ds)
	}
	if ds[0].Type != model.NotifySubIssueCompleted {
		t.Fatalf("expected sub_issue_completed, got %q", ds[0].Type)
	}
	if ds[0].IssueID == nil || *ds[0].IssueID != parentID {
		t.Errorf("the row must point at the parent, got %v", ds[0].IssueID)
	}
}

func TestDeliveries_BlockingTellsTheBlockedIssuesWatchers(t *testing.T) {
	ds := notify.Deliveries(
		notify.Event{
			Version: 8, EntityType: notify.EntityRelation, EntityID: uuid.New(),
			Op: notify.OpUpsert, Actor: authz.UserActor(alice),
		},
		notify.Subject{IssueID: &issueID, BlockedIssueID: &blockedID},
		notify.Audience{BlockedSubscribers: []uuid.UUID{bob}},
	)

	if len(ds) != 1 || ds[0].Type != model.NotifyIssueBlocked {
		t.Fatalf("expected one issue_blocked delivery, got %+v", ds)
	}
	if ds[0].IssueID == nil || *ds[0].IssueID != blockedID {
		t.Errorf("the row must point at the issue that stopped moving, got %v", ds[0].IssueID)
	}
}

func TestDeliveries_PriorityOnlyNotifiesWhenItReachesUrgent(t *testing.T) {
	// Lowering a priority is not news. Only the move to Urgent is, which is also the only
	// one decidable from the row as it stands — the change stream carries no previous value
	// and is not going to grow one for this.
	lowered := notify.Deliveries(
		issueEvent(notify.FieldPriority),
		notify.Subject{IssueID: &issueID, PriorityRaised: false},
		notify.Audience{Subscribers: []uuid.UUID{bob}},
	)
	if len(lowered) != 0 {
		t.Fatalf("a priority change away from urgent notified somebody: %+v", lowered)
	}

	raised := notify.Deliveries(
		issueEvent(notify.FieldPriority),
		notify.Subject{IssueID: &issueID, PriorityRaised: true},
		notify.Audience{Subscribers: []uuid.UUID{bob}},
	)
	if len(raised) != 1 || raised[0].Type != model.NotifyIssuePriorityUp {
		t.Fatalf("expected one issue_priority_raised, got %+v", raised)
	}
}

func TestGroupKey_CoalescesABatchAndSeparatesTheTypes(t *testing.T) {
	batch := notify.Event{Version: 41, BatchKey: "b40"}
	single := notify.Event{Version: 41}

	// Every issue in one bulk edit shares a key, which is what collapses two hundred rows
	// into one carrying a count — M1 acceptance test 8, satisfied by the key's shape.
	other := notify.Event{Version: 55, BatchKey: "b40"}
	if notify.GroupKey(batch, model.NotifyIssueStatusChanged) != notify.GroupKey(other, model.NotifyIssueStatusChanged) {
		t.Error("two changes in one batch must share a group key")
	}
	// A single change is its own batch of one, keyed by a version that is unique per
	// workspace.
	if notify.GroupKey(single, model.NotifyIssueStatusChanged) == notify.GroupKey(batch, model.NotifyIssueStatusChanged) {
		t.Error("a change outside a batch must not share the batch's key")
	}
	// The type is part of both, or a bulk edit that reassigns and re-statuses would fold
	// two different sentences into one row that has to pick one of them to say.
	if notify.GroupKey(batch, model.NotifyIssueAssigned) == notify.GroupKey(batch, model.NotifyIssueStatusChanged) {
		t.Error("two notification types in one batch must not share a group key")
	}
}

func TestDeliveries_EveryProducibleTypeIsRanked(t *testing.T) {
	// The precedence ladder decides which of a person's candidate deliveries survives, so a
	// type missing from it would be dropped silently rather than delivered — a
	// notification that never arrives and that nobody reports, because there is nothing to
	// report. This is the test that fails when a new type is added and not ranked.
	produced := map[string]bool{}
	for _, ds := range [][]notify.Delivery{
		notify.Deliveries(issueEvent(), notify.Subject{IssueID: &issueID, AssigneeID: &bob, Mentions: []uuid.UUID{carol}}, notify.Audience{}),
		notify.Deliveries(issueEvent(notify.FieldState), notify.Subject{IssueID: &issueID}, notify.Audience{Subscribers: []uuid.UUID{bob}}),
		notify.Deliveries(issueEvent(notify.FieldPriority), notify.Subject{IssueID: &issueID, PriorityRaised: true}, notify.Audience{Subscribers: []uuid.UUID{bob}}),
		notify.Deliveries(issueEvent(notify.FieldState), notify.Subject{IssueID: &issueID, ParentID: &parentID, Completed: true}, notify.Audience{ParentSubscribers: []uuid.UUID{bob}}),
		notify.Deliveries(
			notify.Event{Version: 1, EntityType: notify.EntityComment, Op: notify.OpUpsert, Actor: authz.UserActor(alice)},
			notify.Subject{IssueID: &issueID, CommentID: &commentID}, notify.Audience{Subscribers: []uuid.UUID{bob}}),
		notify.Deliveries(
			notify.Event{Version: 1, EntityType: notify.EntityRelation, Op: notify.OpUpsert, Actor: authz.UserActor(alice)},
			notify.Subject{IssueID: &issueID, BlockedIssueID: &blockedID}, notify.Audience{BlockedSubscribers: []uuid.UUID{bob}}),
	} {
		for _, d := range ds {
			produced[d.Type] = true
		}
	}

	want := []string{
		model.NotifyMention, model.NotifyIssueAssigned, model.NotifyIssueBlocked,
		model.NotifyComment, model.NotifyIssuePriorityUp, model.NotifyIssueStatusChanged,
		model.NotifySubIssueCompleted,
	}
	for _, typ := range want {
		if !produced[typ] {
			t.Errorf("no event in this test produces %q — the ladder is untested for it", typ)
		}
		delete(produced, typ)
	}
	if len(produced) != 0 {
		t.Errorf("Deliveries produced types nothing here ranks: %v", produced)
	}
}

func TestParseMentions(t *testing.T) {
	body := fmt.Sprintf(
		"morning @[Bob](user:%s) — see also @[Carol Smith](user:%s), and @[Bob again](user:%s). "+
			"Not a mention: @bob, user:%s, @[Nobody](user:not-a-uuid).",
		bob, carol, bob, alice)

	got := notify.ParseMentions(body)
	if len(got) != 2 || got[0] != bob || got[1] != carol {
		t.Fatalf("expected bob then carol, once each; got %v", got)
	}

	// A bare @name is deliberately not a mention: display names are neither unique nor
	// stable, so resolving one at delivery time notifies whoever holds the name today.
	if len(notify.ParseMentions("@bob please look")) != 0 {
		t.Error("a bare @name must not resolve to anybody")
	}
}

func TestParseMentions_IsBounded(t *testing.T) {
	// A description naming two hundred people is a broadcast, not a mention, and a mention
	// is the one notification that reaches somebody who never asked to hear about the
	// issue at all.
	var body string
	for range 300 {
		body += fmt.Sprintf("@[X](user:%s) ", uuid.Must(uuid.NewV7()))
	}
	if n := len(notify.ParseMentions(body)); n == 0 || n > 50 {
		t.Fatalf("expected a bounded, non-empty list, got %d", n)
	}
}
