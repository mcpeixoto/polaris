package domain_test

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain"
	slackin "github.com/peixotolabs/polaris/services/internal/integrations/slack"
	"github.com/peixotolabs/polaris/services/internal/testutil"
)

func TestCreateSlackConnection_IsAdminOnlyAndLandsOnTheStream(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	memberID := f.NewUser(t, "sam", "member", true)
	member := f.PrincipalFor(memberID, authz.RoleMember, f.TeamID)
	if _, _, err := svc.CreateSlackConnection(ctx, member, domain.CreateSlackConnectionInput{DefaultTeamID: f.TeamID}); err == nil {
		t.Fatal("a member must not enable Slack for the workspace")
	}

	conn, version, err := svc.CreateSlackConnection(ctx, f.Principal(), domain.CreateSlackConnectionInput{
		DefaultTeamID: f.TeamID,
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if version == 0 {
		t.Fatal("the connection must land on the sync stream")
	}
	if conn.DefaultTeamID != f.TeamID {
		t.Fatalf("team: %s", conn.DefaultTeamID)
	}
	if !conn.NotifyIssues || !conn.NotifyComments {
		t.Fatal("notify flags default on")
	}

	raw, _ := json.Marshal(conn)
	if strings.Contains(string(raw), "hooks.slack.com") {
		t.Fatal("the sync payload must not carry the webhook URL")
	}
}

func TestCreateSlackConnection_RefusesAPrivateTeam(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	priv, _, err := svc.CreateTeam(ctx, p, domain.CreateTeamInput{Key: "SEC", Name: "Security", Private: true})
	if err != nil {
		t.Fatalf("private team: %v", err)
	}
	if _, _, err := svc.CreateSlackConnection(ctx, p, domain.CreateSlackConnectionInput{DefaultTeamID: priv.ID}); err == nil {
		t.Fatal("Slack must not target a private team")
	}
}

func TestHandleSlackSlash_CreatesAndComments(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	if _, _, err := svc.CreateSlackConnection(ctx, p, domain.CreateSlackConnectionInput{DefaultTeamID: f.TeamID}); err != nil {
		t.Fatalf("connect: %v", err)
	}

	created, err := svc.HandleSlackSlash(ctx, f.WorkspaceID, slackin.Slash{
		Text: "create Login is broken", UserName: "ada", ChannelName: "eng",
	}, "https://polaris.example")
	if err != nil {
		t.Fatalf("create slash: %v", err)
	}
	if !strings.Contains(created.Text, "created") {
		t.Fatalf("create reply: %s", created.Text)
	}

	issue, _, err := svc.CreateIssue(ctx, p, domain.CreateIssueInput{TeamID: f.TeamID, Title: "Already there"})
	if err != nil {
		t.Fatalf("seed issue: %v", err)
	}

	commented, err := svc.HandleSlackSlash(ctx, f.WorkspaceID, slackin.Slash{
		Text: "comment " + issue.Identifier + " looks good", UserName: "ada", ChannelName: "eng",
	}, "https://polaris.example")
	if err != nil {
		t.Fatalf("comment slash: %v", err)
	}
	if !strings.Contains(commented.Text, "Commented") {
		t.Fatalf("comment reply: %s", commented.Text)
	}

	shown, err := svc.HandleSlackSlash(ctx, f.WorkspaceID, slackin.Slash{Text: issue.Identifier}, "https://polaris.example")
	if err != nil {
		t.Fatalf("show: %v", err)
	}
	if !strings.Contains(shown.Text, issue.Title) {
		t.Fatalf("show reply: %s", shown.Text)
	}
}

func TestSlackUnfurls_IssueURL(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()
	if _, _, err := svc.CreateSlackConnection(ctx, p, domain.CreateSlackConnectionInput{DefaultTeamID: f.TeamID}); err != nil {
		t.Fatalf("connect: %v", err)
	}
	issue, _, err := svc.CreateIssue(ctx, p, domain.CreateIssueInput{TeamID: f.TeamID, Title: "Unfurl me"})
	if err != nil {
		t.Fatalf("issue: %v", err)
	}
	url := "https://polaris.example/issue/" + issue.Identifier
	cards, err := svc.SlackUnfurls(ctx, f.WorkspaceID, []string{url}, "https://polaris.example")
	if err != nil {
		t.Fatalf("unfurl: %v", err)
	}
	card, ok := cards[url]
	if !ok {
		t.Fatalf("missing card: %+v", cards)
	}
	if !strings.Contains(card.Title, issue.Identifier) || !strings.Contains(card.Title, "Unfurl me") {
		t.Fatalf("card: %+v", card)
	}
}

func TestHandleSlackSlash_MagicPhraseIsALinkbackNotACreate(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()
	if _, _, err := svc.CreateSlackConnection(ctx, p, domain.CreateSlackConnectionInput{DefaultTeamID: f.TeamID}); err != nil {
		t.Fatalf("connect: %v", err)
	}
	issue, _, err := svc.CreateIssue(ctx, p, domain.CreateIssueInput{TeamID: f.TeamID, Title: "Linked"})
	if err != nil {
		t.Fatalf("issue: %v", err)
	}
	before, err := svc.ListIssuesForTeam(ctx, p, f.TeamID)
	if err != nil {
		t.Fatalf("list before: %v", err)
	}
	reply, err := svc.HandleSlackSlash(ctx, f.WorkspaceID, slackin.Slash{
		Text: "fixes " + issue.Identifier, UserName: "ada", ChannelName: "eng",
	}, "https://polaris.example")
	if err != nil {
		t.Fatalf("slash: %v", err)
	}
	if !strings.Contains(reply.Text, "Linked") {
		t.Fatalf("reply: %s", reply.Text)
	}
	after, err := svc.ListIssuesForTeam(ctx, p, f.TeamID)
	if err != nil {
		t.Fatalf("list after: %v", err)
	}
	if len(after) != len(before) {
		t.Fatalf("slash must not create an issue from a magic phrase, got %d then %d", len(before), len(after))
	}
}

func TestHandleSlackMessage_MagicWordLinkback(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()
	if _, _, err := svc.CreateSlackConnection(ctx, p, domain.CreateSlackConnectionInput{DefaultTeamID: f.TeamID}); err != nil {
		t.Fatalf("connect: %v", err)
	}
	issue, _, err := svc.CreateIssue(ctx, p, domain.CreateIssueInput{TeamID: f.TeamID, Title: "Linked"})
	if err != nil {
		t.Fatalf("issue: %v", err)
	}
	if err := svc.HandleSlackMessage(ctx, f.WorkspaceID, slackin.Event{
		Text: "fixes " + issue.Identifier + " in prod", User: "U1", Channel: "C1",
	}); err != nil {
		t.Fatalf("message: %v", err)
	}
	comments, err := svc.ListComments(ctx, p, issue.ID)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	found := false
	for _, c := range comments {
		if strings.Contains(c.Body, "Mentioned in Slack") {
			found = true
		}
	}
	if !found {
		t.Fatalf("expected a Slack linkback comment, got %+v", comments)
	}
}
