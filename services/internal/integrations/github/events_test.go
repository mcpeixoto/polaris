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
}

func TestParsePush_BuildsBrowserURLs(t *testing.T) {
	t.Parallel()
	body := []byte(`{
		"repository": {"full_name": "acme/app", "html_url": "https://github.com/acme/app"},
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
}
