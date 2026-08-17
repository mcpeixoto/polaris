// Package syncsrv is the WebSocket delta hub: the read half of the sync engine.
//
// Mutations deliberately do NOT travel over this socket. They go over POST /graphql —
// the same path integrations, the SDK and agents use — so there is exactly one write
// path with one authorisation implementation and one rate limiter. The socket carries
// deltas outward and acknowledgements back, and nothing else.
package syncsrv

import (
	"encoding/json"
	"time"

	"github.com/peixotolabs/polaris/services/internal/domain"

	"github.com/google/uuid"
)

// ClientSchema is the shape version of the client's local store, checked against the hello
// frame before a socket is accepted.
//
// It is an alias, not a value. The number is defined once, in domain.ClientSchemaVersion,
// because the HTTP bootstrap sends it and this socket checks it and a client that gets two
// different answers from the same server is in a state no error message can explain. Both
// halves of that sentence have been true and disagreeing at the same time — see the comment
// on domain.ClientSchemaVersion for what that cost — so the fix is that there is nothing
// here to keep in step.
//
// TestClientSchemaMatchesTheClient pins it to CLIENT_SCHEMA in web/src/store/db.ts, which
// is the one contract left that no compiler can hold.
const ClientSchema = domain.ClientSchemaVersion

// Message type tags. Kept as short strings because these are the highest-frequency
// values on the wire.
const (
	// client -> server
	TypeHello     = "hello"
	TypePing      = "ping"
	TypeSubscribe = "subscribe"

	// server -> client
	TypeReady  = "ready"
	TypeDelta  = "delta"
	TypeResync = "resync"
	TypeAck    = "ack"
	TypeNack   = "nack"
	TypePong   = "pong"
	TypeError  = "error"
)

// Resync reasons. The client shows a different progress affordance for each, because
// "your permissions changed" and "you were offline too long" mean different things to
// the person watching a spinner.
const (
	ReasonGapTooLarge        = "gap_too_large"
	ReasonSchemaChanged      = "schema_changed"
	ReasonPermissionsChanged = "permissions_changed"
	ReasonBufferOverflow     = "buffer_overflow"
)

// Hello is the first frame a client sends.
type Hello struct {
	Type      string    `json:"t"`
	Token     string    `json:"token"`
	Workspace uuid.UUID `json:"workspace"`
	// Resume is the version the client already holds. Zero means "I have nothing".
	Resume       int64     `json:"resume"`
	ClientSchema int       `json:"clientSchema"`
	ClientID     uuid.UUID `json:"clientId"`
}

// Ready answers a Hello that was accepted.
type Ready struct {
	Type    string `json:"t"`
	Version int64  `json:"version"`
	// ServerTime lets the client correct a skewed local clock before it renders any
	// relative timestamp. A laptop an hour out otherwise shows "in 58 minutes" on
	// something that just happened.
	ServerTime time.Time `json:"serverTime"`
	// Heartbeat is how often the client must ping, in seconds.
	Heartbeat int `json:"heartbeat"`
}

// Change is one entity mutation as the client sees it.
type Change struct {
	Version    int64           `json:"v"`
	EntityType string          `json:"type"`
	EntityID   uuid.UUID       `json:"id"`
	Op         string          `json:"op"`
	Actor      Actor           `json:"actor"`
	Payload    json.RawMessage `json:"payload,omitempty"`
}

type Actor struct {
	Type string     `json:"type"`
	ID   *uuid.UUID `json:"id,omitempty"`
}

// Delta is a contiguous run of changes. From/To bracket the range so a client can assert
// it did not skip anything — a cheap invariant check that has caught more bugs than it
// costs.
type Delta struct {
	Type    string   `json:"t"`
	From    int64    `json:"from"`
	To      int64    `json:"to"`
	Changes []Change `json:"changes"`
}

// Resync tells the client to throw its replica away and bootstrap again.
type Resync struct {
	Type   string `json:"t"`
	Reason string `json:"reason"`
	// RetryAfterMS spreads a fleet-wide resync over time. A bad deploy that sets
	// clientSchema wrong makes every client re-bootstrap at once and saturates Postgres;
	// jitter is the difference between a slow minute and an outage.
	RetryAfterMS int `json:"retryAfterMs"`
}

type Pong struct {
	Type       string    `json:"t"`
	ServerTime time.Time `json:"serverTime"`
}

// Error is a fatal protocol-level failure. The socket closes after it.
type Error struct {
	Type    string `json:"t"`
	Code    string `json:"code"`
	Message string `json:"message"`
}

// Subscribe joins ephemeral channels — presence on an issue, typing indicators. These
// are not part of the durable change stream and are never persisted.
type Subscribe struct {
	Type     string   `json:"t"`
	Channels []string `json:"channels"`
}

// envelope is used to peek at the tag before decoding the whole frame.
type envelope struct {
	Type string `json:"t"`
}
