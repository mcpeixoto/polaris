/**
 * The sync engine: everything the client does about staying up to date, in one place.
 *
 * It owns the lifecycle — hydrate from IndexedDB, bootstrap if needed, open the socket,
 * apply deltas, drain the outbox — because those steps are ordered and interdependent,
 * and splitting them across the components that happen to need them is how a client ends
 * up applying a delta before its snapshot has landed.
 *
 * Views never talk to this module. They subscribe to the store; the engine feeds it.
 */

import {
  CLIENT_SCHEMA as STORE_SCHEMA,
  dropDatabase,
  dropStaleDatabases,
  isEntityType,
  Outbox,
  PolarisDB,
  reconciliations,
  sameResult,
  Store,
  uuidv7,
  type Change as StoreChange,
  type Entity,
  type EntityPatch,
  type EntityRow,
  type EntityType,
  type OptimisticPatch,
  type Reconciliation,
  type UUID,
} from '~/store';
import { ApiError, gql, setWorkspace } from './api';
import { streamBootstrap } from './bootstrap';
import { adopt, settle, unpairedCreates, type Succession } from './reconcile';
import {
  OUTDATED_CLIENT_MESSAGE,
  clearSchemaReloadAttempt,
  consumeSchemaReload,
  isOutdatedClientError,
} from './outdated-client';
import {
  CLIENT_SCHEMA as SOCKET_SCHEMA,
  SyncSocket,
  type Change,
  type ConnectionState,
} from './socket';

/**
 * The store's schema version and the socket protocol's must agree.
 *
 * They are declared in two modules because one is about the shape of IndexedDB and the
 * other about what the server will accept, but a client whose local shape is newer than
 * the protocol it speaks would resume against a stream it cannot apply. Checking at
 * module load turns that into a startup failure during development rather than data
 * corruption in production.
 */
if (STORE_SCHEMA !== SOCKET_SCHEMA) {
  throw new Error(
    `client schema mismatch: store is v${STORE_SCHEMA}, socket protocol is v${SOCKET_SCHEMA}`,
  );
}

/**
 * Something still working, but not the way it is supposed to.
 *
 * Distinct from `failed` because the app is usable: the user can read and can type, and the
 * only honest thing to do is say what is not happening rather than either stopping them or
 * letting them find out on the next reload.
 */
export interface EngineDegradation {
  /** `storage-full` is the quota; `storage-failed` is any other refusal from IndexedDB. */
  readonly reason: 'storage-full' | 'storage-failed';
  readonly message: string;
}

export type EngineStatus =
  | { phase: 'idle' }
  | { phase: 'hydrating' }
  | { phase: 'bootstrapping'; received: number }
  | {
      phase: 'ready';
      connection: ConnectionState;
      pending: number;
      /** Absent while everything works. See `EngineDegradation`. */
      degraded?: EngineDegradation;
      /**
       * Set while a remote delta changed a field this client still has in flight.
       *
       * One sentence, not a stack: a burst of keystrokes is one fact.
       */
      notice?: string;
    }
  | {
      phase: 'failed';
      error: string;
      /** True while a retry is already scheduled, so the shell can wait rather than offer one. */
      retrying?: boolean;
    };

export interface EngineOptions {
  onStatus?(status: EngineStatus): void;
}

/**
 * How many times the server may fail a queued mutation before it is treated as poison.
 *
 * It counts answers, not tries. A send that never reached the server is not an attempt at
 * all — the op was not judged, so nothing was learned about it — and counting one was how
 * this ceiling came to delete the user's oldest unsent edit after about half a minute
 * offline: every rejection already rolls its op back on the spot, so the only thing that
 * could ever reach five was a queue nobody could send. The ceiling exists for the op the
 * server keeps failing, which is the one that would otherwise block everything behind it
 * forever, silently.
 */
const MAX_ATTEMPTS = 5;

/**
 * How many provisional-to-real pairings are kept.
 *
 * They exist for the seconds between a create being drawn and the screen learning the row's
 * real name, so a few hundred covers any burst of creates a person can produce by hand while
 * the map stays a fixed, small cost.
 */
const MAX_SUCCESSIONS = 500;

/**
 * Backoff bounds for retrying a failed bootstrap, and for the outbox drain.
 *
 * Jittered for the same reason the socket's reconnect is: the failure worth designing for is
 * the server restarting, and a fleet that all retries on the same millisecond turns a deploy
 * blip into an outage. Capped rather than given up on, because a resync that stops retrying
 * parks the user on a dead screen behind a connection that is still live.
 */
const RETRY_MIN_MS = 1_000;
const RETRY_MAX_MS = 60_000;

/**
 * How many bootstrap pages are written before the reader waits for the disk to catch up.
 *
 * The network outruns IndexedDB on any workspace worth bootstrapping, and every un-written
 * batch is retained by the persist chain — so with no backpressure the whole snapshot is held
 * in memory twice at the peak. Awaiting every few pages costs nothing when the disk is
 * keeping up and bounds the queue when it is not.
 */
const BOOTSTRAP_BACKPRESSURE_PAGES = 8;

