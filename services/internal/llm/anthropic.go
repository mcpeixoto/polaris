package llm

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/rand/v2"
	"net/http"
	"strings"
	"time"
)

const (
	// DefaultBaseURL is the public API root. Overridden in tests, and by a gateway.
	DefaultBaseURL = "https://api.anthropic.com"

	// DefaultModel is what an empty model argument means.
	DefaultModel = "claude-opus-5"

	// apiVersion is the only version this wire format is written against. It is not a
	// setting: the request and response shapes below are what 2023-06-01 accepts.
	apiVersion = "2023-06-01"

	// DefaultMaxTokens caps a non-streaming turn when Request.MaxTokens is zero. Sized to
	// leave room for a real answer while staying under the HTTP timeout — a truncated
	// response costs a whole retry, so lowballing this is the expensive mistake.
	DefaultMaxTokens = 16000

	// DefaultStreamMaxTokens caps a streamed turn when Request.MaxTokens is zero. Higher
	// than the non-streaming default because a stream cannot time out mid-answer.
	DefaultStreamMaxTokens = 64000

	// maxResponseBody caps what is read from a response, so a wrong base URL pointing at
	// something enormous cannot exhaust the process.
	maxResponseBody = 32 << 20
)

// ThinkingMode selects whether the model reasons before answering.
type ThinkingMode string

const (
	// ThinkingDisabled is this package's default. See WithThinking.
	ThinkingDisabled ThinkingMode = "disabled"
	// ThinkingAdaptive lets the model decide how much to think per turn.
	ThinkingAdaptive ThinkingMode = "adaptive"
)

// Effort trades thoroughness against tokens spent. Empty means the server default (high).
type Effort string

const (
	EffortLow    Effort = "low"
	EffortMedium Effort = "medium"
	EffortHigh   Effort = "high"
	EffortXHigh  Effort = "xhigh"
	EffortMax    Effort = "max"
)

// toolTextGuardrail is appended to the system prompt when thinking is off and tools are in
// play. With thinking disabled the model occasionally writes a tool call as prose instead
// of emitting a tool_use block: the turn succeeds, the call never runs, nothing errors, and
// the text pollutes every later turn of the loop. This is the mitigation Anthropic
// documents for that failure mode. It is dropped as soon as thinking is enabled.
const toolTextGuardrail = "When you use a tool, you may say a brief sentence first. " +
	"If no tool can express what the user asked for, say so instead of guessing. " +
	"Do not include internal or system XML tags in your response."

// Option tunes the Anthropic provider. The zero configuration is what the agent runs with;
// these exist for the cases where it must not.
type Option func(*anthropic)

// WithThinking turns extended thinking on or off.
//
// Default: off. With thinking on, the API requires every thinking block to be echoed back
// verbatim inside the assistant turn that precedes a tool_result, and rejects the request
// when they are missing. This package can carry them (Block type "thinking", signature
// intact) but only if the agent loop appends the whole of Response.Content to its history —
// a loop that rebuilds the assistant message from text and tool_use blocks alone will 400
// on its second turn. Off by default so that mistake is impossible; turn it on once the
// loop is known to round-trip content unmodified.
func WithThinking(mode ThinkingMode) Option {
	return func(a *anthropic) { a.thinking = mode }
}

// WithEffort sets output_config.effort. Lower effort is the cheap lever: it cuts tokens
// without changing model.
func WithEffort(e Effort) Option {
	return func(a *anthropic) { a.effort = e }
}

// WithPromptCaching controls the cache breakpoint on the system prompt.
//
// On by default. The breakpoint sits at the end of the system block, which the API renders
// after the tool definitions — so one marker caches the tools plus the system prompt, the
// half of an agent request that is identical on every turn of a loop. It never covers the
// messages, so a cache write can never be paid for content that will not be reused.
func WithPromptCaching(on bool) Option {
	return func(a *anthropic) { a.cacheSystem = on }
}

