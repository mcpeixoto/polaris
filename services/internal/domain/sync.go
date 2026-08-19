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

// BootstrapNotificationLimit is the ceiling on the inbox the snapshot carries.
//
// It is the only cap in the snapshot, and the inbox is the only table that earns one. Every
// other stream here is bounded by something a person maintains — a taxonomy, a sidebar, a
// backlog with archived work excluded — while the fan-out writes a notification per
// recipient per event and nothing ever removes one. On a two-year-old workspace an
// unbounded inbox is not a slow first load, it is the first load: the whole history of
// somebody's notifications on the wire before they can see a single issue, which is the
// outage this endpoint's own semaphore exists to survive.
//
// 2,000 because that is the number the client already works to: web/src/features/inbox
// caps an open inbox at 2,000 rows and hydrates 500 at a time, so a snapshot that carries
// this many carries everything the product will ever render from it. Picking a smaller
// number would make the badge — which is counted from the replica — disagree with the
// server on exactly the accounts where somebody would notice.
//
// The rest is history rather than inbox, and history is what the tiering table in
// docs/05-infrastructure/03-sync-engine.md loads on demand.
const BootstrapNotificationLimit = 2000

// streamPages walks one keyset-paginated bootstrap query to exhaustion, emitting every row
// it returns.
//
// Ten entity types page identically, and the loop has three ways to be wrong that all read
// as working code: a cursor that is never advanced spins forever, a break on an empty page
// costs an extra round trip per type, and a break on a non-empty one stops early on a
// workspace whose row count happens to be a multiple of the page size. Written once, none of
// them can be written a second time — which matters more here than anywhere, because the
// symptom of the third is a snapshot that is silently short.
//
// The cursor is the row id and nothing else: ids are UUIDv7, so ordering by id is creation
// order and OFFSET — which degrades quadratically on the tables where the snapshot actually
// costs something — is never needed.
func streamPages[R any](
	ctx context.Context,
	w BootstrapWriter,
	entityType string,
	page func(ctx context.Context, after uuid.UUID) ([]R, error),
	row func(R) (uuid.UUID, any),
) error {
	after := uuid.Nil
	for {
		rows, err := page(ctx, after)
		if err != nil {
			return platform.Internal(fmt.Errorf("bootstrap %s: %w", entityType, err))
		}
		for _, r := range rows {
			id, payload := row(r)
			if err := w.Entity(entityType, id, payload); err != nil {
				return err
			}
			after = id
		}
		if len(rows) < bootstrapPageSize {
			return nil
		}
	}
}

