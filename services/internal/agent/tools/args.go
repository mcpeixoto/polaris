package tools

import (
	"encoding/json"
	"strconv"
	"strings"
)

func objectSchema(properties map[string]any, required []string) map[string]any {
	schema := map[string]any{
		"type":                 "object",
		"properties":           properties,
		"additionalProperties": false,
	}
	if len(required) > 0 {
		schema["required"] = required
	}
	return schema
}

func strArg(args map[string]any, key string) string {
	v, _ := args[key].(string)
	return strings.TrimSpace(v)
}

// intArg coerces whatever a JSON decoder left behind. Models send "3" as often as 3, and a
// tool that refused the string would be reporting a transport detail as a user error.
func intArg(args map[string]any, key string, fallback int) int {
	switch v := args[key].(type) {
	case float64:
		return int(v)
	case int:
		return v
	case json.Number:
		n, _ := v.Int64()
		return int(n)
	case string:
		n, err := strconv.Atoi(strings.TrimSpace(v))
		if err == nil {
			return n
		}
	}
	return fallback
}

// present reports whether the caller actually sent a key with a value. An explicit null is
// absence: for the three-state fields on UpdateIssueInput, "don't touch it" and "clear it"
// have to be told apart, and every tool here spells the clear with its own flag rather
// than leaving it to be inferred from a null.
func present(args map[string]any, key string) bool {
	v, ok := args[key]
	return ok && v != nil
}

func boolArg(args map[string]any, key string, fallback bool) bool {
	switch v := args[key].(type) {
	case bool:
		return v
	case string:
		b, err := strconv.ParseBool(strings.TrimSpace(v))
		if err == nil {
			return b
		}
	}
	return fallback
}

// strSliceArg reads a list of strings, accepting a bare string as a list of one. Models
// routinely send "bug" where the schema says ["bug"], and rejecting it teaches nothing.
func strSliceArg(args map[string]any, key string) []string {
	switch v := args[key].(type) {
	case []any:
		out := make([]string, 0, len(v))
		for _, item := range v {
			if s, ok := item.(string); ok {
				if s = strings.TrimSpace(s); s != "" {
					out = append(out, s)
				}
			}
		}
		return out
	case []string:
		out := make([]string, 0, len(v))
		for _, s := range v {
			if s = strings.TrimSpace(s); s != "" {
				out = append(out, s)
			}
		}
		return out
	case string:
		if s := strings.TrimSpace(v); s != "" {
			return []string{s}
		}
	}
	return nil
}

// stringSchema is shorthand for the property shape that makes up most of this catalogue.
func stringSchema(description string) map[string]any {
	return map[string]any{"type": "string", "description": description}
}

func intSchema(description string) map[string]any {
	return map[string]any{"type": "integer", "description": description}
}

func boolSchema(description string) map[string]any {
	return map[string]any{"type": "boolean", "description": description}
}

func stringListSchema(description string) map[string]any {
	return map[string]any{
		"type":        "array",
		"items":       map[string]any{"type": "string"},
		"description": description,
	}
}