// WithRetry bounds the automatic retry of 429/5xx/transport failures: at most attempts
// requests in total, with exponential backoff from base. attempts < 1 means no retry.
func WithRetry(attempts int, base time.Duration) Option {
	return func(a *anthropic) {
		a.maxAttempts = max(attempts, 1)
		if base > 0 {
			a.baseDelay = base
		}
	}
}

type anthropic struct {
	apiKey  string
	model   string
	baseURL string
	http    *http.Client

	thinking    ThinkingMode
	effort      Effort
	cacheSystem bool

	maxAttempts int
	baseDelay   time.Duration
	maxDelay    time.Duration
}

// NewAnthropic builds the real client. baseURL empty means the public API; model empty
// means DefaultModel; hc nil means a client with a timeout long enough for a full streamed
// turn. The key is never logged, and appears in exactly one place: the x-api-key header.
func NewAnthropic(apiKey, model, baseURL string, hc *http.Client, opts ...Option) Provider {
	if model == "" {
		model = DefaultModel
	}
	if baseURL == "" {
		baseURL = DefaultBaseURL
	}
	if hc == nil {
		hc = &http.Client{Timeout: 10 * time.Minute}
	}
	a := &anthropic{
		apiKey:      apiKey,
		model:       model,
		baseURL:     strings.TrimRight(baseURL, "/"),
		http:        hc,
		thinking:    ThinkingDisabled,
		cacheSystem: true,
		maxAttempts: 4,
		baseDelay:   500 * time.Millisecond,
		maxDelay:    30 * time.Second,
	}
	for _, opt := range opts {
		opt(a)
	}
	return a
}

func (a *anthropic) Name() string  { return "anthropic" }
func (a *anthropic) Model() string { return a.model }

func (a *anthropic) Complete(ctx context.Context, req Request) (Response, error) {
	payload, err := a.wire(req, false)
	if err != nil {
		return Response{}, err
	}
	res, err := a.do(ctx, payload, false)
	if err != nil {
		return Response{}, err
	}
	defer func() { _ = res.Body.Close() }()

	body, err := io.ReadAll(io.LimitReader(res.Body, maxResponseBody))
	if err != nil {
		if ctx.Err() != nil {
			return Response{}, ctxError(ctx.Err())
		}
		return Response{}, &Error{Kind: KindTransport, Retryable: true, Message: "reading response", Err: err}
	}
	var wire wireResponse
	if err := json.Unmarshal(body, &wire); err != nil {
		return Response{}, &Error{Kind: KindDecode, Status: res.StatusCode, Message: "decoding response", Err: err}
	}
	return wire.toResponse()
}

func (a *anthropic) Stream(ctx context.Context, req Request, onText func(delta string) error) (Response, error) {
	payload, err := a.wire(req, true)
	if err != nil {
		return Response{}, err
	}
	res, err := a.do(ctx, payload, true)
	if err != nil {
		return Response{}, err
	}
	return readStream(ctx, res, onText)
}

// do sends the payload, retrying the failures worth retrying, and returns the live 200
// response with its body unread — the streaming path needs the body, not a buffer.
//
// Retries stop the moment a 200 arrives, which means a stream that fails after its first
// byte is never retried: replaying it would deliver the deltas the caller has already seen.
func (a *anthropic) do(ctx context.Context, payload []byte, stream bool) (*http.Response, error) {
	for attempt := 0; ; attempt++ {
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, a.baseURL+"/v1/messages", bytes.NewReader(payload))
		if err != nil {
			return nil, &Error{Kind: KindInvalidRequest, Message: "building request", Err: err}
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("x-api-key", a.apiKey)
		req.Header.Set("anthropic-version", apiVersion)
		if stream {
			req.Header.Set("Accept", "text/event-stream")
		} else {
			req.Header.Set("Accept", "application/json")
		}

		res, err := a.http.Do(req)
		if err != nil {
			// A cancelled context surfaces here as a transport error; reporting it as one
			// would tell the caller to retry something they deliberately stopped.
			if ctxErr := context.Cause(ctx); ctxErr != nil {
				return nil, ctxError(ctxErr)
			}
			failure := &Error{Kind: KindTransport, Retryable: true, Message: "sending request", Err: err}
			if next, stop := a.backoff(attempt, 0); !stop {
				if werr := sleep(ctx, next); werr != nil {
					return nil, werr
				}
				continue
			}
			return nil, failure
		}
		if res.StatusCode == http.StatusOK {
			return res, nil
		}

		failure := a.apiError(res)
		if !failure.Retryable {
			return nil, failure
		}
		next, stop := a.backoff(attempt, failure.RetryAfter)
		if stop {
			return nil, failure
		}
		if werr := sleep(ctx, next); werr != nil {
			return nil, werr
		}
	}
}

