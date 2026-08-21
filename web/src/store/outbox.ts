import type { PolarisDB } from './db';
import { drainJournal, journalForget, journalWrite } from './journal';
import type { Entity, EntityType, Timestamp, UUID } from './types';

/**
 * The outbox: every mutation the user has made and the server has not yet confirmed.
 *
 * It lives in IndexedDB, and that is the entire point. An in-memory queue loses work the
 * moment a laptop lid closes mid-flight — the user watched their change appear, the
 * optimistic patch was the only copy, and it is gone. Durable, the same sequence is
 * replayed on the next load and the user never learns there was a gap.
 *
 * Replay is safe because every entry carries an `opId`. The server records
 * `(client_id, op_id)` for 24 hours and returns the original result on a replay, so a
 * retry after a dropped response never double-applies. Without that, "survives a reload"
 * would mean "occasionally creates the issue twice".
 */

/**
 * What one optimistic write did to one entity, and how to undo it.
 *
 * `before` is `null` when the entity did not exist — an optimistic create — and `after`
 * is `null` when the write removed it. Keeping both, rather than a field-level diff,
 * makes the undo a single assignment and makes it possible to tell whether the local
 * state is still the one this patch left behind (see `Store.revertOptimistic`).
 */
export interface EntityPatch {
  readonly type: EntityType;
  readonly id: UUID;
  readonly before: Entity | null;
  readonly after: Entity | null;
}

/** One mutation's optimistic effect. A mutation may touch several entities at once. */
export type OptimisticPatch = readonly EntityPatch[];

/**
 * How to pair the row the server allocated an id for with the stand-in that stood for it.
 *
 * Only the entities whose ids the API still mints need one — a comment, a relation, an
 * issue subscription. Issues carry a client-minted id, so their response upserts over the
 * same key and there is nothing to pair.
 *
 * It is *stored*, alongside the mutation, and that is the whole point. Reconciling in the
 * `await` that sent the mutation works only for as long as that `await` survives: a reload
 * between the optimistic write and the response discards the closure, the outbox replays
 * the op from IndexedDB, and the server's row then arrives beside a stand-in nothing is
 * left holding — two comments on the screen for one comment on the server, and no reload
 * clears it because both rows are now in the replica. Data, not a closure, is what
 * survives the reload that causes the bug.
 *
 * Plain data for the same reason: an IndexedDB value cannot hold a function.
 */
export interface Reconciliation {
  readonly type: EntityType;
  /** The id the client invented while it waited. */
  readonly provisionalId: UUID;
  /** Where the row sits in the mutation's response — `['createComment', 'comment']`. */
  readonly path: readonly string[];
}

/** A queued mutation, exactly as it is stored. */
export interface OutboxRecord {
  /** UUIDv7, generated client-side. This is what makes a server-side retry idempotent. */
  readonly opId: UUID;
  /** The GraphQL operation name, so a replay can be re-sent without reconstructing it. */
  readonly mutation: string;
  readonly variables: Readonly<Record<string, unknown>>;
  readonly optimisticPatch: OptimisticPatch;
  /** How to pair the response's row with the stand-in. Absent for client-minted ids. */
  readonly reconcile?: Reconciliation | undefined;
  /** Send attempts so far. Persisted, so a poison op cannot be retried forever across reloads. */
  readonly attempts: number;
  readonly createdAt: Timestamp;
}

export interface OutboxAppend {
  readonly mutation: string;
  readonly variables: Readonly<Record<string, unknown>>;
  readonly optimisticPatch?: OptimisticPatch | undefined;
  readonly reconcile?: Reconciliation | undefined;
  /** Supplied only by tests and by a caller that minted the id before rendering. */
  readonly opId?: UUID | undefined;
}

/**
 * The last millisecond a UUIDv7 was minted in, and the counter inside it.
 *
 * Module-level because the guarantee is per-process: two ids minted in the same
 * millisecond must still order by the moment they were created, since the outbox relies
 * on key order being creation order. Without the counter, two mutations from one
 * keystroke burst would sort by their random bits and replay out of order — which for
 * "set status, then set assignee" means the server applies them backwards.
 */
