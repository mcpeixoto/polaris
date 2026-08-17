package domain

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/store"
)

// Op is what happened to an entity from the client's point of view.
type Op string

const (
	// OpUpsert carries the full entity. The client replaces whatever it has.
	OpUpsert Op = "upsert"
	// OpDelete means the entity is gone for everyone.
	OpDelete Op = "delete"
	// OpRevoke means the entity still exists but this recipient may no longer see it.
	// It carries no payload, and the client deletes its local copy.
	//
	// Without this, somebody removed from a team keeps a perfectly readable local replica
	// of its issues forever. Data loss is not the failure mode here; a silent, permanent
	// read of data you were just cut off from is.
	OpRevoke Op = "revoke"
)

// Change is one entity mutation to be recorded on the sync stream.
type Change struct {
	EntityType string
	EntityID   uuid.UUID
	Op         Op

	// TeamID is the denormalised visibility key. Present for team-scoped entities so the
	// hub can judge a change without re-reading an entity that may already be deleted.
	TeamID *uuid.UUID

	Scope authz.Scope

	// Payload is the entity in its model.* shape. Must be nil for OpRevoke and is
	// conventionally nil for OpDelete — the client only needs the id to forget it.
	Payload any

	// ChangedFields names the entity's fields this mutation actually set, by column name.
	// Empty means a create: everything is new.
	//
	// Recorded by the mutation rather than recovered downstream, because the only way to
	// recover it is to diff this payload against the previous version's — a second
	// definition of what happened, and the one that is wrong. It calls a field changed
	// because a serialiser started emitting it, and calls nothing changed when a bulk edit
	// writes the value a row already held.
	//
	// The notification engine is what reads it, and what it needs it for is telling "the
	// assignee changed" from "somebody edited the title of an issue that has an assignee".
	// The names come from internal/notify's Field* constants, so the mutation that writes
	// the list and the rules that match on it share one vocabulary.
	ChangedFields []string
}

// HistoryEntry is an activity-feed row. Separate from Change on purpose:
//
//	change_log     mechanical, every field, 30-day retention, drives sync and webhooks.
//	issue_history  curated, permanent, and subject to product rules — for example that
//	               property changes in the first three minutes after creation are folded
//	               into the creation event and never shown.
//
// Conflating them means either the sync stream is lossy or the activity feed is noise.
type HistoryEntry struct {
	IssueID   uuid.UUID
	Kind      string
	FromValue any
	ToValue   any
}

// historyGroupWindow is how long a run of same-kind edits by the same actor collapses
// into one feed entry. Three minutes also covers the "changes right after creation are
// part of creation" rule, which is why creation suppression uses the same constant.
const historyGroupWindow = 3 * time.Minute

// Emitter records the consequences of a mutation. Every write in the product goes
// through it, inside the mutation's own transaction.
//
// This is the choke point that makes the whole architecture hold: sync deltas, outbound
// webhooks, the activity feed and the audit log all derive from what is written here. A
// mutation that skips it produces an entity the clients never learn about, which then
// looks like a sync bug and gets debugged in the wrong subsystem for a day.
type Emitter struct{}

// Emit mints versions and appends change rows, inside the caller's transaction.
//
// It returns the highest version assigned, which the caller hands back to the client so
// it knows where its own write landed in the stream.
func (Emitter) Emit(
	ctx context.Context,
	q *store.Queries,
	workspaceID uuid.UUID,
	actor authz.Actor,
	changes ...Change,
) (int64, error) {
	if len(changes) == 0 {
		return 0, nil
	}
	if !actor.Type.Valid() {
		// Not a validation error the user can fix: a call site failed to say who is
		// responsible, and the activity feed, webhooks and audit log all need it.
		return 0, platform.Internal(fmt.Errorf("emit: invalid actor type %q", actor.Type))
	}

	// One statement reserves the whole block. The row lock this takes is the
	// serialisation point of the sync engine: it is what makes the version sequence
	// gapless, which is what lets a client say "I am at V, send me the rest" and trust
	// the answer.
	last, err := q.BumpWorkspaceVersionBy(ctx, store.BumpWorkspaceVersionByParams{
		N:           int64(len(changes)),
		WorkspaceID: workspaceID,
	})
	if err != nil {
		return 0, platform.Internal(fmt.Errorf("bump workspace version: %w", err))
	}
	first := last - int64(len(changes)) + 1

	// A block is a batch. Every row emitted by one call to Emit is one thing somebody did —
	// a bulk edit of two hundred issues is one call, and so is a single update — so the
	// batch's identity is minted here instead of being passed in. No call site can forget
	// to set it, and no call site can invent a second definition of "one action"; both
	// mistakes surface as two hundred inbox rows for one click, which is what
	// notification.group_key coalesces away.
	//
	// Left unset for a single change, which needs no batch: its group key is its version,
	// and versions are already unique per workspace.
	var batchKey *string
	if len(changes) > 1 {
		k := fmt.Sprintf("b%d", first)
		batchKey = &k
	}

	for i, c := range changes {
		version := first + int64(i)

		if c.Op == OpRevoke && c.Payload != nil {
			return 0, platform.Internal(fmt.Errorf(
				"emit: revoke of %s/%s carries a payload — a recipient losing access must not be handed the data on the way out",
				c.EntityType, c.EntityID))
		}

		scopeJSON, err := c.Scope.MarshalJSONB()
		if err != nil {
			return 0, platform.Internal(fmt.Errorf("marshal scope: %w", err))
		}

		var payloadJSON json.RawMessage
		if c.Payload != nil {
			b, err := json.Marshal(c.Payload)
			if err != nil {
				return 0, platform.Internal(fmt.Errorf("marshal payload for %s/%s: %w", c.EntityType, c.EntityID, err))
			}
			payloadJSON = b
		}

		// The column is NOT NULL and a nil slice is a NULL. An absent list means a create,
		// which is a statement about the change; NULL would mean "nobody said", which is a
		// statement about this code, and every reader downstream would have to guess.
		fields := c.ChangedFields
		if fields == nil {
			fields = []string{}
		}

		if err := q.AppendChange(ctx, store.AppendChangeParams{
			WorkspaceID:   workspaceID,
			Version:       version,
			EntityType:    c.EntityType,
			EntityID:      c.EntityID,
			Op:            string(c.Op),
			TeamID:        c.TeamID,
			Scope:         scopeJSON,
			ActorType:     string(actor.Type),
			ActorID:       actor.ID,
			Payload:       payloadJSON,
			ChangedFields: fields,
			BatchKey:      batchKey,
		}); err != nil {
			return 0, platform.Internal(fmt.Errorf("append change: %w", err))
		}
	}

	// Delivered by Postgres on commit, and not at all on rollback. A hub therefore never
	// wakes for a change that did not happen, and never fails to wake for one that did.
	notice, err := json.Marshal(struct {
		WorkspaceID uuid.UUID `json:"w"`
		Version     int64     `json:"v"`
	}{workspaceID, last})
	if err != nil {
		return 0, platform.Internal(fmt.Errorf("marshal notify payload: %w", err))
	}
	if err := q.NotifySyncHub(ctx, string(notice)); err != nil {
		return 0, platform.Internal(fmt.Errorf("notify sync hub: %w", err))
	}

	return last, nil
}

