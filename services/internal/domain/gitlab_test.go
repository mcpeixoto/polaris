package domain_test

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/testutil"
)

func TestCreateGitLabConnection_IsAdminOnlyAndLandsOnTheStream(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	memberID := f.NewUser(t, "sam", "member", true)
	member := f.PrincipalFor(memberID, authz.RoleMember, f.TeamID)
	if _, _, _, err := svc.CreateGitLabConnection(ctx, member, domain.CreateGitLabConnectionInput{}); err == nil {
		t.Fatal("a member must not enable GitLab for the workspace")
	}

	conn, secret, version, err := svc.CreateGitLabConnection(ctx, f.Principal(), domain.CreateGitLabConnectionInput{})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if version == 0 {
		t.Fatal("the connection must land on the sync stream")
	}
	if conn.InstanceURL != domain.DefaultGitLabInstanceURL {
		t.Fatalf("instance: %q", conn.InstanceURL)
	}
	if conn.BranchNameFormat != domain.DefaultGitBranchFormat {
		t.Fatalf("format: %q", conn.BranchNameFormat)
	}
	if secret == "" {
		t.Fatal("the webhook token is what an admin pastes into GitLab; it has to exist at create")
	}

	raw, _ := json.Marshal(conn)
	if strings.Contains(string(raw), secret) {
		t.Fatal("the sync payload must not carry the webhook secret")
	}
}