/**
 * What the sync badge says when another device wrote a field this one still has in flight.
 *
 * The doc of record asks for the collision to be visible. Last write wins, so there is
 * nothing to merge — the line exists so the screen does not change under a pending edit
 * in silence.
 */
const REMOTE_EDIT_NOTICE = 'Updated elsewhere';

/**
 * Stamped onto the optimistic row so a list sorts the edit to the top.
 *
 * The server writes its own and will never send this one back. Counting it as a pending
 * field means our own delta never looks echoed — `updatedAt` differs — and every later
 * delta is then overwritten by the stale value until the HTTP response drops the op,
 * which is the race this rebase exists to close.
 */
const SERVER_CLOCK_FIELDS = new Set(['updatedAt']);

/** `mutation CreateComment(...)` → `CreateComment`, so a thrown error names the call site. */
function operationName(document: string): string {
  return /\bmutation\s+([A-Za-z0-9_]+)/.exec(document)?.[1] ?? 'a mutation';
}

/**
 * Whether a failure the server *answered* with is worth queueing behind.
 *
 * A rate limit or a server fault says nothing about the mutation — the same op sent a
 * minute later may well be accepted — so discarding it would throw away work over a blip.
 * Everything else (validation, permission, conflict, plan limit, a query over the complexity
 * ceiling) is a decision about this op specifically, and repeating it would only produce the
 * same refusal. QUERY_TOO_COMPLEX belongs to that second group and not to the first, however
 * much its old spelling — RATELIMITED — suggested otherwise: the ceiling is fixed, so the
 * hundredth attempt is priced exactly like the first.
 */
function isRetriable(err: unknown): boolean {
  return err instanceof ApiError && (err.code === 'RATELIMITED' || err.code === 'INTERNAL');
}

export class SyncEngine {
  store!: Store;
  outbox!: Outbox;

  private db!: PolarisDB;
  private socket: SyncSocket;
  private workspaceId: UUID;
  private clientId: UUID;
  private options: EngineOptions;

  private status: EngineStatus = { phase: 'idle' };
  /**
   * What the server called the rows this client first drew under an id it invented.
   *
   * Bounded and oldest-first, because it is a convenience for the seconds after a create and
   * not a history: a long session creates thousands of rows and every one of them would sit
   * here forever otherwise. An entry that has been evicted is indistinguishable from one that
   * never existed, and both answer "no succession" — which is the correct answer for a row
   * whose stand-in retired long enough ago that nothing is still holding the old id.
   */
  private successions = new Map<UUID, UUID>();
  private draining = false;
  private resyncTimer: ReturnType<typeof setTimeout> | null = null;
  private resyncDelay = RETRY_MIN_MS;
  private drainTimer: ReturnType<typeof setTimeout> | null = null;
  private drainDelay = RETRY_MIN_MS;
  private bootstrapAbort: AbortController | null = null;
  private degraded: EngineDegradation | undefined;
  private stopped = false;
  /**
   * Pending rows a remote delta has already changed, so the badge can say so once.
   *
   * Cleared when that row's own write echoes, or when the op leaves the queue. A second
   * delta for the same row does not push another notice.
   */
  private conflicts: { opId: UUID; type: EntityType; id: UUID }[] = [];
  /**
   * Values a rebase covered, keyed by op and row, so a rejection can put them back.
   *
   * The overlay keeps our pending fields on top of someone else's delta. Undoing the
   * whole optimistic snapshot on a refusal would also undo their fields; restoring just
   * what we covered puts their delta back and drops the write the server refused.
   */
  private covered = new Map<string, Map<string, unknown>>();

  constructor(workspaceId: UUID, options: EngineOptions = {}) {
    this.workspaceId = workspaceId;
    this.options = options;

    // One client id per browser profile, not per tab: it pairs with opId to identify a
    // mutation, and two tabs generating the same opId under different client ids would
    // each be treated as a first attempt.
    this.clientId = readOrCreateClientId();

    this.socket = new SyncSocket(this.clientId, {
      onReady: (version) => void this.onSocketReady(version),
      onDelta: (changes) => this.onDelta(changes),
      onResync: (reason, retryAfterMs) => this.onResync(reason, retryAfterMs),
      onStateChange: () => this.publishStatus(),
    });
  }

  async start(): Promise<void> {
    setWorkspace(this.workspaceId);
    this.stopped = false;

    try {
      this.setStatus({ phase: 'hydrating' });

      // Opened here rather than in the constructor: IndexedDB is async, and a constructor
      // that cannot await would leave every method guarding against a half-open handle.
      this.db = await PolarisDB.open(this.workspaceId);
      this.store = new Store(this.workspaceId, {
        db: this.db,
        onPersistError: (error) => this.onPersistError(error),
      });
      this.outbox = await Outbox.open(this.db);

      // Databases for other workspaces, and for older schema versions, are dead weight
      // in a storage quota the browser may reclaim at any time — and a stale one is what
      // a schema bump is trying to get rid of.
      void dropStaleDatabases(this.workspaceId);

      const snapshot = await this.db.readAll();

      // A snapshot with no bootstrapAt is a torn one — the rows landed but the commit did
      // not — and hydrating it would present a partial replica as complete.
      if (snapshot.meta && snapshot.meta.bootstrapAt !== null) {
        this.store.hydrate(snapshot);
      } else {
        await this.bootstrap();
      }

      this.socket.connect(this.store.version);
      clearSchemaReloadAttempt();
      this.setStatus({
        phase: 'ready',
        connection: this.socket.connectionState(),
        pending: this.outbox.pending().length,
      });
    } catch (err) {
      if (isOutdatedClientError(err)) {
        await this.recoverOutdatedClient();
      }
      this.setStatus({
        phase: 'failed',
        error: err instanceof Error ? err.message : 'could not start',
      });
      throw err;
    }
  }

