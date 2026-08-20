import { deleteDB, openDB, type DBSchema, type IDBPDatabase } from 'idb';

import { clearJournal } from './journal';
import type { OutboxRecord } from './outbox';
import {
  ENTITY_TYPES,
  type Comment,
  type Attachment,
  type Document,
  type Cycle,
  type Customer,
  type CustomerRequest,
  type SlaRule,
  type Entity,
  type EntityOf,
  type EntityType,
  type Favorite,
  type GitHubConnection,
  type GitHubUserLink,
  type Issue,
  type IssueLabel,
  type IssueRelation,
  type IssueSubscription,
  type IssueTemplate,
  type FormTemplate,
  type FormTemplateField,
  type ProjectTemplate,
  type ProjectTemplateMilestone,
  type ProjectTemplateIssue,
  type Initiative,
  type InitiativeProject,
  type ProjectUpdate,
  type ProjectDependency,
  type ProjectLabel,
  type ProjectLabelLink,
  type Label,
  type Notification,
  type Project,
  type ProjectMember,
  type ProjectMilestone,
  type ProjectStatus,
  type ProjectTeam,
  type RecurringIssue,
  type Team,
  type TeamMembership,
  type Timestamp,
  type User,
  type UUID,
  type View,
  type ViewPreference,
  type WorkflowState,
  type Workspace,
} from './types';

/**
 * The durable half of the replica.
 *
 * IndexedDB is where the workspace survives a reload, which is what makes the app open
 * instantly on the second visit instead of staring at a bootstrap stream. Nothing renders
 * from here — the in-memory store does that — so every method on this file is on the
 * boot path or the write path, never on the read path.
 */

/**
 * The shape version of the local store, bumped whenever this layout changes.
 *
 * It is part of the database *name*, so a bump is not a migration: the new build opens a
 * database that does not exist yet, bootstraps into it, and the old one is swept away.
 * Cheap, obvious, and impossible to get subtly wrong — which matters far more than the
 * one-off cost of a re-download. It must stay equal to `syncsrv.ClientSchema`, because
 * the server compares them at hello and sends `resync` on a mismatch.
 *
 * v2 adds the M1 entities — labels, templates, relations, subscriptions, notifications,
 * views and favourites. A v1 replica has no object store to put any of them in, so it is
 * not stale, it is unusable: the only correct thing to do with it is throw it away.
 *
 * v3 changes no layout at all. It exists because the *server* started sending seven of
 * those types at bootstrap, having previously declared them and shipped none. A v2 replica
 * therefore has the object stores and has never been given a row to put in them: an empty
 * Views sidebar, an empty inbox, and label applications naming labels it has never seen.
 * That does not converge — nothing re-sends a row that was never sent — so the replica has
 * to be thrown away, which is what a bump does.
 *
 * v4 adds projects, their statuses, teams, members and milestones, and the two columns
 * on an issue that point at them.
 *
 * v5 adds cycles, team cadence fields, and issue.cycleId.
 *
 * v6 adds team triage flags and issue.snoozedUntil.
 *
 * v7 adds team auto-close/archive periods and issue.autoClosedAt.
 *
 * v8 adds attachment (URL-idempotent link cards on issues).
 *
 * v9 adds document (markdown attached to teams and projects).
 *
 * v10 adds initiative and initiativeProject (workspace objectives grouping projects).
 * v11 adds projectUpdate (health plus narrative status posts on projects).
 * v12 adds projectDependency (end→start links between projects).
 * v13 adds view.projectId (attached project views as tabs).
 * v14 adds projectLabel and projectLabelLink (workspace taxonomy for projects).
 *
 * v15 adds githubConnection and githubUserLink (GitHub v1 linking, no secrets).
 *
 * v16 adds githubConnection.linkbacks (opt-out of comments posted back to GitHub).
 *
 * v18 adds project update reminder cadence on workspace and per-project schedule overrides.
 * v19 adds formTemplate, formTemplateField, and issue.formTemplateId.
 * v21 adds projectTemplate, projectTemplateMilestone, projectTemplateIssue, and project.projectTemplateId.
 * v22 adds githubConnection and githubUserLink (GitHub v1 linking, no secrets).
 * v23 adds githubConnection.linkbacks (opt-out of comments posted back to GitHub).
 * v24 adds recurringIssue, team default template ids, and issue.recurringIssueId.
 * v25 adds customer and customerRequest.
 * v30 adds slaRule (workspace SLA policies).
 * v32 adds comment.anchorStart / anchorEnd / quote (inline comments on descriptions).
 * Numbers 26–29 and 31 are reserved for concurrent slices on other worktrees.
 */
