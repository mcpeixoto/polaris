// Package linear imports a workspace from Linear.
//
// client.go speaks Linear's GraphQL API and nothing else: it knows the endpoint, the
// pagination shape and the rate limiter, and returns Linear's objects as Linear describes
// them. import.go decides what each becomes here.
package linear

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/peixotolabs/polaris/services/internal/platform"
)

// DefaultBaseURL is Linear's GraphQL endpoint.
const DefaultBaseURL = "https://api.linear.app/graphql"

const (
	// pageSize is Linear's own maximum for a connection page.
	pageSize = 100

	// maxTries bounds the retries on a rate-limited request. Linear's limiter resets on the
	// hour, so a sixth attempt a few seconds after the fifth is not going to be the one that
	// gets through, and an import that waits forever looks exactly like one that hung.
	maxTries = 5

	// maxBackoff caps a single wait, whatever Linear says. A reset header an hour out would
	// otherwise park the worker past the job's own timeout and past the stale sweep.
	maxBackoff = 2 * time.Minute

	// maxResponseBytes bounds one page. A hundred issues with long descriptions is a few
	// megabytes; anything far beyond that is not a page of issues.
	maxResponseBytes = 64 << 20
)

// Client is one API key's view of Linear.
type Client struct {
	// BaseURL is the GraphQL endpoint. A field so tests can point it at httptest.
	BaseURL string
	APIKey  string
	HTTP    *http.Client

	// sleep is how the client waits out a rate limit. Tests replace it so a retry test does
	// not take a second per attempt.
	sleep func(context.Context, time.Duration) error
}

// NewClient builds a client for one key against baseURL, or Linear itself when it is empty.
func NewClient(baseURL, apiKey string, httpClient *http.Client) *Client {
	if baseURL == "" {
		baseURL = DefaultBaseURL
	}
	if httpClient == nil {
		httpClient = &http.Client{Timeout: 60 * time.Second}
	}
	return &Client{BaseURL: baseURL, APIKey: apiKey, HTTP: httpClient, sleep: sleepCtx}
}

func sleepCtx(ctx context.Context, d time.Duration) error {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-t.C:
		return nil
	}
}

type gqlRequest struct {
	Query     string         `json:"query"`
	Variables map[string]any `json:"variables,omitempty"`
}

type gqlError struct {
	Message    string `json:"message"`
	Extensions struct {
		Code string `json:"code"`
	} `json:"extensions"`
}

type gqlResponse struct {
	Data   json.RawMessage `json:"data"`
	Errors []gqlError      `json:"errors"`
}

// errRateLimited is a refusal worth waiting out; wait says for how long, when Linear said.
type errRateLimited struct{ wait time.Duration }

func (e errRateLimited) Error() string { return "linear: rate limited" }

// errBadKey is the error a rejected key produces, shown to the person who pasted it.
//
// COPY: new string.
var errBadKey = platform.Validation("apiKey", "Linear did not accept that API key")

// Do runs one GraphQL operation and decodes its data into out, retrying while Linear says
// to slow down.
func (c *Client) Do(ctx context.Context, query string, vars map[string]any, out any) error {
	var lastErr error
	for attempt := 0; attempt < maxTries; attempt++ {
		data, err := c.once(ctx, query, vars)
		if err == nil {
			if out == nil {
				return nil
			}
			if err := json.Unmarshal(data, out); err != nil {
				return fmt.Errorf("linear: decode response: %w", err)
			}
			return nil
		}
		var limited errRateLimited
		if !errors.As(err, &limited) {
			return err
		}
		lastErr = err
		if attempt == maxTries-1 {
			break
		}
		wait := limited.wait
		if wait <= 0 {
			// 1s, 2s, 4s, 8s: four waits between five tries, fifteen seconds in all.
			wait = time.Second << attempt
		}
		wait = min(wait, maxBackoff)
		if err := c.sleep(ctx, wait); err != nil {
			return err
		}
	}
	// COPY: new string, shown on a job that gave up.
	return &platform.Error{
		Code:    platform.CodeRateLimited,
		Message: "Linear kept refusing requests for being too frequent; try the import again later",
		Err:     lastErr,
	}
}

