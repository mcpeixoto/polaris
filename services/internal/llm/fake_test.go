package llm

import (
	"context"
	"errors"
	"net/http"
	"testing"
	"time"
)

func TestFakeReturnsScriptedResponsesInOrder(t *testing.T) {
	var f Provider = NewFake(
		ToolUseResponse("toolu_1", "get_issue", map[string]any{"id": "4"}),
		TextResponse("It is called Ship it."),
	)
	fake := f.(*Fake)

	first, err := f.Complete(context.Background(), Request{Messages: []Message{userText("what is issue 4?")}})
	if err != nil {
		t.Fatalf("first Complete: %v", err)
	}
	if first.StopReason != "tool_use" || len(first.ToolUses()) != 1 {
		t.Fatalf("first response = %+v", first)
	}

	second, err := f.Complete(context.Background(), Request{Messages: []Message{userText("and?")}})
	if err != nil {
		t.Fatalf("second Complete: %v", err)
	}
	if second.Text() != "It is called Ship it." {
		t.Errorf("second text = %q", second.Text())
	}

	if _, err := f.Complete(context.Background(), Request{Messages: []Message{userText("more")}}); err == nil {
		t.Error("running past the end of the script must be an error")
	}

	reqs := fake.Requests()
	if len(reqs) != 3 {
		t.Fatalf("recorded %d requests, want 3", len(reqs))
	}
	if reqs[0].Messages[0].Content[0].Text != "what is issue 4?" {
		t.Errorf("first recorded request = %+v", reqs[0])
	}
	if fake.Calls() != 3 {
		t.Errorf("Calls() = %d", fake.Calls())
	}

	// The recorded slice is a copy: a caller mutating it must not corrupt the record.
	reqs[0].System = "tampered"
	if fake.Requests()[0].System != "" {
		t.Error("Requests() handed out the internal slice")
	}
}

func TestFakeScriptsErrors(t *testing.T) {
	boom := &Error{Kind: KindRateLimit, Retryable: true, Message: "slow down"}
	f := &Fake{
		Responses: []Response{{}, TextResponse("recovered")},
		Errs:      []error{boom},
	}

	if _, err := f.Complete(context.Background(), Request{}); !errors.Is(err, ErrRateLimited) {
		t.Fatalf("err = %v, want ErrRateLimited", err)
	}
	res, err := f.Complete(context.Background(), Request{})
	if err != nil {
		t.Fatalf("second Complete: %v", err)
	}
	if res.Text() != "recovered" {
		t.Errorf("text = %q", res.Text())
	}
}

func TestFakeStreamsTextAndPropagatesCallerError(t *testing.T) {
	f := NewFake(TextResponse("hello"), TextResponse("again"))

	var seen []string
	res, err := f.Stream(context.Background(), Request{}, func(d string) error {
		seen = append(seen, d)
		return nil
	})
	if err != nil {
		t.Fatalf("Stream: %v", err)
	}
	if len(seen) != 1 || seen[0] != "hello" || res.Text() != "hello" {
		t.Errorf("deltas = %q, text = %q", seen, res.Text())
	}

	stopped := errors.New("caller went away")
	if _, err := f.Stream(context.Background(), Request{}, func(string) error { return stopped }); !errors.Is(err, stopped) {
		t.Errorf("err = %v, want the caller's error", err)
	}
}

func TestFakeRespectsCancelledContext(t *testing.T) {
	f := NewFake(TextResponse("never sent"))
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	if _, err := f.Complete(ctx, Request{}); !errors.Is(err, context.Canceled) {
		t.Errorf("err = %v, want context.Canceled", err)
	}
	if f.Calls() != 0 {
		t.Errorf("Calls() = %d: a cancelled call is not a call", f.Calls())
	}
}

func TestFakeIdentity(t *testing.T) {
	f := NewFake()
	if f.Name() != "fake" || f.Model() != "fake-model" {
		t.Errorf("Name/Model = %q/%q", f.Name(), f.Model())
	}
	f.ProviderName, f.ModelID = "anthropic", "claude-opus-5"
	if f.Name() != "anthropic" || f.Model() != "claude-opus-5" {
		t.Errorf("Name/Model = %q/%q", f.Name(), f.Model())
	}
}

func TestClassifyStatus(t *testing.T) {
	cases := []struct {
		status    int
		errType   string
		message   string
		wantKind  Kind
		wantRetry bool
	}{
		{401, "authentication_error", "invalid x-api-key", KindAuth, false},
		{403, "permission_error", "no access to model", KindPermission, false},
		{404, "not_found_error", "model: nope", KindNotFound, false},
		{413, "request_too_large", "request too large", KindContextLength, false},
		{400, "invalid_request_error", "prompt is too long: 2000000 tokens", KindContextLength, false},
		{400, "invalid_request_error", "messages: roles must alternate", KindInvalidRequest, false},
		{409, "conflict", "conflict", KindInvalidRequest, false},
		{429, "rate_limit_error", "slow down", KindRateLimit, true},
		{500, "api_error", "boom", KindServer, true},
		{529, "overloaded_error", "overloaded", KindOverloaded, true},
	}
	for _, c := range cases {
		kind, retry := classifyStatus(c.status, c.errType, c.message)
		if kind != c.wantKind || retry != c.wantRetry {
			t.Errorf("classifyStatus(%d, %q) = %q/%v, want %q/%v",
				c.status, c.errType, kind, retry, c.wantKind, c.wantRetry)
		}
	}
}

func TestParseRetryAfter(t *testing.T) {
	now := time.Date(2026, 9, 6, 12, 0, 0, 0, time.UTC)

	cases := []struct {
		header string
		want   time.Duration
	}{
		{"", 0},
		{"12", 12 * time.Second},
		{"-5", 0},
		{"nonsense", 0},
		{now.Add(30 * time.Second).Format(http.TimeFormat), 30 * time.Second},
		{now.Add(-time.Minute).Format(http.TimeFormat), 0},
	}
	for _, c := range cases {
		h := http.Header{}
		if c.header != "" {
			h.Set("Retry-After", c.header)
		}
		if got := parseRetryAfter(h, now); got != c.want {
			t.Errorf("parseRetryAfter(%q) = %s, want %s", c.header, got, c.want)
		}
	}
}