// History appends activity-feed rows, folding a run of same-kind edits by the same actor
// into the existing entry rather than appending a new one.
//
// suppressBefore lets the caller pass the issue's creation time so that edits made
// within the first few minutes vanish into the creation event: without it, creating an
// issue and immediately setting its assignee and priority produces three feed entries
// for what the user experienced as one action.
func (Emitter) History(
	ctx context.Context,
	q *store.Queries,
	workspaceID uuid.UUID,
	actor authz.Actor,
	issueCreatedAt time.Time,
	entries ...HistoryEntry,
) error {
	if len(entries) == 0 {
		return nil
	}
	if !actor.Type.Valid() {
		return platform.Internal(fmt.Errorf("history: invalid actor type %q", actor.Type))
	}

	now := time.Now()
	withinCreationWindow := now.Sub(issueCreatedAt) < historyGroupWindow

	for _, e := range entries {
		// Property changes just after creation are part of creation.
		if withinCreationWindow && e.Kind != "created" {
			continue
		}

		fromJSON, err := marshalOptional(e.FromValue)
		if err != nil {
			return platform.Internal(fmt.Errorf("marshal history from-value: %w", err))
		}
		toJSON, err := marshalOptional(e.ToValue)
		if err != nil {
			return platform.Internal(fmt.Errorf("marshal history to-value: %w", err))
		}

		// Collapse a run of edits to the same field by the same person.
		if e.Kind != "created" {
			existing, err := q.FindGroupableHistoryEntry(ctx, store.FindGroupableHistoryEntryParams{
				IssueID:   e.IssueID,
				Kind:      e.Kind,
				ActorType: string(actor.Type),
				ActorID:   actor.ID,
				Since:     now.Add(-historyGroupWindow),
			})
			if err == nil {
				// Keep the original from-value and move the to-value forward, so a
				// Todo -> Doing -> Done run reads as Todo -> Done.
				if err := q.UpdateIssueHistoryTarget(ctx, store.UpdateIssueHistoryTargetParams{
					ID:      existing.ID,
					ToValue: toJSON,
				}); err != nil {
					return platform.Internal(fmt.Errorf("update grouped history: %w", err))
				}
				continue
			} else if !store.IsNotFound(err) {
				return platform.Internal(fmt.Errorf("find groupable history: %w", err))
			}
		}

		id, err := uuid.NewV7()
		if err != nil {
			return platform.Internal(fmt.Errorf("new uuid: %w", err))
		}
		if err := q.AppendIssueHistory(ctx, store.AppendIssueHistoryParams{
			ID:          id,
			WorkspaceID: workspaceID,
			IssueID:     e.IssueID,
			ActorType:   string(actor.Type),
			ActorID:     actor.ID,
			Kind:        e.Kind,
			FromValue:   fromJSON,
			ToValue:     toJSON,
			GroupedAt:   nil,
		}); err != nil {
			return platform.Internal(fmt.Errorf("append issue history: %w", err))
		}
	}
	return nil
}

func marshalOptional(v any) (json.RawMessage, error) {
	if v == nil {
		return nil, nil
	}
	b, err := json.Marshal(v)
	if err != nil {
		return nil, err
	}
	return b, nil
}