  stop(): void {
    this.stopped = true;
    if (this.resyncTimer) {
      clearTimeout(this.resyncTimer);
      this.resyncTimer = null;
    }
    if (this.drainTimer) {
      clearTimeout(this.drainTimer);
      this.drainTimer = null;
    }
    // A bootstrap stream has no timeout of its own long enough to matter here: without this,
    // `stop()` returns while a snapshot keeps arriving into a store nobody is watching.
    this.bootstrapAbort?.abort();
    this.socket.disconnect();
  }

  /**
   * A durable write that did not land.
   *
   * The in-memory replica carries on regardless, which is why this has to be said out loud:
   * everything since the failure exists only in this tab, and a reload loses it. The quota is
   * the case worth separating — it is the one a re-bootstrap onto a smaller replica can
   * actually fix — so stale databases are dropped here in the hope of making room.
   */
  private onPersistError(error: unknown): void {
    // Not `instanceof Error`: a `DOMException` is not one in every runtime this ships to,
    // and the quota failure is precisely the one that arrives as a DOMException.
    const named = error as { name?: unknown; message?: unknown } | null;
    const quota =
      named?.name === 'QuotaExceededError' ||
      (typeof named?.message === 'string' && /quota/i.test(named.message));
    this.degraded = {
      reason: quota ? 'storage-full' : 'storage-failed',
      message: quota
        ? 'this browser is out of space, so changes are not being saved locally'
        : 'changes are not being saved locally',
    };
    if (quota) void dropStaleDatabases(this.workspaceId);
    console.error('[sync] the local replica could not be written', error);
    this.publishStatus();
  }

  /**
   * Runs a mutation optimistically.
   *
   * The order is the whole design: render first, persist the intent second, talk to the
   * server third. A user who types a title and immediately closes the laptop must find
   * that title on their phone, and that only holds if the outbox write happens before the
   * network call rather than after it.
   */
  async mutate<T>(input: {
    mutation: string;
    variables: Record<string, unknown>;
    optimistic?: OptimisticPatch;
    /**
     * How to pair the response's rows with the stand-ins, for server-allocated ids.
     *
     * A list when one mutation writes more than one stand-in. Required in practice rather
     * than by the type — see the check below, which knows what the type cannot.
     */
    reconcile?: Reconciliation | readonly Reconciliation[];
  }): Promise<T> {
    const opId = uuidv7();

    // Dev only, and it throws rather than warns.
    //
    // The failure it catches is invisible by inspection and invisible at runtime until a
    // user reports seeing their own comment twice — an optimistic create under a stand-in
    // id, paired only inside the `await`, which a reload discards. Five features shipped
    // it, each fixed alone, none of them stopping the sixth. A console warning would have
    // been read by nobody: this is the same class of mistake as forgetting to await, and
    // the only enforcement that works on it is the kind that stops the screen.
    //
    // Dev covers it because every unit test and every e2e run is a dev build, so a call
    // site written wrong fails in CI on the first test that reaches it — while a user in
    // production is never shown an error for a mistake that is ours.
    if (import.meta.env.DEV) {
      const loose = unpairedCreates(input);
      if (loose.length > 0) {
        const rows = loose.map((entry) => `${entry.type} ${entry.id}`).join(', ');
        throw new Error(
          `[sync] ${operationName(input.mutation)} renders ${rows} optimistically under an id ` +
            `it never sends, and declares no \`reconcile\` for it. The server will mint its own ` +
            `id, its row will arrive beside the stand-in, and the user will see the thing twice ` +
            `for good. Declare \`reconcile\` (see web/src/sync/reconcile.ts) or send the id.`,
        );
      }
    }

    if (input.optimistic) this.store.applyOptimistic(input.optimistic);

    const record = await this.outbox.append({
      opId,
      mutation: input.mutation,
      variables: input.variables,
      optimisticPatch: input.optimistic,
      reconcile: input.reconcile,
    });
    // Claimed before it goes out. `pending()` filters on exactly this set, so without the
    // claim any drain that starts while this attempt is still awaiting — and `onSocketReady`
    // starts one on every reconnect — picks the same op up and sends it again. The server's
    // idempotency table stops the double write, but both answers then run `settle` and
    // `discharge`: the first resolve deletes the record while the second is mid-flight, and
    // the stand-in is retired twice against a record that is no longer there.
    this.outbox.markInFlight(opId);
    this.publishStatus();

    try {
      const data = await gql<T>(input.mutation, {
        ...input.variables,
        clientId: this.clientId,
        opId,
      });
      this.remember(settle(this.store, input.reconcile, data));
      await this.discharge(opId, input.reconcile);
      this.publishStatus();
      return data;
    } catch (err) {
      if (err instanceof ApiError && (err.isOffline || isRetriable(err))) {
        // Either the request never reached the server, or it reached one that was too
        // busy to take it. In both cases the mutation may still happen, so keep it queued
        // and keep the optimistic state on screen — rolling back here is what makes an app
        // feel like it "lost" an edit the moment a lift's doors close.
        //
        // The claim is released with it: this caller is done, and an op left claimed is
        // invisible to `pending()` and would never be retried at all.
        this.outbox.release(opId);
        this.publishStatus();
        this.scheduleDrain(err.retryAfterMs);
        throw err;
      }

      // A real rejection. Undo the optimistic patch so the user is not left looking at a
      // state the server refused.
      this.outbox.release(opId);
      await this.undoQueued(opId);
      this.publishStatus();
      throw err;
    } finally {
      void record;
    }
  }

