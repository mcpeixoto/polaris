// Package scalars implements the custom GraphQL scalars.
//
// They live in their own package so that both the generated executor and the hand-written
// resolvers can reference them without the generated code importing the resolver package
// it is generated into.
package scalars

import (
	"encoding/json"
	"fmt"
	"io"
	"strconv"

	"github.com/99designs/gqlgen/graphql"
	"github.com/google/uuid"
)

// UUID is the identifier type across the whole API. Values are UUIDv7 — time-ordered, so
// index locality is good and the change log sorts naturally by creation.
type UUID = uuid.UUID

// MarshalUUID writes a UUID as a quoted string.
func MarshalUUID(u uuid.UUID) graphql.Marshaler {
	return graphql.WriterFunc(func(w io.Writer) {
		_, _ = io.WriteString(w, strconv.Quote(u.String()))
	})
}

// UnmarshalUUID accepts a string. It deliberately refuses anything else rather than
// coercing: a client sending a number where an id belongs has a bug, and silently
// producing the nil UUID would turn that bug into a query that quietly matches nothing.
func UnmarshalUUID(v any) (uuid.UUID, error) {
	s, ok := v.(string)
	if !ok {
		return uuid.Nil, fmt.Errorf("UUID must be a string, got %T", v)
	}
	u, err := uuid.Parse(s)
	if err != nil {
		return uuid.Nil, fmt.Errorf("invalid UUID %q", s)
	}
	return u, nil
}

// JSON carries the free-form values in issue history entries, where the shape genuinely
// depends on which field changed.
type JSON = json.RawMessage

func MarshalJSON(j json.RawMessage) graphql.Marshaler {
	return graphql.WriterFunc(func(w io.Writer) {
		if len(j) == 0 {
			_, _ = io.WriteString(w, "null")
			return
		}
		_, _ = w.Write(j)
	})
}

func UnmarshalJSON(v any) (json.RawMessage, error) {
	if v == nil {
		return nil, nil
	}
	b, err := json.Marshal(v)
	if err != nil {
		return nil, fmt.Errorf("invalid JSON value: %w", err)
	}
	return b, nil
}