// apiError reads and closes a non-200 response, turning it into a classified *Error.
func (a *anthropic) apiError(res *http.Response) *Error {
	defer func() { _ = res.Body.Close() }()
	body, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))

	var wire struct {
		Error struct {
			Type    string `json:"type"`
			Message string `json:"message"`
		} `json:"error"`
		RequestID string `json:"request_id"`
	}
	_ = json.Unmarshal(body, &wire)

	message := wire.Error.Message
	if message == "" {
		message = strings.TrimSpace(string(body))
	}
	if message == "" {
		message = http.StatusText(res.StatusCode)
	}
	requestID := wire.RequestID
	if requestID == "" {
		requestID = res.Header.Get("request-id")
	}

	kind, retryable := classifyStatus(res.StatusCode, wire.Error.Type, message)
	return &Error{
		Kind:       kind,
		Status:     res.StatusCode,
		Type:       wire.Error.Type,
		Message:    message,
		RequestID:  requestID,
		RetryAfter: parseRetryAfter(res.Header, time.Now()),
		Retryable:  retryable,
	}
}

// backoff returns how long to wait before attempt+1, and whether to give up instead.
//
// Full jitter on top of the exponential curve: a rate limit hits every in-flight request at
// once, and a fixed schedule would march them back into the wall together.
func (a *anthropic) backoff(attempt int, retryAfter time.Duration) (time.Duration, bool) {
	if attempt+1 >= a.maxAttempts {
		return 0, true
	}
	if retryAfter > 0 {
		// The server's own instruction wins, capped so a hostile or wrong header cannot
		// pin a request for an hour.
		return min(retryAfter, a.maxDelay), false
	}
	delay := a.baseDelay << attempt
	if delay > a.maxDelay || delay <= 0 {
		delay = a.maxDelay
	}
	return delay/2 + time.Duration(rand.Int64N(int64(delay/2)+1)), false
}

func sleep(ctx context.Context, d time.Duration) error {
	if d <= 0 {
		return nil
	}
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return ctxError(context.Cause(ctx))
	case <-t.C:
		return nil
	}
}

// --- wire format ---------------------------------------------------------------------

type wireRequest struct {
	Model        string            `json:"model"`
	MaxTokens    int               `json:"max_tokens"`
	System       []wireSystemBlock `json:"system,omitempty"`
	Messages     []wireMessage     `json:"messages"`
	Tools        []wireTool        `json:"tools,omitempty"`
	Thinking     *wireThinking     `json:"thinking,omitempty"`
	OutputConfig *wireOutputConfig `json:"output_config,omitempty"`
	Stream       bool              `json:"stream,omitempty"`
}

type wireSystemBlock struct {
	Type         string        `json:"type"`
	Text         string        `json:"text"`
	CacheControl *cacheControl `json:"cache_control,omitempty"`
}

type cacheControl struct {
	Type string `json:"type"`
}

type wireMessage struct {
	Role    string      `json:"role"`
	Content []wireBlock `json:"content"`
}

