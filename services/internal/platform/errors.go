package platform

import (
	"errors"
	"fmt"
)

// ErrorCode is the stable, machine-readable classification of a failure. It is mapped
// once — in the GraphQL error presenter — onto the `extensions.code` field, and once in
// the REST handlers onto an HTTP status. Adding an `if err ==` check at a call site to
// decide a status code is how two surfaces start disagreeing about what "not found" means.
type ErrorCode string

const (
	CodeValidation   ErrorCode = "VALIDATION"
	CodeNotFound     ErrorCode = "NOT_FOUND"
	CodeForbidden    ErrorCode = "FORBIDDEN"
	CodeUnauthorized ErrorCode = "UNAUTHENTICATED"
	CodeConflict     ErrorCode = "CONFLICT"
	CodeRateLimited  ErrorCode = "RATELIMITED"
	CodeEntitlement  ErrorCode = "PLAN_LIMIT"
	CodeInternal     ErrorCode = "INTERNAL"
)

// Error is the one error type that crosses a package boundary in this codebase.
type Error struct {
	Code ErrorCode
	// Message is shown to the caller. It must never contain a database string, a stack
	// trace or another user's data.
	Message string
	// Field names the offending input for validation errors, so the client can attach
	// the message to the right control instead of showing a toast.
	Field string
	// Err is the wrapped cause. Logged, never serialised to the client.
	Err error
}

func (e *Error) Error() string {
	if e.Err != nil {
		return fmt.Sprintf("%s: %s: %v", e.Code, e.Message, e.Err)
	}
	return fmt.Sprintf("%s: %s", e.Code, e.Message)
}

func (e *Error) Unwrap() error { return e.Err }

func Validation(field, msg string) *Error {
	return &Error{Code: CodeValidation, Message: msg, Field: field}
}

func NotFound(what string) *Error {
	return &Error{Code: CodeNotFound, Message: what + " not found"}
}

// Forbidden is deliberately vague. Distinguishing "exists but you may not see it" from
// "does not exist" leaks the existence of private teams and their issues.
func Forbidden(msg string) *Error {
	if msg == "" {
		msg = "you do not have access to this resource"
	}
	return &Error{Code: CodeForbidden, Message: msg}
}

func Unauthorized(msg string) *Error {
	if msg == "" {
		msg = "authentication required"
	}
	return &Error{Code: CodeUnauthorized, Message: msg}
}

func Conflict(msg string) *Error {
	return &Error{Code: CodeConflict, Message: msg}
}

func RateLimited(msg string) *Error {
	return &Error{Code: CodeRateLimited, Message: msg}
}

// Internal wraps an unexpected failure. The cause is logged; the caller is told nothing.
func Internal(err error) *Error {
	return &Error{Code: CodeInternal, Message: "internal error", Err: err}
}

// CodeOf classifies any error. Anything that is not an *Error is internal by definition:
// an unclassified error escaping the domain layer is a bug, not a user mistake.
func CodeOf(err error) ErrorCode {
	var e *Error
	if errors.As(err, &e) {
		return e.Code
	}
	return CodeInternal
}
