package domain_test

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/testutil"
	"github.com/peixotolabs/polaris/services/internal/webhookout"
)

type slackSender struct {
	bodies []string
}

func (s *slackSender) Send(_ context.Context, dest webhookout.Destination) webhookout.Result {
	s.bodies = append(s.bodies, string(dest.Body))
	return webhookout.Result{Status: 200, Duration: time.Millisecond}
}

func TestFanOutSlack_PostsIssueEvents(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	url := "https://hooks.slack.com/services/T00000000/B00000000/xxxxxxxxxxxxxxxxxxxxxxxx"
	if _, _, err := svc.CreateSlackConnection(ctx, p, domain.CreateSlackConnectionInput{
		DefaultTeamID: f.TeamID,
		WebhookURL:    &url,
	}); err != nil {
		t.Fatalf("connect: %v", err)
	}

	issue, _, err := svc.CreateIssue(ctx, p, domain.CreateIssueInput{TeamID: f.TeamID, Title: "Notify me"})
	if err != nil {
		t.Fatalf("issue: %v", err)
	}

	sender := &slackSender{}
	n, err := svc.FanOutSlack(ctx, f.WorkspaceID, "https://polaris.example", sender)
	if err != nil {
		t.Fatalf("fan-out: %v", err)
	}
	if n == 0 {
		t.Fatal("expected at least one Slack post")
	}
	joined := strings.Join(sender.bodies, "\n")
	if !strings.Contains(joined, issue.Identifier) || !strings.Contains(joined, "Notify me") {
		t.Fatalf("payloads: %s", joined)
	}

	again, err := svc.FanOutSlack(ctx, f.WorkspaceID, "https://polaris.example", sender)
	if err != nil {
		t.Fatalf("second fan-out: %v", err)
	}
	if again != 0 {
		t.Fatalf("cursor must advance so a second pass posts nothing, got %d", again)
	}
}

var _ webhookout.Sender = (*slackSender)(nil)
