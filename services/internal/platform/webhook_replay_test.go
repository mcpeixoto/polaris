package platform

import (
	"fmt"
	"sync"
	"testing"
	"time"
)

func TestReplayGuard_RefusesTheSameBodyTwice(t *testing.T) {
	t.Parallel()

	g := NewReplayGuard()
	now := time.Now()
	body := []byte(`{"action":"created","data":{"issue":{"web_url":"https://sentry.io/issues/1/"}}}`)
	key := WebhookDeliveryKey("sentry", "ws-1", body)

	if g.Seen(key, now) {
		t.Fatal("a delivery nobody has sent yet must not be a replay")
	}
	g.Record(key, now)
	if !g.Seen(key, now.Add(time.Hour)) {
		t.Error("a delivery already handled must be refused when it is posted again")
	}
}

// The whole point of keying on the body: it is the only part a signature covers.
//
// A replayer can set X-GitHub-Delivery, Request-ID and Sentry-Hook-Timestamp to anything at
// all, because none of them is inside the MAC. If the guard keyed on one of those, defeating
// it would be a matter of editing a header.
func TestReplayGuard_HeadersCannotDefeatIt(t *testing.T) {
	t.Parallel()

	g := NewReplayGuard()
	body := []byte(`{"object_kind":"merge_request"}`)
	first := WebhookDeliveryKey("gitlab", "ws-1", body)
	g.Record(first, time.Now())

	// Same bytes, an hour later, with whatever fresh timestamp the replayer likes: the key
	// is derived from the body alone, so it is the same key.
	if !g.Seen(WebhookDeliveryKey("gitlab", "ws-1", body), time.Now().Add(time.Hour)) {
		t.Error("the key must depend on the body only, so no header can change it")
	}
}

// Two workspaces receiving byte-identical payloads are two deliveries, not one.
func TestReplayGuard_ScopeKeepsWorkspacesApart(t *testing.T) {
	t.Parallel()

	g := NewReplayGuard()
	body := []byte(`{"object_kind":"push"}`)
	g.Record(WebhookDeliveryKey("gitlab", "ws-1", body), time.Now())

	if g.Seen(WebhookDeliveryKey("gitlab", "ws-2", body), time.Now()) {
		t.Error("another workspace's identical payload must not be dropped as a replay")
	}
	if g.Seen(WebhookDeliveryKey("github", "ws-1", body), time.Now()) {
		t.Error("another provider's identical payload must not be dropped as a replay")
	}
}

func TestReplayGuard_ForgetsAfterTheTTL(t *testing.T) {
	t.Parallel()

	g := NewReplayGuardWith(time.Minute, 0)
	now := time.Now()
	key := WebhookDeliveryKey("sentry", "ws-1", []byte("{}"))
	g.Record(key, now)

	if !g.Seen(key, now.Add(30*time.Second)) {
		t.Error("inside the window it is still a replay")
	}
	if g.Seen(key, now.Add(2*time.Minute)) {
		t.Error("past the window the entry must be forgotten rather than kept forever")
	}
}

// A delivery that failed is not a delivery that happened.
//
// Seen must not record, or a database blip during ingest would be remembered as success and
// the redelivery — the GitHub "Redeliver" button, pressed by somebody who watched the first
// one 500 — would be refused. A transient error would become permanent data loss.
func TestReplayGuard_SeenDoesNotRecord(t *testing.T) {
	t.Parallel()

	g := NewReplayGuard()
	now := time.Now()
	key := WebhookDeliveryKey("github", "app", []byte(`{"action":"opened"}`))

	if g.Seen(key, now) {
		t.Fatal("unexpectedly seen")
	}
	if g.Seen(key, now) {
		t.Error("Seen recorded the key; a failed delivery must stay replayable")
	}
}

// The map is bounded, and a flood cannot turn the guard into the outage.
func TestReplayGuard_EvictsOldestPastTheCap(t *testing.T) {
	t.Parallel()

	const max = 100
	g := NewReplayGuardWith(time.Hour, max)
	base := time.Now()
	for i := 0; i < max*2; i++ {
		g.Record(WebhookDeliveryKey("github", "app", []byte(fmt.Sprintf("%d", i))), base.Add(time.Duration(i)*time.Millisecond))
	}

	g.mu.Lock()
	held := len(g.seen)
	g.mu.Unlock()
	if held > max {
		t.Errorf("guard holds %d entries, cap is %d", held, max)
	}
	newest := WebhookDeliveryKey("github", "app", []byte(fmt.Sprintf("%d", max*2-1)))
	if !g.Seen(newest, base.Add(time.Duration(max*2)*time.Millisecond)) {
		t.Error("eviction must drop the oldest entries, not the newest")
	}
}

// Every inbound webhook route shares one guard, and they are served concurrently.
func TestReplayGuard_ConcurrentUse(t *testing.T) {
	t.Parallel()

	g := NewReplayGuard()
	now := time.Now()
	var wg sync.WaitGroup
	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			key := WebhookDeliveryKey("sentry", "ws-1", []byte(fmt.Sprintf("%d", i%7)))
			g.Seen(key, now)
			g.Record(key, now)
		}(i)
	}
	wg.Wait()
}

// A nil guard is a no-op rather than a panic.
//
// Every handler holds a *ReplayGuard, and a test or a future wiring path that builds one
// without it should lose the protection, not the process.
func TestReplayGuard_NilIsInert(t *testing.T) {
	t.Parallel()

	var g *ReplayGuard
	key := WebhookDeliveryKey("sentry", "ws-1", []byte("{}"))
	if g.Seen(key, time.Now()) {
		t.Error("a nil guard must report nothing seen")
	}
	g.Record(key, time.Now())
}