  /**
   * What the server ended up calling a row this client first drew under a stand-in id.
   *
   * Returns the id it was given when nothing has superseded it — so a caller can pass any id
   * through this and get back the one that names a real row, without having to know whether
   * the row it is holding was ever provisional.
   *
   * Follows a chain, because a stand-in can in principle be retired against a delta row that
   * is itself later replaced by the response; one hop is the only case in practice and the
   * loop is a few lines of insurance against a cycle turning into a hang.
   */
  succession(id: UUID): UUID {
    let current = id;
    for (let hops = 0; hops < 8; hops++) {
      const next = this.successions.get(current);
      if (next === undefined || next === current) return current;
      current = next;
    }
    return current;
  }

  /**
   * Whether a queued mutation is still standing in for this id.
   *
   * True means the server has never heard of it: it is an id this client invented for a row
   * it has not been told the real name of yet. Sending it as a foreign key — a reply's
   * parent, a link's target — gets the write refused, so a caller that is about to do that
   * should ask first and keep the user's text rather than lose it to a refusal it could have
   * predicted.
   */
  isProvisional(id: UUID): boolean {
    if (this.successions.has(id)) return false;
    // A set membership test on the outbox rather than a scan of it: this is asked from
    // composer and render paths, so with a large offline queue the scan it used to do was an
    // O(n·m) copy per keystroke.
    return this.outbox.hasProvisional(id);
  }

  /**
   * Drops an op the server has answered — but not before the retirement it caused is on disk.
   *
   * The stand-in is a *persisted* row, and retiring it is a persisted delete. The two are not
   * written at the same moment: `applyOptimistic` updates memory synchronously and queues the
   * durable write, so between "the screen shows one comment" and "the replica holds one
   * comment" there is a gap the length of an IndexedDB transaction — tens of milliseconds on a
   * quiet machine, and far longer on a loaded one, which is also exactly when the delta beats
   * the response and `adopt` does the retiring.
   *
   * A reload taken in that gap is unrecoverable, and it is unrecoverable *because* of the line
   * below. The outbox record is the only thing left that knows this stand-in has a real row to
   * be paired with; drop it while the delete is still queued and the reload finds the stand-in
   * back off disk, the server's row beside it, and nothing anywhere holding the pairing. Both
   * rows are ordinary rows now, and no amount of reloading separates them again — which is the
   * duplicate at the top of ./reconcile.ts, arrived at from the one direction that file does
   * not cover: not a pairing that was never declared, but one that was made and then lost.
   *
   * So the queue is drained first. Either the delete lands and the record can go, or the tab
   * dies waiting — and then the record is still in the outbox, the drain replays it, the
   * server's idempotency table answers with the original row, and `settle` retires the
   * stand-in a second time. Both ways out are correct; dropping the record early is the only
   * way to have neither.
   *
   * Only for ops that declared a pairing. Every other optimistic write is a value the delta
   * stream will restate — a lost one is a stale field until the next delta, not a row that
   * exists twice for good — and making every mutation wait on the disk queue would put an
   * IndexedDB round trip in front of every keystroke's acknowledgement for no gain.
   */
  private async discharge(
    opId: UUID,
    spec: Reconciliation | readonly Reconciliation[] | undefined,
  ): Promise<void> {
    if (reconciliations(spec).length > 0) await this.store.whenPersisted();
    await this.outbox.resolve(opId);
    this.forgetCover(opId);
    this.clearConflicts(opId);
  }

  /**
   * Files the pairings a retirement just made.
   *
   * Called from all three routes a stand-in can be retired by — the mutation response, the
   * outbox drain, the delta stream — because a caller holding the old id does not know or
   * care which of them got there first.
   */
  private remember(pairs: readonly Succession[]): void {
    for (const pair of pairs) {
      this.successions.set(pair.provisionalId as UUID, pair.realId as UUID);
    }
    // Insertion order, so this drops the oldest — the ones least likely to still be held by
    // anything on screen.
    while (this.successions.size > MAX_SUCCESSIONS) {
      const oldest = this.successions.keys().next();
      if (oldest.done === true) break;
      this.successions.delete(oldest.value);
    }
  }

