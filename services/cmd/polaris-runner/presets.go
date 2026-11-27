package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
)

// promptVia is how the preset receives the issue prompt.
type promptVia int

const (
	viaStdin promptVia = iota
	viaArg
)

// Presets are data: the argv, where the prompt goes, how a previous session is
// resumed, and which parser reads the CLI's stdout. Unattended flags are not
// part of the default argv. The agent's own permission config stays in force
// unless the operator passes --unsafe-auto-approve.
type preset struct {
	name         string
	bin          string
	binEnv       string
	args         []string
	holdLast     bool
	resumeFlag   string
	promptVia    promptVia
	unsafe       []string
	maxTurnsFlag string
	parse        func([]byte, *outcome)
}

type launch struct {
	bin       string
	args      []string
	promptVia promptVia
}

var presets = []preset{
	{
		name:         "claude",
		bin:          "claude",
		binEnv:       "POLARIS_RUNNER_CLAUDE_BIN",
		args:         []string{"-p", "--output-format", "stream-json", "--verbose"},
		resumeFlag:   "--resume",
		promptVia:    viaStdin,
		unsafe:       []string{"--dangerously-skip-permissions"},
		maxTurnsFlag: "--max-turns",
		parse:        parseClaude,
	},
	{
		// The trailing "-" is the prompt source (stdin). Resume and the
		// unattended flag have to sit in front of it or codex treats them as
		// the prompt.
		name:       "codex",
		bin:        "codex",
		binEnv:     "POLARIS_RUNNER_CODEX_BIN",
		args:       []string{"exec", "--json", "-"},
		holdLast:   true,
		resumeFlag: "resume",
		promptVia:  viaStdin,
		unsafe:     []string{"--full-auto"},
		parse:      parseDefensive,
	},
	{
		name:       "opencode",
		bin:        "opencode",
		binEnv:     "POLARIS_RUNNER_OPENCODE_BIN",
		args:       []string{"run", "--format", "json"},
		resumeFlag: "--session",
		promptVia:  viaArg,
		parse:      parseDefensive,
	},
}

func lookupPreset(name string) (preset, error) {
	for _, p := range presets {
		if p.name == name {
			return p, nil
		}
	}
	return preset{}, fmt.Errorf("unknown preset %q", name)
}

func (p preset) launch(session, prompt string, maxTurns int, unsafe bool) (launch, error) {
	// COPY: these are the errors for flags the preset cannot honour. Silent
	// success would look like the cap or the permission skip had been applied.
	if maxTurns > 0 && p.maxTurnsFlag == "" {
		return launch{}, fmt.Errorf("--max-turns is not supported by the %s preset", p.name)
	}
	if unsafe && len(p.unsafe) == 0 {
		return launch{}, fmt.Errorf("the %s preset has no unattended flag; its own permission config still applies", p.name)
	}

	args := append([]string{}, p.args...)
	var tail []string
	if p.holdLast && len(args) > 0 {
		tail = []string{args[len(args)-1]}
		args = args[:len(args)-1]
	}
	if maxTurns > 0 {
		args = append(args, p.maxTurnsFlag, strconv.Itoa(maxTurns))
	}
	if session != "" && p.resumeFlag != "" {
		args = append(args, p.resumeFlag, session)
	}
	if unsafe {
		args = append(args, p.unsafe...)
	}
	args = append(args, tail...)
	if p.promptVia == viaArg {
		args = append(args, prompt)
	}
	return launch{bin: p.binary(), args: args, promptVia: p.promptVia}, nil
}

// binary prefers the env override so tests, and operators with a CLI not on
// PATH, can point at a real file. A relative path is made absolute against the
// runner's cwd: the child runs with Dir set to the workdir, and a relative
// Path would otherwise be resolved there.
func (p preset) binary() string {
	bin := p.bin
	if v := os.Getenv(p.binEnv); v != "" {
		bin = v
	}
	if filepath.Base(bin) != bin {
		if abs, err := filepath.Abs(bin); err == nil {
			bin = abs
		}
	}
	return bin
}

type outcome struct {
	session string
	text    string
	input   int
	output  int
	isError bool
}

// parseClaude reads Claude's stream-json. session_id arrives on the init
// event; the result event carries the text, the token counts and is_error.
// Anything else, including assistant messages, is noise for this purpose.
func parseClaude(line []byte, o *outcome) {
	var ev struct {
		Type    string `json:"type"`
		Subtype string `json:"subtype"`
		Session string `json:"session_id"`
		Result  string `json:"result"`
		IsError bool   `json:"is_error"`
		Usage   struct {
			Input  int `json:"input_tokens"`
			Output int `json:"output_tokens"`
		} `json:"usage"`
	}
	if json.Unmarshal(line, &ev) != nil {
		return
	}
	if ev.Type == "system" && ev.Subtype == "init" && ev.Session != "" {
		o.session = ev.Session
	}
	if ev.Type != "result" {
		return
	}
	o.text = ev.Result
	o.isError = ev.IsError
	o.input = ev.Usage.Input
	o.output = ev.Usage.Output
	if ev.Session != "" {
		o.session = ev.Session
	}
}

