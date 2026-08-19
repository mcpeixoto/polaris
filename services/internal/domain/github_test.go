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