  /** Retries everything queued. Called on reconnect and after an offline failure. */
  async drainOutbox(): Promise<void> {
    if (this.stopped) return;
    if (this.draining) {
      // Not lost. A skipped drain used to be simply dropped, so a burst of offline
      // mutations that scheduled several overlapping drains ended with a queue nothing
      // came back for.
      this.scheduleDrain();
      return;
    }
    this.draining = true;

    try {
      // Replayed in creation order. "Set status, then set assignee" applied backwards
      // gives a different final state, and the outbox is keyed by a monotonic UUIDv7
      // precisely so this ordering is available.
      for (const record of this.outbox.pending()) {
        if (record.attempts >= MAX_ATTEMPTS) {
          // Poison: the server has answered this op five times and failed it every time,
          // across however many sessions. Dropping it loses the edit, which is bad — but
          // retrying it forever blocks every op behind it, which is worse, and silently.
          // The rollback at least makes the loss visible.
          await this.undoQueued(record.opId);
          console.error('[sync] dropping a mutation after repeated failures', record.opId);
          continue;
        }

        if (!this.outbox.markInFlight(record.opId)) continue;

        try {
          // The same opId as the first attempt, which is what makes the server's
          // idempotency table return the original result instead of writing again.
          const data = await gql(record.mutation, {
            ...record.variables,
            clientId: this.clientId,
            opId: record.opId,
          });
          // The replay carries the original result, so this is the same pairing the
          // first attempt would have done — and the only chance to do it, because the
          // caller that was awaiting the first attempt is gone.
          this.remember(settle(this.store, record.reconcile, data));
          await this.discharge(record.opId, record.reconcile);
        } catch (err) {
          if (err instanceof ApiError && err.isOffline) {
            // Still offline. Release the claim without counting an attempt and stop:
            // nothing about this op was judged, so a try that never left the machine
            // must not move it closer to being discarded.
            //
            // Rearmed rather than left to `onSocketReady`. The socket and /graphql are not
            // the same service: an API container restarting behind the same proxy leaves the
            // socket perfectly healthy and nothing else would ever drain the queue.
            this.outbox.release(record.opId);
            this.scheduleDrain();
            break;
          }

          // The server answered. A refusal is final, but a rate limit or a server fault
          // is not: those keep their place in the queue and are counted, which is what
          // the attempt ceiling is for.
          const attempts = await this.outbox.markAttempt(record.opId);
          if (isRetriable(err) && attempts < MAX_ATTEMPTS) {
            // The server's own number when it gave one. A client that answers a 429 with a
            // guess of its own is a client that keeps hitting the same rate limit.
            this.scheduleDrain(err instanceof ApiError ? err.retryAfterMs : undefined);
            break;
          }

          await this.undoQueued(record.opId);
        }
      }
    } finally {
      this.draining = false;
      this.publishStatus();
    }

    // A drain that ran while another was in progress returned immediately; a drain that
    // stopped early left work behind. Either way something has to come back for it, and
    // nothing else will.
    if (this.outbox.pending().length > 0) this.scheduleDrain();
  }

  private async onSocketReady(serverVersion: number): Promise<void> {
    // A reconnected socket is evidence the network is back, so the queue starts from the
    // bottom of the backoff curve rather than from wherever it had climbed to while down.
    this.resetDrainBackoff();
    // Anything queued while offline goes out before anything else, so the user's own
    // edits reach the server before deltas arrive that might contradict them.
    await this.drainOutbox();
    void serverVersion;
    this.publishStatus();
  }

  private onDelta(changes: Change[]): void {
    if (changes.length === 0) return;
    // The store advances its own version from the batch and schedules the durable write;
    // the socket only needs to know where to resume from.
    this.store.applyChanges(changes as unknown as StoreChange[]);
    // The payload is the whole row. An edit this client has not been answered for yet is
    // only a few fields of it, and painting the payload over those fields is how the other
    // computer's priority wins the screen while this computer's status is still in flight.
    this.rebasePending(changes);
    // A row in this batch may be the one a stand-in is standing in for. The socket pushes it
    // the moment the mutation commits, which on a loaded machine is well before the response
    // gets back here — and until something retires the stand-in the user is looking at their
    // comment twice. Doing it here rather than waiting for `settle` is what makes the
    // duplicate last a frame instead of a round trip, or forever when the response is lost.
    this.remember(adopt(this.store, this.outbox, changes));
    this.socket.setVersion(this.store.version);
  }