// StreamBootstrap writes a complete, permission-filtered replica of the workspace.
//
// Everything runs inside one REPEATABLE READ transaction, so the snapshot is a single
// consistent instant even though writes continue throughout. The version emitted first is
// read inside that same transaction, which is what lets the client open a socket with
// {resume: version} and be certain it has neither missed a change nor been sent one twice.
//
// Entities are emitted in dependency order — teams before statuses before labels before
// issues — so a client that applies rows as they arrive never holds a row referencing
// something it has not seen. That matters because the client renders progressively, and the
// order below is ENTITY_TYPES in web/src/store/types.ts read top to bottom. The two are one
// list in two languages: applying an issueLabel before its label is a chip with no name on
// it, which is the shape of bug this ordering exists to make impossible.
//
// Every stream's predicate is the scope its Emit computes, restated in SQL. That is the rule
// the whole function turns on: a snapshot that ships more than the change stream would have
// sent this principal is a way to read something the hub refuses to send, and one that ships
// less is two clients disagreeing about the same workspace with nothing erroring. The place
// each predicate is written down is the query, next to a comment naming the emitter it
// mirrors.
func (s *Service) StreamBootstrap(ctx context.Context, p *authz.Principal, w BootstrapWriter) error {
	teamIDs := p.Teams.IDs()

	// THE visibility predicate, asked once for the scope that has no team to test: whether
	// this principal receives workspace-wide entities at all. Passed into the statements that
	// need it rather than re-derived from the role in each of them, so there is still exactly
	// one definition of what a guest is.
	includeWorkspaceScoped := authz.Visible(p, authz.WorkspaceScope())

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

		// Users are workspace-scoped and guests do not receive the directory. The same
		// answer the label, template and view streams are handed below, spelled once: two
		// spellings of one rule in one function is how the second one drifts.
		if includeWorkspaceScoped {
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

		// Labels and templates come before the issues, and that is not cosmetic: an
		// application names a label and an issue may name the template it was created from,
		// so a client applying rows as they arrive would otherwise hold a chip with no name
		// on it. The replica was in exactly that state until this milestone — issueLabel rows
		// were streamed and label rows were not.
		//
		// Both carry the same two-scope rule, which is requireLabelScope's and
		// requireTemplateScope's: a row with no team belongs to the workspace and reaches
		// every non-guest, a row with a team reaches that team's members. It is stated in the
		// two statements rather than here, because that is where it can be read next to the
		// column it tests.
		//
		// Outside the team guard on purpose. A workspace label exists whether or not the
		// caller is in any team, and a principal with none still opens a create dialog.
		if err := streamPages(ctx, w, "label",
			func(ctx context.Context, after uuid.UUID) ([]store.StreamLabelsForBootstrapRow, error) {
				return q.StreamLabelsForBootstrap(ctx, store.StreamLabelsForBootstrapParams{
					WorkspaceID:            p.WorkspaceID,
					TeamIds:                teamIDs,
					IncludeWorkspaceScoped: includeWorkspaceScoped,
					AfterID:                after,
					PageSize:               bootstrapPageSize,
				})
			},
			func(l store.StreamLabelsForBootstrapRow) (uuid.UUID, any) {
				return l.ID, toLabel(store.GetLabelRow(l))
			},
		); err != nil {
			return err
		}

		if err := streamPages(ctx, w, "issueTemplate",
			func(ctx context.Context, after uuid.UUID) ([]store.StreamIssueTemplatesForBootstrapRow, error) {
				return q.StreamIssueTemplatesForBootstrap(ctx, store.StreamIssueTemplatesForBootstrapParams{
					WorkspaceID:            p.WorkspaceID,
					TeamIds:                teamIDs,
					IncludeWorkspaceScoped: includeWorkspaceScoped,
					AfterID:                after,
					PageSize:               bootstrapPageSize,
				})
			},
			func(t store.StreamIssueTemplatesForBootstrapRow) (uuid.UUID, any) {
				return t.ID, toIssueTemplate(store.GetIssueTemplateRow(t))
			},
		); err != nil {
			return err
		}

		// Projects before issues: an issue may name a project and a milestone.
		// Admins receive every project, including those on private teams they are not in;
		// everybody else receives the ones whose teams they belong to.
		projectTeamIDs := teamIDs
		if p.Role.IsAdmin() {
			all := make([]uuid.UUID, 0, len(teams))
			for _, t := range teams {
				all = append(all, t.ID)
			}
			projectTeamIDs = all
		}

		if err := streamPages(ctx, w, "projectStatus",
			func(ctx context.Context, after uuid.UUID) ([]store.ProjectStatus, error) {
				return q.StreamProjectStatusesForBootstrap(ctx, store.StreamProjectStatusesForBootstrapParams{
					WorkspaceID:            p.WorkspaceID,
					IncludeWorkspaceScoped: includeWorkspaceScoped,
					AfterID:                after,
					PageSize:               bootstrapPageSize,
				})
			},
			func(s store.ProjectStatus) (uuid.UUID, any) { return s.ID, toProjectStatus(s) },
		); err != nil {
			return err
		}

		if err := streamPages(ctx, w, "project",
			func(ctx context.Context, after uuid.UUID) ([]store.Project, error) {
				return q.StreamProjectsForBootstrap(ctx, store.StreamProjectsForBootstrapParams{
					WorkspaceID: p.WorkspaceID,
					TeamIds:     projectTeamIDs,
					AfterID:     after,
					PageSize:    bootstrapPageSize,
				})
			},
			func(row store.Project) (uuid.UUID, any) { return row.ID, toProject(row) },
		); err != nil {
			return err
		}

		if err := streamPages(ctx, w, "projectTeam",
			func(ctx context.Context, after uuid.UUID) ([]store.ProjectTeam, error) {
				return q.StreamProjectTeamsForBootstrap(ctx, store.StreamProjectTeamsForBootstrapParams{
					WorkspaceID: p.WorkspaceID,
					TeamIds:     projectTeamIDs,
					AfterID:     after,
					PageSize:    bootstrapPageSize,
				})
			},
			func(t store.ProjectTeam) (uuid.UUID, any) { return t.ID, toProjectTeam(t) },
		); err != nil {
			return err
		}

		if err := streamPages(ctx, w, "projectMember",
			func(ctx context.Context, after uuid.UUID) ([]store.ProjectMember, error) {
				return q.StreamProjectMembersForBootstrap(ctx, store.StreamProjectMembersForBootstrapParams{
					WorkspaceID: p.WorkspaceID,
					TeamIds:     projectTeamIDs,
					AfterID:     after,
					PageSize:    bootstrapPageSize,
				})
			},
			func(m store.ProjectMember) (uuid.UUID, any) { return m.ID, toProjectMember(m) },
		); err != nil {
			return err
		}

		if err := streamPages(ctx, w, "projectMilestone",
			func(ctx context.Context, after uuid.UUID) ([]store.ProjectMilestone, error) {
				return q.StreamProjectMilestonesForBootstrap(ctx, store.StreamProjectMilestonesForBootstrapParams{
					WorkspaceID: p.WorkspaceID,
					TeamIds:     projectTeamIDs,
					AfterID:     after,
					PageSize:    bootstrapPageSize,
				})
			},
			func(m store.ProjectMilestone) (uuid.UUID, any) { return m.ID, toProjectMilestone(m) },
		); err != nil {
			return err
		}

		if err := streamPages(ctx, w, "initiative",
			func(ctx context.Context, after uuid.UUID) ([]store.Initiative, error) {
				return q.StreamInitiativesForBootstrap(ctx, store.StreamInitiativesForBootstrapParams{
					WorkspaceID: p.WorkspaceID,
					TeamIds:     teamIDs,
					AfterID:     after,
					PageSize:    bootstrapPageSize,
				})
			},
			func(i store.Initiative) (uuid.UUID, any) { return i.ID, toInitiative(i) },
		); err != nil {
			return err
		}

		if err := streamPages(ctx, w, "initiativeProject",
			func(ctx context.Context, after uuid.UUID) ([]store.InitiativeProject, error) {
				return q.StreamInitiativeProjectsForBootstrap(ctx, store.StreamInitiativeProjectsForBootstrapParams{
					WorkspaceID: p.WorkspaceID,
					TeamIds:     projectTeamIDs,
					AfterID:     after,
					PageSize:    bootstrapPageSize,
				})
			},
			func(ip store.InitiativeProject) (uuid.UUID, any) { return ip.ID, toInitiativeProject(ip) },
		); err != nil {
			return err
		}

		if err := streamPages(ctx, w, "projectUpdate",
			func(ctx context.Context, after uuid.UUID) ([]store.ProjectUpdate, error) {
				return q.StreamProjectUpdatesForBootstrap(ctx, store.StreamProjectUpdatesForBootstrapParams{
					WorkspaceID: p.WorkspaceID,
					TeamIds:     projectTeamIDs,
					AfterID:     after,
					PageSize:    bootstrapPageSize,
				})
			},
			func(pu store.ProjectUpdate) (uuid.UUID, any) { return pu.ID, toProjectUpdate(pu) },
		); err != nil {
			return err
		}

		if err := streamPages(ctx, w, "projectDependency",
			func(ctx context.Context, after uuid.UUID) ([]store.ProjectDependency, error) {
				return q.StreamProjectDependenciesForBootstrap(ctx, store.StreamProjectDependenciesForBootstrapParams{
					WorkspaceID: p.WorkspaceID,
					TeamIds:     projectTeamIDs,
					AfterID:     after,
					PageSize:    bootstrapPageSize,
				})
			},
			func(pd store.ProjectDependency) (uuid.UUID, any) { return pd.ID, toProjectDependency(pd) },
		); err != nil {
			return err
		}

		// Project labels before their applications — same bargain as label/issueLabel.
		if len(teamIDs) > 0 || includeWorkspaceScoped {
			if err := streamPages(ctx, w, "projectLabel",
				func(ctx context.Context, after uuid.UUID) ([]store.StreamProjectLabelsForBootstrapRow, error) {
					return q.StreamProjectLabelsForBootstrap(ctx, store.StreamProjectLabelsForBootstrapParams{
						WorkspaceID:            p.WorkspaceID,
						IncludeWorkspaceScoped: true,
						AfterID:                after,
						PageSize:               bootstrapPageSize,
					})
				},
				func(l store.StreamProjectLabelsForBootstrapRow) (uuid.UUID, any) {
					return l.ID, toProjectLabel(store.GetProjectLabelRow(l))
				},
			); err != nil {
				return err
			}
		}

		if len(projectTeamIDs) > 0 {
			if err := streamPages(ctx, w, "projectLabelLink",
				func(ctx context.Context, after uuid.UUID) ([]store.ProjectLabelLink, error) {
					return q.StreamProjectLabelLinksForBootstrap(ctx, store.StreamProjectLabelLinksForBootstrapParams{
						WorkspaceID: p.WorkspaceID,
						TeamIds:     projectTeamIDs,
						AfterID:     after,
						PageSize:    bootstrapPageSize,
					})
				},
				func(link store.ProjectLabelLink) (uuid.UUID, any) {
					return link.ID, toProjectLabelLink(link)
				},
			); err != nil {
				return err
			}
		}

		if err := streamPages(ctx, w, "cycle",
			func(ctx context.Context, after uuid.UUID) ([]store.Cycle, error) {
				return q.StreamCyclesForBootstrap(ctx, store.StreamCyclesForBootstrapParams{
					WorkspaceID: p.WorkspaceID,
					TeamIds:     teamIDs,
					AfterID:     after,
					PageSize:    bootstrapPageSize,
				})
			},
			func(c store.Cycle) (uuid.UUID, any) { return c.ID, toCycle(c) },
		); err != nil {
			return err
		}

		// Everything hanging off an issue. Guarded on the caller having a team at all: with
		// none, every one of these statements is a scan that can only return nothing.
		//
		// Archived issues are excluded and never cached locally — that exclusion is what
		// keeps a five-year-old workspace's first load bounded — and each statement below
		// joins the issue for the same reason, so the snapshot never carries a row hanging
		// off an issue it left out.
		if len(teamIDs) > 0 {
			if err := streamPages(ctx, w, "issue",
				func(ctx context.Context, after uuid.UUID) ([]store.Issue, error) {
					return q.StreamIssuesForBootstrap(ctx, store.StreamIssuesForBootstrapParams{
						WorkspaceID: p.WorkspaceID,
						TeamIds:     teamIDs,
						AfterID:     after,
						PageSize:    bootstrapPageSize,
					})
				},
				func(i store.Issue) (uuid.UUID, any) { return i.ID, toIssue(i, teamKeys[i.TeamID]) },
			); err != nil {
				return err
			}

			// Label applications and relations, after the issues that name them and before
			// the comments, in the dependency order this whole function is written in.
			//
			// These two were written and never called. Both queries have existed since the
			// milestone that added them, both are joined against the issue table so they
			// ship exactly what the snapshot itself contains, and neither was reachable from
			// here — so every replica built by bootstrap held issues with no label chips and
			// no links, while a replica built by applying the change stream held both. Two
			// clients disagreeing about the same workspace with nothing erroring is the
			// failure the snapshot exists to make impossible.
			if err := streamPages(ctx, w, "issueLabel",
				func(ctx context.Context, after uuid.UUID) ([]store.IssueLabel, error) {
					return q.StreamIssueLabelsForBootstrap(ctx, store.StreamIssueLabelsForBootstrapParams{
						WorkspaceID: p.WorkspaceID,
						TeamIds:     teamIDs,
						AfterID:     after,
						PageSize:    bootstrapPageSize,
					})
				},
				func(a store.IssueLabel) (uuid.UUID, any) { return a.ID, toIssueLabel(a) },
			); err != nil {
				return err
			}

			if err := streamPages(ctx, w, "issueRelation",
				func(ctx context.Context, after uuid.UUID) ([]store.IssueRelation, error) {
					return q.StreamIssueRelationsForBootstrap(ctx, store.StreamIssueRelationsForBootstrapParams{
						WorkspaceID: p.WorkspaceID,
						TeamIds:     teamIDs,
						AfterID:     after,
						PageSize:    bootstrapPageSize,
					})
				},
				func(r store.IssueRelation) (uuid.UUID, any) { return r.ID, toIssueRelation(r) },
			); err != nil {
				return err
			}

			if err := streamPages(ctx, w, "attachment",
				func(ctx context.Context, after uuid.UUID) ([]store.Attachment, error) {
					return q.StreamAttachmentsForBootstrap(ctx, store.StreamAttachmentsForBootstrapParams{
						WorkspaceID: p.WorkspaceID,
						TeamIds:     teamIDs,
						AfterID:     after,
						PageSize:    bootstrapPageSize,
					})
				},
				func(a store.Attachment) (uuid.UUID, any) { return a.ID, toAttachment(a) },
			); err != nil {
				return err
			}

			if err := streamPages(ctx, w, "document",
				func(ctx context.Context, after uuid.UUID) ([]store.Document, error) {
					return q.StreamDocumentsForBootstrap(ctx, store.StreamDocumentsForBootstrapParams{
						WorkspaceID: p.WorkspaceID,
						TeamIds:     teamIDs,
						AfterID:     after,
						PageSize:    bootstrapPageSize,
					})
				},
				func(d store.Document) (uuid.UUID, any) { return d.ID, toDocument(d) },
			); err != nil {
				return err
			}

			if err := streamPages(ctx, w, "comment",
				func(ctx context.Context, after uuid.UUID) ([]store.Comment, error) {
					return q.StreamCommentsForBootstrap(ctx, store.StreamCommentsForBootstrapParams{
						WorkspaceID: p.WorkspaceID,
						TeamIds:     teamIDs,
						AfterID:     after,
						PageSize:    bootstrapPageSize,
					})
				},
				func(c store.Comment) (uuid.UUID, any) { return c.ID, toComment(c) },
			); err != nil {
				return err
			}

			// Whose subscriptions: the caller's, and nobody else's. A subscription is emitted
			// under the subscriber's user scope precisely so that one person's watch list does
			// not land in every teammate's replica, and a snapshot that shipped the whole
			// watcher list would be the leak the emitter refused to be.
			if err := streamPages(ctx, w, "issueSubscription",
				func(ctx context.Context, after uuid.UUID) ([]store.IssueSubscription, error) {
					return q.StreamIssueSubscriptionsForBootstrap(ctx, store.StreamIssueSubscriptionsForBootstrapParams{
						WorkspaceID: p.WorkspaceID,
						UserID:      p.UserID,
						TeamIds:     teamIDs,
						AfterID:     after,
						PageSize:    bootstrapPageSize,
					})
				},
				func(sub store.IssueSubscription) (uuid.UUID, any) {
					return sub.ID, toIssueSubscription(sub)
				},
			); err != nil {
				return err
			}
		}

		// The inbox, after the comments a notification may name and before the sidebar.
		//
		// The only stream here that is capped and the only one with no cursor: see
		// BootstrapNotificationLimit for why the table that grows forever gets a ceiling, and
		// why a statement that can never return more than one page does not need paging.
		notifications, err := q.StreamNotificationsForBootstrap(ctx, store.StreamNotificationsForBootstrapParams{
			WorkspaceID: p.WorkspaceID,
			UserID:      p.UserID,
			TeamIds:     teamIDs,
			PageSize:    BootstrapNotificationLimit,
		})
		if err != nil {
			return platform.Internal(fmt.Errorf("bootstrap notification: %w", err))
		}
		for _, n := range notifications {
			if err := w.Entity("notification", n.ID, toNotification(n)); err != nil {
				return err
			}
		}

		// The sidebar. A view is three-scoped — private to its owner, or one team's, or the
		// workspace's — and preferences and favourites belong to one person, so all three
		// statements are told who is asking as well as which teams they are in.
		if err := streamPages(ctx, w, "view",
			func(ctx context.Context, after uuid.UUID) ([]store.StreamViewsForBootstrapRow, error) {
				return q.StreamViewsForBootstrap(ctx, store.StreamViewsForBootstrapParams{
					WorkspaceID:            p.WorkspaceID,
					TeamIds:                teamIDs,
					UserID:                 &p.UserID,
					IncludeWorkspaceScoped: includeWorkspaceScoped,
					AfterID:                after,
					PageSize:               bootstrapPageSize,
				})
			},
			func(v store.StreamViewsForBootstrapRow) (uuid.UUID, any) {
				return v.ID, toView(store.GetViewRow(v))
			},
		); err != nil {
			return err
		}

		if err := streamPages(ctx, w, "viewPreference",
			func(ctx context.Context, after uuid.UUID) ([]store.ViewPreference, error) {
				return q.StreamViewPreferencesForBootstrap(ctx, store.StreamViewPreferencesForBootstrapParams{
					WorkspaceID: p.WorkspaceID,
					UserID:      p.UserID,
					AfterID:     after,
					PageSize:    bootstrapPageSize,
				})
			},
			func(pref store.ViewPreference) (uuid.UUID, any) { return pref.ID, toViewPreference(pref) },
		); err != nil {
			return err
		}

		// Favourites last, because one may point at any of the above — and the statement
		// ships only those whose target this snapshot has already carried. A favourite is a
		// pointer with no foreign key, and the client deletes one whose target it forgets, so
		// shipping a dangling entry would leave a bootstrapped replica holding a sidebar row
		// that opens nothing and that an online replica does not have.
		if err := streamPages(ctx, w, "favorite",
			func(ctx context.Context, after uuid.UUID) ([]store.Favorite, error) {
				return q.StreamFavoritesForBootstrap(ctx, store.StreamFavoritesForBootstrapParams{
					WorkspaceID:            p.WorkspaceID,
					UserID:                 p.UserID,
					TeamIds:                teamIDs,
					IncludeWorkspaceScoped: includeWorkspaceScoped,
					AfterID:                after,
					PageSize:               bootstrapPageSize,
				})
			},
			func(f store.Favorite) (uuid.UUID, any) { return f.ID, toFavorite(f) },
		); err != nil {
			return err
		}

		return nil
	})
}