func (c *Client) once(ctx context.Context, query string, vars map[string]any) (json.RawMessage, error) {
	body, err := json.Marshal(gqlRequest{Query: query, Variables: vars})
	if err != nil {
		return nil, fmt.Errorf("linear: encode request: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.BaseURL, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("linear: build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	// Bare, with no "Bearer": that is how Linear takes a personal API key. A Bearer prefix
	// is for OAuth tokens and turns a working personal key into an authentication error.
	req.Header.Set("Authorization", c.APIKey)

	resp, err := c.HTTP.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		return nil, fmt.Errorf("linear: request: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, maxResponseBytes))
	if err != nil {
		return nil, fmt.Errorf("linear: read response: %w", err)
	}

	if resp.StatusCode == http.StatusTooManyRequests {
		return nil, errRateLimited{wait: retryAfter(resp.Header, time.Now())}
	}
	if resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden {
		return nil, errBadKey
	}

	var parsed gqlResponse
	if err := json.Unmarshal(raw, &parsed); err != nil {
		if resp.StatusCode >= 300 {
			return nil, fmt.Errorf("linear: HTTP %d", resp.StatusCode)
		}
		return nil, fmt.Errorf("linear: decode response: %w", err)
	}
	for _, e := range parsed.Errors {
		switch e.Extensions.Code {
		case "RATELIMITED":
			return nil, errRateLimited{wait: retryAfter(resp.Header, time.Now())}
		case "AUTHENTICATION_ERROR":
			return nil, errBadKey
		}
	}
	if len(parsed.Errors) > 0 {
		msgs := make([]string, 0, len(parsed.Errors))
		for _, e := range parsed.Errors {
			msgs = append(msgs, e.Message)
		}
		return nil, fmt.Errorf("linear: %s", strings.Join(msgs, "; "))
	}
	if resp.StatusCode >= 300 {
		return nil, fmt.Errorf("linear: HTTP %d", resp.StatusCode)
	}
	return parsed.Data, nil
}

// retryAfter reads how long Linear asked us to wait. Retry-After is seconds; Linear's own
// X-RateLimit-Requests-Reset is the epoch millisecond the window reopens. Zero means
// neither was present and the caller backs off on its own schedule.
func retryAfter(h http.Header, now time.Time) time.Duration {
	if v := strings.TrimSpace(h.Get("Retry-After")); v != "" {
		if secs, err := strconv.Atoi(v); err == nil && secs > 0 {
			return time.Duration(secs) * time.Second
		}
		if at, err := http.ParseTime(v); err == nil {
			if d := at.Sub(now); d > 0 {
				return d
			}
		}
	}
	if v := strings.TrimSpace(h.Get("X-RateLimit-Requests-Reset")); v != "" {
		if ms, err := strconv.ParseInt(v, 10, 64); err == nil {
			if d := time.UnixMilli(ms).Sub(now); d > 0 {
				return d
			}
		}
	}
	return 0
}

type pageInfo struct {
	HasNextPage bool    `json:"hasNextPage"`
	EndCursor   *string `json:"endCursor"`
}

type connection[T any] struct {
	Nodes    []T      `json:"nodes"`
	PageInfo pageInfo `json:"pageInfo"`
}

// paginate walks a top-level connection to its end. query must declare $first and $after
// and select `field { nodes {...} pageInfo { hasNextPage endCursor } }`.
func paginate[T any](ctx context.Context, c *Client, field, query string) ([]T, error) {
	var out []T
	var after *string
	for {
		vars := map[string]any{"first": pageSize}
		if after != nil {
			vars["after"] = *after
		}
		var data map[string]connection[T]
		if err := c.Do(ctx, query, vars, &data); err != nil {
			return nil, err
		}
		page, ok := data[field]
		if !ok {
			return nil, fmt.Errorf("linear: response has no %q", field)
		}
		out = append(out, page.Nodes...)
		if !page.PageInfo.HasNextPage || page.PageInfo.EndCursor == nil {
			return out, nil
		}
		after = page.PageInfo.EndCursor
	}
}

// ---------------------------------------------------------------------------------------
// Linear's objects, as Linear names them.

type ref struct {
	ID string `json:"id"`
}

type refs struct {
	Nodes []ref `json:"nodes"`
}

type Viewer struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	Email        string `json:"email"`
	Organization struct {
		ID     string `json:"id"`
		Name   string `json:"name"`
		URLKey string `json:"urlKey"`
	} `json:"organization"`
}

type Team struct {
	ID   string `json:"id"`
	Key  string `json:"key"`
	Name string `json:"name"`
}

type WorkflowState struct {
	ID       string  `json:"id"`
	Name     string  `json:"name"`
	Type     string  `json:"type"`
	Color    string  `json:"color"`
	Position float64 `json:"position"`
	Team     *ref    `json:"team"`
}

type IssueLabel struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Color  string `json:"color"`
	Team   *ref   `json:"team"`
	Parent *ref   `json:"parent"`
}

type User struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	DisplayName string `json:"displayName"`
	Email       string `json:"email"`
	Active      bool   `json:"active"`
}

type Project struct {
	ID          string  `json:"id"`
	Name        string  `json:"name"`
	Description string  `json:"description"`
	State       string  `json:"state"`
	StartDate   *string `json:"startDate"`
	TargetDate  *string `json:"targetDate"`
	Teams       refs    `json:"teams"`
	Lead        *ref    `json:"lead"`
}

type Cycle struct {
	ID       string    `json:"id"`
	Number   float64   `json:"number"`
	Name     *string   `json:"name"`
	StartsAt time.Time `json:"startsAt"`
	EndsAt   time.Time `json:"endsAt"`
	Team     *ref      `json:"team"`
}

