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

// This file is the sync engine's read side, exposed through the domain layer because
// scripts/lint-imports.sh forbids internal/syncsrv from importing internal/store. That
// rule is not bureaucracy here: it guarantees the hub filters deltas with the same
// authz.Visible predicate the resolvers use, rather than growing a second, subtly
// different one next to the database.

// SyncChange is one change_log row, decoded far enough for the hub to make a visibility
// decision without touching the database again.
type SyncChange struct {
	Version    int64
	EntityType string
	EntityID   uuid.UUID
	Op         string
	Scope      authz.Scope
	ActorType  string
	ActorID    *uuid.UUID
	// Payload is the entity as the client stores it, already serialised. It is passed
	// through untouched — re-encoding it here would be pure cost and a chance to drift.
	Payload json.RawMessage
}

// Visible applies THE visibility predicate. The hub calls this for every change against
// every session, which is why the scope travels on the row rather than being looked up.
func (c SyncChange) Visible(p *authz.Principal) bool {
	return authz.VisibleEntity(p, c.EntityID, c.Scope)
}

// ReadChanges returns changes in (after, through], up to limit rows.
//
// The limit is what makes the "gap too large" branch decidable: a caller that gets a
// full page asks again, and one whose backlog exceeds its budget sends a resync instead
// of streaming forever into a client that has been offline for a fortnight.
func (s *Service) ReadChanges(ctx context.Context, workspaceID uuid.UUID, after, through int64, limit int32) ([]SyncChange, error) {
	rows, err := s.db.Queries().ReadChangesSince(ctx, store.ReadChangesSinceParams{
		WorkspaceID:    workspaceID,
		AfterVersion:   after,
		ThroughVersion: through,
		PageSize:       limit,
	})
	if err != nil {
		return nil, platform.Internal(fmt.Errorf("read changes: %w", err))
	}

	out := make([]SyncChange, 0, len(rows))
	for _, r := range rows {
		scope, err := authz.ParseScope(r.Scope)
		if err != nil {
			// A row whose scope will not parse cannot be judged, so it must not be sent.
			// Skipping is the safe failure: the client misses a change and re-bootstraps
			// eventually, rather than being handed something it may not see.
			platform.Log(ctx).Error("change_log row has an unparseable scope; skipping",
				"workspace", workspaceID, "version", r.Version, "error", err)
			continue
		}
		out = append(out, SyncChange{
			Version:    r.Version,
			EntityType: r.EntityType,
			EntityID:   r.EntityID,
			Op:         r.Op,
			Scope:      scope,
			ActorType:  r.ActorType,
			ActorID:    r.ActorID,
			Payload:    r.Payload,
		})
	}
	return out, nil
}

// OldestRetainedVersion tells a resuming client whether its position still exists.
//
// change_log is pruned to 30 days. A client below this watermark has had its deltas
// deleted and must re-bootstrap; without the check it would resume from a version that
// no longer exists and silently miss everything in between.
func (s *Service) OldestRetainedVersion(ctx context.Context, workspaceID uuid.UUID) (int64, error) {
	v, err := s.db.Queries().OldestRetainedVersion(ctx, workspaceID)
	if err != nil {
		return 0, platform.Internal(err)
	}
	return v, nil
}

// SyncNotice is a wakeup: a workspace has changes up to Version.
type SyncNotice struct {
	WorkspaceID uuid.UUID `json:"w"`
	Version     int64     `json:"v"`
}

// ListenForChanges blocks, delivering a notice for every committed mutation until ctx is
// cancelled.
//
// It holds a dedicated connection because LISTEN is session state: in production
// pgbouncer runs in transaction mode, where a pooled connection is handed to somebody
// else between statements and the subscription evaporates. That is why the hub is
// configured with a direct-to-Postgres URL rather than the pooled one.
//
// Postgres delivers NOTIFY on commit and not at all on rollback, which is the property
// that makes this preferable to publishing to a cache after the transaction returns: a
// wakeup can never be sent for a change that did not happen, and a committed change can
// never fail to produce one.
func (s *Service) ListenForChanges(ctx context.Context, fn func(SyncNotice)) error {
	conn, err := s.db.Pool().Acquire(ctx)
	if err != nil {
		return platform.Internal(fmt.Errorf("acquire listen connection: %w", err))
	}
	defer conn.Release()

	if _, err := conn.Exec(ctx, "LISTEN polaris_sync"); err != nil {
		return platform.Internal(fmt.Errorf("listen: %w", err))
	}

	for {
		n, err := conn.Conn().WaitForNotification(ctx)
		if err != nil {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			return platform.Internal(fmt.Errorf("wait for notification: %w", err))
		}

		var notice SyncNotice
		if err := json.Unmarshal([]byte(n.Payload), &notice); err != nil {
			platform.Log(ctx).Error("malformed sync notice", "payload", n.Payload, "error", err)
			continue
		}
		fn(notice)
	}
}

// --- bootstrap ------------------------------------------------------------------

// BootstrapWriter receives the snapshot one entity at a time. The hub-facing code owns
// the encoding (NDJSON, gzip, chunking) so that this layer never has to know about HTTP.
type BootstrapWriter interface {
	// Meta is called exactly once, first, with the version the snapshot is consistent as of.
	Meta(version int64, clientSchema int) error
	// Entity is called once per row.
	Entity(entityType string, id uuid.UUID, payload any) error
}

// bootstrapPageSize bounds how many rows are held in memory at once. The snapshot for a
// large workspace is tens of megabytes; loading it whole would put the server's memory
// at the mercy of its biggest customer.
const bootstrapPageSize = 1000