export const CLIENT_SCHEMA = 32;

/**
 * One database per workspace per schema version.
 *
 * Per workspace because a person in four workspaces should not pay four replicas' worth
 * of read amplification to open one, and because signing out of one must not touch the
 * others. Per schema version because that is what makes the upgrade path a delete.
 */
export function databaseName(workspaceId: UUID, clientSchema: number = CLIENT_SCHEMA): string {
  return `polaris/${workspaceId}/v${clientSchema}`;
}

/**
 * The replica's own bookkeeping.
 *
 * `version` is the workspace version this replica is complete up to, and it is the number
 * the client resumes from. It is written in the same transaction as the rows it describes
 * — a version ahead of its data means the client asks for changes after V, is told there
 * are none, and permanently renders a workspace missing whatever was in flight.
 */
export interface Meta {
  readonly version: number;
  /**
   * When the snapshot completed. Absent until then: a bootstrap interrupted halfway
   * leaves rows behind, and without this flag a partial replica is indistinguishable
   * from a complete one.
   */
  readonly bootstrapAt: Timestamp | null;
  readonly clientSchema: number;
}

/** An entity to store, tagged with the object store it belongs in. */
export interface EntityRow {
  readonly type: EntityType;
  readonly entity: Entity;
}

/** An entity to forget. */
export interface EntityRef {
  readonly type: EntityType;
  readonly id: UUID;
}

/** One durable write: rows in, rows out, and the version they leave the replica at. */
export interface WriteBatch {
  readonly puts?: readonly EntityRow[] | undefined;
  readonly deletes?: readonly EntityRef[] | undefined;
  readonly meta?: Meta | undefined;
}

/**
 * Everything the in-memory store needs to rehydrate, read in one transaction.
 *
 * Written as a mapped type over `EntityType` rather than a hand-listed set of fields, so
 * that adding an entity type to `ENTITY_TYPES` cannot leave a table silently absent from
 * hydration — which would present a complete replica as one missing every label.
 */
export type Snapshot = {
  readonly meta: Meta | null;
} & { readonly [T in EntityType]: ReadonlyArray<EntityOf<T>> };

/**
 * One object store per entity type, keyed by id, with no secondary indexes.
 *
 * IndexedDB is never on the read path — every query is answered from the in-memory
 * indexes — so an index here would be write cost paid for a lookup nothing performs.
 * The only reads are `getAll` at boot and the single `meta` row.
 */
interface PolarisSchema extends DBSchema {
  workspace: { key: UUID; value: Workspace };
  user: { key: UUID; value: User };
  githubConnection: { key: UUID; value: GitHubConnection };
  githubUserLink: { key: UUID; value: GitHubUserLink };
  team: { key: UUID; value: Team };
  teamMembership: { key: UUID; value: TeamMembership };
  workflowState: { key: UUID; value: WorkflowState };
  customer: { key: UUID; value: Customer };
  slaRule: { key: UUID; value: SlaRule };
  label: { key: UUID; value: Label };
  issueTemplate: { key: UUID; value: IssueTemplate };
  formTemplate: { key: UUID; value: FormTemplate };
  formTemplateField: { key: UUID; value: FormTemplateField };
  projectTemplate: { key: UUID; value: ProjectTemplate };
  projectTemplateMilestone: { key: UUID; value: ProjectTemplateMilestone };
  projectTemplateIssue: { key: UUID; value: ProjectTemplateIssue };
  projectStatus: { key: UUID; value: ProjectStatus };
  project: { key: UUID; value: Project };
  projectTeam: { key: UUID; value: ProjectTeam };
  projectMember: { key: UUID; value: ProjectMember };
  projectMilestone: { key: UUID; value: ProjectMilestone };
  initiative: { key: UUID; value: Initiative };
  initiativeProject: { key: UUID; value: InitiativeProject };
  projectUpdate: { key: UUID; value: ProjectUpdate };
  projectDependency: { key: UUID; value: ProjectDependency };
  projectLabel: { key: UUID; value: ProjectLabel };
  projectLabelLink: { key: UUID; value: ProjectLabelLink };
  cycle: { key: UUID; value: Cycle };
  recurringIssue: { key: UUID; value: RecurringIssue };
  issue: { key: UUID; value: Issue };
  customerRequest: { key: UUID; value: CustomerRequest };
  issueLabel: { key: UUID; value: IssueLabel };
  issueRelation: { key: UUID; value: IssueRelation };
  attachment: { key: UUID; value: Attachment };
  document: { key: UUID; value: Document };
  comment: { key: UUID; value: Comment };
  issueSubscription: { key: UUID; value: IssueSubscription };
  notification: { key: UUID; value: Notification };
  view: { key: UUID; value: View };
  viewPreference: { key: UUID; value: ViewPreference };
  favorite: { key: UUID; value: Favorite };
  meta: { key: string; value: Meta };
  outbox: { key: UUID; value: OutboxRecord };
}

