package llm

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
)

// sseEvent is every streaming event flattened into one struct, for the same reason
// wireBlock is: each event type sets its own fields and leaves the rest absent.
type sseEvent struct {
	Type    string `json:"type"`
	Index   int    `json:"index"`
	Message *struct {
		Model string    `json:"model"`
		Usage wireUsage `json:"usage"`
	} `json:"message"`
	ContentBlock *wireBlock `json:"content_block"`
	Delta        *struct {
		Type        string `json:"type"`
		Text        string `json:"text"`
		PartialJSON string `json:"partial_json"`
		Thinking    string `json:"thinking"`
		Signature   string `json:"signature"`
		StopReason  string `json:"stop_reason"`
	} `json:"delta"`
	Usage *wireUsage `json:"usage"`
	Error *struct {
		Type    string `json:"type"`
		Message string `json:"message"`
	} `json:"error"`
}

// streamBlock is one content block under construction. Text and tool arguments both arrive
// in fragments, so nothing can be decoded until content_block_stop.
type streamBlock struct {
	typ   string
	text  strings.Builder
	id    string
	name  string
	input strings.Builder
	// seeded records that input holds the placeholder object content_block_start carries
	// for a tool_use block. The real arguments arrive as deltas, and appending them to the
	// placeholder would produce "{}{...}" — valid-looking nonsense that decodes to nothing.
	seeded    bool
	signature string
}

type streamAcc struct {
	blocks []*streamBlock
	out    Response
	done   bool
}

// readStream consumes the SSE body and assembles the same Response a non-streamed call
// would have returned, calling onText for each text fragment on the way.
func readStream(ctx context.Context, res *http.Response, onText func(delta string) error) (Response, error) {
	defer func() { _ = res.Body.Close() }()

	r := bufio.NewReader(io.LimitReader(res.Body, maxResponseBody))
	acc := &streamAcc{}
	var data strings.Builder

	// dispatch runs one complete event and reports whether the stream is finished.
	dispatch := func() (bool, error) {
		if data.Len() == 0 {
			return false, nil
		}
		payload := data.String()
		data.Reset()
		return acc.handle(payload, onText)
	}

	for {
		line, err := r.ReadString('\n')
		if line != "" {
			if complete := feed(&data, line); complete {
				done, derr := dispatch()
				if derr != nil {
					return Response{}, derr
				}
				if done {
					break
				}
			}
		}
		if err != nil {
			// A cancelled context reaches here as a read error on the body; it is the
			// caller stopping, not the provider failing.
			if ctxErr := context.Cause(ctx); ctxErr != nil {
				return Response{}, ctxError(ctxErr)
			}
			if !errors.Is(err, io.EOF) {
				return Response{}, &Error{Kind: KindTransport, Retryable: true, Message: "reading stream", Err: err}
			}
			if done, derr := dispatch(); derr != nil {
				return Response{}, derr
			} else if done {
				break
			}
			break
		}
	}

	if !acc.done {
		// A stream that stops before message_stop leaves a half-written answer. Reporting
		// it as a success would put a truncated assistant turn into the conversation, where
		// it is indistinguishable from one the model actually finished.
		return Response{}, &Error{
			Kind:      KindTransport,
			Retryable: true,
			Message:   "stream ended before message_stop",
		}
	}
	return acc.response(), nil
}

// feed adds one raw line to the current event buffer and reports whether the event is
// complete (SSE separates events with a blank line).
func feed(data *strings.Builder, raw string) bool {
	line := strings.TrimRight(raw, "\r\n")
	switch {
	case line == "":
		return true
	case strings.HasPrefix(line, ":"):
		return false // comment, and the API's keep-alive
	}
	value, ok := strings.CutPrefix(line, "data:")
	if !ok {
		// "event:" and any future field: the payload names its own type, so the framing
		// fields are noise here.
		return false
	}
	if data.Len() > 0 {
		data.WriteByte('\n')
	}
	data.WriteString(strings.TrimPrefix(value, " "))
	return false
}

