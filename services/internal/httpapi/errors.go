package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/peixotolabs/polaris/services/internal/platform"
)

// errorBody is the wire shape of a failure. It matches the shape of a GraphQL error's
// extensions so a client can handle "forbidden" identically whichever endpoint produced
// it.
type errorBody struct {
	Error struct {
		Code    string `json:"code"`
		Message string `json:"message"`
		Field   string `json:"field,omitempty"`
	} `json:"error"`
}

// statusFor maps a domain error code onto an HTTP status, in one place.
//
// Doing this at call sites is how two endpoints end up disagreeing about what "not found"
// means — and how a 403 that should have been a 404 confirms that a private team exists.
func statusFor(code platform.ErrorCode) int {
	switch code {
	case platform.CodeValidation:
		return http.StatusBadRequest
	case platform.CodeUnauthorized:
		return http.StatusUnauthorized
	case platform.CodeForbidden:
		return http.StatusForbidden
	case platform.CodeNotFound:
		return http.StatusNotFound
	case platform.CodeConflict:
		return http.StatusConflict
	case platform.CodeRateLimited:
		return http.StatusTooManyRequests
	case platform.CodeEntitlement:
		return http.StatusPaymentRequired
	default:
		return http.StatusInternalServerError
	}
}

func writeError(w http.ResponseWriter, r *http.Request, err error) {
	code := platform.CodeOf(err)
	status := statusFor(code)

	var body errorBody
	body.Error.Code = string(code)

	var pe *platform.Error
	if errors.As(err, &pe) {
		body.Error.Message = pe.Message
		body.Error.Field = pe.Field
	} else {
		body.Error.Message = "internal error"
	}

	// An internal error's cause is logged in full and never serialised. A database
	// string in a client response is an information leak, and often a schema disclosure.
	if code == platform.CodeInternal {
		platform.Log(r.Context()).Error("request failed",
			"path", r.URL.Path, "method", r.Method, "error", err)
		body.Error.Message = "internal error"
	}

	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// decodeJSON reads a request body with a hard size limit.
//
// Unbounded decoding on an unauthenticated endpoint lets anybody make the process
// allocate as much as they like; DisallowUnknownFields turns a client's typo into an
// error instead of a field silently ignored.
func decodeJSON(w http.ResponseWriter, r *http.Request, dst any) error {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		return platform.Validation("", "could not parse the request body")
	}
	return nil
}