let lastTimestamp = -1;
let sequence = 0;

/** The 12-bit counter that shares a millisecond, per RFC 9562's monotonic construction. */
const MAX_SEQUENCE = 0xfff;

function hex8(byte: number): string {
  return byte.toString(16).padStart(2, '0');
}

/**
 * Mints a time-ordered UUID.
 *
 * v7 rather than v4 because these ids are IndexedDB keys and Postgres primary keys: a
 * random key scatters writes across the whole B-tree, while a time-ordered one appends.
 * The client-side half of the same property is that the outbox replays in creation order
 * from the key alone, with no secondary index and no sequence column.
 */
export function uuidv7(): string {
  const now = Date.now();
  if (now > lastTimestamp) {
    lastTimestamp = now;
    sequence = 0;
  } else if (sequence < MAX_SEQUENCE) {
    sequence += 1;
  } else {
    // More than 4,096 ids in one millisecond. Borrowing the next millisecond keeps the
    // sequence strictly increasing; repeating one would break the ordering that the
    // replay depends on, and the clock catches up within the millisecond.
    lastTimestamp += 1;
    sequence = 0;
  }

  const timeHex = lastTimestamp.toString(16).padStart(12, '0');
  const seqHex = (0x7000 | sequence).toString(16).padStart(4, '0');

  let tail = '';
  let first = true;
  for (const byte of crypto.getRandomValues(new Uint8Array(8))) {
    // The top two bits of the ninth byte are the RFC 4122 variant.
    tail += hex8(first ? 0x80 | (byte & 0x3f) : byte);
    first = false;
  }

  return `${timeHex.slice(0, 8)}-${timeHex.slice(8)}-${seqHex}-${tail.slice(0, 4)}-${tail.slice(4)}`;
}

export class Outbox {
  private readonly db: PolarisDB | null;
  /**
   * The queue, mirrored in memory in creation order.
   *
   * Mirrored because a connection indicator and a "N unsent changes" affordance read it
   * on every render, and an `await` on the render path is how a synchronous UI becomes a
   * flickering one. Writes go to IndexedDB first and the mirror follows, so the mirror
   * can never claim something durable that is not.
   */
  private readonly records = new Map<UUID, OutboxRecord>();
  /**
   * Ops handed to the network and not yet answered. In memory only: after a reload
   * nothing is in flight by definition, so everything queued becomes sendable again,
   * which is exactly the resume behaviour `opId` idempotency exists to make safe.
   */
  private readonly inFlight = new Set<UUID>();

  constructor(db: PolarisDB | null = null) {
    this.db = db;
  }

  /** Opens the queue and loads whatever the last session left behind. */
  static async open(db: PolarisDB): Promise<Outbox> {
    const outbox = new Outbox(db);
    const stored = await db.readOutbox();
    // Sorted by opId, which for UUIDv7 is creation order. Replaying "assign to me" before
    // "move to In Progress" because IndexedDB happened to return them that way would
    // reorder the user's own edits against each other.
    stored.sort((a, b) => (a.opId < b.opId ? -1 : a.opId > b.opId ? 1 : 0));
    for (const record of stored) outbox.records.set(record.opId, record);

    // Then whatever the journal is still holding: writes whose IndexedDB transaction was
    // aborted by the teardown that ended the last session. They are promoted to the durable
    // queue here, in creation order, and they sort ahead of nothing — a journalled write is
    // by definition the last thing that happened, and `records` is a Map, so re-inserting an
    // opId that IndexedDB already had keeps its original position.
    for (const entry of drainJournal(db.workspaceId)) {
      if (outbox.records.has(entry.opId)) continue;
      await db.putOutbox(entry);
      outbox.records.set(entry.opId, entry);
    }
    return outbox;
  }

  get size(): number {
    return this.records.size;
  }

