package sentry

import (
	"strings"
	"testing"
)

func TestParse_IssueCreated(t *testing.T) {
	t.Parallel()
	body := []byte(`{
		"action": "created",
		"data": {
			"issue": {
				"id": "12345",
				"shortId": "WEB-1",
				"title": "Error: boom",
				"culprit": "app.views in index",
				"permalink": "https://sentry.io/organizations/acme/issues/12345/",
				"web_url": "https://acme.sentry.io/issues/12345/",
				"level": "error",
				"project": {"name": "Web", "slug": "web"}
			}
		}
	}`)
	ev, skip, err := Parse(body)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if skip != "" {
		t.Fatalf("skip: %s", skip)
	}
	if ev.URL != "https://acme.sentry.io/issues/12345/" {
		t.Fatalf("url: %s", ev.URL)
	}
	if ev.Title != "Error: boom" {
		t.Fatalf("title: %s", ev.Title)
	}
	if ev.Project != "Web" {
		t.Fatalf("project: %s", ev.Project)
	}
	if ev.ShortID != "WEB-1" {
		t.Fatalf("shortId: %s", ev.ShortID)
	}
}

func TestParse_AlertTriggered(t *testing.T) {
	t.Parallel()
	body := []byte(`{
		"action": "triggered",
		"data": {
			"event": {
				"title": "TypeError: x is not a function",
				"issue_url": "https://sentry.io/organizations/acme/issues/99/",
				"web_url": "https://sentry.io/organizations/acme/issues/99/events/abc/",
				"culprit": "main.ts",
				"level": "error",
				"environment": "production"
			}
		}
	}`)
	ev, skip, err := Parse(body)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if skip != "" {
		t.Fatalf("skip: %s", skip)
	}
	if !strings.Contains(ev.URL, "/issues/99/") {
		t.Fatalf("url: %s", ev.URL)
	}
	if ev.Title != "TypeError: x is not a function" {
		t.Fatalf("title: %s", ev.Title)
	}
	if ev.Environment != "production" {
		t.Fatalf("env: %s", ev.Environment)
	}
}

func TestParse_LegacyPlugin(t *testing.T) {
	t.Parallel()
	body := []byte(`{
		"project_name": "Web",
		"culprit": "app.views",
		"message": "ZeroDivisionError",
		"url": "https://sentry.io/organizations/acme/issues/7/",
		"level": "error"
	}`)
	ev, skip, err := Parse(body)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if skip != "" {
		t.Fatalf("skip: %s", skip)
	}
	if ev.URL != "https://sentry.io/organizations/acme/issues/7/" {
		t.Fatalf("url: %s", ev.URL)
	}
	if ev.Title != "ZeroDivisionError" {
		t.Fatalf("title: %s", ev.Title)
	}
}

func TestParse_IgnoresResolvedAndInstallation(t *testing.T) {
	t.Parallel()
	_, skip, err := Parse([]byte(`{"action":"resolved","data":{"issue":{"web_url":"https://sentry.io/issues/1/"}}}`))
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if skip != "ignored-action" {
		t.Fatalf("skip: %s", skip)
	}
	_, skip, err = Parse([]byte(`{"action":"created","data":{"installation":{"uuid":"abc"}}}`))
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if skip != "no-issue" {
		t.Fatalf("skip: %s", skip)
	}
}

func TestParse_BadJSON(t *testing.T) {
	t.Parallel()
	if _, _, err := Parse([]byte(`{`)); err == nil {
		t.Fatal("malformed JSON must fail")
	}
}
