package domain_test

import (
	"context"
	"encoding/json"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/testutil"
	"github.com/peixotolabs/polaris/services/internal/webhookout"
)

func TestCreateWebhook_SecretExistsInTheCreateResponseAndNowhereInTheListing(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	hook, secret, _, err := svc.CreateWebhook(ctx, f.Principal(), domain.CreateWebhookInput{
		URL:            "https://hooks.example.com/polaris",
		AllPublicTeams: true,
		ResourceTypes:  []string{"Issue"},
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if !strings.HasPrefix(secret, "whsec_") {
		t.Fatalf("secret %q is not marked as a webhook secret", secret)
	}
	listed, err := svc.ListWebhooks(ctx, f.Principal())
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(listed) != 1 || listed[0].ID != hook.ID {
		t.Fatalf("list = %+v", listed)
	}
	raw, _ := json.Marshal(listed[0])
	if strings.Contains(string(raw), secret) {
		t.Fatal("the listing serialised the signing secret")
	}
}

func TestCreateWebhook_AMemberCannotMintOne(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	member := f.PrincipalFor(f.NewUser(t, "sam", "member", true), authz.RoleMember, f.TeamID)

	_, _, _, err := svc.CreateWebhook(ctx, member, domain.CreateWebhookInput{
		URL:            "https://hooks.example.com/polaris",
		AllPublicTeams: true,
		ResourceTypes:  []string{"Issue"},
	})
	if platform.CodeOf(err) != platform.CodeForbidden {
		t.Fatalf("code = %s, want FORBIDDEN", platform.CodeOf(err))
	}
}

func TestCreateWebhook_RefusesHTTPAndLoopback(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	_, _, _, err := svc.CreateWebhook(ctx, p, domain.CreateWebhookInput{
		URL: "http://hooks.example.com/x", AllPublicTeams: true, ResourceTypes: []string{"Issue"},
	})
	if platform.CodeOf(err) != platform.CodeValidation {
		t.Fatalf("http: %v", err)
	}
	_, _, _, err = svc.CreateWebhook(ctx, p, domain.CreateWebhookInput{
		URL: "https://127.0.0.1/x", AllPublicTeams: true, ResourceTypes: []string{"Issue"},
	})
	if platform.CodeOf(err) != platform.CodeValidation {
		t.Fatalf("loopback: %v", err)
	}
}

func TestFanOutWebhooks_DoesNotReplayHistoryIntoANewURL(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	if _, _, err := svc.CreateIssue(ctx, p, domain.CreateIssueInput{TeamID: f.TeamID, Title: "Already happened"}); err != nil {
		t.Fatalf("issue: %v", err)
	}
	if _, _, _, err := svc.CreateWebhook(ctx, p, domain.CreateWebhookInput{
		URL: "https://hooks.example.com/polaris", AllPublicTeams: true, ResourceTypes: []string{"Issue"},
	}); err != nil {
		t.Fatalf("webhook: %v", err)
	}

	n, err := svc.FanOutWebhooks(ctx, f.WorkspaceID, "https://app.example")
	if err != nil {
		t.Fatalf("fanout: %v", err)
	}
	if n != 0 {
		t.Fatalf("queued %d deliveries for history that predated the webhook", n)
	}
}

func TestFanOutWebhooks_QueuesANewIssueAndSkipsAPrivateTeam(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	if _, _, _, err := svc.CreateWebhook(ctx, p, domain.CreateWebhookInput{
		URL: "https://hooks.example.com/polaris", AllPublicTeams: true, ResourceTypes: []string{"Issue"},
	}); err != nil {
		t.Fatalf("webhook: %v", err)
	}

	if _, _, err := svc.CreateIssue(ctx, p, domain.CreateIssueInput{TeamID: f.TeamID, Title: "Public"}); err != nil {
		t.Fatalf("public issue: %v", err)
	}
	n, err := svc.FanOutWebhooks(ctx, f.WorkspaceID, "https://app.example")
	if err != nil {
		t.Fatalf("fanout public: %v", err)
	}
	if n != 1 {
		t.Fatalf("queued %d, want 1 public issue", n)
	}

	priv, _, err := svc.CreateTeam(ctx, p, domain.CreateTeamInput{Key: "SEC", Name: "Security", Private: true})
	if err != nil {
		t.Fatalf("private team: %v", err)
	}
	if _, _, err := svc.CreateIssue(ctx, p, domain.CreateIssueInput{TeamID: priv.ID, Title: "Secret"}); err != nil {
		t.Fatalf("private issue: %v", err)
	}
	n, err = svc.FanOutWebhooks(ctx, f.WorkspaceID, "https://app.example")
	if err != nil {
		t.Fatalf("fanout private: %v", err)
	}
	if n != 0 {
		t.Fatalf("queued %d deliveries for a private-team issue onto an allPublicTeams webhook", n)
	}
}

func TestDeliverDueWebhooks_RetriesThenDisables(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	hook, secret, _, err := svc.CreateWebhook(ctx, p, domain.CreateWebhookInput{
		URL: "https://hooks.example.com/polaris", AllPublicTeams: true, ResourceTypes: []string{"Issue"},
	})
	if err != nil {
		t.Fatalf("webhook: %v", err)
	}
	if _, _, err := svc.CreateIssue(ctx, p, domain.CreateIssueInput{TeamID: f.TeamID, Title: "Ping"}); err != nil {
		t.Fatalf("issue: %v", err)
	}
	if _, err := svc.FanOutWebhooks(ctx, f.WorkspaceID, "https://app.example"); err != nil {
		t.Fatalf("fanout: %v", err)
	}

	sender := &scriptedSender{status: 500}
	now := time.Now()
	for i := 0; i < 4; i++ {
		if _, err := svc.DeliverDueWebhooks(ctx, sender, now); err != nil {
			t.Fatalf("attempt %d: %v", i+1, err)
		}
		now = now.Add(7 * time.Hour)
	}
	if sender.calls != 4 {
		t.Fatalf("POSTs = %d, want 4 (first plus three retries)", sender.calls)
	}
	if sender.lastSecret != secret {
		t.Fatal("retries must sign with the stored secret")
	}

	listed, err := svc.ListWebhooks(ctx, p)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(listed) != 1 || listed[0].ID != hook.ID || listed[0].Enabled {
		t.Fatalf("after exhausting retries the webhook must be disabled; got %+v", listed)
	}
}

func TestDeliverDueWebhooks_A200ClearsTheRow(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	if _, _, _, err := svc.CreateWebhook(ctx, p, domain.CreateWebhookInput{
		URL: "https://hooks.example.com/polaris", AllPublicTeams: true, ResourceTypes: []string{"Issue"},
	}); err != nil {
		t.Fatalf("webhook: %v", err)
	}
	issue, _, err := svc.CreateIssue(ctx, p, domain.CreateIssueInput{TeamID: f.TeamID, Title: "Ping"})
	if err != nil {
		t.Fatalf("issue: %v", err)
	}
	if _, err := svc.FanOutWebhooks(ctx, f.WorkspaceID, "https://app.example"); err != nil {
		t.Fatalf("fanout: %v", err)
	}

	sender := &scriptedSender{status: 200}
	n, err := svc.DeliverDueWebhooks(ctx, sender, time.Now())
	if err != nil {
		t.Fatalf("deliver: %v", err)
	}
	if n != 1 {
		t.Fatalf("delivered %d, want 1", n)
	}
	if !strings.Contains(string(sender.lastBody), issue.Identifier) {
		t.Fatalf("payload did not carry the issue: %s", sender.lastBody)
	}
	n, err = svc.DeliverDueWebhooks(ctx, sender, time.Now())
	if err != nil {
		t.Fatalf("second pass: %v", err)
	}
	if n != 0 {
		t.Fatal("a delivered row must not be posted again")
	}
}

type scriptedSender struct {
	mu         sync.Mutex
	status     int
	calls      int
	lastBody   []byte
	lastSecret string
}

func (s *scriptedSender) Send(_ context.Context, dest webhookout.Destination) webhookout.Result {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.calls++
	s.lastBody = append([]byte(nil), dest.Body...)
	s.lastSecret = dest.Secret
	return webhookout.Result{Status: s.status, Duration: time.Millisecond}
}

var _ webhookout.Sender = (*scriptedSender)(nil)

func TestCreateWebhook_TeamXOR(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()
	tid := f.TeamID

	_, _, _, err := svc.CreateWebhook(ctx, p, domain.CreateWebhookInput{
		URL: "https://hooks.example.com/x", AllPublicTeams: true, TeamID: &tid, ResourceTypes: []string{"Issue"},
	})
	if platform.CodeOf(err) != platform.CodeValidation {
		t.Fatalf("both: %v", err)
	}
	_, _, _, err = svc.CreateWebhook(ctx, p, domain.CreateWebhookInput{
		URL: "https://hooks.example.com/x", ResourceTypes: []string{"Issue"},
	})
	if platform.CodeOf(err) != platform.CodeValidation {
		t.Fatalf("neither: %v", err)
	}
}
