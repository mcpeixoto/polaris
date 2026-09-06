// Package llm is the provider abstraction the in-app agent talks to.
//
// The types here are deliberately the smallest shape that can express a tool-using
// conversation: text, a tool call, a tool result. They are not the Anthropic wire format —
// mapping onto it is anthropic.go's job — because the agent loop should not have to be
// rewritten the day a second provider appears, and because a loop written against the raw
// wire types ends up asserting on JSON tags in its tests.
//
// There is no vendor SDK behind this. One POST and one SSE stream do not justify a
// dependency that pins its own API version and has to be upgraded on someone else's
// schedule — the same call this repo already made for Stripe.
package llm

import "context"

// Role is the author of a message. There is no system role: the system prompt is a field
// on Request, which is where the API puts it too.
type Role string

const (
	RoleUser      Role = "user"
	RoleAssistant Role = "assistant"
)

// Block type discriminators. These are the wire values, so a caller switching on
// Block.Type reads the same strings as the API documentation.
const (
	BlockText       = "text"
	BlockToolUse    = "tool_use"
	BlockToolResult = "tool_result"
	// BlockThinking and BlockRedactedThinking only appear when the provider was built with
	// WithThinking(ThinkingAdaptive). They must be echoed back verbatim in the assistant
	// message on the next turn — see WithThinking for what happens when they are not.
	BlockThinking         = "thinking"
	BlockRedactedThinking = "redacted_thinking"
)

// Block is one piece of content. Type is "text", "tool_use", or "tool_result" (plus
// "thinking"/"redacted_thinking" when thinking is enabled).
type Block struct {
	Type      string
	Text      string         // text, thinking
	ID        string         // tool_use: the id the model assigned
	Name      string         // tool_use: tool name
	Input     map[string]any // tool_use: arguments
	ToolUseID string         // tool_result: which tool_use this answers
	Content   string         // tool_result: the result, already serialised
	IsError   bool           // tool_result
	// Signature authenticates a thinking block. Opaque; the API rejects an edited one, so
	// it is carried through untouched or not at all. For redacted_thinking it holds the
	// encrypted payload instead.
	Signature string
}

// Message is one turn.
type Message struct {
	Role    Role
	Content []Block
}

// ToolSpec describes a tool the model may call. InputSchema is a JSON Schema object; the
// agent's tool registry already builds these, so it is passed through unexamined.
type ToolSpec struct {
	Name, Description string
	InputSchema       map[string]any
}

// Request is one call. It carries the whole conversation: the API is stateless and so is
// this package — nothing is remembered between calls.
type Request struct {
	System    string
	Messages  []Message
	Tools     []ToolSpec
	MaxTokens int
}

// Usage is what the turn cost. A later phase bills against these numbers, so all four are
// reported: cached input is charged at a different rate from fresh input, and a caller that
// sums only InputTokens would silently under-report a cache write and over-report a read.
type Usage struct {
	InputTokens  int
	OutputTokens int
	// CacheCreationInputTokens is input written to the prompt cache (~1.25x input price).
	CacheCreationInputTokens int
	// CacheReadInputTokens is input served from the prompt cache (~0.1x input price). It is
	// not included in InputTokens.
	CacheReadInputTokens int
}

// Response is one assistant turn.
type Response struct {
	Content    []Block
	StopReason string // "end_turn", "tool_use", "max_tokens", ...
	Usage      Usage
	// Model is the model that actually served the turn. Recorded rather than assumed
	// because billing is per model and the provider may route elsewhere.
	Model string
}

// Text is every text block joined, which is what a caller wants when it does not care
// about block structure.
func (r Response) Text() string {
	var out string
	for _, b := range r.Content {
		if b.Type == BlockText {
			out += b.Text
		}
	}
	return out
}

// ToolUses returns the tool calls in the turn. Non-empty exactly when StopReason is
// "tool_use".
func (r Response) ToolUses() []Block {
	var out []Block
	for _, b := range r.Content {
		if b.Type == BlockToolUse {
			out = append(out, b)
		}
	}
	return out
}

// Provider is one model behind one endpoint.
type Provider interface {
	Name() string
	Model() string
	// Complete is one turn. StopReason "tool_use" means Content holds tool_use blocks
	// the caller must execute and feed back as tool_result blocks.
	Complete(ctx context.Context, req Request) (Response, error)
	// Stream is Complete with incremental text. onText is called with each text delta as
	// it arrives; the final assembled Response is returned. onText returning an error
	// aborts the stream and that error is returned.
	Stream(ctx context.Context, req Request, onText func(delta string) error) (Response, error)
}