func TestLinkGitLabMergeRequest_AttachesByMagicWordAndBranch(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	if _, _, _, err := svc.CreateGitLabConnection(ctx, p, domain.CreateGitLabConnectionInput{}); err != nil {
		t.Fatalf("connect: %v", err)
	}
	issue, _, err := svc.CreateIssue(ctx, p, domain.CreateIssueInput{TeamID: f.TeamID, Title: "Importer"})
	if err != nil {
		t.Fatalf("issue: %v", err)
	}

	links, version, err := svc.LinkGitLabMergeRequest(ctx, p, domain.LinkGitLabMergeRequestInput{
		URL:        "https://gitlab.com/acme/app/-/merge_requests/12",
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
	if !strings.Contains(links[0].URL, "/-/merge_requests/12") {
		t.Fatalf("url: %s", links[0].URL)
	}

	again, _, err := svc.LinkGitLabMergeRequest(ctx, p, domain.LinkGitLabMergeRequestInput{
		URL:   "https://gitlab.com/acme/app/-/merge_requests/12",
		Title: "Fixes ENG-1",
	})
	if err != nil {
		t.Fatalf("relink: %v", err)
	}
	if len(again) != 1 || again[0].ID != links[0].ID {
		t.Fatalf("the same MR URL must update the existing card, got %+v", again)
	}
}

func TestLinkGitLabMergeRequest_SkipStopsBranchAutoLink(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	if _, _, _, err := svc.CreateGitLabConnection(ctx, p, domain.CreateGitLabConnectionInput{}); err != nil {
		t.Fatalf("connect: %v", err)
	}
	if _, _, err := svc.CreateIssue(ctx, p, domain.CreateIssueInput{TeamID: f.TeamID, Title: "Noise"}); err != nil {
		t.Fatalf("issue: %v", err)
	}

	links, _, err := svc.LinkGitLabMergeRequest(ctx, p, domain.LinkGitLabMergeRequestInput{
		URL:        "https://gitlab.com/acme/app/-/merge_requests/99",
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

func TestIngestGitLabPush_RequiresMagicWordAndCommitLinking(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	if _, _, _, err := svc.CreateGitLabConnection(ctx, p, domain.CreateGitLabConnectionInput{}); err != nil {
		t.Fatalf("connect: %v", err)
	}
	issue, _, err := svc.CreateIssue(ctx, p, domain.CreateIssueInput{TeamID: f.TeamID, Title: "Commit me"})
	if err != nil {
		t.Fatalf("issue: %v", err)
	}

	if _, _, err := svc.IngestGitLabPush(ctx, f.WorkspaceID, domain.GitLabPushInput{
		Commits: []domain.GitLabCommitInput{{
			SHA: "abc123def", URL: "https://gitlab.com/acme/app/-/commit/abc123def", Message: "fixes ENG-1",
		}},
	}); err != nil {
		t.Fatalf("ingest while disabled: %v", err)
	}
	listed, err := svc.ListAttachments(ctx, p, issue.ID)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(listed) != 0 {
		t.Fatal("commit linking is opt-in; a push must not attach until it is enabled")
	}

	on := true
	if _, _, err := svc.UpdateGitLabConnection(ctx, p, domain.UpdateGitLabConnectionInput{LinkCommits: &on}); err != nil {
		t.Fatalf("enable commits: %v", err)
	}
	if _, _, err := svc.IngestGitLabPush(ctx, f.WorkspaceID, domain.GitLabPushInput{
		Commits: []domain.GitLabCommitInput{{
			SHA: "abc123def", URL: "https://gitlab.com/acme/app/-/commit/abc123def", Message: "wip ENG-1",
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

	if _, _, err := svc.IngestGitLabPush(ctx, f.WorkspaceID, domain.GitLabPushInput{
		Commits: []domain.GitLabCommitInput{{
			SHA: "abc123def", URL: "https://gitlab.com/acme/app/-/commit/abc123def", Message: "fixes ENG-1",
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

func TestLinkGitLabMergeRequest_OpenedMovesIssueToStarted(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	if _, _, _, err := svc.CreateGitLabConnection(ctx, p, domain.CreateGitLabConnectionInput{}); err != nil {
		t.Fatalf("connect: %v", err)
	}
	issue, _, err := svc.CreateIssue(ctx, p, domain.CreateIssueInput{TeamID: f.TeamID, Title: "Importer"})
	if err != nil {
		t.Fatalf("issue: %v", err)
	}

	if _, _, err := svc.LinkGitLabMergeRequest(ctx, p, domain.LinkGitLabMergeRequestInput{
		URL:   "https://gitlab.com/acme/app/-/merge_requests/12",
		Title: "Fixes ENG-1",
	}); err != nil {
		t.Fatalf("link: %v", err)
	}
	got, err := svc.GetIssue(ctx, p, issue.ID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.StateID != f.InProgress {
		t.Fatalf("an opened MR must move the issue to Started, state=%s want %s", got.StateID, f.InProgress)
	}
}

func TestIngestGitLabMergeRequest_MergedClosingWordCompletesWhenEveryMRIsMerged(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	if _, _, _, err := svc.CreateGitLabConnection(ctx, p, domain.CreateGitLabConnectionInput{}); err != nil {
		t.Fatalf("connect: %v", err)
	}
	issue, _, err := svc.CreateIssue(ctx, p, domain.CreateIssueInput{TeamID: f.TeamID, Title: "Importer"})
	if err != nil {
		t.Fatalf("issue: %v", err)
	}

	if _, _, err := svc.IngestGitLabMergeRequest(ctx, f.WorkspaceID, domain.LinkGitLabMergeRequestInput{
		URL: "https://gitlab.com/acme/app/-/merge_requests/12", Title: "Fixes ENG-1",
	}); err != nil {
		t.Fatalf("open first: %v", err)
	}
	if _, _, err := svc.IngestGitLabMergeRequest(ctx, f.WorkspaceID, domain.LinkGitLabMergeRequestInput{
		URL: "https://gitlab.com/acme/app/-/merge_requests/13", Title: "Fixes ENG-1",
	}); err != nil {
		t.Fatalf("open second: %v", err)
	}
	if _, _, err := svc.IngestGitLabMergeRequest(ctx, f.WorkspaceID, domain.LinkGitLabMergeRequestInput{
		URL: "https://gitlab.com/acme/app/-/merge_requests/12", Title: "Fixes ENG-1", Merged: true,
	}); err != nil {
		t.Fatalf("merge first: %v", err)
	}
	mid, err := svc.GetIssue(ctx, p, issue.ID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if mid.StateID == f.Done {
		t.Fatal("Done must wait until every linked MR has merged")
	}

	if _, _, err := svc.IngestGitLabMergeRequest(ctx, f.WorkspaceID, domain.LinkGitLabMergeRequestInput{
		URL: "https://gitlab.com/acme/app/-/merge_requests/13", Title: "Fixes ENG-1", Merged: true,
	}); err != nil {
		t.Fatalf("merge second: %v", err)
	}
	got, err := svc.GetIssue(ctx, p, issue.ID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.StateID != f.Done {
		t.Fatalf("the last merged closing MR must complete the issue, state=%s", got.StateID)
	}
}

func TestIngestGitLabPush_DefaultBranchClosingWordCompletes(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	on := true
	if _, _, _, err := svc.CreateGitLabConnection(ctx, p, domain.CreateGitLabConnectionInput{LinkCommits: &on}); err != nil {
		t.Fatalf("connect: %v", err)
	}
	issue, _, err := svc.CreateIssue(ctx, p, domain.CreateIssueInput{TeamID: f.TeamID, Title: "Commit me"})
	if err != nil {
		t.Fatalf("issue: %v", err)
	}

	if _, _, err := svc.IngestGitLabPush(ctx, f.WorkspaceID, domain.GitLabPushInput{
		Commits: []domain.GitLabCommitInput{{
			SHA: "abc123def", URL: "https://gitlab.com/acme/app/-/commit/abc123def",
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

	if _, _, err := svc.IngestGitLabPush(ctx, f.WorkspaceID, domain.GitLabPushInput{
		Commits: []domain.GitLabCommitInput{{
			SHA: "abc123def", URL: "https://gitlab.com/acme/app/-/commit/abc123def",
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

type recordingGitLabPoster struct {
	comments []domain.GitLabComment
}

func (r *recordingGitLabPoster) Post(_ context.Context, _ string, c domain.GitLabComment) error {
	r.comments = append(r.comments, c)
	return nil
}

func TestGitLabLinkback_PostedOnFirstMRLink(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	svc.PublicURL = "https://polaris.example"
	poster := &recordingGitLabPoster{}
	svc.SetGitLabCommentPoster(poster)
	ctx := context.Background()
	p := f.Principal()

	if _, _, _, err := svc.CreateGitLabConnection(ctx, p, domain.CreateGitLabConnectionInput{}); err != nil {
		t.Fatalf("connect: %v", err)
	}
	if _, _, err := svc.CreateIssue(ctx, p, domain.CreateIssueInput{TeamID: f.TeamID, Title: "Importer"}); err != nil {
		t.Fatalf("issue: %v", err)
	}

	if _, _, err := svc.LinkGitLabMergeRequest(ctx, p, domain.LinkGitLabMergeRequestInput{
		URL: "https://gitlab.com/acme/app/-/merge_requests/12", Title: "Fixes ENG-1",
	}); err != nil {
		t.Fatalf("link: %v", err)
	}
	if len(poster.comments) != 1 {
		t.Fatalf("want one linkback, got %d", len(poster.comments))
	}
	c := poster.comments[0]
	if c.Project != "acme/app" || c.Number != 12 {
		t.Fatalf("comment target: %+v", c)
	}
	// The exact address, not just a substring containing it. A linkback goes into
	// somebody else's pull request and cannot be edited afterwards, so the URL has to be
	// one this client can actually route — `/issue/ENG-1`, the same shape the digest, the
	// outbound webhook and the Slack unfurl use. A `/<urlKey>/issue/ENG-1` prefix still
	// contains "/issue/ENG-1", which is how the wrong shape went unnoticed.
	const want = "ENG-1: Importer\nhttps://polaris.example/issue/ENG-1"
	if c.Body != want {
		t.Fatalf("linkback body:\n got %q\nwant %q", c.Body, want)
	}

	if _, _, err := svc.LinkGitLabMergeRequest(ctx, p, domain.LinkGitLabMergeRequestInput{
		URL: "https://gitlab.com/acme/app/-/merge_requests/12", Title: "Fixes ENG-1",
	}); err != nil {
		t.Fatalf("relink: %v", err)
	}
	if len(poster.comments) != 1 {
		t.Fatalf("a second event for the same card must not comment again, got %d", len(poster.comments))
	}
}

func TestGitLabLinkback_SkippedWhenDisabled(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	poster := &recordingGitLabPoster{}
	svc.SetGitLabCommentPoster(poster)
	ctx := context.Background()
	p := f.Principal()

	off := false
	if _, _, _, err := svc.CreateGitLabConnection(ctx, p, domain.CreateGitLabConnectionInput{Linkbacks: &off}); err != nil {
		t.Fatalf("connect: %v", err)
	}
	if _, _, err := svc.CreateIssue(ctx, p, domain.CreateIssueInput{TeamID: f.TeamID, Title: "Quiet"}); err != nil {
		t.Fatalf("issue: %v", err)
	}
	if _, _, err := svc.LinkGitLabMergeRequest(ctx, p, domain.LinkGitLabMergeRequestInput{
		URL: "https://gitlab.com/acme/app/-/merge_requests/1", Title: "Fixes ENG-1",
	}); err != nil {
		t.Fatalf("link: %v", err)
	}
	if len(poster.comments) != 0 {
		t.Fatalf("disabled linkbacks must not post, got %+v", poster.comments)
	}
}

func TestVerifyGitLabWebhook_RejectsABadToken(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	_, secret, _, err := svc.CreateGitLabConnection(ctx, f.Principal(), domain.CreateGitLabConnectionInput{})
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	if err := svc.VerifyGitLabWebhook(ctx, f.WorkspaceID, "wrong"); err == nil {
		t.Fatal("a wrong token must be refused")
	}
	if err := svc.VerifyGitLabWebhook(ctx, f.WorkspaceID, secret); err != nil {
		t.Fatalf("the matching token must verify: %v", err)
	}
}

func TestCreateGitLabConnection_SelfHostedInstanceURL(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	url := "https://gitlab.example.com/"
	conn, _, _, err := svc.CreateGitLabConnection(ctx, f.Principal(), domain.CreateGitLabConnectionInput{
		InstanceURL: &url,
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if conn.InstanceURL != "https://gitlab.example.com" {
		t.Fatalf("instance must drop the trailing slash, got %q", conn.InstanceURL)
	}

	bad := "https://gitlab.example.com/api"
	if _, _, err := svc.UpdateGitLabConnection(ctx, f.Principal(), domain.UpdateGitLabConnectionInput{
		InstanceURL: &bad,
	}); err == nil {
		t.Fatal("a path on the instance URL must be refused")
	}
}