/** The single `meta` row's key. One record, so the store needs no key path. */
const META_KEY = 'replica';

/**
 * The IndexedDB `version` is pinned at 1 on purpose. Schema evolution is expressed in
 * the database *name*, so the `upgradeneeded` path only ever runs once per database and
 * there is no migration ladder to get wrong at three in the morning.
 */
const IDB_VERSION = 1;

export class PolarisDB {
  private readonly db: IDBPDatabase<PolarisSchema>;
  readonly workspaceId: UUID;
  private detached = false;

  private constructor(db: IDBPDatabase<PolarisSchema>, workspaceId: UUID) {
    this.db = db;
    this.workspaceId = workspaceId;
  }

  /**
   * Opens the replica, dropping and recreating it if it claims a schema this build does
   * not speak.
   *
   * The name already encodes the schema, so the check can only fire if something wrote a
   * `meta` row from a different build — but the cost is one read at boot and the failure
   * it prevents is unbounded: a replica shaped for another version renders wrong data
   * confidently, and every bug report from it points somewhere else.
   */
  static async open(workspaceId: UUID): Promise<PolarisDB> {
    let handle = await PolarisDB.connect(workspaceId);
    const meta = await handle.db.get('meta', META_KEY);
    if (meta !== undefined && meta.clientSchema !== CLIENT_SCHEMA) {
      handle.close();
      await dropDatabase(workspaceId);
      handle = await PolarisDB.connect(workspaceId);
    }
    return handle;
  }

  private static async connect(workspaceId: UUID): Promise<PolarisDB> {
    let self: PolarisDB | undefined;
    const db = await openDB<PolarisSchema>(databaseName(workspaceId), IDB_VERSION, {
      upgrade(database) {
        for (const type of ENTITY_TYPES) database.createObjectStore(type, { keyPath: 'id' });
        // `meta` holds one out-of-line record; `outbox` is keyed by opId, which is a
        // UUIDv7 and therefore sorts in creation order — the queue needs no index to be
        // replayed in the order the user made the edits.
        database.createObjectStore('meta');
        database.createObjectStore('outbox', { keyPath: 'opId' });
      },
      blocking() {
        // Another tab is deleting or upgrading this database. Holding the connection
        // open would block it indefinitely, so let go: that tab is about to
        // re-bootstrap, and this one will find out on its next write.
        self?.detach();
      },
    });
    self = new PolarisDB(db, workspaceId);
    return self;
  }

  /**
   * Applies a batch in one transaction.
   *
   * One transaction per batch, never per row. A bootstrap page is a few thousand rows,
   * and IndexedDB charges for the transaction, not the put — per-row transactions turn a
   * ten-thousand-issue snapshot from seconds into minutes. The requests are fired without
   * awaiting each other for the same reason: awaiting inside the loop serialises the
   * round trips and, worse, risks the transaction auto-committing between rows.
   */
  async write(batch: WriteBatch): Promise<void> {
    this.assertUsable();
    const puts = batch.puts ?? [];
    const deletes = batch.deletes ?? [];
    if (puts.length === 0 && deletes.length === 0 && batch.meta === undefined) return;

    const tx = this.db.transaction([...ENTITY_TYPES, 'meta'], 'readwrite');
    const pending: Array<Promise<unknown>> = [];
    for (const row of puts) {
      pending.push(tx.objectStore(row.type).put(row.entity as never));
    }
    for (const ref of deletes) {
      pending.push(tx.objectStore(ref.type).delete(ref.id));
    }
    if (batch.meta !== undefined) {
      // Same transaction as the rows it describes, so a crash cannot leave the resume
      // version ahead of the data it promises.
      pending.push(tx.objectStore('meta').put(batch.meta, META_KEY));
    }
    pending.push(tx.done);
    await Promise.all(pending);
  }

