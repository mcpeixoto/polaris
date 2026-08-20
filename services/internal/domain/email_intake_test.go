package domain_test

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/testutil"
)

func TestUpdateTeamEmailIntake_MintsACopyableAddress(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	svc.PublicURL = "https://polaris.example"
	ctx := context.Background()
	p := f.Principal()

	team, _, err := svc.UpdateTeamEmailIntake(ctx, p, domain.UpdateTeamEmailIntakeInput{
		TeamID: f.TeamID, Enabled: true,
	})
	if err != nil {
		t.Fatalf("enable: %v", err)
	}
	if !team.EmailIntakeEnabled {
		t.Fatal("intake stayed off")
	}
	if team.EmailIntakeAddress == nil || !strings.HasSuffix(*team.EmailIntakeAddress, "@inbound.polaris.example") {
		t.Fatalf("address = %v", team.EmailIntakeAddress)
	}

	again, _, err := svc.UpdateTeamEmailIntake(ctx, p, domain.UpdateTeamEmailIntakeInput{
		TeamID: f.TeamID, Enabled: false,
	})
	if err != nil {
		t.Fatalf("disable: %v", err)
	}
	if again.EmailIntakeEnabled {
		t.Fatal("intake stayed on")
	}
	if again.EmailIntakeAddress != nil {
		t.Fatalf("disabled intake still exposed the address: %v", again.EmailIntakeAddress)
	}

	reenabled, _, err := svc.UpdateTeamEmailIntake(ctx, p, domain.UpdateTeamEmailIntakeInput{
		TeamID: f.TeamID, Enabled: true,
	})
	if err != nil {
		t.Fatalf("re-enable: %v", err)
	}
	if reenabled.EmailIntakeAddress == nil || *reenabled.EmailIntakeAddress != *team.EmailIntakeAddress {
		t.Fatalf("re-enable minted a new address: got %v want %v", reenabled.EmailIntakeAddress, team.EmailIntakeAddress)
	}
}

func TestIngestInboundEmail_CreatesAnIssueForTheTeamAddress(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	svc.PublicURL = "https://polaris.example"
	ctx := context.Background()
	p := f.Principal()

	team, _, err := svc.UpdateTeamEmailIntake(ctx, p, domain.UpdateTeamEmailIntakeInput{
		TeamID: f.TeamID, Enabled: true,
	})
	if err != nil {
		t.Fatal(err)
	}

	result, err := svc.IngestInboundEmail(ctx, domain.InboundEmail{
		To:        *team.EmailIntakeAddress,
		From:      "alice@example.com",
		Subject:   "Login is broken",
		Text:      "Cannot sign in on mobile.",
		MessageID: "<msg-1@example.com>",
	})
	if err != nil {
		t.Fatalf("ingest: %v", err)
	}
	if result.Ignored != "" || result.Issue == nil {
		t.Fatalf("result = %+v", result)
	}
	if result.Issue.Title != "Login is broken" {
		t.Fatalf("title = %q", result.Issue.Title)
	}
	if result.Issue.Description != "Cannot sign in on mobile." {
		t.Fatalf("body = %q", result.Issue.Description)
	}
	if result.Issue.CreatorID != nil {
		t.Fatalf("email issues are unattributed, got creator %v", result.Issue.CreatorID)
	}

	atts, err := svc.ListAttachments(ctx, p, result.Issue.ID)
	if err != nil {
		t.Fatalf("attachments: %v", err)
	}
	if len(atts) != 1 {
		t.Fatalf("want the original email as one attachment, got %d", len(atts))
	}

	again, err := svc.IngestInboundEmail(ctx, domain.InboundEmail{
		To:        *team.EmailIntakeAddress,
		From:      "alice@example.com",
		Subject:   "Login is broken",
		Text:      "Cannot sign in on mobile.",
		MessageID: "<msg-1@example.com>",
	})
	if err != nil {
		t.Fatalf("retry: %v", err)
	}
	if again.Issue == nil || again.Issue.ID != result.Issue.ID {
		t.Fatalf("retry minted a second issue: %+v", again)
	}
}