  /**
   * Puts unacknowledged optimistic fields back on top of a delta that does not yet
   * contain them.
   *
   * `applyChanges` has already written the payload, which is the whole entity. The
   * pending patch is also a whole entity, copied from the replica at the click, so
   * replaying it would wipe the other computer's fields. Only the keys that differ
   * between that patch's `before` and `after` are ours. When every one of them already
   * equals `after`, this delta is our write coming back — it stands, and a later delta
   * must not be rebased for that row. The server remains the judge.
   */
  private rebasePending(changes: Change[]): void {
    const applied = new Map<string, { type: EntityType; id: UUID; payload: Entity }>();
    for (const change of changes) {
      const row = upsertPayload(change);
      if (row === null) continue;
      applied.set(`${row.type}:${row.id}`, row);
    }
    if (applied.size === 0) return;

    const beforeNotice = this.conflictNotice();
    for (const { type, id, payload } of applied.values()) {
      for (const { opId, patch } of this.outbox.optimisticPatches()) {
        if (patch.type !== type || patch.id !== id) continue;
        const before = patch.before;
        const after = patch.after;
        // A delete has no fields to keep, and a create has no previous row to diff.
        // Both stay on the path `applyChanges` just took.
        if (before === null || after === null) continue;
        const fields = pendingFields(before, after);
        if (fields.length === 0) continue;

        const echoed = fields.every((key) =>
          sameResult(readField(payload, key), readField(after, key)),
        );
        if (echoed) {
          this.outbox.markEchoed(opId, type, id);
          this.covered.delete(coverKey(opId, type, id));
          this.clearConflict(opId, type, id);
          continue;
        }

        for (const key of fields) {
          const incoming = readField(payload, key);
          if (
            !sameResult(incoming, readField(before, key)) &&
            !sameResult(incoming, readField(after, key))
          ) {
            this.noteConflict(opId, type, id);
            break;
          }
        }

        const current = this.store.get(type, id);
        if (current === undefined) continue;
        this.rememberCover(opId, type, id, current, fields);
        const next = overlayFields(current, after, fields);
        if (sameResult(current, next)) continue;
        this.store.applyOptimistic([{ type, id, before: current, after: next }]);
      }
    }
    if (this.conflictNotice() !== beforeNotice) this.publishStatus();
  }

  /**
   * Drops an op the server rejected, and puts back any remote fields a rebase had covered.
   *
   * `revertOptimistic` restores the snapshot only when the row still is that snapshot. A
   * delta that landed first means it is not, and the covered values are the remote row's
   * — restoring those, and only where the screen still shows our pending value, is what
   * makes the refusal visible without erasing the other computer's edit.
   */
  private async undoQueued(opId: UUID): Promise<void> {
    const patch = await this.outbox.rollback(opId);
    if (patch) this.store.revertOptimistic(patch);
    this.restoreCovered(opId, patch);
    this.clearConflicts(opId);
  }

  private noteConflict(opId: UUID, type: EntityType, id: UUID): void {
    if (this.conflicts.some((row) => row.opId === opId && row.type === type && row.id === id)) {
      return;
    }
    this.conflicts.push({ opId, type, id });
  }

  private clearConflict(opId: UUID, type: EntityType, id: UUID): void {
    this.conflicts = this.conflicts.filter(
      (row) => row.opId !== opId || row.type !== type || row.id !== id,
    );
  }

  private clearConflicts(opId: UUID): void {
    this.conflicts = this.conflicts.filter((row) => row.opId !== opId);
  }

  /** The notice, or nothing once every colliding op has echoed or left the queue. */
  private conflictNotice(): string | undefined {
    this.conflicts = this.conflicts.filter((row) => this.outbox.get(row.opId) !== undefined);
    return this.conflicts.length > 0 ? REMOTE_EDIT_NOTICE : undefined;
  }

  private rememberCover(
    opId: UUID,
    type: EntityType,
    id: UUID,
    current: Entity,
    fields: readonly string[],
  ): void {
    // The row in the store is the delta just applied (plus any earlier pending op in this
    // batch). Saving it again on the next delta replaces the cover with the newer remote
    // value, which is the one a refusal should restore.
    const saved = new Map<string, unknown>();
    for (const field of fields) saved.set(field, readField(current, field));
    this.covered.set(coverKey(opId, type, id), saved);
  }

  private restoreCovered(opId: UUID, patch: OptimisticPatch | null): void {
    if (patch !== null) {
      for (const entry of patch) this.restoreEntry(opId, entry);
    }
    this.forgetCover(opId);
  }

  private restoreEntry(opId: UUID, entry: EntityPatch): void {
    const saved = this.covered.get(coverKey(opId, entry.type, entry.id));
    this.covered.delete(coverKey(opId, entry.type, entry.id));
    if (saved === undefined || entry.after === null) return;
    const current = this.store.get(entry.type, entry.id);
    if (current === undefined) return;

    const next: Record<string, unknown> = { ...current };
    let changed = false;
    for (const [field, serverValue] of saved) {
      // Already moved off our pending value — a later write owns it, and putting the
      // covered value back would resurrect one.
      if (!sameResult(readField(current, field), readField(entry.after, field))) continue;
      if (serverValue === undefined) delete next[field];
      else next[field] = serverValue;
      changed = true;
    }
    if (!changed) return;
    const entity = next as unknown as Entity;
    if (sameResult(current, entity)) return;
    this.store.applyOptimistic([
      { type: entry.type, id: entry.id, before: current, after: entity },
    ]);
  }