  /**
   * Reads the whole replica for hydration.
   *
   * Every request is issued before the first await, which is what keeps this one
   * transaction: awaiting a table before asking for the next lets IndexedDB auto-commit
   * between them, and sixteen serial transactions at boot is the pause this whole layer
   * exists to avoid.
   */
  async readAll(): Promise<Snapshot> {
    this.assertUsable();
    const tx = this.db.transaction([...ENTITY_TYPES, 'meta'], 'readonly');
    const tables = ENTITY_TYPES.map(
      (type) => tx.objectStore(type).getAll() as Promise<readonly Entity[]>,
    );
    const metaRequest = tx.objectStore('meta').get(META_KEY);

    const rows = await Promise.all(tables);
    const meta = await metaRequest;
    await tx.done;

    const snapshot: Record<string, unknown> = { meta: meta ?? null };
    ENTITY_TYPES.forEach((type, i) => {
      snapshot[type] = rows[i] ?? [];
    });
    return snapshot as Snapshot;
  }

  async readMeta(): Promise<Meta | null> {
    this.assertUsable();
    return (await this.db.get('meta', META_KEY)) ?? null;
  }

  /**
   * Empties every entity store and clears the meta row, for the start of a bootstrap.
   *
   * The outbox is deliberately left alone: a re-bootstrap is a statement about the
   * replica, not about the user's unsent work, and throwing away queued mutations
   * because the schema changed would lose edits the user believes are saved.
   */
  async clearEntities(): Promise<void> {
    this.assertUsable();
    const tx = this.db.transaction([...ENTITY_TYPES, 'meta'], 'readwrite');
    const pending: Array<Promise<unknown>> = ENTITY_TYPES.map((type) =>
      tx.objectStore(type).clear(),
    );
    pending.push(tx.objectStore('meta').delete(META_KEY));
    pending.push(tx.done);
    await Promise.all(pending);
  }

  async readOutbox(): Promise<OutboxRecord[]> {
    this.assertUsable();
    return this.db.getAll('outbox');
  }

  async putOutbox(record: OutboxRecord): Promise<void> {
    this.assertUsable();
    await this.db.put('outbox', record);
  }

  async deleteOutbox(opId: UUID): Promise<void> {
    this.assertUsable();
    await this.db.delete('outbox', opId);
  }

  async clearOutbox(): Promise<void> {
    this.assertUsable();
    await this.db.clear('outbox');
  }

  close(): void {
    this.detached = true;
    this.db.close();
  }

  /** Closes the connection and deletes the database behind it. */
  async destroy(): Promise<void> {
    this.close();
    await dropDatabase(this.workspaceId);
  }

  private detach(): void {
    this.detached = true;
    this.db.close();
  }

  private assertUsable(): void {
    if (this.detached) {
      throw new Error(
        `local replica for workspace ${this.workspaceId} is closed; reopen it before use`,
      );
    }
  }
}

/**
 * Deletes a replica outright.
 *
 * This is the whole of the schema-mismatch recovery, and the whole of sign-out cleanup.
 * A migration path would be more efficient and would be the wrong trade: local data is
 * a cache of the server, re-downloadable at will, and a migration bug corrupts a replica
 * in ways that are invisible until a user swears the app is showing them the wrong
 * status.
 */
export async function dropDatabase(
  workspaceId: UUID,
  clientSchema: number = CLIENT_SCHEMA,
): Promise<void> {
  await deleteDB(databaseName(workspaceId, clientSchema));
  // The write-ahead journal goes with it. It lives outside IndexedDB precisely so that
  // deleting the replica cannot take it — which is what it is for during a session and
  // exactly wrong here: on sign-out, or when this installation is pointed at a different
  // server, a surviving entry is a mutation replayed against a workspace the person may no
  // longer be in, on a server that never issued it.
  //
  // Not keyed by schema version, unlike the database name, and deliberately: a journalled
  // entry is a GraphQL operation, which a client-side schema bump does not invalidate. A
  // user whose replica was rebuilt by an upgrade should still not lose the edit they made
  // just before it.
  clearJournal(workspaceId);
}

/**
 * Deletes replicas of this workspace left behind by other schema versions.
 *
 * Because a schema bump changes the database name rather than migrating in place, the
 * previous replica would otherwise sit on disk forever — tens of megabytes per bump, per
 * workspace, never read again. Best-effort by design: `indexedDB.databases()` is not
 * universal, and failing to reclaim space must never stop the app from starting.
 */
export async function dropStaleDatabases(workspaceId: UUID): Promise<void> {
  if (typeof indexedDB === 'undefined' || typeof indexedDB.databases !== 'function') return;
  const keep = databaseName(workspaceId);
  const prefix = `polaris/${workspaceId}/v`;
  let existing: IDBDatabaseInfo[];
  try {
    existing = await indexedDB.databases();
  } catch {
    return;
  }
  await Promise.all(
    existing
      .map((info) => info.name)
      .filter(
        (name): name is string => name !== undefined && name.startsWith(prefix) && name !== keep,
      )
      .map((name) => deleteDB(name)),
  );
}
