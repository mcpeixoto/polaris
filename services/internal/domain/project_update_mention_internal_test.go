package domain

import (
	"testing"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/store"
)

// A mention in a project update has no issue, and neither channel may call it one.
func TestProjectUpdateMentionWording(t *testing.T) {
	payload := []byte(`{"projectId":"` + uuid.NewString() + `"}`)
	if got := describePushEvent(model.NotifyMention, "", 1, payload); got != "mentioned you in a project update" {
		t.Fatalf("push said %q", got)
	}
	if got := describePushEvent(model.NotifyMention, "ENG-1", 1, nil); got != "mentioned you in ENG-1" {
		t.Fatalf("push said %q for an issue mention", got)
	}

	item := itemFor(store.ClaimNotificationsForEmailRow{Type: model.NotifyMention, Count: 1}, "https://x/inbox", "https://x")
	if item.Title != "a project update" {
		t.Fatalf("digest titled it %q", item.Title)
	}
}
