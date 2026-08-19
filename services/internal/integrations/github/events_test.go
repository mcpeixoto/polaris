package github

import "testing"

func TestParsePullRequest(t *testing.T) {
	t.Parallel()
	body := []byte(`{
		"action": "opened",
		"installation": {"id": 99},
		"pull_request": {
			"html_url": "https://github.com/acme/app/pull/12",
			"title": "Fixes ENG-1",
			"body": "see description",
			"number": 12,
			"head": {"ref": "feat/eng-1-importer"},
			"base": {"repo": {"full_name": "acme/app"}}
		}
	}`)
	got, err := ParsePullRequest(body)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if got.Installation != 99 {
		t.Fatalf("installation: %d", got.Installation)
	}
	if got.Input.URL != "https://github.com/acme/app/pull/12" {
		t.Fatalf("url: %q", got.Input.URL)
	}
	if got.Input.Title != "Fixes ENG-1" || got.Input.BranchName != "feat/eng-1-importer" {
		t.Fatalf("fields: %+v", got.Input)
	}
	if got.Input.Repo != "acme/app" || got.Input.Number != 12 {
		t.Fatalf("repo: %+v", got.Input)
	}
	if got.Input.Draft || got.Input.Merged {
		t.Fatalf("opened PR must not look drafted or merged: %+v", got.Input)
	}
}

func TestParsePush_BuildsBrowserURLs(t *testing.T) {
	t.Parallel()
	body := []byte(`{
		"ref": "refs/heads/main",
		"repository": {"full_name": "acme/app", "html_url": "https://github.com/acme/app", "default_branch": "main"},
		"commits": [{
			"id": "abc123",
			"url": "https://api.github.com/repos/acme/app/commits/abc123",
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
	if c.URL != "https://github.com/acme/app/commit/abc123" {
		t.Fatalf("url: %q — the attachment must open in the browser, not the API", c.URL)
	}
	if c.Message != "Fixes ENG-1" {
		t.Fatalf("message: %q", c.Message)
	}
	if !c.OnDefaultBranch {
		t.Fatal("a push to the default branch must mark its commits so merge automation can fire")
	}
}

func TestParsePullRequest_OpenedWithReviewersIsStillOpened(t *testing.T) {
	t.Parallel()
	body := []byte(`{
		"action": "opened",
		"pull_request": {
			"html_url": "https://github.com/acme/app/pull/12",
			"title": "Fixes ENG-1",
			"number": 12,
			"mergeable_state": "clean",
			"requested_reviewers": [{"login": "ada"}],
			"head": {"ref": "feat/eng-1"},
			"base": {"repo": {"full_name": "acme/app"}}
		}
	}`)
	got, err := ParsePullRequest(body)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if got.Input.ReviewRequested {
		t.Fatal("reviewers on an opened payload must not classify as review_requested")
	}
	if got.Input.MergeableState != "" {
		t.Fatalf("opened must not carry mergeable_state, got %q", got.Input.MergeableState)
	}
}

func TestParsePullRequest_ReviewRequestedAndReadyForMerge(t *testing.T) {
	t.Parallel()
	review := []byte(`{
		"action": "review_requested",
		"pull_request": {
			"html_url": "https://github.com/acme/app/pull/12",
			"title": "Fixes ENG-1",
			"number": 12,
			"head": {"ref": "feat/eng-1"},
			"base": {"repo": {"full_name": "acme/app"}}
		}
	}`)
	got, err := ParsePullRequest(review)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if !got.Input.ReviewRequested {
		t.Fatal("review_requested must set the flag the status mapping reads")
	}

	sync := []byte(`{
		"action": "synchronize",
		"pull_request": {
			"html_url": "https://github.com/acme/app/pull/12",
			"title": "Fixes ENG-1",
			"number": 12,
			"mergeable_state": "clean",
			"head": {"ref": "feat/eng-1"},
			"base": {"repo": {"full_name": "acme/app"}}
		}
	}`)
	got, err = ParsePullRequest(sync)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if got.Input.MergeableState != "clean" {
		t.Fatalf("synchronize with a clean PR must pass mergeable_state, got %q", got.Input.MergeableState)
	}
}