// wireBlock is every content block shape in one struct. The API ignores absent fields and
// each type only ever sets its own, so one struct with omitempty beats five types plus a
// custom marshaller.
type wireBlock struct {
	Type string `json:"type"`

	Text string `json:"text,omitempty"`

	ID    string          `json:"id,omitempty"`
	Name  string          `json:"name,omitempty"`
	Input json.RawMessage `json:"input,omitempty"`

	ToolUseID string `json:"tool_use_id,omitempty"`
	Content   string `json:"content,omitempty"`
	IsError   bool   `json:"is_error,omitempty"`

	Thinking  string `json:"thinking,omitempty"`
	Signature string `json:"signature,omitempty"`
	Data      string `json:"data,omitempty"`
}

type wireTool struct {
	Name        string         `json:"name"`
	Description string         `json:"description,omitempty"`
	InputSchema map[string]any `json:"input_schema"`
}

type wireThinking struct {
	Type string `json:"type"`
}

type wireOutputConfig struct {
	Effort string `json:"effort,omitempty"`
}

// wire builds and marshals the request body. Validation happens here rather than at the
// server: a 400 for an empty messages array costs a round trip to say what a type check
// already knew.
func (a *anthropic) wire(req Request, stream bool) ([]byte, error) {
	if len(req.Messages) == 0 {
		return nil, &Error{Kind: KindInvalidRequest, Message: "request has no messages"}
	}

	maxTokens := req.MaxTokens
	if maxTokens <= 0 {
		maxTokens = DefaultMaxTokens
		if stream {
			maxTokens = DefaultStreamMaxTokens
		}
	}

	out := wireRequest{
		Model:     a.model,
		MaxTokens: maxTokens,
		Stream:    stream,
	}

	system := req.System
	if a.thinking == ThinkingDisabled && len(req.Tools) > 0 {
		if system != "" {
			system += "\n\n"
		}
		system += toolTextGuardrail
	}
	if system != "" {
		block := wireSystemBlock{Type: "text", Text: system}
		if a.cacheSystem {
			block.CacheControl = &cacheControl{Type: "ephemeral"}
		}
		out.System = []wireSystemBlock{block}
	}

	for i, msg := range req.Messages {
		if msg.Role != RoleUser && msg.Role != RoleAssistant {
			return nil, &Error{Kind: KindInvalidRequest, Message: fmt.Sprintf("message %d has role %q", i, msg.Role)}
		}
		if len(msg.Content) == 0 {
			return nil, &Error{Kind: KindInvalidRequest, Message: fmt.Sprintf("message %d has no content", i)}
		}
		blocks := make([]wireBlock, 0, len(msg.Content))
		for j, b := range msg.Content {
			wb, err := toWireBlock(b)
			if err != nil {
				return nil, &Error{Kind: KindInvalidRequest, Message: fmt.Sprintf("message %d block %d: %s", i, j, err)}
			}
			blocks = append(blocks, wb)
		}
		out.Messages = append(out.Messages, wireMessage{Role: string(msg.Role), Content: blocks})
	}

	for i, t := range req.Tools {
		if t.Name == "" {
			return nil, &Error{Kind: KindInvalidRequest, Message: fmt.Sprintf("tool %d has no name", i)}
		}
		schema := t.InputSchema
		if schema == nil {
			schema = map[string]any{"type": "object", "properties": map[string]any{}}
		}
		out.Tools = append(out.Tools, wireTool{Name: t.Name, Description: t.Description, InputSchema: schema})
	}

	// Thinking is only ever sent explicitly: on this model family it is on by default, so
	// omitting the field would enable it by accident.
	out.Thinking = &wireThinking{Type: string(a.thinking)}
	if a.effort != "" {
		out.OutputConfig = &wireOutputConfig{Effort: string(a.effort)}
	}

	body, err := json.Marshal(out)
	if err != nil {
		return nil, &Error{Kind: KindInvalidRequest, Message: "encoding request", Err: err}
	}
	return body, nil
}