// StreamBootstrap writes a complete, permission-filtered replica of the workspace.
//
// Everything runs inside one REPEATABLE READ transaction, so the snapshot is a single
// consistent instant even though writes continue throughout. The version emitted first is
// read inside that same transaction, which is what lets the client open a socket with
// {resume: version} and be certain it has neither missed a change nor been sent one twice.
//
// Entities are emitted in dependency order — teams before statuses before issues — so a
// client that applies rows as they arrive never holds a row referencing something it has
// not seen. That matters because the client renders progressively.
func (s *Service) StreamBootstrap(ctx context.Context, p *authz.Principal, w BootstrapWriter) error {
	teamIDs := p.Teams.IDs()

	return s.db.InReadOnlyTx(ctx, func(ctx context.Context, q *store.Queries) error {
		version, err := q.GetWorkspaceVersion(ctx, p.WorkspaceID)
		if err != nil {
			return platform.Internal(fmt.Errorf("read version: %w", err))
		}
		if err := w.Meta(version, ClientSchemaVersion); err != nil {
			return err
		}

		ws, err := q.GetWorkspace(ctx, p.WorkspaceID)
		if err != nil {
			return platform.Internal(err)
		}
		if err := w.Entity("workspace", ws.ID, toWorkspace(ws)); err != nil {
			return err
		}

		// Users are workspace-scoped and guests do not receive the directory.
		if !p.IsGuest() {
			users, err := q.ListUsersInWorkspace(ctx, p.WorkspaceID)
			if err != nil {
				return platform.Internal(err)
			}
			for _, u := range users {
				if err := w.Entity("user", u.ID, toUser(u)); err != nil {
					return err
				}
			}
		}

		teams, err := q.ListTeamsInWorkspace(ctx, p.WorkspaceID)
		if err != nil {
			return platform.Internal(err)
		}
		teamKeys := make(map[uuid.UUID]string, len(teams))
		for _, t := range teams {
			teamKeys[t.ID] = t.Key
			if !authz.Visible(p, authz.TeamScope(t.ID, t.Private)) {
				continue
			}
			if err := w.Entity("team", t.ID, toTeam(t)); err != nil {
				return err
			}
		}

		memberships, err := q.ListMembershipsInWorkspace(ctx, p.WorkspaceID)
		if err != nil {
			return platform.Internal(err)
		}
		for _, m := range memberships {
			if !p.Teams.Has(m.TeamID) {
				continue
			}
			if err := w.Entity("teamMembership", m.ID, toMembership(m)); err != nil {
				return err
			}
		}

		states, err := q.ListWorkflowStatesInWorkspace(ctx, p.WorkspaceID)
		if err != nil {
			return platform.Internal(err)
		}
		for _, st := range states {
			if !p.Teams.Has(st.TeamID) {
				continue
			}
			if err := w.Entity("workflowState", st.ID, toWorkflowState(st)); err != nil {
				return err
			}
		}

		// Issues are keyset-paginated by id. OFFSET degrades quadratically, which is
		// precisely wrong for the one query that runs against the largest table.
		//
		// Archived issues are excluded and never cached locally: that exclusion is what
		// keeps a five-year-old workspace's first load bounded.
		if len(teamIDs) > 0 {
			after := uuid.Nil
			for {
				issues, err := q.StreamIssuesForBootstrap(ctx, store.StreamIssuesForBootstrapParams{
					WorkspaceID: p.WorkspaceID,
					TeamIds:     teamIDs,
					AfterID:     after,
					PageSize:    bootstrapPageSize,
				})
				if err != nil {
					return platform.Internal(err)
				}
				for _, i := range issues {
					if err := w.Entity("issue", i.ID, toIssue(i, teamKeys[i.TeamID])); err != nil {
						return err
					}
					after = i.ID
				}
				if len(issues) < bootstrapPageSize {
					break
				}
			}

			after = uuid.Nil
			for {
				comments, err := q.StreamCommentsForBootstrap(ctx, store.StreamCommentsForBootstrapParams{
					WorkspaceID: p.WorkspaceID,
					TeamIds:     teamIDs,
					AfterID:     after,
					PageSize:    bootstrapPageSize,
				})
				if err != nil {
					return platform.Internal(err)
				}
				for _, c := range comments {
					if err := w.Entity("comment", c.ID, toComment(c)); err != nil {
						return err
					}
					after = c.ID
				}
				if len(comments) < bootstrapPageSize {
					break
				}
			}
		}

		return nil
	})
}

// ClientSchemaVersion is the shape version of the client's local store. Bumping it makes
// every client drop its database and bootstrap again.
const ClientSchemaVersion = 1

// PruneChangeLog deletes change rows past the retention window. Run nightly.
//
// The window has to comfortably exceed the longest plausible laptop-in-a-drawer gap:
// a client that resumes below the oldest retained version has to re-download everything,
// and doing that to somebody back from three weeks' leave is a bad first impression.
const ChangeLogRetention = 30 * 24 * time.Hour

func (s *Service) PruneChangeLog(ctx context.Context) (int64, error) {
	n, err := s.db.Queries().PruneChangeLogBefore(ctx, time.Now().Add(-ChangeLogRetention))
	if err != nil {
		return 0, platform.Internal(err)
	}
	return n, nil
}

// EnsureChangeLogPartitions creates the monthly partitions for the coming months.
//
// Runs daily and looks three months ahead, because the failure mode if it lapses is that
// every write in the product lands in the default partition — and a partition cannot then
// be created for a month whose rows are already sitting there.
func (s *Service) EnsureChangeLogPartitions(ctx context.Context) error {
	now := time.Now()
	for i := range 4 {
		month := now.AddDate(0, i, 0)
		if err := s.db.Queries().EnsureChangeLogPartition(ctx, store.DateOf(month)); err != nil {
			return platform.Internal(fmt.Errorf("ensure partition for %s: %w", month.Format("2006-01"), err))
		}
	}
	return nil
}
