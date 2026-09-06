package llm

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// sse writes one server-sent event and flushes it, so the client sees it now rather than
// when the handler returns — which is the entire property under test.
func sse(t *testing.T, w http.ResponseWriter, event, data string) {
	t.Helper()
	if _, err := io.WriteString(w, "event: "+event+"\ndata: "+data+"\n\n"); err != nil {
		t.Errorf("writing %s: %v", event, err)
		return
	}
	w.(http.Flusher).Flush()
}

func TestStreamDeltasArriveIncrementally(t *testing.T) {
	firstDelta := make(chan struct{})

	p, _ := newTestProvider(t, func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("Accept"); got != "text/event-stream" {
			t.Errorf("Accept = %q", got)
		}
		body, _ := io.ReadAll(r.Body)
		var sent struct {
			Stream    bool `json:"stream"`
			MaxTokens int  `json:"max_tokens"`
		}
		_ = json.Unmarshal(body, &sent)
		if !sent.Stream {
			t.Error(`"stream":true missing from a streamed request`)
		}
		if sent.MaxTokens != DefaultStreamMaxTokens {
			t.Errorf("max_tokens = %d, want %d", sent.MaxTokens, DefaultStreamMaxTokens)
		}

		w.Header().Set("Content-Type", "text/event-stream")
		sse(t, w, "message_start", `{"type":"message_start","message":{"model":"claude-opus-5","usage":{"input_tokens":10,"cache_read_input_tokens":5,"output_tokens":1}}}`)
		sse(t, w, "content_block_start", `{"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}`)
		sse(t, w, "content_block_delta", `{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hel"}}`)

		// The rest of the stream is held back until the caller has been handed the first
		// delta. If Stream buffered the body, this test deadlocks and says so.
		select {
		case <-firstDelta:
		case <-time.After(5 * time.Second):
			t.Error("onText was not called before the stream finished")
		}

		sse(t, w, "content_block_delta", `{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"lo "}}`)
		sse(t, w, "content_block_delta", `{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"world"}}`)
		sse(t, w, "content_block_stop", `{"type":"content_block_stop","index":0}`)
		sse(t, w, "content_block_start", `{"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_7","name":"get_issue","input":{}}}`)
		sse(t, w, "content_block_delta", `{"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\"id\": "}}`)
		sse(t, w, "content_block_delta", `{"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"\"4\"}"}}`)
		sse(t, w, "content_block_stop", `{"type":"content_block_stop","index":1}`)
		sse(t, w, "message_delta", `{"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":25}}`)
		sse(t, w, "message_stop", `{"type":"message_stop"}`)
	})

	var deltas []string
	res, err := p.Stream(context.Background(), Request{Messages: []Message{userText("hi")}}, func(d string) error {
		if len(deltas) == 0 {
			close(firstDelta)
		}
		deltas = append(deltas, d)
		return nil
	})
	if err != nil {
		t.Fatalf("Stream: %v", err)
	}

	if want := []string{"Hel", "lo ", "world"}; !equalStrings(deltas, want) {
		t.Errorf("deltas = %q, want %q", deltas, want)
	}
	if len(res.Content) != 2 {
		t.Fatalf("content = %+v", res.Content)
	}
	if res.Content[0].Type != BlockText || res.Content[0].Text != "Hello world" {
		t.Errorf("text block = %+v", res.Content[0])
	}
	tu := res.Content[1]
	if tu.Type != BlockToolUse || tu.ID != "toolu_7" || tu.Name != "get_issue" || tu.Input["id"] != "4" {
		t.Errorf("tool_use block = %+v", tu)
	}
	if res.StopReason != "tool_use" {
		t.Errorf("StopReason = %q", res.StopReason)
	}
	if res.Model != "claude-opus-5" {
		t.Errorf("Model = %q", res.Model)
	}
	want := Usage{InputTokens: 10, OutputTokens: 25, CacheReadInputTokens: 5}
	if res.Usage != want {
		t.Errorf("Usage = %+v, want %+v", res.Usage, want)
	}
	if res.Text() != "Hello world" {
		t.Errorf("Text() = %q", res.Text())
	}
}

