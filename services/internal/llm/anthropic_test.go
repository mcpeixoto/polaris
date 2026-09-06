package llm

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// newTestProvider wires a provider at a test server with retries that take microseconds
// rather than seconds, so a retry test measures behaviour and not sleep.
func newTestProvider(t *testing.T, h http.HandlerFunc, opts ...Option) (Provider, *httptest.Server) {
	t.Helper()
	srv := httptest.NewServer(h)
	t.Cleanup(srv.Close)
	opts = append([]Option{WithRetry(4, time.Millisecond)}, opts...)
	return NewAnthropic("sk-test", "claude-opus-5", srv.URL, srv.Client(), opts...), srv
}

func userText(s string) Message {
	return Message{Role: RoleUser, Content: []Block{{Type: BlockText, Text: s}}}
}

func TestCompleteReturnsTextAndUsage(t *testing.T) {
	var gotBody []byte
	var gotHeaders http.Header

	p, _ := newTestProvider(t, func(w http.ResponseWriter, r *http.Request) {
		gotBody, _ = io.ReadAll(r.Body)
		gotHeaders = r.Header.Clone()
		if r.URL.Path != "/v1/messages" {
			t.Errorf("path = %q, want /v1/messages", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{
			"id": "msg_1",
			"type": "message",
			"role": "assistant",
			"model": "claude-opus-5",
			"content": [{"type": "text", "text": "Paris."}],
			"stop_reason": "end_turn",
			"usage": {
				"input_tokens": 12,
				"output_tokens": 3,
				"cache_creation_input_tokens": 40,
				"cache_read_input_tokens": 900
			}
		}`)
	})

	res, err := p.Complete(context.Background(), Request{
		System:    "You are Polaris.",
		Messages:  []Message{userText("Capital of France?")},
		MaxTokens: 64,
	})
	if err != nil {
		t.Fatalf("Complete: %v", err)
	}

	if got := res.Text(); got != "Paris." {
		t.Errorf("Text() = %q, want %q", got, "Paris.")
	}
	if res.StopReason != "end_turn" {
		t.Errorf("StopReason = %q", res.StopReason)
	}
	if res.Model != "claude-opus-5" {
		t.Errorf("Model = %q", res.Model)
	}
	want := Usage{InputTokens: 12, OutputTokens: 3, CacheCreationInputTokens: 40, CacheReadInputTokens: 900}
	if res.Usage != want {
		t.Errorf("Usage = %+v, want %+v", res.Usage, want)
	}

	if got := gotHeaders.Get("x-api-key"); got != "sk-test" {
		t.Errorf("x-api-key = %q", got)
	}
	if got := gotHeaders.Get("anthropic-version"); got != "2023-06-01" {
		t.Errorf("anthropic-version = %q", got)
	}
	if got := gotHeaders.Get("Content-Type"); got != "application/json" {
		t.Errorf("Content-Type = %q", got)
	}
	if strings.Contains(gotHeaders.Get("Authorization"), "sk-test") {
		t.Error("key must go in x-api-key, not Authorization")
	}

	// No tools, so no guardrail: the system prompt reaches the API as written, with the
	// cache breakpoint on it.
	var sent struct {
		MaxTokens int `json:"max_tokens"`
		System    []struct {
			Text         string          `json:"text"`
			CacheControl json.RawMessage `json:"cache_control"`
		} `json:"system"`
		Stream   bool `json:"stream"`
		Thinking struct {
			Type string `json:"type"`
		} `json:"thinking"`
	}
	if err := json.Unmarshal(gotBody, &sent); err != nil {
		t.Fatalf("request body is not JSON: %v", err)
	}
	if sent.MaxTokens != 64 {
		t.Errorf("max_tokens = %d, want 64", sent.MaxTokens)
	}
	if len(sent.System) != 1 || sent.System[0].Text != "You are Polaris." {
		t.Fatalf("system = %+v", sent.System)
	}
	if string(sent.System[0].CacheControl) != `{"type":"ephemeral"}` {
		t.Errorf("cache_control = %s", sent.System[0].CacheControl)
	}
	if sent.Stream {
		t.Error("stream must be absent on Complete")
	}
	if sent.Thinking.Type != "disabled" {
		t.Errorf("thinking = %q, want disabled (thinking is on by default server-side)", sent.Thinking.Type)
	}
}

func TestCompleteDefaultsMaxTokens(t *testing.T) {
	var sent struct {
		MaxTokens int `json:"max_tokens"`
	}
	p, _ := newTestProvider(t, func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(body, &sent)
		_, _ = io.WriteString(w, `{"content":[],"stop_reason":"end_turn","usage":{}}`)
	})

	if _, err := p.Complete(context.Background(), Request{Messages: []Message{userText("hi")}}); err != nil {
		t.Fatalf("Complete: %v", err)
	}
	if sent.MaxTokens != DefaultMaxTokens {
		t.Errorf("max_tokens = %d, want %d", sent.MaxTokens, DefaultMaxTokens)
	}
}

// TestToolUseThenContinuation is the whole point of the package: a turn that asks for a
// tool, and the follow-up carrying its result. The second body is asserted byte for byte,
// because a tool_result the API silently reinterprets is the failure that shows up as the
// model losing its place three turns later.
func TestToolUseThenContinuation(t *testing.T) {
	var bodies [][]byte
	p, _ := newTestProvider(t, func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		bodies = append(bodies, body)
		if len(bodies) == 1 {
			_, _ = io.WriteString(w, `{
				"model": "claude-opus-5",
				"content": [
					{"type": "text", "text": "Let me look."},
					{"type": "tool_use", "id": "toolu_1", "name": "get_issue", "input": {"id": "4"}}
				],
				"stop_reason": "tool_use",
				"usage": {"input_tokens": 30, "output_tokens": 9}
			}`)
			return
		}
		_, _ = io.WriteString(w, `{
			"model": "claude-opus-5",
			"content": [{"type": "text", "text": "It is called Ship it."}],
			"stop_reason": "end_turn",
			"usage": {"input_tokens": 60, "output_tokens": 7}
		}`)
	})

	tools := []ToolSpec{{
		Name:        "get_issue",
		Description: "Read an issue",
		InputSchema: map[string]any{
			"type":       "object",
			"properties": map[string]any{"id": map[string]any{"type": "string"}},
		},
	}}
	first := Request{
		System:    "You are Polaris.",
		Messages:  []Message{userText("What is issue 4?")},
		Tools:     tools,
		MaxTokens: 1024,
	}

	res, err := p.Complete(context.Background(), first)
	if err != nil {
		t.Fatalf("first Complete: %v", err)
	}
	if res.StopReason != "tool_use" {
		t.Fatalf("StopReason = %q, want tool_use", res.StopReason)
	}
	calls := res.ToolUses()
	if len(calls) != 1 {
		t.Fatalf("got %d tool calls, want 1", len(calls))
	}
	if calls[0].ID != "toolu_1" || calls[0].Name != "get_issue" || calls[0].Input["id"] != "4" {
		t.Fatalf("tool call = %+v", calls[0])
	}

	second := first
	second.Messages = []Message{
		userText("What is issue 4?"),
		{Role: RoleAssistant, Content: res.Content},
		{Role: RoleUser, Content: []Block{{
			Type:      BlockToolResult,
			ToolUseID: "toolu_1",
			Content:   `{"title":"Ship it"}`,
		}}},
	}
	if _, err := p.Complete(context.Background(), second); err != nil {
		t.Fatalf("second Complete: %v", err)
	}
	if len(bodies) != 2 {
		t.Fatalf("got %d requests, want 2", len(bodies))
	}

	want := `{"model":"claude-opus-5","max_tokens":1024,` +
		`"system":[{"type":"text","text":"You are Polaris.\n\n` + toolTextGuardrail + `","cache_control":{"type":"ephemeral"}}],` +
		`"messages":[` +
		`{"role":"user","content":[{"type":"text","text":"What is issue 4?"}]},` +
		`{"role":"assistant","content":[{"type":"text","text":"Let me look."},{"type":"tool_use","id":"toolu_1","name":"get_issue","input":{"id":"4"}}]},` +
		`{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_1","content":"{\"title\":\"Ship it\"}"}]}` +
		`],` +
		`"tools":[{"name":"get_issue","description":"Read an issue","input_schema":{"properties":{"id":{"type":"string"}},"type":"object"}}],` +
		`"thinking":{"type":"disabled"}}`

	if got := string(bodies[1]); got != want {
		t.Errorf("second request body\n got: %s\nwant: %s", got, want)
	}
}

func TestToolResultErrorFlagIsSent(t *testing.T) {
	var body []byte
	p, _ := newTestProvider(t, func(w http.ResponseWriter, r *http.Request) {
		body, _ = io.ReadAll(r.Body)
		_, _ = io.WriteString(w, `{"content":[],"stop_reason":"end_turn","usage":{}}`)
	})

	_, err := p.Complete(context.Background(), Request{
		Messages: []Message{{Role: RoleUser, Content: []Block{{
			Type:      BlockToolResult,
			ToolUseID: "toolu_9",
			Content:   "issue not found",
			IsError:   true,
		}}}},
		MaxTokens: 16,
	})
	if err != nil {
		t.Fatalf("Complete: %v", err)
	}
	if !strings.Contains(string(body), `"is_error":true`) {
		t.Errorf("is_error missing from body: %s", body)
	}
}

func TestCompleteRejectsBadRequestBeforeSending(t *testing.T) {
	var calls atomic.Int32
	p, _ := newTestProvider(t, func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		_, _ = io.WriteString(w, `{"content":[],"stop_reason":"end_turn","usage":{}}`)
	})

	if _, err := p.Complete(context.Background(), Request{}); !errors.Is(err, ErrInvalidRequest) {
		t.Errorf("empty messages: err = %v, want ErrInvalidRequest", err)
	}
	if calls.Load() != 0 {
		t.Errorf("server was called %d times for a request that could not be valid", calls.Load())
	}
}

func TestRetriesRateLimitThenSucceeds(t *testing.T) {
	var calls atomic.Int32
	p, _ := newTestProvider(t, func(w http.ResponseWriter, r *http.Request) {
		if calls.Add(1) == 1 {
			w.Header().Set("Retry-After", "1")
			w.WriteHeader(http.StatusTooManyRequests)
			_, _ = io.WriteString(w, `{"type":"error","error":{"type":"rate_limit_error","message":"slow down"}}`)
			return
		}
		_, _ = io.WriteString(w, `{"content":[{"type":"text","text":"ok"}],"stop_reason":"end_turn","usage":{"input_tokens":1,"output_tokens":1}}`)
	}, WithRetry(4, 10*time.Second)) // a base delay we must never actually wait

	start := time.Now()
	res, err := p.Complete(context.Background(), Request{Messages: []Message{userText("hi")}, MaxTokens: 16})
	if err != nil {
		t.Fatalf("Complete: %v", err)
	}
	if res.Text() != "ok" {
		t.Errorf("Text() = %q", res.Text())
	}
	if calls.Load() != 2 {
		t.Errorf("calls = %d, want 2", calls.Load())
	}
	// The server asked for one second; the configured backoff would have been five to ten.
	if elapsed := time.Since(start); elapsed > 4*time.Second {
		t.Errorf("waited %s: retry-after was not honoured over the backoff curve", elapsed)
	}
}

func TestRetriesOverloadedAndGivesUp(t *testing.T) {
	var calls atomic.Int32
	p, _ := newTestProvider(t, func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		w.WriteHeader(529)
		_, _ = io.WriteString(w, `{"type":"error","error":{"type":"overloaded_error","message":"overloaded"}}`)
	}, WithRetry(3, time.Millisecond))

	_, err := p.Complete(context.Background(), Request{Messages: []Message{userText("hi")}, MaxTokens: 16})
	if !errors.Is(err, ErrOverloaded) {
		t.Fatalf("err = %v, want ErrOverloaded", err)
	}
	if !Retryable(err) {
		t.Error("an exhausted overloaded error is still retryable later")
	}
	if calls.Load() != 3 {
		t.Errorf("calls = %d, want 3 (the attempt cap)", calls.Load())
	}
}

func TestDoesNotRetryBadRequest(t *testing.T) {
	var calls atomic.Int32
	p, _ := newTestProvider(t, func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		w.WriteHeader(http.StatusBadRequest)
		_, _ = io.WriteString(w, `{"type":"error","error":{"type":"invalid_request_error","message":"messages: at least one message is required"}}`)
	})

	_, err := p.Complete(context.Background(), Request{Messages: []Message{userText("hi")}, MaxTokens: 16})
	if !errors.Is(err, ErrInvalidRequest) {
		t.Fatalf("err = %v, want ErrInvalidRequest", err)
	}
	if Retryable(err) {
		t.Error("a 400 must not be reported as retryable")
	}
	if calls.Load() != 1 {
		t.Errorf("calls = %d, want 1: a 400 that is not a 429 is never retried", calls.Load())
	}
}

func TestAuthFailureIsClassifiedAndNotRetried(t *testing.T) {
	var calls atomic.Int32
	p, _ := newTestProvider(t, func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		w.Header().Set("request-id", "req_42")
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = io.WriteString(w, `{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}`)
	})

	_, err := p.Complete(context.Background(), Request{Messages: []Message{userText("hi")}, MaxTokens: 16})
	if !errors.Is(err, ErrAuth) {
		t.Fatalf("err = %v, want ErrAuth", err)
	}
	if errors.Is(err, ErrRateLimited) || errors.Is(err, ErrInvalidRequest) {
		t.Error("auth failure must not match another sentinel")
	}
	if KindOf(err) != KindAuth {
		t.Errorf("KindOf = %q", KindOf(err))
	}
	if Retryable(err) {
		t.Error("a bad key is not a transient failure")
	}
	if calls.Load() != 1 {
		t.Errorf("calls = %d, want 1", calls.Load())
	}

	var e *Error
	if !errors.As(err, &e) {
		t.Fatalf("err is not *Error: %v", err)
	}
	if e.Status != 401 || e.RequestID != "req_42" || e.Message != "invalid x-api-key" {
		t.Errorf("error detail = %+v", e)
	}
	if strings.Contains(err.Error(), "sk-test") {
		t.Error("error text must never carry the key")
	}
}

func TestContextLengthIsClassifiedDistinctly(t *testing.T) {
	p, _ := newTestProvider(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = io.WriteString(w, `{"type":"error","error":{"type":"invalid_request_error","message":"prompt is too long: 1200000 tokens > 1000000 maximum"}}`)
	})

	_, err := p.Complete(context.Background(), Request{Messages: []Message{userText("hi")}, MaxTokens: 16})
	if !errors.Is(err, ErrContextLength) {
		t.Fatalf("err = %v, want ErrContextLength", err)
	}
	if errors.Is(err, ErrInvalidRequest) {
		t.Error("context-length must be distinguishable from a plain 400")
	}
	if Retryable(err) {
		t.Error("resending the same oversized conversation cannot succeed")
	}
}

func TestContextCancellationAbortsInFlightRequest(t *testing.T) {
	started := make(chan struct{})
	// released frees the handler when the test returns. Waiting only on the request context
	// would hang httptest's Close, which blocks on in-flight handlers.
	released := make(chan struct{})
	var calls atomic.Int32
	p, _ := newTestProvider(t, func(w http.ResponseWriter, r *http.Request) {
		if calls.Add(1) == 1 {
			close(started)
		}
		select {
		case <-r.Context().Done():
		case <-released:
		}
	})
	defer close(released)

	ctx, cancel := context.WithCancel(context.Background())
	go func() {
		<-started
		cancel()
	}()

	_, err := p.Complete(ctx, Request{Messages: []Message{userText("hi")}, MaxTokens: 16})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("err = %v, want context.Canceled", err)
	}
	if KindOf(err) != KindCanceled {
		t.Errorf("KindOf = %q, want %q", KindOf(err), KindCanceled)
	}
	if Retryable(err) {
		t.Error("a cancelled request must not be reported as retryable")
	}
	if calls.Load() != 1 {
		t.Errorf("calls = %d: a cancelled request must not be retried", calls.Load())
	}
}

func TestThinkingOptionRoundTripsBlocks(t *testing.T) {
	var body []byte
	p, _ := newTestProvider(t, func(w http.ResponseWriter, r *http.Request) {
		body, _ = io.ReadAll(r.Body)
		_, _ = io.WriteString(w, `{
			"content": [
				{"type": "thinking", "thinking": "weighing it up", "signature": "sig-1"},
				{"type": "text", "text": "done"}
			],
			"stop_reason": "end_turn",
			"usage": {"input_tokens": 1, "output_tokens": 1}
		}`)
	}, WithThinking(ThinkingAdaptive), WithEffort(EffortLow))

	res, err := p.Complete(context.Background(), Request{
		Messages:  []Message{userText("hi")},
		Tools:     []ToolSpec{{Name: "noop"}},
		MaxTokens: 16,
	})
	if err != nil {
		t.Fatalf("Complete: %v", err)
	}
	if !strings.Contains(string(body), `"thinking":{"type":"adaptive"}`) {
		t.Errorf("thinking not sent: %s", body)
	}
	if !strings.Contains(string(body), `"output_config":{"effort":"low"}`) {
		t.Errorf("effort not sent: %s", body)
	}
	if strings.Contains(string(body), toolTextGuardrail) {
		t.Error("the disabled-thinking guardrail must not be added when thinking is on")
	}
	if len(res.Content) != 2 || res.Content[0].Type != BlockThinking || res.Content[0].Signature != "sig-1" {
		t.Fatalf("content = %+v", res.Content)
	}

	// The signature has to survive the trip back out, or the next turn is rejected.
	res2Body := make(chan string, 1)
	p2, _ := newTestProvider(t, func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		res2Body <- string(b)
		_, _ = io.WriteString(w, `{"content":[],"stop_reason":"end_turn","usage":{}}`)
	}, WithThinking(ThinkingAdaptive))
	if _, err := p2.Complete(context.Background(), Request{
		Messages: []Message{
			userText("hi"),
			{Role: RoleAssistant, Content: res.Content},
			userText("and now?"),
		},
		MaxTokens: 16,
	}); err != nil {
		t.Fatalf("second Complete: %v", err)
	}
	if got := <-res2Body; !strings.Contains(got, `{"type":"thinking","thinking":"weighing it up","signature":"sig-1"}`) {
		t.Errorf("thinking block not echoed back: %s", got)
	}
}

func TestNewAnthropicDefaults(t *testing.T) {
	p := NewAnthropic("k", "", "", nil)
	if p.Model() != DefaultModel {
		t.Errorf("Model() = %q, want %q", p.Model(), DefaultModel)
	}
	if p.Name() != "anthropic" {
		t.Errorf("Name() = %q", p.Name())
	}
}