func (a *streamAcc) handle(payload string, onText func(delta string) error) (bool, error) {
	if strings.TrimSpace(payload) == "[DONE]" {
		return true, nil
	}
	var ev sseEvent
	if err := json.Unmarshal([]byte(payload), &ev); err != nil {
		return false, &Error{Kind: KindDecode, Message: "decoding stream event", Err: err}
	}

	switch ev.Type {
	case "error":
		kind, retryable := KindServer, true
		var errType, message string
		if ev.Error != nil {
			errType, message = ev.Error.Type, ev.Error.Message
			kind, retryable = classifyErrorType(errType, message)
		}
		return false, &Error{Kind: kind, Type: errType, Message: message, Retryable: retryable}

	case "message_start":
		if ev.Message != nil {
			a.out.Model = ev.Message.Model
			a.out.Usage = ev.Message.Usage.toUsage()
		}

	case "content_block_start":
		block := &streamBlock{}
		if ev.ContentBlock != nil {
			block.typ = ev.ContentBlock.Type
			block.id = ev.ContentBlock.ID
			block.name = ev.ContentBlock.Name
			block.signature = ev.ContentBlock.Signature
			if ev.ContentBlock.Type == BlockRedactedThinking {
				block.signature = ev.ContentBlock.Data
			}
			// A text block can start with content already in it.
			block.text.WriteString(ev.ContentBlock.Text + ev.ContentBlock.Thinking)
			if trimmed := strings.TrimSpace(string(ev.ContentBlock.Input)); trimmed != "" && trimmed != "null" {
				block.input.WriteString(trimmed)
				block.seeded = true
			}
		}
		a.set(ev.Index, block)

	case "content_block_delta":
		block := a.at(ev.Index)
		if block == nil || ev.Delta == nil {
			break
		}
		switch ev.Delta.Type {
		case "text_delta":
			block.text.WriteString(ev.Delta.Text)
			if onText != nil && ev.Delta.Text != "" {
				if err := onText(ev.Delta.Text); err != nil {
					return false, fmt.Errorf("llm: stream aborted by caller: %w", err)
				}
			}
		case "input_json_delta":
			if block.seeded {
				block.input.Reset()
				block.seeded = false
			}
			block.input.WriteString(ev.Delta.PartialJSON)
		case "thinking_delta":
			block.text.WriteString(ev.Delta.Thinking)
		case "signature_delta":
			block.signature += ev.Delta.Signature
		}

	case "message_delta":
		if ev.Delta != nil && ev.Delta.StopReason != "" {
			a.out.StopReason = ev.Delta.StopReason
		}
		if ev.Usage != nil {
			// message_delta carries the running totals; message_start only had the input
			// side. Zero fields here mean "unchanged", not "none".
			u := ev.Usage.toUsage()
			if u.OutputTokens > 0 {
				a.out.Usage.OutputTokens = u.OutputTokens
			}
			if u.InputTokens > 0 {
				a.out.Usage.InputTokens = u.InputTokens
			}
			if u.CacheCreationInputTokens > 0 {
				a.out.Usage.CacheCreationInputTokens = u.CacheCreationInputTokens
			}
			if u.CacheReadInputTokens > 0 {
				a.out.Usage.CacheReadInputTokens = u.CacheReadInputTokens
			}
		}

	case "message_stop":
		a.done = true
		return true, nil
	}
	return false, nil
}

func (a *streamAcc) set(index int, block *streamBlock) {
	for len(a.blocks) <= index {
		a.blocks = append(a.blocks, nil)
	}
	a.blocks[index] = block
}

func (a *streamAcc) at(index int) *streamBlock {
	if index < 0 || index >= len(a.blocks) {
		return nil
	}
	return a.blocks[index]
}

func (a *streamAcc) response() Response {
	out := a.out
	for _, b := range a.blocks {
		if b == nil {
			continue
		}
		switch b.typ {
		case BlockText:
			out.Content = append(out.Content, Block{Type: BlockText, Text: b.text.String()})
		case BlockToolUse:
			// A malformed argument fragment is not worth failing the whole turn over: an
			// empty map reaches the tool, which rejects it with a message the model can act
			// on, rather than killing a conversation that may hold real work.
			input, _ := decodeToolInput(json.RawMessage(b.input.String()))
			out.Content = append(out.Content, Block{
				Type:  BlockToolUse,
				ID:    b.id,
				Name:  b.name,
				Input: input,
			})
		case BlockThinking:
			out.Content = append(out.Content, Block{Type: BlockThinking, Text: b.text.String(), Signature: b.signature})
		case BlockRedactedThinking:
			out.Content = append(out.Content, Block{Type: BlockRedactedThinking, Signature: b.signature})
		}
	}
	return out
}