  private forgetCover(opId: UUID): void {
    const prefix = `${opId}:`;
    for (const key of this.covered.keys()) {
      if (key.startsWith(prefix)) this.covered.delete(key);
    }
  }

  private onResync(reason: string, retryAfterMs: number): void {
    void reason;
    this.resyncDelay = RETRY_MIN_MS;
    // The server already jittered this. Honouring the delay is what stops a fleet-wide
    // resync — a bad deploy, a schema bump — from arriving at Postgres as one spike.
    this.scheduleResync(retryAfterMs);
  }

  /**
   * Rebuilds the replica, and keeps trying.
   *
   * A resync used to be one timer and one attempt: any failure — a 500, a dropped stream, a
   * tunnel — set `phase: 'failed'` and stopped there, leaving the user on a dead splash
   * behind a socket that was still connected and still delivering. Nothing retried it and
   * nothing could, short of a reload.
   */
  private scheduleResync(delayMs: number): void {
    if (this.stopped) return;
    if (this.resyncTimer) clearTimeout(this.resyncTimer);

    this.resyncTimer = setTimeout(() => {
      this.resyncTimer = null;
      void (async () => {
        try {
          await this.bootstrap();
          this.resyncDelay = RETRY_MIN_MS;
          this.socket.connect(this.store.version);
          clearSchemaReloadAttempt();
          // Set rather than published: `publishStatus` re-emits a non-ready phase unchanged,
          // and the phase at this point is the `bootstrapping` this rebuild just finished.
          this.setStatus(this.readyStatus());
        } catch (err) {
          if (isOutdatedClientError(err)) {
            // A schema disagreement is not something a retry can resolve; only a new bundle
            // can, and this reloads once to go and get one.
            await this.recoverOutdatedClient();
            this.setStatus({
              phase: 'failed',
              error: err instanceof Error ? err.message : 'resync failed',
            });
            return;
          }
          if (this.stopped) return;
          const next = Math.min(
            this.resyncDelay + Math.random() * this.resyncDelay * 0.5,
            RETRY_MAX_MS,
          );
          this.resyncDelay = Math.min(this.resyncDelay * 2, RETRY_MAX_MS);
          this.setStatus({
            phase: 'failed',
            error: err instanceof Error ? err.message : 'resync failed',
            retrying: true,
          });
          this.scheduleResync(next);
        }
      })();
    }, delayMs);
  }

  private async bootstrap(): Promise<void> {
    this.setStatus({ phase: 'bootstrapping', received: 0 });

    // The socket is closed for the length of the rebuild, and this is not a tidiness.
    // A delta delivered into a store that is mid-bootstrap is applied against a replica that
    // does not hold the rows yet: a `revoke` that lands before the page carrying its entity
    // forgets nothing, the page then re-inserts the row, and an entity the user has lost
    // access to stays readable for good — the exact leak `revoke` exists to prevent.
    this.socket.disconnect();

    // Clears the previous replica before the first row lands. Ingesting on top of it
    // would leave behind every entity that has since been deleted or revoked — and a
    // resync triggered by "permissions changed" is exactly the case where those stale
    // rows are the ones the client must not keep.
    await this.store.beginBootstrap();

    // Engine-owned so `stop()` can cancel it. A snapshot has no timeout that matters at the
    // scale of a tab being closed, and without this the stream keeps arriving into a store
    // nothing is watching.
    const abort = new AbortController();
    this.bootstrapAbort?.abort();
    this.bootstrapAbort = abort;

    let pages = 0;
    try {
      const result = await streamBootstrap(
        this.workspaceId,
        {
          onMeta: (meta) => {
            if (meta.clientSchema !== STORE_SCHEMA) {
              // Reloading is the prescribed recovery, but only a new bundle (or a rebuilt
              // server) can actually change the number. Throwing here lets start() drop the
              // torn replica and auto-reload once, rather than leaving the user on a splash
              // whose "Try again" retries the same disagreement.
              throw new ApiError('CONFLICT', OUTDATED_CLIENT_MESSAGE);
            }
          },
          onBatch: async (entities) => {
            const rows: EntityRow[] = entities.map((e) => ({
              type: e.type as EntityType,
              entity: e.payload as Entity,
            }));
            this.store.ingestBootstrapPage(rows);
            // Backpressure. `ingestBootstrapPage` queues its write and returns, so with a
            // network faster than IndexedDB — which is every workspace worth bootstrapping —
            // every un-written batch stays retained by the persist chain and the whole
            // snapshot is held twice at the peak. Waiting here is what lets the reader
            // inherit the disk's pace.
            if (++pages % BOOTSTRAP_BACKPRESSURE_PAGES === 0) await this.store.whenPersisted();
          },
          onProgress: (received) => this.setStatus({ phase: 'bootstrapping', received }),
        },
        abort.signal,
      );

      // The commit point. Rows were written as they streamed, but bootstrapAt is only set
      // here — so a connection that drops mid-snapshot leaves a store the next load
      // correctly recognises as torn and re-fetches, rather than one it mistakes for complete.
      await this.store.finishBootstrap(result.version);
    } finally {
      if (this.bootstrapAbort === abort) this.bootstrapAbort = null;
    }
  }

