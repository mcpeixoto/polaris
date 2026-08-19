package domain_test

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"strings"
	"testing"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/testutil"
)

func TestCreateGitHubConnection_IsAdminOnlyAndLandsOnTheStream(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	memberID := f.NewUser(t, "sam", "member", true)
	member := f.PrincipalFor(memberID, authz.RoleMember, f.TeamID)
	if _, _, _, err := svc.CreateGitHubConnection(ctx, member, domain.CreateGitHubConnectionInput{}); err == nil {
		t.Fatal("a member must not enable GitHub for the workspace")
	}

	conn, secret, version, err := svc.CreateGitHubConnection(ctx, f.Principal(), domain.CreateGitHubConnectionInput{
		OrgLogin: ptr("acme"),
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if version == 0 {
		t.Fatal("the connection must land on the sync stream")
	}
	if conn.OrgLogin == nil || *conn.OrgLogin != "acme" {
		t.Fatalf("org: %+v", conn.OrgLogin)
	}
	if conn.BranchNameFormat != domain.DefaultGitBranchFormat {
		t.Fatalf("format: %q", conn.BranchNameFormat)
	}
	if secret == "" {
		t.Fatal("the commit-webhook secret is what an admin pastes into GitHub; it has to exist at create")
	}

	raw, _ := json.Marshal(conn)
	if strings.Contains(string(raw), secret) {
		t.Fatal("the sync payload must not carry the webhook secret")
	}
}

func TestLinkGitHubPullRequest_AttachesByMagicWordAndBranch(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	if _, _, _, err := svc.CreateGitHubConnection(ctx, p, domain.CreateGitHubConnectionInput{}); err != nil {
		t.Fatalf("connect: %v", err)
	}
	issue, _, err := svc.CreateIssue(ctx, p, domain.CreateIssueInput{TeamID: f.TeamID, Title: "Importer"})
	if err != nil {
		t.Fatalf("issue: %v", err)
	}

	links, version, err := svc.LinkGitHubPullRequest(ctx, p, domain.LinkGitHubPullRequestInput{
		URL:        "https://github.com/acme/app/pull/12",
		Title:      "Fixes ENG-1",
		Body:       "see description",
		BranchName: "feat/eng-1-importer",
	})
	if err != nil {
		t.Fatalf("link: %v", err)
	}
	if version == 0 {
		t.Fatal("the attachment must land on the sync stream")
	}
	if len(links) != 1 || links[0].IssueID != issue.ID {
		t.Fatalf("got %+v, want one card on ENG-1", links)
	}
	if !strings.Contains(links[0].URL, "/pull/12") {
		t.Fatalf("url: %s", links[0].URL)
	}

	again, _, err := svc.LinkGitHubPullRequest(ctx, p, domain.LinkGitHubPullRequestInput{
		URL:   "https://github.com/acme/app/pull/12",
		Title: "Fixes ENG-1",
	})
	if err != nil {
		t.Fatalf("relink: %v", err)
	}
	if len(again) != 1 || again[0].ID != links[0].ID {
		t.Fatalf("the same PR URL must update the existing card, got %+v", again)
	}
}

func TestLinkGitHubPullRequest_SkipStopsBranchAutoLink(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	if _, _, _, err := svc.CreateGitHubConnection(ctx, p, domain.CreateGitHubConnectionInput{}); err != nil {
		t.Fatalf("connect: %v", err)
	}
	if _, _, err := svc.CreateIssue(ctx, p, domain.CreateIssueInput{TeamID: f.TeamID, Title: "Noise"}); err != nil {
		t.Fatalf("issue: %v", err)
	}

	links, _, err := svc.LinkGitHubPullRequest(ctx, p, domain.LinkGitHubPullRequestInput{
		URL:        "https://github.com/acme/app/pull/99",
		Title:      "skip ENG-1",
		BranchName: "eng-1-accidentally",
	})
	if err != nil {
		t.Fatalf("link: %v", err)
	}
	if len(links) != 0 {
		t.Fatalf("skip must prevent the branch id from attaching, got %+v", links)
	}
}

func TestLinkGitHubPullRequest_AssignsUnassignedIssueToTheLinker(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	if _, _, _, err := svc.CreateGitHubConnection(ctx, p, domain.CreateGitHubConnectionInput{}); err != nil {
		t.Fatalf("connect: %v", err)
	}
	issue, _, err := svc.CreateIssue(ctx, p, domain.CreateIssueInput{TeamID: f.TeamID, Title: "Unowned"})
	if err != nil {
		t.Fatalf("issue: %v", err)
	}
	if issue.AssigneeID != nil {
		t.Fatal("the fixture issue starts unassigned")
	}

	if _, _, err := svc.LinkGitHubPullRequest(ctx, p, domain.LinkGitHubPullRequestInput{
		URL:   "https://github.com/acme/app/pull/3",
		Title: "Fixes ENG-1",
	}); err != nil {
		t.Fatalf("link: %v", err)
	}
	got, err := svc.GetIssue(ctx, p, issue.ID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.AssigneeID == nil || *got.AssigneeID != p.UserID {
		t.Fatalf("unassigned issue must take the linker, assignee=%v", got.AssigneeID)
	}
}

func TestIngestGitHubPush_RequiresMagicWordAndCommitLinking(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	if _, _, _, err := svc.CreateGitHubConnection(ctx, p, domain.CreateGitHubConnectionInput{}); err != nil {
		t.Fatalf("connect: %v", err)
	}
	issue, _, err := svc.CreateIssue(ctx, p, domain.CreateIssueInput{TeamID: f.TeamID, Title: "Commit me"})
	if err != nil {
		t.Fatalf("issue: %v", err)
	}

	off := false
	if _, _, err := svc.UpdateGitHubConnection(ctx, p, domain.UpdateGitHubConnectionInput{LinkCommits: &off}); err != nil {
		t.Fatalf("disable commits: %v", err)
	}
	if _, _, err := svc.IngestGitHubPush(ctx, f.WorkspaceID, domain.GitHubPushInput{
		Commits: []domain.GitHubCommitInput{{
			SHA: "abc123def", URL: "https://github.com/acme/app/commit/abc123def", Message: "fixes ENG-1",
		}},
	}); err != nil {
		t.Fatalf("ingest while disabled: %v", err)
	}
	listed, err := svc.ListAttachments(ctx, p, issue.ID)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(listed) != 0 {
		t.Fatal("commit linking is opt-in; a push must not attach until the extra webhook is enabled")
	}

	on := true
	if _, _, err := svc.UpdateGitHubConnection(ctx, p, domain.UpdateGitHubConnectionInput{LinkCommits: &on}); err != nil {
		t.Fatalf("enable commits: %v", err)
	}
	if _, _, err := svc.IngestGitHubPush(ctx, f.WorkspaceID, domain.GitHubPushInput{
		Commits: []domain.GitHubCommitInput{{
			SHA: "abc123def", URL: "https://github.com/acme/app/commit/abc123def", Message: "wip ENG-1",
		}},
	}); err != nil {
		t.Fatalf("ingest without word: %v", err)
	}
	listed, err = svc.ListAttachments(ctx, p, issue.ID)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(listed) != 0 {
		t.Fatal("a commit message without a magic word must not link")
	}

	if _, _, err := svc.IngestGitHubPush(ctx, f.WorkspaceID, domain.GitHubPushInput{
		Commits: []domain.GitHubCommitInput{{
			SHA: "abc123def", URL: "https://github.com/acme/app/commit/abc123def", Message: "fixes ENG-1",
		}},
	}); err != nil {
		t.Fatalf("ingest: %v", err)
	}
	listed, err = svc.ListAttachments(ctx, p, issue.ID)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(listed) != 1 {
		t.Fatalf("want one commit card, got %d", len(listed))
	}
}

func TestLinkGitHubPullRequest_TeamNEWCreatesAnIssue(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	if _, _, _, err := svc.CreateGitHubConnection(ctx, p, domain.CreateGitHubConnectionInput{}); err != nil {
		t.Fatalf("connect: %v", err)
	}

	links, _, err := svc.LinkGitHubPullRequest(ctx, p, domain.LinkGitHubPullRequestInput{
		URL:   "https://github.com/acme/app/pull/8",
		Title: "A brand new thing",
		Body:  "ENG-NEW",
	})
	if err != nil {
		t.Fatalf("link: %v", err)
	}
	if len(links) != 1 {
		t.Fatalf("want one new issue linked, got %+v", links)
	}
	created, err := svc.GetIssue(ctx, p, links[0].IssueID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if created.Title != "A brand new thing" {
		t.Fatalf("title: %q", created.Title)
	}
	if created.StateID != f.InProgress {
		t.Fatalf("TEAM-NEW must land in Started, state=%s want %s", created.StateID, f.InProgress)
	}
}

func TestVerifyGitHubCommitWebhook_RejectsABadHMAC(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	_, secret, _, err := svc.CreateGitHubConnection(ctx, f.Principal(), domain.CreateGitHubConnectionInput{})
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	body := []byte(`{"ref":"refs/heads/main"}`)
	if err := svc.VerifyGitHubCommitWebhook(ctx, f.WorkspaceID, body, "sha256=deadbeef"); err == nil {
		t.Fatal("a wrong digest must be refused")
	}

	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write(body)
	header := "sha256=" + hex.EncodeToString(mac.Sum(nil))
	if err := svc.VerifyGitHubCommitWebhook(ctx, f.WorkspaceID, body, header); err != nil {
		t.Fatalf("a correctly signed body must verify: %v", err)
	}
}

func TestLinkGitHubPullRequest_OpenedMovesIssueToStarted(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	if _, _, _, err := svc.CreateGitHubConnection(ctx, p, domain.CreateGitHubConnectionInput{}); err != nil {
		t.Fatalf("connect: %v", err)
	}
	issue, _, err := svc.CreateIssue(ctx, p, domain.CreateIssueInput{TeamID: f.TeamID, Title: "Importer"})
	if err != nil {
		t.Fatalf("issue: %v", err)
	}
	if issue.StateID != f.Todo && issue.StateID != f.Backlog {
		t.Fatalf("fixture issues start unstarted, got %s", issue.StateID)
	}

	if _, _, err := svc.LinkGitHubPullRequest(ctx, p, domain.LinkGitHubPullRequestInput{
		URL:   "https://github.com/acme/app/pull/12",
		Title: "Fixes ENG-1",
	}); err != nil {
		t.Fatalf("link: %v", err)
	}
	got, err := svc.GetIssue(ctx, p, issue.ID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.StateID != f.InProgress {
		t.Fatalf("an opened PR must move the issue to Started, state=%s want %s", got.StateID, f.InProgress)
	}
}

func TestIngestGitHubPullRequest_MergedClosingWordCompletesWhenEveryPRIsMerged(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	if _, _, _, err := svc.CreateGitHubConnection(ctx, p, domain.CreateGitHubConnectionInput{}); err != nil {
		t.Fatalf("connect: %v", err)
	}
	issue, _, err := svc.CreateIssue(ctx, p, domain.CreateIssueInput{TeamID: f.TeamID, Title: "Importer"})
	if err != nil {
		t.Fatalf("issue: %v", err)
	}

	if _, _, err := svc.IngestGitHubPullRequest(ctx, f.WorkspaceID, domain.LinkGitHubPullRequestInput{
		URL: "https://github.com/acme/app/pull/12", Title: "Fixes ENG-1",
	}); err != nil {
		t.Fatalf("open first: %v", err)
	}
	if _, _, err := svc.IngestGitHubPullRequest(ctx, f.WorkspaceID, domain.LinkGitHubPullRequestInput{
		URL: "https://github.com/acme/app/pull/13", Title: "Fixes ENG-1",
	}); err != nil {
		t.Fatalf("open second: %v", err)
	}
	if _, _, err := svc.IngestGitHubPullRequest(ctx, f.WorkspaceID, domain.LinkGitHubPullRequestInput{
		URL: "https://github.com/acme/app/pull/12", Title: "Fixes ENG-1", Merged: true,
	}); err != nil {
		t.Fatalf("merge first: %v", err)
	}
	mid, err := svc.GetIssue(ctx, p, issue.ID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if mid.StateID == f.Done {
		t.Fatal("Done must wait until every linked PR has merged")
	}

	if _, _, err := svc.IngestGitHubPullRequest(ctx, f.WorkspaceID, domain.LinkGitHubPullRequestInput{
		URL: "https://github.com/acme/app/pull/13", Title: "Fixes ENG-1", Merged: true,
	}); err != nil {
		t.Fatalf("merge second: %v", err)
	}
	got, err := svc.GetIssue(ctx, p, issue.ID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.StateID != f.Done {
		t.Fatalf("the last merged closing PR must complete the issue, state=%s", got.StateID)
	}
}

func TestIngestGitHubPullRequest_MergedRelationDoesNotComplete(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	if _, _, _, err := svc.CreateGitHubConnection(ctx, p, domain.CreateGitHubConnectionInput{}); err != nil {
		t.Fatalf("connect: %v", err)
	}
	issue, _, err := svc.CreateIssue(ctx, p, domain.CreateIssueInput{TeamID: f.TeamID, Title: "Related"})
	if err != nil {
		t.Fatalf("issue: %v", err)
	}

	if _, _, err := svc.IngestGitHubPullRequest(ctx, f.WorkspaceID, domain.LinkGitHubPullRequestInput{
		URL: "https://github.com/acme/app/pull/4", Title: "relates to ENG-1", Merged: true,
	}); err != nil {
		t.Fatalf("ingest: %v", err)
	}
	got, err := svc.GetIssue(ctx, p, issue.ID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.StateID == f.Done {
		t.Fatal("a relation word must never apply the merge status")
	}
}

func TestIngestGitHubPush_DefaultBranchClosingWordCompletes(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	on := true
	if _, _, _, err := svc.CreateGitHubConnection(ctx, p, domain.CreateGitHubConnectionInput{LinkCommits: &on}); err != nil {
		t.Fatalf("connect: %v", err)
	}
	issue, _, err := svc.CreateIssue(ctx, p, domain.CreateIssueInput{TeamID: f.TeamID, Title: "Commit me"})
	if err != nil {
		t.Fatalf("issue: %v", err)
	}

	if _, _, err := svc.IngestGitHubPush(ctx, f.WorkspaceID, domain.GitHubPushInput{
		Commits: []domain.GitHubCommitInput{{
			SHA: "abc123def", URL: "https://github.com/acme/app/commit/abc123def",
			Message: "fixes ENG-1",
		}},
	}); err != nil {
		t.Fatalf("feature branch: %v", err)
	}
	mid, err := svc.GetIssue(ctx, p, issue.ID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if mid.StateID != f.InProgress {
		t.Fatalf("a commit on a feature branch must start the issue, state=%s", mid.StateID)
	}

	if _, _, err := svc.IngestGitHubPush(ctx, f.WorkspaceID, domain.GitHubPushInput{
		Commits: []domain.GitHubCommitInput{{
			SHA: "abc123def", URL: "https://github.com/acme/app/commit/abc123def",
			Message: "fixes ENG-1", OnDefaultBranch: true,
		}},
	}); err != nil {
		t.Fatalf("default branch: %v", err)
	}
	got, err := svc.GetIssue(ctx, p, issue.ID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.StateID != f.Done {
		t.Fatalf("a closing commit on the default branch must complete the issue, state=%s", got.StateID)
	}
}

type recordingPoster struct {
	comments []domain.GitHubComment
}

func (r *recordingPoster) Post(_ context.Context, _ string, c domain.GitHubComment) error {
	r.comments = append(r.comments, c)
	return nil
}

func TestGitHubLinkback_PostedOnFirstPRLink(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	svc.PublicURL = "https://polaris.example"
	poster := &recordingPoster{}
	svc.SetGitHubCommentPoster(poster)
	ctx := context.Background()
	p := f.Principal()

	if _, _, _, err := svc.CreateGitHubConnection(ctx, p, domain.CreateGitHubConnectionInput{}); err != nil {
		t.Fatalf("connect: %v", err)
	}
	if _, _, err := svc.CreateIssue(ctx, p, domain.CreateIssueInput{TeamID: f.TeamID, Title: "Importer"}); err != nil {
		t.Fatalf("issue: %v", err)
	}

	if _, _, err := svc.LinkGitHubPullRequest(ctx, p, domain.LinkGitHubPullRequestInput{
		URL: "https://github.com/acme/app/pull/12", Title: "Fixes ENG-1",
	}); err != nil {
		t.Fatalf("link: %v", err)
	}
	if len(poster.comments) != 1 {
		t.Fatalf("want one linkback, got %d", len(poster.comments))
	}
	c := poster.comments[0]
	if c.Repo != "acme/app" || c.Number != 12 {
		t.Fatalf("comment target: %+v", c)
	}
	if !strings.Contains(c.Body, "ENG-1: Importer") || !strings.Contains(c.Body, "/issue/ENG-1") {
		t.Fatalf("public linkback must name the issue, got %q", c.Body)
	}

	if _, _, err := svc.LinkGitHubPullRequest(ctx, p, domain.LinkGitHubPullRequestInput{
		URL: "https://github.com/acme/app/pull/12", Title: "Fixes ENG-1",
	}); err != nil {
		t.Fatalf("relink: %v", err)
	}
	if len(poster.comments) != 1 {
		t.Fatalf("a second event for the same card must not comment again, got %d", len(poster.comments))
	}
}

func TestGitHubLinkback_SkippedWhenDisabled(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	poster := &recordingPoster{}
	svc.SetGitHubCommentPoster(poster)
	ctx := context.Background()
	p := f.Principal()

	off := false
	if _, _, _, err := svc.CreateGitHubConnection(ctx, p, domain.CreateGitHubConnectionInput{Linkbacks: &off}); err != nil {
		t.Fatalf("connect: %v", err)
	}
	if _, _, err := svc.CreateIssue(ctx, p, domain.CreateIssueInput{TeamID: f.TeamID, Title: "Quiet"}); err != nil {
		t.Fatalf("issue: %v", err)
	}
	if _, _, err := svc.LinkGitHubPullRequest(ctx, p, domain.LinkGitHubPullRequestInput{
		URL: "https://github.com/acme/app/pull/1", Title: "Fixes ENG-1",
	}); err != nil {
		t.Fatalf("link: %v", err)
	}
	if len(poster.comments) != 0 {
		t.Fatalf("disabled linkbacks must not post, got %+v", poster.comments)
	}
}

func TestGitHubLinkback_PrivateTeamIsLinkOnly(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	svc.PublicURL = "https://polaris.example"
	poster := &recordingPoster{}
	svc.SetGitHubCommentPoster(poster)
	ctx := context.Background()
	p := f.Principal()

	if _, _, _, err := svc.CreateGitHubConnection(ctx, p, domain.CreateGitHubConnectionInput{}); err != nil {
		t.Fatalf("connect: %v", err)
	}
	priv := true
	if _, _, err := svc.UpdateTeam(ctx, p, domain.UpdateTeamInput{ID: f.TeamID, Private: &priv}); err != nil {
		t.Fatalf("private: %v", err)
	}
	if _, _, err := svc.CreateIssue(ctx, p, domain.CreateIssueInput{TeamID: f.TeamID, Title: "Secret work"}); err != nil {
		t.Fatalf("issue: %v", err)
	}
	if _, _, err := svc.LinkGitHubPullRequest(ctx, p, domain.LinkGitHubPullRequestInput{
		URL: "https://github.com/acme/app/pull/9", Title: "Fixes ENG-1",
	}); err != nil {
		t.Fatalf("link: %v", err)
	}
	if len(poster.comments) != 1 {
		t.Fatalf("want one linkback, got %d", len(poster.comments))
	}
	if strings.Contains(poster.comments[0].Body, "Secret work") {
		t.Fatalf("a private team must not leak the title onto GitHub, got %q", poster.comments[0].Body)
	}
	if !strings.Contains(poster.comments[0].Body, "/issue/ENG-1") {
		t.Fatalf("private linkback is still the URL, got %q", poster.comments[0].Body)
	}
}

func TestGetGitHubTeamAutomation_UnconfiguredUsesNoRow(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	got, err := svc.GetGitHubTeamAutomation(ctx, f.Principal(), f.TeamID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.Configured {
		t.Fatal("a team with no mapping row is unconfigured, so the defaults still apply")
	}
	if got.OpenedStateID != nil || got.MergedStateID != nil {
		t.Fatalf("unconfigured mappings must be empty, got %+v", got)
	}
}

func TestUpdateGitHubTeamAutomation_OpenedMappingOverridesDefault(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	if _, _, _, err := svc.CreateGitHubConnection(ctx, p, domain.CreateGitHubConnectionInput{}); err != nil {
		t.Fatalf("connect: %v", err)
	}
	if _, err := svc.UpdateGitHubTeamAutomation(ctx, p, domain.UpdateGitHubTeamAutomationInput{
		TeamID:        f.TeamID,
		OpenedStateID: &f.Todo,
	}); err != nil {
		t.Fatalf("map: %v", err)
	}
	issue, _, err := svc.CreateIssue(ctx, p, domain.CreateIssueInput{TeamID: f.TeamID, Title: "Importer"})
	if err != nil {
		t.Fatalf("issue: %v", err)
	}
	if _, _, err := svc.LinkGitHubPullRequest(ctx, p, domain.LinkGitHubPullRequestInput{
		URL: "https://github.com/acme/app/pull/12", Title: "Fixes ENG-1",
	}); err != nil {
		t.Fatalf("link: %v", err)
	}
	got, err := svc.GetIssue(ctx, p, issue.ID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.StateID != f.Todo {
		t.Fatalf("opened mapping must beat the Started default, state=%s want %s", got.StateID, f.Todo)
	}
}

func TestUpdateGitHubTeamAutomation_NullOpenedDisablesDefault(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	if _, _, _, err := svc.CreateGitHubConnection(ctx, p, domain.CreateGitHubConnectionInput{}); err != nil {
		t.Fatalf("connect: %v", err)
	}
	if _, err := svc.UpdateGitHubTeamAutomation(ctx, p, domain.UpdateGitHubTeamAutomationInput{TeamID: f.TeamID}); err != nil {
		t.Fatalf("map: %v", err)
	}
	issue, _, err := svc.CreateIssue(ctx, p, domain.CreateIssueInput{TeamID: f.TeamID, Title: "Importer"})
	if err != nil {
		t.Fatalf("issue: %v", err)
	}
	start := issue.StateID
	if _, _, err := svc.LinkGitHubPullRequest(ctx, p, domain.LinkGitHubPullRequestInput{
		URL: "https://github.com/acme/app/pull/12", Title: "Fixes ENG-1",
	}); err != nil {
		t.Fatalf("link: %v", err)
	}
	got, err := svc.GetIssue(ctx, p, issue.ID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.StateID != start {
		t.Fatalf("a configured row with a null opened mapping is no action, state=%s", got.StateID)
	}
}

func TestUpdateGitHubTeamAutomation_DraftedAndReviewAndReadyForMerge(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	if _, _, _, err := svc.CreateGitHubConnection(ctx, p, domain.CreateGitHubConnectionInput{}); err != nil {
		t.Fatalf("connect: %v", err)
	}
	review, _, err := svc.CreateWorkflowState(ctx, p, domain.CreateWorkflowStateInput{
		TeamID: f.TeamID, Name: "In Review", Category: domain.CategoryStarted, Color: "#f2c94c",
	})
	if err != nil {
		t.Fatalf("review status: %v", err)
	}
	ready, _, err := svc.CreateWorkflowState(ctx, p, domain.CreateWorkflowStateInput{
		TeamID: f.TeamID, Name: "Ready", Category: domain.CategoryStarted, Color: "#4cb782",
	})
	if err != nil {
		t.Fatalf("ready status: %v", err)
	}
	if _, err := svc.UpdateGitHubTeamAutomation(ctx, p, domain.UpdateGitHubTeamAutomationInput{
		TeamID:                 f.TeamID,
		DraftedStateID:         &f.Backlog,
		ReviewRequestedStateID: &review.ID,
		ReadyForMergeStateID:   &ready.ID,
	}); err != nil {
		t.Fatalf("map: %v", err)
	}

	draftIssue, _, err := svc.CreateIssue(ctx, p, domain.CreateIssueInput{TeamID: f.TeamID, Title: "Draft me"})
	if err != nil {
		t.Fatalf("issue: %v", err)
	}
	if _, _, err := svc.LinkGitHubPullRequest(ctx, p, domain.LinkGitHubPullRequestInput{
		URL: "https://github.com/acme/app/pull/21", Title: "Fixes ENG-1", Draft: true,
	}); err != nil {
		t.Fatalf("draft: %v", err)
	}
	got, err := svc.GetIssue(ctx, p, draftIssue.ID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.StateID != f.Backlog {
		t.Fatalf("drafted mapping must move the issue, state=%s want %s", got.StateID, f.Backlog)
	}

	reviewIssue, _, err := svc.CreateIssue(ctx, p, domain.CreateIssueInput{TeamID: f.TeamID, Title: "Review me"})
	if err != nil {
		t.Fatalf("issue: %v", err)
	}
	if _, _, err := svc.LinkGitHubPullRequest(ctx, p, domain.LinkGitHubPullRequestInput{
		URL: "https://github.com/acme/app/pull/22", Title: "Fixes ENG-2", ReviewRequested: true,
	}); err != nil {
		t.Fatalf("review: %v", err)
	}
	got, err = svc.GetIssue(ctx, p, reviewIssue.ID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.StateID != review.ID {
		t.Fatalf("review-requested mapping must move the issue, state=%s want %s", got.StateID, review.ID)
	}

	readyIssue, _, err := svc.CreateIssue(ctx, p, domain.CreateIssueInput{TeamID: f.TeamID, Title: "Ready me"})
	if err != nil {
		t.Fatalf("issue: %v", err)
	}
	if _, _, err := svc.LinkGitHubPullRequest(ctx, p, domain.LinkGitHubPullRequestInput{
		URL: "https://github.com/acme/app/pull/23", Title: "Fixes ENG-3", MergeableState: "clean",
	}); err != nil {
		t.Fatalf("ready: %v", err)
	}
	got, err = svc.GetIssue(ctx, p, readyIssue.ID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.StateID != ready.ID {
		t.Fatalf("ready-for-merge mapping must move the issue, state=%s want %s", got.StateID, ready.ID)
	}
}

func TestUpdateGitHubTeamAutomation_MergedUsesMappedStatusWhenEveryPRMerged(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	if _, _, _, err := svc.CreateGitHubConnection(ctx, p, domain.CreateGitHubConnectionInput{}); err != nil {
		t.Fatalf("connect: %v", err)
	}
	shipped, _, err := svc.CreateWorkflowState(ctx, p, domain.CreateWorkflowStateInput{
		TeamID: f.TeamID, Name: "Shipped", Category: domain.CategoryCompleted, Color: "#5e6ad2",
	})
	if err != nil {
		t.Fatalf("status: %v", err)
	}
	if _, err := svc.UpdateGitHubTeamAutomation(ctx, p, domain.UpdateGitHubTeamAutomationInput{
		TeamID:        f.TeamID,
		MergedStateID: &shipped.ID,
	}); err != nil {
		t.Fatalf("map: %v", err)
	}
	issue, _, err := svc.CreateIssue(ctx, p, domain.CreateIssueInput{TeamID: f.TeamID, Title: "Importer"})
	if err != nil {
		t.Fatalf("issue: %v", err)
	}
	if _, _, err := svc.IngestGitHubPullRequest(ctx, f.WorkspaceID, domain.LinkGitHubPullRequestInput{
		URL: "https://github.com/acme/app/pull/12", Title: "Fixes ENG-1", Merged: true,
	}); err != nil {
		t.Fatalf("merge: %v", err)
	}
	got, err := svc.GetIssue(ctx, p, issue.ID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.StateID != shipped.ID {
		t.Fatalf("merged mapping must land on the chosen status, state=%s want %s", got.StateID, shipped.ID)
	}
}

func TestUpdateGitHubTeamAutomation_MemberCannotWrite(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	memberID := f.NewUser(t, "sam", "member", true)
	member := f.PrincipalFor(memberID, authz.RoleMember, f.TeamID)
	if _, err := svc.UpdateGitHubTeamAutomation(ctx, member, domain.UpdateGitHubTeamAutomationInput{
		TeamID:        f.TeamID,
		OpenedStateID: &f.Todo,
	}); err == nil {
		t.Fatal("a member must not write GitHub status mappings; that is team.update")
	}

	got, err := svc.GetGitHubTeamAutomation(ctx, member, f.TeamID)
	if err != nil {
		t.Fatalf("members can still read the mappings: %v", err)
	}
	if got.Configured {
		t.Fatal("the refused write must not have persisted")
	}
}

func TestUpdateGitHubTeamAutomation_RejectsAStatusFromAnotherTeam(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	other, _, err := svc.CreateTeam(ctx, p, domain.CreateTeamInput{Key: "DES", Name: "Design"})
	if err != nil {
		t.Fatalf("team: %v", err)
	}
	states, err := f.DB.Queries().ListWorkflowStatesForTeam(ctx, other.ID)
	if err != nil {
		t.Fatalf("states: %v", err)
	}
	if len(states) == 0 {
		t.Fatal("a new team must seed statuses")
	}
	if _, err := svc.UpdateGitHubTeamAutomation(ctx, p, domain.UpdateGitHubTeamAutomationInput{
		TeamID:        f.TeamID,
		OpenedStateID: &states[0].ID,
	}); err == nil {
		t.Fatal("a mapping must not point at another team's status")
	}
}

func TestDeleteGitHubTeamAutomation_RestoresDefaults(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	if _, _, _, err := svc.CreateGitHubConnection(ctx, p, domain.CreateGitHubConnectionInput{}); err != nil {
		t.Fatalf("connect: %v", err)
	}
	if _, err := svc.UpdateGitHubTeamAutomation(ctx, p, domain.UpdateGitHubTeamAutomationInput{TeamID: f.TeamID}); err != nil {
		t.Fatalf("map: %v", err)
	}
	if _, err := svc.DeleteGitHubTeamAutomation(ctx, p, f.TeamID); err != nil {
		t.Fatalf("delete: %v", err)
	}
	got, err := svc.GetGitHubTeamAutomation(ctx, p, f.TeamID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.Configured {
		t.Fatal("deleting the row must restore the product defaults")
	}

	issue, _, err := svc.CreateIssue(ctx, p, domain.CreateIssueInput{TeamID: f.TeamID, Title: "Importer"})
	if err != nil {
		t.Fatalf("issue: %v", err)
	}
	if _, _, err := svc.LinkGitHubPullRequest(ctx, p, domain.LinkGitHubPullRequestInput{
		URL: "https://github.com/acme/app/pull/12", Title: "Fixes ENG-1",
	}); err != nil {
		t.Fatalf("link: %v", err)
	}
	moved, err := svc.GetIssue(ctx, p, issue.ID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if moved.StateID != f.InProgress {
		t.Fatalf("defaults must apply again, state=%s want %s", moved.StateID, f.InProgress)
	}
}
