package slack

import "testing"

func TestTicketAsk(t *testing.T) {
	t.Parallel()
	title, body, ok := TicketAsk("🎫 The printer is on fire")
	if !ok || title != "The printer is on fire" || body != "" {
		t.Fatalf("title=%q body=%q ok=%v", title, body, ok)
	}
	title, body, ok = TicketAsk("🎫 Login\n\nSafari, twice.")
	if !ok || title != "Login" || body != "Safari, twice." {
		t.Fatalf("multiline: title=%q body=%q", title, body)
	}
	if _, _, ok := TicketAsk("please fix login"); ok {
		t.Fatal("a message without 🎫 is not an Ask")
	}
	title, _, ok = TicketAsk("🎫")
	if !ok || title != "Ask from Slack" {
		t.Fatalf("bare ticket: %q", title)
	}
}

func TestIsAsksCommand(t *testing.T) {
	t.Parallel()
	if !IsAsksCommand("/asks") || !IsAsksCommand("/ASK") {
		t.Fatal("the dedicated Asks slash must match")
	}
	if IsAsksCommand("/polaris") {
		t.Fatal("/polaris is parsed from its text, not as the Asks command")
	}
}