// ClientSchemaVersion is the shape version of the client's local store, and the only
// definition of it on this side of the wire.
//
// Bumping it makes every client drop its database and bootstrap again: cheap, obvious, and
// impossible to get subtly wrong, which matters far more here than the one-off cost of a
// re-download. It must equal CLIENT_SCHEMA in web/src/store/db.ts.
//
// It lives in this package rather than in internal/syncsrv because both of the two paths a
// client can arrive by need it, and syncsrv imports domain: the HTTP bootstrap sends it in
// the meta frame from StreamBootstrap above, and the WebSocket hello is checked against it
// in syncsrv, whose ClientSchema is now an alias for this constant rather than a second
// copy of the number.
//
// It was a second copy, and it drifted. The client went to 2 to discard replicas for the M1
// entity types, syncsrv followed, and this one stayed at 1 — so the WebSocket agreed with
// the client and the bootstrap that has to succeed before the socket is ever opened did
// not. The failure is not a degraded app but a dead one, and the error it produces tells
// the user to reload, which cannot fix a disagreement between two source constants. That is
// the second time this exact drift happened; hence one constant, aliased, instead of a
// third comment asking people to remember.
//
// v2 added label, issueLabel, issueRelation, issueSubscription, notification, view,
// viewPreference, favorite and issueTemplate to the replica.
//
// v3 is a different kind of bump: nothing changed shape, but the bootstrap started
// *sending* seven of those types. A v2 replica has somewhere to put a label and has never
// been given one, so it is not stale in a way that catches up — it has an empty Views
// sidebar, an empty inbox and label applications naming labels it has never seen, and it
// stays that way until some unrelated delta happens to carry each row. Discarding it is the
// only thing that fixes it, which is exactly what this constant is for.
// v4 adds projectStatus, project, projectTeam, projectMember and projectMilestone, and
// issue.projectId / issue.projectMilestoneId.
// v5 adds cycle, team cadence fields, and issue.cycleId.
// v6 adds team triage flags and issue.snoozedUntil.
// v7 adds team auto-close/archive periods and issue.autoClosedAt.
// v8 adds attachment (URL-idempotent link cards on issues).
// v9 adds document (markdown attached to teams and projects).
// v10 adds initiative and initiativeProject (workspace objectives grouping projects).
// v11 adds projectUpdate (health plus narrative status posts on projects).
// v12 adds projectDependency (end→start links between projects).
// v13 adds view.projectId (attached project views as tabs).
// v14 adds projectLabel and projectLabelLink (workspace taxonomy for projects).
// v18 adds project update reminder cadence on workspace and per-project schedule overrides.
const ClientSchemaVersion = 18

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