func TestStreamOnTextErrorAbortsStream(t *testing.T) {
	stopped := errors.New("caller went away")
	released := make(chan struct{})

	p, _ := newTestProvider(t, func(w http.ResponseWriter, r *http.Request) {
		sse(t, w, "message_start", `{"type":"message_start","message":{"model":"claude-opus-5","usage":{"input_tokens":1}}}`)
		sse(t, w, "content_block_start", `{"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}`)
		sse(t, w, "content_block_delta", `{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"one"}}`)
		sse(t, w, "content_block_delta", `{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"two"}}`)
		// Nothing more is sent: the client should already be gone.
		select {
		case <-r.Context().Done():
		case <-released:
		}
	})
	defer close(released)

	var seen []string
	_, err := p.Stream(context.Background(), Request{Messages: []Message{userText("hi")}}, func(d string) error {
		seen = append(seen, d)
		if len(seen) == 2 {
			return stopped
		}
		return nil
	})
	if !errors.Is(err, stopped) {
		t.Fatalf("err = %v, want the caller's own error", err)
	}
	if len(seen) != 2 {
		t.Errorf("onText called %d times, want 2: the stream must stop at the error", len(seen))
	}
}

func TestStreamContextCancellationAborts(t *testing.T) {
	released := make(chan struct{})
	p, _ := newTestProvider(t, func(w http.ResponseWriter, r *http.Request) {
		sse(t, w, "message_start", `{"type":"message_start","message":{"model":"claude-opus-5","usage":{"input_tokens":1}}}`)
		sse(t, w, "content_block_start", `{"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}`)
		sse(t, w, "content_block_delta", `{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"partial"}}`)
		select {
		case <-r.Context().Done():
		case <-released:
		}
	})
	defer close(released)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	_, err := p.Stream(ctx, Request{Messages: []Message{userText("hi")}}, func(d string) error {
		cancel()
		return nil
	})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("err = %v, want context.Canceled", err)
	}
	if KindOf(err) != KindCanceled {
		t.Errorf("KindOf = %q, want %q", KindOf(err), KindCanceled)
	}
}

func TestStreamTruncatedIsAnError(t *testing.T) {
	p, _ := newTestProvider(t, func(w http.ResponseWriter, r *http.Request) {
		sse(t, w, "message_start", `{"type":"message_start","message":{"model":"claude-opus-5","usage":{"input_tokens":1}}}`)
		sse(t, w, "content_block_start", `{"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}`)
		sse(t, w, "content_block_delta", `{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"half an ans"}}`)
		// Handler returns: the body ends with no message_stop.
	})

	_, err := p.Stream(context.Background(), Request{Messages: []Message{userText("hi")}}, nil)
	if !errors.Is(err, ErrTransport) {
		t.Fatalf("err = %v, want ErrTransport", err)
	}
	if !strings.Contains(err.Error(), "message_stop") {
		t.Errorf("error should say what was missing: %v", err)
	}
	if !Retryable(err) {
		t.Error("a truncated stream is worth retrying")
	}
}

func TestStreamErrorEventIsClassified(t *testing.T) {
	p, _ := newTestProvider(t, func(w http.ResponseWriter, r *http.Request) {
		sse(t, w, "message_start", `{"type":"message_start","message":{"model":"claude-opus-5","usage":{"input_tokens":1}}}`)
		sse(t, w, "error", `{"type":"error","error":{"type":"overloaded_error","message":"overloaded"}}`)
	})

	_, err := p.Stream(context.Background(), Request{Messages: []Message{userText("hi")}}, nil)
	if !errors.Is(err, ErrOverloaded) {
		t.Fatalf("err = %v, want ErrOverloaded", err)
	}
}

// TestStreamRetriesBeforeFirstByte pins the boundary: a stream is retried while it is still
// a failed HTTP request, and never once bytes have reached the caller.
func TestStreamRetriesBeforeFirstByte(t *testing.T) {
	var calls atomic.Int32
	p, _ := newTestProvider(t, func(w http.ResponseWriter, r *http.Request) {
		if calls.Add(1) == 1 {
			w.WriteHeader(http.StatusServiceUnavailable)
			_, _ = io.WriteString(w, `{"type":"error","error":{"type":"api_error","message":"try again"}}`)
			return
		}
		sse(t, w, "message_start", `{"type":"message_start","message":{"model":"claude-opus-5","usage":{"input_tokens":2}}}`)
		sse(t, w, "content_block_start", `{"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}`)
		sse(t, w, "content_block_delta", `{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"done"}}`)
		sse(t, w, "content_block_stop", `{"type":"content_block_stop","index":0}`)
		sse(t, w, "message_delta", `{"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":4}}`)
		sse(t, w, "message_stop", `{"type":"message_stop"}`)
	})

	res, err := p.Stream(context.Background(), Request{Messages: []Message{userText("hi")}}, nil)
	if err != nil {
		t.Fatalf("Stream: %v", err)
	}
	if res.Text() != "done" {
		t.Errorf("Text() = %q", res.Text())
	}
	if calls.Load() != 2 {
		t.Errorf("calls = %d, want 2", calls.Load())
	}
}

func equalStrings(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
