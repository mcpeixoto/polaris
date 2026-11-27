package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

type api struct {
	base  string
	token string
	http  *http.Client
}

func newAPI(base, token string) *api {
	return &api{
		base:  strings.TrimRight(base, "/"),
		token: token,
		http:  &http.Client{Timeout: 30 * time.Second},
	}
}

type claimRequest struct {
	Version string `json:"version"`
}

type finishRequest struct {
	Status       string `json:"status"`
	Summary      string `json:"summary,omitempty"`
	Error        string `json:"error,omitempty"`
	SessionRef   string `json:"sessionRef,omitempty"`
	InputTokens  int    `json:"inputTokens,omitempty"`
	OutputTokens int    `json:"outputTokens,omitempty"`
}

type claimed struct {
	runID   string
	session string
	issue   issue
}

type issue struct {
	identifier  string
	title       string
	description string
	url         string
	teamKey     string
	teamName    string
	state       string
	priority    string
	comments    []issueComment
}

type issueComment struct {
	author    string
	body      string
	createdAt string
}

func (a *api) claim(ctx context.Context, version string) (int, []byte, error) {
	return a.post(ctx, "/runner/v1/claim", claimRequest{Version: version})
}

func (a *api) heartbeat(ctx context.Context, id string) (int, error) {
	code, body, err := a.post(ctx, runPath(id, "heartbeat"), struct{}{})
	if err != nil {
		return 0, err
	}
	if code >= 400 && code != http.StatusConflict && code != http.StatusNotFound {
		return code, fmt.Errorf("heartbeat: %s", statusLine(code, body))
	}
	return code, nil
}

// beat posts a heartbeat immediately and then every heartbeatEvery. onStop is
// called for 409 (the run was cancelled — the child must die) and 404 (the run
// is not this agent's). Other failures are logged and the loop continues: one
// dropped request is not a reason to abandon a run that is still claimed.
func (a *api) beat(ctx context.Context, id string, onStop func(reason string)) {
	send := func() bool {
		code, err := a.heartbeat(ctx, id)
		switch code {
		case http.StatusConflict:
			onStop(reasonCancelled)
			return false
		case http.StatusNotFound:
			onStop(reasonNotFound)
			return false
		}
		if ctx.Err() != nil {
			return false
		}
		if err != nil {
			fmt.Fprintf(os.Stderr, "heartbeat: %v\n", err)
		}
		return true
	}
	if !send() {
		return
	}
	tick := time.NewTicker(heartbeatEvery)
	defer tick.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
			if !send() {
				return
			}
		}
	}
}

func (a *api) finish(ctx context.Context, id string, req finishRequest) error {
	code, body, err := a.post(ctx, runPath(id, "finish"), req)
	if err != nil {
		return err
	}
	// 409 and 404 mean the server already closed the run. Reporting that as a
	// transport failure would hide a finish that did land.
	if code == http.StatusNotFound || code == http.StatusConflict || code/100 == 2 {
		return nil
	}
	return fmt.Errorf("finish: %s", statusLine(code, body))
}

func (a *api) post(ctx context.Context, path string, payload any) (int, []byte, error) {
	var body io.Reader
	if payload != nil {
		b, err := json.Marshal(payload)
		if err != nil {
			return 0, nil, err
		}
		body = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, a.base+path, body)
	if err != nil {
		return 0, nil, err
	}
	req.Header.Set("Authorization", "Bearer "+a.token)
	req.Header.Set("User-Agent", "polaris-runner/"+runnerVersion)
	if payload != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := a.http.Do(req)
	if err != nil {
		return 0, nil, err
	}
	defer resp.Body.Close()
	respBody, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if err != nil {
		return resp.StatusCode, nil, err
	}
	return resp.StatusCode, respBody, nil
}

func runPath(id, action string) string {
	return "/runner/v1/runs/" + url.PathEscape(id) + "/" + action
}

func decodeClaim(body []byte) (claimed, error) {
	var wire claimWire
	if err := json.Unmarshal(body, &wire); err != nil {
		var probe struct {
			Run struct {
				ID string `json:"id"`
			} `json:"run"`
		}
		_ = json.Unmarshal(body, &probe)
		return claimed{runID: probe.Run.ID}, fmt.Errorf("claim: %w", err)
	}
	comments := make([]issueComment, 0, len(wire.Issue.Comments))
	for _, c := range wire.Issue.Comments {
		comments = append(comments, issueComment{
			author:    c.Author.v,
			body:      c.Body,
			createdAt: c.CreatedAt.v,
		})
	}
	return claimed{
		runID:   wire.Run.ID,
		session: wire.Run.SessionRef.v,
		issue: issue{
			identifier:  wire.Issue.Identifier,
			title:       wire.Issue.Title,
			description: wire.Issue.Description.v,
			url:         wire.Issue.URL,
			teamKey:     wire.Issue.Team.Key,
			teamName:    wire.Issue.Team.Name,
			state:       wire.Issue.State.v,
			priority:    wire.Issue.Priority.v,
			comments:    comments,
		},
	}, nil
}

type claimWire struct {
	Run struct {
		ID         string     `json:"id"`
		SessionRef wireString `json:"sessionRef"`
	} `json:"run"`
	Issue struct {
		ID          string     `json:"id"`
		Identifier  string     `json:"identifier"`
		Title       string     `json:"title"`
		Description wireString `json:"description"`
		URL         string     `json:"url"`
		Team        struct {
			Key  string `json:"key"`
			Name string `json:"name"`
		} `json:"team"`
		State    wireString `json:"state"`
		Priority wireString `json:"priority"`
		Comments []struct {
			Author    wireString `json:"author"`
			Body      string     `json:"body"`
			CreatedAt wireString `json:"createdAt"`
		} `json:"comments"`
	} `json:"issue"`
}

// wireString accepts a JSON string, null, a number, or an object with a name.
// State, priority and author are named in the contract without a shape, and a
// runner that rejected an object the server sent would fail every claim.
type wireString struct{ v string }

func (s *wireString) UnmarshalJSON(b []byte) error {
	if string(b) == "null" {
		s.v = ""
		return nil
	}
	if len(b) > 0 && b[0] == '"' {
		var v string
		if err := json.Unmarshal(b, &v); err != nil {
			return err
		}
		s.v = v
		return nil
	}
	if len(b) > 0 && b[0] == '{' {
		var obj struct {
			Name        string `json:"name"`
			DisplayName string `json:"displayName"`
			Key         string `json:"key"`
			Label       string `json:"label"`
			Type        string `json:"type"`
		}
		if err := json.Unmarshal(b, &obj); err == nil {
			switch {
			case obj.DisplayName != "":
				s.v = obj.DisplayName
				return nil
			case obj.Name != "" && obj.Type != "":
				// State is a name plus a category. The name alone does not say
				// whether the work is still open.
				s.v = obj.Name + " (" + obj.Type + ")"
				return nil
			case obj.Name != "":
				s.v = obj.Name
				return nil
			case obj.Label != "":
				s.v = obj.Label
				return nil
			case obj.Key != "":
				s.v = obj.Key
				return nil
			}
		}
	}
	s.v = string(b)
	return nil
}

func statusLine(code int, body []byte) string {
	s := strings.TrimSpace(string(body))
	s = strings.ReplaceAll(s, "\n", " ")
	if len(s) > 300 {
		s = s[:300]
	}
	if s == "" {
		return fmt.Sprintf("%d %s", code, http.StatusText(code))
	}
	return fmt.Sprintf("%d %s", code, s)
}
