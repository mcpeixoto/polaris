package httpapi

import (
	"compress/gzip"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"sync"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/platform"
)

// bootstrapLimiter caps concurrent snapshots across the whole process.
//
// The realistic outage mode for this system is a resync storm: one bad deploy sets the
// client schema wrong, every connected client re-bootstraps at the same moment, and
// Postgres saturates serving snapshots while ordinary interactive queries queue behind
// them. A semaphore turns that into a slow minute for a few people instead of an outage
// for everybody.
var bootstrapLimiter = make(chan struct{}, 8)

type bootstrapHandler struct {
	svc *domain.Service
}

// ServeHTTP streams a permission-scoped replica of the workspace as NDJSON.
//
// NDJSON rather than one JSON document because the client writes to IndexedDB as rows
// arrive and shows real progress. A single array would have to be fully received and
// fully parsed before the first row could be stored, which on a 25 MB snapshot means a
// long blank screen and a main thread pegged at 100%.
func (h *bootstrapHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	p, ok := authz.PrincipalFrom(r.Context())
	if !ok {
		writeError(w, r, platform.Unauthorized(""))
		return
	}

	select {
	case bootstrapLimiter <- struct{}{}:
		defer func() { <-bootstrapLimiter }()
	default:
		w.Header().Set("Retry-After", "10")
		writeError(w, r, platform.RateLimited("too many snapshots in flight, try again shortly"))
		return
	}

	w.Header().Set("Content-Type", "application/x-ndjson; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	// Chunked, so the client sees rows immediately instead of waiting on Content-Length.
	w.Header().Set("X-Accel-Buffering", "no")

	var out io.Writer = w
	var gz *gzip.Writer
	if strings.Contains(r.Header.Get("Accept-Encoding"), "gzip") {
		w.Header().Set("Content-Encoding", "gzip")
		// Level 1: the payload is highly repetitive JSON, so most of the compression is
		// available at the cheapest setting, and CPU spent here is CPU not spent serving
		// interactive queries during exactly the incident this endpoint causes.
		gz, _ = gzip.NewWriterLevel(w, gzip.BestSpeed)
		defer gz.Close()
		out = gz
	}

	writer := &ndjsonWriter{w: out, flusher: asFlusher(w, gz)}

	if err := h.svc.StreamBootstrap(r.Context(), p, writer); err != nil {
		// The status line has already gone out with 200, so the failure cannot be
		// signalled with a status code. A terminator line the client checks for is the
		// only honest way to say "this snapshot is incomplete" mid-stream — without it a
		// truncated response is indistinguishable from a complete one and the client
		// would happily commit a half-replica.
		platform.Log(r.Context()).Error("bootstrap stream failed", "error", err)
		writer.abort(err)
		return
	}
	writer.done()
}

// ndjsonWriter encodes the snapshot one line at a time.
type ndjsonWriter struct {
	w       io.Writer
	flusher http.Flusher

	mu    sync.Mutex
	count int
	err   error
}

type bootstrapMeta struct {
	Kind         string `json:"kind"`
	Version      int64  `json:"version"`
	ClientSchema int    `json:"clientSchema"`
}

type bootstrapEntity struct {
	Kind    string    `json:"kind"`
	Type    string    `json:"type"`
	ID      uuid.UUID `json:"id"`
	Payload any       `json:"payload"`
}

type bootstrapEnd struct {
	Kind  string `json:"kind"`
	Count int    `json:"count"`
	Error string `json:"error,omitempty"`
}

func (n *ndjsonWriter) Meta(version int64, clientSchema int) error {
	return n.write(bootstrapMeta{Kind: "meta", Version: version, ClientSchema: clientSchema})
}

func (n *ndjsonWriter) Entity(entityType string, id uuid.UUID, payload any) error {
	if err := n.write(bootstrapEntity{Kind: "entity", Type: entityType, ID: id, Payload: payload}); err != nil {
		return err
	}
	n.mu.Lock()
	n.count++
	count := n.count
	n.mu.Unlock()

	// Flushing every row would defeat gzip's window and multiply syscalls; never
	// flushing would buffer the whole snapshot and undo the point of streaming.
	if count%200 == 0 {
		n.flush()
	}
	return nil
}

func (n *ndjsonWriter) done() {
	_ = n.write(bootstrapEnd{Kind: "end", Count: n.count})
	n.flush()
}

func (n *ndjsonWriter) abort(err error) {
	// The message is deliberately generic; the cause is in the server log.
	_ = n.write(bootstrapEnd{Kind: "end", Count: n.count, Error: "snapshot failed"})
	n.flush()
}

func (n *ndjsonWriter) write(v any) error {
	if n.err != nil {
		return n.err
	}
	b, err := json.Marshal(v)
	if err != nil {
		n.err = platform.Internal(err)
		return n.err
	}
	b = append(b, '\n')
	if _, err := n.w.Write(b); err != nil {
		// A client that navigated away mid-snapshot is normal, not exceptional.
		n.err = err
		return err
	}
	return nil
}

func (n *ndjsonWriter) flush() {
	if n.flusher != nil {
		n.flusher.Flush()
	}
}

// asFlusher returns something that pushes bytes all the way to the socket. With gzip in
// the chain both layers must be flushed, and in that order, or the compressor holds the
// tail of the stream and the client waits for rows that have already been written.
func asFlusher(w http.ResponseWriter, gz *gzip.Writer) http.Flusher {
	httpFlusher, ok := w.(http.Flusher)
	if !ok {
		return nil
	}
	if gz == nil {
		return httpFlusher
	}
	return flusherFunc(func() {
		_ = gz.Flush()
		httpFlusher.Flush()
	})
}

type flusherFunc func()

func (f flusherFunc) Flush() { f() }
