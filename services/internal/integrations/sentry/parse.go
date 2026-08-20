// Package sentry parses inbound Sentry webhook payloads.
//
// It calls nothing in store: the HTTP layer verifies the signature, this package turns
// the JSON into domain input, and domain does the create-or-link. That split is what
// keeps a Sentry-created issue on the same path as one linked from GraphQL.
package sentry

import (
	"encoding/json"
	"strings"
)

// Event is the subset of a Sentry webhook this product reads.
type Event struct {
	Action      string
	URL         string
	Title       string
	Culprit     string
	Project     string
	Level       string
	ShortID     string
	Environment string
}

type payload struct {
	Action      string `json:"action"`
	URL         string `json:"url"`
	Level       string `json:"level"`
	Culprit     string `json:"culprit"`
	Message     string `json:"message"`
	ProjectName string `json:"project_name"`
	ProjectSlug string `json:"project_slug"`
	Project     any    `json:"project"`
	Data        *struct {
		Issue *issuePayload `json:"issue"`
		Event *eventPayload `json:"event"`
	} `json:"data"`
	Event *eventPayload `json:"event"`
}

type issuePayload struct {
	ID        string `json:"id"`
	ShortID   string `json:"shortId"`
	Title     string `json:"title"`
	Culprit   string `json:"culprit"`
	Permalink string `json:"permalink"`
	WebURL    string `json:"web_url"`
	Level     string `json:"level"`
	Project   *struct {
		Name string `json:"name"`
		Slug string `json:"slug"`
	} `json:"project"`
	Metadata *struct {
		Type  string `json:"type"`
		Value string `json:"value"`
	} `json:"metadata"`
}

type eventPayload struct {
	Title       string `json:"title"`
	Culprit     string `json:"culprit"`
	Level       string `json:"level"`
	WebURL      string `json:"web_url"`
	IssueURL    string `json:"issue_url"`
	URL         string `json:"url"`
	Environment string `json:"environment"`
	Metadata    *struct {
		Type  string `json:"type"`
		Value string `json:"value"`
		Title string `json:"title"`
	} `json:"metadata"`
}

// Parse turns a Sentry webhook body into an Event. A payload with no issue URL is not
// an error — installation and metric-alert pings have none — so the second return is
// empty when the caller should ignore rather than refuse.
func Parse(body []byte) (Event, string, error) {
	var raw payload
	if err := json.Unmarshal(body, &raw); err != nil {
		return Event{}, "", err
	}

	action := strings.ToLower(strings.TrimSpace(raw.Action))
	if ignoreAction(action) {
		return Event{}, "ignored-action", nil
	}

	out := Event{Action: action}

	if raw.Data != nil && raw.Data.Issue != nil {
		fillFromIssue(&out, raw.Data.Issue)
	}
	if out.URL == "" && raw.Data != nil && raw.Data.Event != nil {
		fillFromEvent(&out, raw.Data.Event)
	}
	if out.URL == "" && raw.Event != nil {
		fillFromEvent(&out, raw.Event)
	}
	if out.URL == "" {
		out.URL = strings.TrimSpace(raw.URL)
		if out.Title == "" {
			out.Title = firstNonEmpty(raw.Message, raw.Culprit)
		}
		if out.Culprit == "" {
			out.Culprit = raw.Culprit
		}
		if out.Level == "" {
			out.Level = raw.Level
		}
		if out.Project == "" {
			out.Project = firstNonEmpty(raw.ProjectName, raw.ProjectSlug, projectSlug(raw.Project))
		}
	}

	out.URL = strings.TrimSpace(out.URL)
	out.Title = strings.TrimSpace(out.Title)
	if out.URL == "" {
		return Event{}, "no-issue", nil
	}
	if out.Title == "" {
		out.Title = "Sentry issue"
	}
	return out, "", nil
}

func fillFromIssue(out *Event, issue *issuePayload) {
	out.URL = firstNonEmpty(issue.WebURL, issue.Permalink)
	out.Title = strings.TrimSpace(issue.Title)
	if out.Title == "" && issue.Metadata != nil {
		out.Title = firstNonEmpty(issue.Metadata.Type, issue.Metadata.Value)
	}
	out.Culprit = issue.Culprit
	out.ShortID = issue.ShortID
	out.Level = issue.Level
	if issue.Project != nil {
		out.Project = firstNonEmpty(issue.Project.Name, issue.Project.Slug)
	}
}

func fillFromEvent(out *Event, event *eventPayload) {
	out.URL = firstNonEmpty(event.IssueURL, event.WebURL, event.URL)
	out.Title = strings.TrimSpace(event.Title)
	if out.Title == "" && event.Metadata != nil {
		out.Title = firstNonEmpty(event.Metadata.Title, event.Metadata.Type, event.Metadata.Value)
	}
	out.Culprit = event.Culprit
	out.Level = event.Level
	out.Environment = event.Environment
}

func ignoreAction(action string) bool {
	switch action {
	case "resolved", "assigned", "unassigned", "ignored", "archived", "unresolved":
		return true
	default:
		return false
	}
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if s := strings.TrimSpace(v); s != "" {
			return s
		}
	}
	return ""
}

func projectSlug(raw any) string {
	switch v := raw.(type) {
	case string:
		return v
	case map[string]any:
		if slug, ok := v["slug"].(string); ok {
			return slug
		}
		if name, ok := v["name"].(string); ok {
			return name
		}
	}
	return ""
}