// parseDefensive reads Codex and OpenCode JSONL. Both CLIs add event types
// between releases; an event this does not recognise is ignored rather than
// failing the run. The last agent message wins, which is the final text when
// the CLI emits the full message on each update and the last one at the end.
func parseDefensive(line []byte, o *outcome) {
	var ev map[string]any
	if json.Unmarshal(line, &ev) != nil {
		return
	}
	if id := sessionID(ev); id != "" {
		o.session = id
	}
	if text, ok := messageText(ev); ok {
		o.text = text
	}
	if in, out, ok := usageOf(ev); ok {
		o.input, o.output = in, out
	}
	if errText, ok := errorOf(ev); ok {
		o.isError = true
		if o.text == "" && errText != "" {
			o.text = errText
		}
	}
}

func sessionID(m map[string]any) string {
	if s := stringField(m, "session_id", "sessionId", "sessionID", "thread_id", "threadId"); s != "" {
		return s
	}
	for _, key := range []string{"properties", "info", "item", "msg"} {
		child, ok := m[key].(map[string]any)
		if !ok {
			continue
		}
		if s := stringField(child, "session_id", "sessionId", "sessionID", "thread_id", "threadId"); s != "" {
			return s
		}
	}
	return ""
}

func messageText(m map[string]any) (string, bool) {
	typ, _ := m["type"].(string)
	if typ == "result" {
		if s, ok := m["result"].(string); ok {
			return s, true
		}
	}
	if item, ok := m["item"].(map[string]any); ok && item["type"] == "agent_message" {
		if s, ok := item["text"].(string); ok && s != "" {
			return s, true
		}
	}
	if msg, ok := m["msg"].(map[string]any); ok && msg["type"] == "agent_message" {
		if s, ok := msg["message"].(string); ok && s != "" {
			return s, true
		}
		if s, ok := msg["text"].(string); ok && s != "" {
			return s, true
		}
	}
	if typ == "text" {
		if s, ok := m["text"].(string); ok && s != "" {
			return s, true
		}
		if part, ok := m["part"].(map[string]any); ok {
			if s, ok := part["text"].(string); ok && s != "" {
				return s, true
			}
		}
	}
	if props, ok := m["properties"].(map[string]any); ok {
		if part, ok := props["part"].(map[string]any); ok && part["type"] == "text" {
			if s, ok := part["text"].(string); ok && s != "" {
				return s, true
			}
		}
	}
	return "", false
}

func usageOf(m map[string]any) (int, int, bool) {
	if in, out, ok := usageMap(m["usage"]); ok {
		return in, out, true
	}
	if in, out, ok := usageMap(m["tokens"]); ok {
		return in, out, true
	}
	if info, ok := m["info"].(map[string]any); ok {
		if in, out, ok := usageMap(info["total_token_usage"]); ok {
			return in, out, true
		}
	}
	if msg, ok := m["msg"].(map[string]any); ok {
		if info, ok := msg["info"].(map[string]any); ok {
			if in, out, ok := usageMap(info["total_token_usage"]); ok {
				return in, out, true
			}
		}
	}
	return 0, 0, false
}

func usageMap(v any) (int, int, bool) {
	m, ok := v.(map[string]any)
	if !ok {
		return 0, 0, false
	}
	in, inOK := firstNumber(m, "input_tokens", "inputTokens", "input")
	out, outOK := firstNumber(m, "output_tokens", "outputTokens", "output")
	if !inOK && !outOK {
		return 0, 0, false
	}
	return in, out, true
}

func errorOf(m map[string]any) (string, bool) {
	if b, ok := m["is_error"].(bool); ok && b {
		s, _ := m["result"].(string)
		return s, true
	}
	if m["type"] == "error" {
		s, _ := m["message"].(string)
		return s, true
	}
	return "", false
}

func stringField(m map[string]any, keys ...string) string {
	for _, k := range keys {
		if s, ok := m[k].(string); ok && s != "" {
			return s
		}
	}
	return ""
}

func firstNumber(m map[string]any, keys ...string) (int, bool) {
	for _, k := range keys {
		if n, ok := asInt(m[k]); ok {
			return n, true
		}
	}
	return 0, false
}

func asInt(v any) (int, bool) {
	switch n := v.(type) {
	case float64:
		return int(n), true
	case int:
		return n, true
	case json.Number:
		i, err := n.Int64()
		if err != nil {
			return 0, false
		}
		return int(i), true
	default:
		return 0, false
	}
}