type Issue struct {
	ID          string     `json:"id"`
	Identifier  string     `json:"identifier"`
	Number      float64    `json:"number"`
	Title       string     `json:"title"`
	Description *string    `json:"description"`
	Priority    float64    `json:"priority"`
	Estimate    *float64   `json:"estimate"`
	DueDate     *string    `json:"dueDate"`
	CreatedAt   time.Time  `json:"createdAt"`
	CompletedAt *time.Time `json:"completedAt"`
	CanceledAt  *time.Time `json:"canceledAt"`
	ArchivedAt  *time.Time `json:"archivedAt"`
	Team        *ref       `json:"team"`
	State       *ref       `json:"state"`
	Assignee    *ref       `json:"assignee"`
	Creator     *ref       `json:"creator"`
	Labels      refs       `json:"labels"`
	Project     *ref       `json:"project"`
	Cycle       *ref       `json:"cycle"`
	Parent      *ref       `json:"parent"`
}

type Comment struct {
	ID        string    `json:"id"`
	Body      string    `json:"body"`
	CreatedAt time.Time `json:"createdAt"`
	User      *ref      `json:"user"`
	Issue     *ref      `json:"issue"`
	Parent    *ref      `json:"parent"`
}

type IssueRelation struct {
	ID           string `json:"id"`
	Type         string `json:"type"`
	Issue        *ref   `json:"issue"`
	RelatedIssue *ref   `json:"relatedIssue"`
}

// Workspace is everything an import reads, fetched up front.
//
// Up front rather than streamed into the mapper, because the mapper needs the whole graph
// to place anything: an issue names a state, a cycle and a parent that may each be on a
// later page.
type Workspace struct {
	Viewer         Viewer
	Teams          []Team
	WorkflowStates []WorkflowState
	Labels         []IssueLabel
	Users          []User
	Projects       []Project
	Cycles         []Cycle
	Issues         []Issue
	Comments       []Comment
	Relations      []IssueRelation
}

const viewerQuery = `query { viewer { id name email organization { id name urlKey } } }`

// Viewer is the cheapest call there is, and the one that proves a key works.
func (c *Client) Viewer(ctx context.Context) (Viewer, error) {
	var data struct {
		Viewer Viewer `json:"viewer"`
	}
	if err := c.Do(ctx, viewerQuery, nil, &data); err != nil {
		return Viewer{}, err
	}
	return data.Viewer, nil
}

// connQuery builds a paginated query over one top-level connection.
func connQuery(field, args, selection string) string {
	return fmt.Sprintf(
		`query($first: Int!, $after: String) { %s(first: $first, after: $after%s) { nodes { %s } pageInfo { hasNextPage endCursor } } }`,
		field, args, selection)
}

// Archived objects are asked for explicitly on every connection that has them: an import
// that silently dropped everything somebody had archived would look complete and not be.
const includeArchived = ", includeArchived: true"

var (
	teamsQuery  = connQuery("teams", "", `id key name`)
	statesQuery = connQuery("workflowStates", "", `id name type color position team { id }`)
	labelsQuery = connQuery("issueLabels", "", `id name color team { id } parent { id }`)
	usersQuery  = connQuery("users", ", includeDisabled: true", `id name displayName email active`)
	projQuery   = connQuery("projects", includeArchived,
		`id name description state startDate targetDate teams { nodes { id } } lead { id }`)
	cyclesQuery = connQuery("cycles", includeArchived, `id number name startsAt endsAt team { id }`)
	issuesQuery = connQuery("issues", includeArchived, `id identifier number title description
		priority estimate dueDate createdAt completedAt canceledAt archivedAt
		team { id } state { id } assignee { id } creator { id } labels { nodes { id } }
		project { id } cycle { id } parent { id }`)
	commentsQuery  = connQuery("comments", "", `id body createdAt user { id } issue { id } parent { id }`)
	relationsQuery = connQuery("issueRelations", "", `id type issue { id } relatedIssue { id }`)
)

// FetchWorkspace reads everything the import needs.
func (c *Client) FetchWorkspace(ctx context.Context) (*Workspace, error) {
	var w Workspace
	var err error
	if w.Viewer, err = c.Viewer(ctx); err != nil {
		return nil, err
	}
	if w.Teams, err = paginate[Team](ctx, c, "teams", teamsQuery); err != nil {
		return nil, err
	}
	if w.WorkflowStates, err = paginate[WorkflowState](ctx, c, "workflowStates", statesQuery); err != nil {
		return nil, err
	}
	if w.Labels, err = paginate[IssueLabel](ctx, c, "issueLabels", labelsQuery); err != nil {
		return nil, err
	}
	if w.Users, err = paginate[User](ctx, c, "users", usersQuery); err != nil {
		return nil, err
	}
	if w.Projects, err = paginate[Project](ctx, c, "projects", projQuery); err != nil {
		return nil, err
	}
	if w.Cycles, err = paginate[Cycle](ctx, c, "cycles", cyclesQuery); err != nil {
		return nil, err
	}
	if w.Issues, err = paginate[Issue](ctx, c, "issues", issuesQuery); err != nil {
		return nil, err
	}
	if w.Comments, err = paginate[Comment](ctx, c, "comments", commentsQuery); err != nil {
		return nil, err
	}
	if w.Relations, err = paginate[IssueRelation](ctx, c, "issueRelations", relationsQuery); err != nil {
		return nil, err
	}
	return &w, nil
}
