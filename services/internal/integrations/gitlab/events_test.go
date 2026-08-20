package gitlab

import "testing"

func TestParseMergeRequest(t *testing.T) {
	t.Parallel()
	body := []byte(`{
		"object_kind": "merge_request",
		"project": {"path_with_namespace": "acme/app", "web_url": "https://gitlab.com/acme/app"},
		"object_attributes": {
			"iid": 12,
			"title": "Fixes ENG-1",
			"description": "see description",
			"state": "opened",
			"action": "open",
			"source_branch": "feat/eng-1-importer",
			"url": "https://gitlab.com/acme/app/-/merge_requests/12",
			"merge_status": "can_be_merged"
		}
	}`)
	got, err := ParseMergeRequest(body)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if got.Input.URL != "https://gitlab.com/acme/app/-/merge_requests/12" {
		t.Fatalf("url: %q", got.Input.URL)
	}
	if got.Input.Title != "Fixes ENG-1" || got.Input.BranchName != "feat/eng-1-importer" {
		t.Fatalf("fields: %+v", got.Input)
	}
	if got.Input.Repo != "acme/app" || got.Input.Number != 12 {
		t.Fatalf("repo: %+v", got.Input)
	}
	if got.Input.Draft || got.Input.Merged {
		t.Fatalf("opened MR must not look drafted or merged: %+v", got.Input)
	}
	if got.Input.MergeableState != "" {
		t.Fatalf("opened-class events must not fire ready-for-merge: %+v", got.Input)
	}
}

func TestParsePush_BuildsBrowserURLs(t *testing.T) {
	t.Parallel()
	body := []byte(`{
		"object_kind": "push",
		"ref": "refs/heads/main",
		"project": {"path_with_namespace": "acme/app", "web_url": "https://gitlab.com/acme/app", "default_branch": "main"},
		"commits": [{
			"id": "abc123",
			"url": "https://gitlab.com/api/v4/projects/1/repository/commits/abc123",
			"message": "Fixes ENG-1"
		}]
	}`)
	got, err := ParsePush(body)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if len(got.Input.Commits) != 1 {
		t.Fatalf("commits: %d", len(got.Input.Commits))
	}
	c := got.Input.Commits[0]
	if c.URL != "https://gitlab.com/acme/app/-/commit/abc123" {
		t.Fatalf("url: %q — the attachment must open in the browser, not the API", c.URL)
	}
	if c.Message != "Fixes ENG-1" {
		t.Fatalf("message: %q", c.Message)
	}
	if !c.OnDefaultBranch {
		t.Fatal("a push to the default branch must mark its commits so merge automation can fire")
	}
}

func TestParseMergeRequest_ReviewersOnOpenIsStillOpened(t *testing.T) {
	t.Parallel()
	body := []byte(`{
		"object_kind": "merge_request",
		"project": {"path_with_namespace": "acme/app"},
		"object_attributes": {
			"iid": 12,
			"title": "Fixes ENG-1",
			"state": "opened",
			"action": "open",
			"source_branch": "feat/eng-1",
			"url": "https://gitlab.com/acme/app/-/merge_requests/12",
			"merge_status": "can_be_merged"
		},
		"reviewers": [{"username": "ada"}]
	}`)
	got, err := ParseMergeRequest(body)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if got.Input.ReviewRequested {
		t.Fatal("reviewers present on open are not a review-requested event")
	}
	if got.Input.MergeableState != "" {
		t.Fatal("open must stay opened even when GitLab already reports can_be_merged")
	}
}

func TestParsePipelineReady(t *testing.T) {
	t.Parallel()
	body := []byte(`{
		"object_kind": "pipeline",
		"object_attributes": {"status": "success"},
		"project": {"path_with_namespace": "acme/app"},
		"merge_request": {
			"iid": 4,
			"title": "Fixes ENG-1",
			"url": "https://gitlab.com/acme/app/-/merge_requests/4",
			"source_branch": "feat/eng-1",
			"state": "opened"
		}
	}`)
	got, ok, err := ParsePipelineReady(body)
	if err != nil || !ok {
		t.Fatalf("parse: ok=%v err=%v", ok, err)
	}
	if got.MergeableState != "can_be_merged" || got.Number != 4 {
		t.Fatalf("ready: %+v", got)
	}
}
