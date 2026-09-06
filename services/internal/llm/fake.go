package llm

import (
	"context"
	"fmt"
	"sync"
)

// Fake is a scripted provider for tests: it returns Responses in order and records the
// Requests it was given.
//
// It exists so the agent loop can be tested for what it does with a tool call, a refusal or
// a truncated turn without an HTTP server in the middle — the transport is anthropic.go's
// business and is tested there.
type Fake struct {
	// Responses are handed out in order, one per Complete or Stream call. Running past the
	// end is an error rather than a repeat: a loop that calls one more time than the test
	// expected is exactly the bug worth failing on.
	Responses []Response
	// Errs, when an entry is non-nil, is returned instead of the Response at the same
	// index. Shorter than Responses is fine; a missing entry means success.
	Errs []error
	// ProviderName and ModelID answer Name and Model. Empty means the defaults below.
	ProviderName string
	ModelID      string

	mu       sync.Mutex
	requests []Request
	calls    int
}

// NewFake scripts a provider that returns these responses in order.
func NewFake(responses ...Response) *Fake {
	return &Fake{Responses: responses}
}

// TextResponse is the common one-line script: a finished turn holding one text block.
func TextResponse(text string) Response {
	return Response{
		Content:    []Block{{Type: BlockText, Text: text}},
		StopReason: "end_turn",
		Usage:      Usage{InputTokens: 1, OutputTokens: 1},
	}
}

// ToolUseResponse scripts a turn that asks for one tool call.
func ToolUseResponse(id, name string, input map[string]any) Response {
	if input == nil {
		input = map[string]any{}
	}
	return Response{
		Content:    []Block{{Type: BlockToolUse, ID: id, Name: name, Input: input}},
		StopReason: "tool_use",
		Usage:      Usage{InputTokens: 1, OutputTokens: 1},
	}
}

func (f *Fake) Name() string {
	if f.ProviderName != "" {
		return f.ProviderName
	}
	return "fake"
}

func (f *Fake) Model() string {
	if f.ModelID != "" {
		return f.ModelID
	}
	return "fake-model"
}

func (f *Fake) Complete(ctx context.Context, req Request) (Response, error) {
	if err := ctx.Err(); err != nil {
		return Response{}, ctxError(err)
	}
	return f.next(req)
}

// Stream replays each text block as a single delta. Splitting them further would test the
// caller's reassembly against a fiction; the real chunk boundaries are the model's.
func (f *Fake) Stream(ctx context.Context, req Request, onText func(delta string) error) (Response, error) {
	if err := ctx.Err(); err != nil {
		return Response{}, ctxError(err)
	}
	res, err := f.next(req)
	if err != nil {
		return Response{}, err
	}
	for _, b := range res.Content {
		if b.Type != BlockText || b.Text == "" || onText == nil {
			continue
		}
		if err := onText(b.Text); err != nil {
			return Response{}, fmt.Errorf("llm: stream aborted by caller: %w", err)
		}
	}
	return res, nil
}

func (f *Fake) next(req Request) (Response, error) {
	f.mu.Lock()
	defer f.mu.Unlock()

	i := f.calls
	f.calls++
	f.requests = append(f.requests, req)

	if i < len(f.Errs) && f.Errs[i] != nil {
		return Response{}, f.Errs[i]
	}
	if i >= len(f.Responses) {
		return Response{}, fmt.Errorf("llm: fake has no response scripted for call %d", i+1)
	}
	return f.Responses[i], nil
}

// Requests returns the requests the provider was given, in order.
func (f *Fake) Requests() []Request {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]Request(nil), f.requests...)
}

// Calls is how many times the provider was asked for a turn.
func (f *Fake) Calls() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.calls
}