  /**
   * Drops the replica and reloads the tab once.
   *
   * beginBootstrap has already emptied the stores, but the connection is still open, and
   * IndexedDB will refuse to delete a database another handle holds. Closing first is
   * what makes the drop actually happen. The reload is gated so a server that is simply
   * on a different number than this source tree cannot flash forever.
   */
  private async recoverOutdatedClient(): Promise<void> {
    try {
      if (this.db) {
        await this.db.destroy();
      } else {
        await dropDatabase(this.workspaceId);
      }
    } catch {
      /* the reload below is the recovery; a failed delete must not block it */
    }
    if (!consumeSchemaReload()) return;
    location.reload();
    await new Promise<never>(() => {
      /* the document is going away */
    });
  }

  /**
   * Arranges for one more drain, later.
   *
   * One timer, not one per caller. The flat five-second `setTimeout` this replaces kept no
   * handle (so `stop()` could not clear it), had no backoff and no jitter, and was scheduled
   * once per failing mutation: fifty offline edits armed fifty timers that all fired
   * together, and the `draining` guard then discarded forty-nine of them for good.
   *
   * `retryAfterMs` is the server's own answer on a 429 and wins over the backoff, because the
   * point of honouring it is to stop asking before it says so.
   */
  private scheduleDrain(retryAfterMs?: number): void {
    if (this.stopped || this.drainTimer !== null) return;

    const base = retryAfterMs ?? this.drainDelay;
    const delay = Math.min(base + Math.random() * base * 0.5, RETRY_MAX_MS);
    this.drainTimer = setTimeout(() => {
      this.drainTimer = null;
      void this.drainOutbox();
    }, delay);

    if (retryAfterMs === undefined) {
      this.drainDelay = Math.min(this.drainDelay * 2, RETRY_MAX_MS);
    }
  }

  /** A drain that got somewhere: the next failure starts from the bottom of the curve again. */
  private resetDrainBackoff(): void {
    this.drainDelay = RETRY_MIN_MS;
  }

  private setStatus(status: EngineStatus): void {
    this.status = status;
    this.options.onStatus?.(status);
  }

  /** What "everything is running" looks like right now, degradation included. */
  private readyStatus(): EngineStatus {
    return {
      phase: 'ready',
      connection: this.socket.connectionState(),
      pending: this.outbox.pending().length,
      // Spread rather than assigned so a healthy engine publishes no key at all under
      // `exactOptionalPropertyTypes`.
      ...(this.degraded === undefined ? null : { degraded: this.degraded }),
      ...(this.conflictNotice() === undefined ? null : { notice: REMOTE_EDIT_NOTICE }),
    };
  }

  private publishStatus(): void {
    if (this.status.phase !== 'ready' && this.status.phase !== 'idle') {
      this.options.onStatus?.(this.status);
      return;
    }
    this.setStatus(this.readyStatus());
  }
}

function upsertPayload(change: Change): { type: EntityType; id: UUID; payload: Entity } | null {
  if (change.op !== 'upsert' || change.payload === undefined || change.payload === null)
    return null;
  if (typeof change.payload !== 'object') return null;
  if (!isEntityType(change.type)) return null;
  return { type: change.type, id: change.id as UUID, payload: change.payload as Entity };
}

function readField(entity: object, key: string): unknown {
  return (entity as unknown as Record<string, unknown>)[key];
}

/** Keys the optimistic write actually changed. `updatedAt` is excluded; see `SERVER_CLOCK_FIELDS`. */
function pendingFields(before: Entity, after: Entity): string[] {
  const left = before as unknown as Record<string, unknown>;
  const right = after as unknown as Record<string, unknown>;
  const fields: string[] = [];
  for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) {
    if (SERVER_CLOCK_FIELDS.has(key)) continue;
    if (!sameResult(left[key], right[key])) fields.push(key);
  }
  return fields;
}

function overlayFields(current: Entity, after: Entity, fields: readonly string[]): Entity {
  const next: Record<string, unknown> = { ...(current as unknown as Record<string, unknown>) };
  const source = after as unknown as Record<string, unknown>;
  for (const field of fields) {
    if (source[field] === undefined) delete next[field];
    else next[field] = source[field];
  }
  return next as unknown as Entity;
}

function coverKey(opId: UUID, type: EntityType, id: UUID): string {
  return `${opId}:${type}:${id}`;
}

const CLIENT_ID_KEY = 'polaris.clientId';

function readOrCreateClientId(): UUID {
  try {
    const existing = localStorage.getItem(CLIENT_ID_KEY);
    if (existing) return existing as UUID;
    const fresh = uuidv7();
    localStorage.setItem(CLIENT_ID_KEY, fresh);
    return fresh;
  } catch {
    // Safari private mode and sandboxed iframes throw on localStorage. A per-session id
    // still works — the only cost is that an outbox surviving a reload is treated as a
    // different client, which the server handles as a fresh operation.
    return uuidv7();
  }
}