func toWireBlock(b Block) (wireBlock, error) {
	switch b.Type {
	case BlockText:
		if b.Text == "" {
			return wireBlock{}, errors.New("empty text block")
		}
		return wireBlock{Type: BlockText, Text: b.Text}, nil
	case BlockToolUse:
		if b.ID == "" || b.Name == "" {
			return wireBlock{}, errors.New("tool_use needs an id and a name")
		}
		input := b.Input
		if input == nil {
			// A tool with no arguments still has to send an object; null is a 400.
			input = map[string]any{}
		}
		raw, err := json.Marshal(input)
		if err != nil {
			return wireBlock{}, fmt.Errorf("tool_use input: %w", err)
		}
		return wireBlock{Type: BlockToolUse, ID: b.ID, Name: b.Name, Input: raw}, nil
	case BlockToolResult:
		if b.ToolUseID == "" {
			return wireBlock{}, errors.New("tool_result needs a tool_use_id")
		}
		return wireBlock{Type: BlockToolResult, ToolUseID: b.ToolUseID, Content: b.Content, IsError: b.IsError}, nil
	case BlockThinking:
		return wireBlock{Type: BlockThinking, Thinking: b.Text, Signature: b.Signature}, nil
	case BlockRedactedThinking:
		return wireBlock{Type: BlockRedactedThinking, Data: b.Signature}, nil
	default:
		return wireBlock{}, fmt.Errorf("unknown block type %q", b.Type)
	}
}

type wireUsage struct {
	InputTokens              int `json:"input_tokens"`
	OutputTokens             int `json:"output_tokens"`
	CacheCreationInputTokens int `json:"cache_creation_input_tokens"`
	CacheReadInputTokens     int `json:"cache_read_input_tokens"`
}

func (u wireUsage) toUsage() Usage {
	return Usage{
		InputTokens:              u.InputTokens,
		OutputTokens:             u.OutputTokens,
		CacheCreationInputTokens: u.CacheCreationInputTokens,
		CacheReadInputTokens:     u.CacheReadInputTokens,
	}
}

type wireResponse struct {
	ID         string      `json:"id"`
	Type       string      `json:"type"`
	Model      string      `json:"model"`
	Content    []wireBlock `json:"content"`
	StopReason string      `json:"stop_reason"`
	Usage      wireUsage   `json:"usage"`
}

func (w wireResponse) toResponse() (Response, error) {
	out := Response{
		StopReason: w.StopReason,
		Usage:      w.Usage.toUsage(),
		Model:      w.Model,
	}
	for _, b := range w.Content {
		block, err := fromWireBlock(b)
		if err != nil {
			return Response{}, &Error{Kind: KindDecode, Message: err.Error()}
		}
		if block.Type == "" {
			continue // a block type this package does not model; dropping it beats guessing
		}
		out.Content = append(out.Content, block)
	}
	return out, nil
}

func fromWireBlock(b wireBlock) (Block, error) {
	switch b.Type {
	case BlockText:
		return Block{Type: BlockText, Text: b.Text}, nil
	case BlockToolUse:
		input, err := decodeToolInput(b.Input)
		if err != nil {
			return Block{}, fmt.Errorf("tool_use %q input: %w", b.ID, err)
		}
		return Block{Type: BlockToolUse, ID: b.ID, Name: b.Name, Input: input}, nil
	case BlockThinking:
		return Block{Type: BlockThinking, Text: b.Thinking, Signature: b.Signature}, nil
	case BlockRedactedThinking:
		return Block{Type: BlockRedactedThinking, Signature: b.Data}, nil
	default:
		return Block{}, nil
	}
}

// decodeToolInput always returns a non-nil map: a tool handler that has to nil-check its
// arguments before every lookup is a handler that will forget once.
func decodeToolInput(raw json.RawMessage) (map[string]any, error) {
	input := map[string]any{}
	trimmed := strings.TrimSpace(string(raw))
	if trimmed == "" || trimmed == "null" {
		return input, nil
	}
	if err := json.Unmarshal(raw, &input); err != nil {
		return nil, err
	}
	if input == nil {
		input = map[string]any{}
	}
	return input, nil
}