  /** Everything queued, oldest first. */
  list(): readonly OutboxRecord[] {
    return [...this.records.values()];
  }

  /** Everything queued that is not already on the wire, oldest first. */
  pending(): readonly OutboxRecord[] {
    return this.list().filter((record) => !this.inFlight.has(record.opId));
  }

  get(opId: UUID): OutboxRecord | undefined {
    return this.records.get(opId);
  }

  /**
   * Queues a mutation, durably, before it is sent.
   *
   * The write is awaited rather than fired and forgotten: returning early would mean the
   * caller sends a mutation that the queue does not yet know about, and a crash in that
   * window loses the op with no trace that it ever existed.
   *
   * The journal line before it covers the `await` itself, which is the part awaiting cannot.
   * An IndexedDB transaction is abandoned when the document is discarded, so a tab closed
   * mid-commit loses the op exactly as an in-memory queue would — the durability starts when
   * the transaction lands, not when it is requested. `journalWrite` is synchronous, and it
   * runs before the first `await` in this function, so it has committed by the time control
   * can leave. See ./journal.ts for why `localStorage`, and why it holds nothing else.
   *
   * The ordering of the three lines is the whole mechanism and none of them may be moved:
   * record, commit, forget. Forgetting before the commit reopens the window; forgetting
   * later leaves an entry recovered on the next boot, which is harmless and is not free.
   */
  async append(input: OutboxAppend): Promise<OutboxRecord> {
    const record: OutboxRecord = {
      opId: input.opId ?? uuidv7(),
      mutation: input.mutation,
      variables: input.variables,
      optimisticPatch: input.optimisticPatch ?? [],
      // Spread rather than assigned, so an op with nothing to pair stores no key at all
      // under `exactOptionalPropertyTypes`.
      ...(input.reconcile === undefined ? null : { reconcile: input.reconcile }),
      attempts: 0,
      createdAt: new Date().toISOString(),
    };
    if (this.db) journalWrite(this.db.workspaceId, record);
    await this.db?.putOutbox(record);
    this.records.set(record.opId, record);
    if (this.db) journalForget(this.db.workspaceId, record.opId);
    return record;
  }

  /** Claims an op for sending. Returns false if it is gone or already on the wire. */
  markInFlight(opId: UUID): boolean {
    if (!this.records.has(opId) || this.inFlight.has(opId)) return false;
    this.inFlight.add(opId);
    return true;
  }

  /** Counts a send attempt and releases the op so a retry can claim it again. */
  async markAttempt(opId: UUID): Promise<number> {
    const record = this.records.get(opId);
    if (record === undefined) return 0;
    const updated: OutboxRecord = { ...record, attempts: record.attempts + 1 };
    await this.db?.putOutbox(updated);
    this.records.set(opId, updated);
    this.inFlight.delete(opId);
    return updated.attempts;
  }

  /**
   * Drops an op the server accepted.
   *
   * The optimistic patch is discarded rather than reconciled: the delta stream carries
   * the authoritative row, and it may differ from what was optimistically written
   * because somebody else changed the same field first. Keeping the patch and merging it
   * would be the client arguing with the server about what happened.
   */
  async resolve(opId: UUID): Promise<OutboxRecord | null> {
    const record = this.records.get(opId);
    if (record === undefined) return null;
    await this.db?.deleteOutbox(opId);
    this.records.delete(opId);
    this.inFlight.delete(opId);
    return record;
  }

  /**
   * Drops an op the server rejected and hands back its patch so the caller can undo it.
   *
   * Only rejection — never a network failure. An op that could not be sent stays queued;
   * rolling it back would delete the user's work because their train went into a tunnel.
   */
  async rollback(opId: UUID): Promise<OptimisticPatch | null> {
    const record = await this.resolve(opId);
    return record === null ? null : record.optimisticPatch;
  }

  /** Empties the queue, for sign-out. */
  async clear(): Promise<void> {
    await this.db?.clearOutbox();
    this.records.clear();
    this.inFlight.clear();
  }
}
