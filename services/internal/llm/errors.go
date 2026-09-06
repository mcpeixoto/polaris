package llm

import (
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// Kind classifies a provider failure by what the caller should do about it, not by which
// HTTP status produced it. The agent has to decide three different things — retry, tell the
// operator their key is wrong, or drop history and try again — and a single opaque error
// forces it to string-match the provider's prose to tell them apart.
type Kind string

const (
	// KindAuth is a bad, missing or revoked key (401). Never retried.
	KindAuth Kind = "auth"
	// KindPermission is a valid key without access to this model or feature (403).
	KindPermission Kind = "permission"
	// KindNotFound is a wrong model id or endpoint (404).
	KindNotFound Kind = "not_found"
	// KindInvalidRequest is a malformed request (400). A bug here, not a transient fault.
	KindInvalidRequest Kind = "invalid_request"
	// KindContextLength means the conversation no longer fits. Retrying the same messages
	// cannot succeed; the caller must summarise or drop turns first.
	KindContextLength Kind = "context_length"
	// KindRateLimit is 429. Retryable, and RetryAfter says when.
	KindRateLimit Kind = "rate_limit"
	// KindOverloaded is 529. Retryable.
	KindOverloaded Kind = "overloaded"
	// KindServer is any other 5xx. Retryable.
	KindServer Kind = "server"
	// KindTransport is a connection failure or a truncated stream. Retryable.
	KindTransport Kind = "transport"
	// KindCanceled means the caller's context ended. Unwraps to context.Canceled or
	// context.DeadlineExceeded.
	KindCanceled Kind = "canceled"
	// KindDecode is a response this package could not parse. Not retryable: the same bytes
	// would come back.
	KindDecode Kind = "decode"
)

// Sentinels for errors.Is. Matching on these is the supported way to branch — the Kind
// field is there for logging and metrics.
var (
	ErrAuth           = errors.New("llm: authentication failed")
	ErrPermission     = errors.New("llm: permission denied")
	ErrNotFound       = errors.New("llm: model or endpoint not found")
	ErrInvalidRequest = errors.New("llm: invalid request")
	ErrContextLength  = errors.New("llm: context length exceeded")
	ErrRateLimited    = errors.New("llm: rate limited")
	ErrOverloaded     = errors.New("llm: provider overloaded")
	ErrServer         = errors.New("llm: provider server error")
	ErrTransport      = errors.New("llm: transport failure")
	ErrDecode         = errors.New("llm: malformed provider response")
)

func sentinel(k Kind) error {
	switch k {
	case KindAuth:
		return ErrAuth
	case KindPermission:
		return ErrPermission
	case KindNotFound:
		return ErrNotFound
	case KindInvalidRequest:
		return ErrInvalidRequest
	case KindContextLength:
		return ErrContextLength
	case KindRateLimit:
		return ErrRateLimited
	case KindOverloaded:
		return ErrOverloaded
	case KindServer:
		return ErrServer
	case KindTransport:
		return ErrTransport
	case KindDecode:
		return ErrDecode
	}
	return nil
}

// Error is every failure this package returns.
type Error struct {
	Kind Kind
	// Status is the HTTP status, or 0 when the request never got a response.
	Status int
	// Type is the provider's own error type ("rate_limit_error", ...), kept verbatim for
	// logs — new ones appear without warning and are not worth failing over.
	Type string
	// Message is the provider's message. It carries no key material; it can quote the
	// request, so it is for operators, not end users.
	Message string
	// RequestID identifies the call in Anthropic's logs. The single most useful field when
	// asking them what happened.
	RequestID string
	// RetryAfter is the server's own instruction, when it sent one.
	RetryAfter time.Duration
	// Retryable is whether retrying the identical request could plausibly work. The client
	// has already exhausted its own attempts by the time the caller sees this.
	Retryable bool
	Err       error
}

func (e *Error) Error() string {
	var b strings.Builder
	b.WriteString("llm: ")
	b.WriteString(string(e.Kind))
	if e.Status != 0 {
		fmt.Fprintf(&b, " (http %d", e.Status)
		if e.Type != "" {
			b.WriteString(", " + e.Type)
		}
		b.WriteString(")")
	}
	if e.Message != "" {
		b.WriteString(": " + e.Message)
	}
	if e.Err != nil && e.Message == "" {
		b.WriteString(": " + e.Err.Error())
	}
	if e.RequestID != "" {
		b.WriteString(" [request " + e.RequestID + "]")
	}
	return b.String()
}

func (e *Error) Unwrap() error { return e.Err }

// Is matches the package sentinels, so callers write errors.Is(err, llm.ErrRateLimited)
// instead of a type assertion plus a field comparison.
func (e *Error) Is(target error) bool {
	s := sentinel(e.Kind)
	return s != nil && target == s
}

// Retryable reports whether err is worth retrying later. The client's own bounded retry has
// already run; this is for the caller's queue, which can wait minutes rather than seconds.
func Retryable(err error) bool {
	var e *Error
	if errors.As(err, &e) {
		return e.Retryable
	}
	return false
}

// KindOf returns the classification of err, or "" if it did not come from this package.
func KindOf(err error) Kind {
	var e *Error
	if errors.As(err, &e) {
		return e.Kind
	}
	return ""
}

// classifyStatus maps an HTTP status and the provider's error payload onto a Kind.
//
// Context-length failures arrive as a plain 400 with no distinguishing type, so the message
// has to be read. That is fragile by nature: the fallback is KindInvalidRequest, which is
// also non-retryable, so a missed match costs a worse error message and nothing else.
func classifyStatus(status int, errType, message string) (Kind, bool) {
	switch status {
	case http.StatusUnauthorized:
		return KindAuth, false
	case http.StatusForbidden:
		return KindPermission, false
	case http.StatusNotFound:
		return KindNotFound, false
	case http.StatusRequestEntityTooLarge:
		return KindContextLength, false
	case http.StatusTooManyRequests:
		return KindRateLimit, true
	}
	if status == http.StatusBadRequest {
		if isContextLengthMessage(message) {
			return KindContextLength, false
		}
		return KindInvalidRequest, false
	}
	if status >= 500 {
		// 529 is Anthropic's "overloaded", which is the retry that most often succeeds.
		if status == 529 || errType == "overloaded_error" {
			return KindOverloaded, true
		}
		return KindServer, true
	}
	// Anything else in the 4xx range is a client mistake: never retried, per the rule that
	// only 429 among 4xx is worth a second attempt.
	if status >= 400 {
		return KindInvalidRequest, false
	}
	return KindServer, true
}

var contextLengthMarkers = []string{
	"prompt is too long",
	"context limit",
	"context window",
	"maximum context",
	"too many tokens",
	"exceed context",
}

func isContextLengthMessage(msg string) bool {
	m := strings.ToLower(msg)
	for _, marker := range contextLengthMarkers {
		if strings.Contains(m, marker) {
			return true
		}
	}
	return false
}

// parseRetryAfter reads the retry-after header in both forms the RFC allows. A negative or
// unparseable value is treated as absent so a malformed header cannot pin the client.
func parseRetryAfter(h http.Header, now time.Time) time.Duration {
	v := strings.TrimSpace(h.Get("Retry-After"))
	if v == "" {
		return 0
	}
	if secs, err := strconv.Atoi(v); err == nil {
		if secs < 0 {
			return 0
		}
		return time.Duration(secs) * time.Second
	}
	if t, err := http.ParseTime(v); err == nil {
		if d := t.Sub(now); d > 0 {
			return d
		}
	}
	return 0
}

// ctxError converts a cancelled context into an *Error that still unwraps to
// context.Canceled, so both errors.Is(err, context.Canceled) and KindOf work.
func ctxError(err error) *Error {
	return &Error{Kind: KindCanceled, Message: "request cancelled", Err: err}
}

// classifyErrorType maps the provider's own error type onto a Kind. Used for errors that
// arrive inside a 200 SSE stream, where there is no status code to read.
func classifyErrorType(errType, message string) (Kind, bool) {
	switch errType {
	case "authentication_error":
		return KindAuth, false
	case "permission_error":
		return KindPermission, false
	case "not_found_error":
		return KindNotFound, false
	case "request_too_large":
		return KindContextLength, false
	case "rate_limit_error":
		return KindRateLimit, true
	case "overloaded_error":
		return KindOverloaded, true
	case "invalid_request_error":
		if isContextLengthMessage(message) {
			return KindContextLength, false
		}
		return KindInvalidRequest, false
	}
	// api_error and anything new: a mid-stream failure of unknown shape is more often a
	// blip than a bug in the request.
	return KindServer, true
}