func TestIngestInboundEmail_IgnoresRepliesAndUnknownAddresses(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	svc.PublicURL = "https://polaris.example"
	ctx := context.Background()
	p := f.Principal()

	team, _, err := svc.UpdateTeamEmailIntake(ctx, p, domain.UpdateTeamEmailIntakeInput{
		TeamID: f.TeamID, Enabled: true,
	})
	if err != nil {
		t.Fatal(err)
	}

	reply, err := svc.IngestInboundEmail(ctx, domain.InboundEmail{
		To:        *team.EmailIntakeAddress,
		Subject:   "Re: Login is broken",
		Text:      "following up",
		InReplyTo: "<msg-1@example.com>",
	})
	if err != nil {
		t.Fatalf("reply: %v", err)
	}
	if reply.Ignored != "reply" {
		t.Fatalf("reply = %+v", reply)
	}

	unknown, err := svc.IngestInboundEmail(ctx, domain.InboundEmail{
		To:      "nobody@inbound.polaris.example",
		Subject: "Hello",
		Text:    "x",
	})
	if err != nil {
		t.Fatalf("unknown: %v", err)
	}
	if unknown.Ignored != "unknown-address" {
		t.Fatalf("unknown = %+v", unknown)
	}

	disabled, _, err := svc.UpdateTeamEmailIntake(ctx, p, domain.UpdateTeamEmailIntakeInput{
		TeamID: f.TeamID, Enabled: false,
	})
	if err != nil {
		t.Fatal(err)
	}
	if disabled.EmailIntakeAddress != nil {
		t.Fatal("disabled address still on the replica")
	}
	miss, err := svc.IngestInboundEmail(ctx, domain.InboundEmail{
		To:      *team.EmailIntakeAddress,
		Subject: "Still filing?",
		Text:    "should not land",
	})
	if err != nil {
		t.Fatalf("disabled: %v", err)
	}
	if miss.Ignored != "unknown-address" {
		t.Fatalf("disabled intake still created: %+v", miss)
	}
}

func TestIngestInboundEmail_TemplateAddressAppliesProperties(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	svc.PublicURL = "https://polaris.example"
	ctx := context.Background()
	p := f.Principal()

	props, _ := json.Marshal(map[string]any{"priority": 2})
	tpl, _, err := svc.CreateIssueTemplate(ctx, p, domain.CreateIssueTemplateInput{
		TeamID:     &f.TeamID,
		Name:       "Bug",
		Properties: props,
	})
	if err != nil {
		t.Fatalf("template: %v", err)
	}

	updated, _, err := svc.UpdateIssueTemplateEmailIntake(ctx, p, domain.UpdateIssueTemplateEmailIntakeInput{
		TemplateID: tpl.ID, Enabled: true,
	})
	if err != nil {
		t.Fatalf("enable template email: %v", err)
	}
	if updated.EmailIntakeAddress == nil {
		t.Fatal("no template address")
	}

	result, err := svc.IngestInboundEmail(ctx, domain.InboundEmail{
		To:      *updated.EmailIntakeAddress,
		From:    "bob@example.com",
		Subject: "Crash on save",
		Text:    "Steps: tap save.",
	})
	if err != nil {
		t.Fatalf("ingest: %v", err)
	}
	if result.Issue == nil {
		t.Fatalf("ignored: %+v", result)
	}
	if result.Issue.Title != "Crash on save" {
		t.Fatalf("title overwritten by template: %q", result.Issue.Title)
	}
	if result.Issue.Priority != 2 {
		t.Fatalf("priority = %d", result.Issue.Priority)
	}
	if result.Issue.TemplateID == nil || *result.Issue.TemplateID != tpl.ID {
		t.Fatalf("templateId = %v", result.Issue.TemplateID)
	}

	_, _, err = svc.UpdateIssueTemplateEmailIntake(ctx, p, domain.UpdateIssueTemplateEmailIntakeInput{
		TemplateID: tpl.ID, Enabled: false,
	})
	if err != nil {
		t.Fatal(err)
	}
}

func TestUpdateIssueTemplateEmailIntake_RefusesAWorkspaceTemplate(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	p := f.Principal()

	tpl, _, err := svc.CreateIssueTemplate(context.Background(), p, domain.CreateIssueTemplateInput{
		Name: "Workspace-wide",
	})
	if err != nil {
		t.Fatal(err)
	}
	_, _, err = svc.UpdateIssueTemplateEmailIntake(context.Background(), p, domain.UpdateIssueTemplateEmailIntakeInput{
		TemplateID: tpl.ID, Enabled: true,
	})
	if err == nil {
		t.Fatal("workspace template accepted an intake address")
	}
}

func TestIngestInboundEmail_LandsInTriageWhenTheTeamRunsIt(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	svc.PublicURL = "https://polaris.example"
	ctx := context.Background()
	p := f.Principal()

	enableTriage(t, svc, p, f.TeamID, false)
	team, _, err := svc.UpdateTeamEmailIntake(ctx, p, domain.UpdateTeamEmailIntakeInput{
		TeamID: f.TeamID, Enabled: true,
	})
	if err != nil {
		t.Fatal(err)
	}

	result, err := svc.IngestInboundEmail(ctx, domain.InboundEmail{
		To:      *team.EmailIntakeAddress,
		Subject: "From outside",
		Text:    "please look",
	})
	if err != nil {
		t.Fatalf("ingest: %v", err)
	}
	triage := stateByCategory(t, svc, p, f.TeamID, domain.CategoryTriage)
	if result.Issue.StateID != triage {
		t.Fatalf("state = %s, want triage %s", result.Issue.StateID, triage)
	}
}
