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
  Outbox,
  PolarisDB,
  Store,
  uuidv7,
  type Change as StoreChange,
  type Entity,
  type EntityRow,
  type EntityType,
  type OptimisticPatch,
  type Reconciliation,
  type UUID,
} from '~/store';
import { ApiError, gql, setWorkspace } from './api';
import { streamBootstrap } from './bootstrap';
import { adopt, settle, unpairedCreates } from './reconcile';
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

export type EngineStatus =
  | { phase: 'idle' }
  | { phase: 'hydrating' }
  | { phase: 'bootstrapping'; received: number }
  | { phase: 'ready'; connection: ConnectionState; pending: number }
  | { phase: 'failed'; error: string };

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

/** `mutation CreateComment(...)` → `CreateComment`, so a thrown error names the call site. */
function operationName(document: string): string {
  return /\bmutation\s+([A-Za-z0-9_]+)/.exec(document)?.[1] ?? 'a mutation';
}

/**
 * Whether a failure the server *answered* with is worth queueing behind.
 *
 * A rate limit or a server fault says nothing about the mutation — the same op sent a
 * minute later may well be accepted — so discarding it would throw away work over a blip.
 * Everything else (validation, permission, conflict, plan limit) is a decision about this
 * op specifically, and repeating it would only produce the same refusal.
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
  private draining = false;
  private resyncTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

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
      this.store = new Store(this.workspaceId, { db: this.db });
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
    if (this.resyncTimer) clearTimeout(this.resyncTimer);
    this.socket.disconnect();
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
    this.publishStatus();

    try {
      const data = await gql<T>(input.mutation, {
        ...input.variables,
        clientId: this.clientId,
        opId,
      });
      settle(this.store, input.reconcile, data);
      await this.outbox.resolve(opId);
      this.publishStatus();
      return data;
    } catch (err) {
      if (err instanceof ApiError && (err.isOffline || isRetriable(err))) {
        // Either the request never reached the server, or it reached one that was too
        // busy to take it. In both cases the mutation may still happen, so keep it queued
        // and keep the optimistic state on screen — rolling back here is what makes an app
        // feel like it "lost" an edit the moment a lift's doors close.
        this.publishStatus();
        void this.scheduleDrain();
        throw err;
      }

      // A real rejection. Undo the optimistic patch so the user is not left looking at a
      // state the server refused.
      const patch = await this.outbox.rollback(opId);
      if (patch) this.store.revertOptimistic(patch);
      this.publishStatus();
      throw err;
    } finally {
      void record;
    }
  }

  /** Retries everything queued. Called on reconnect and after an offline failure. */
  async drainOutbox(): Promise<void> {
    if (this.draining || this.stopped) return;
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
          const patch = await this.outbox.rollback(record.opId);
          if (patch) this.store.revertOptimistic(patch);
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
          settle(this.store, record.reconcile, data);
          await this.outbox.resolve(record.opId);
        } catch (err) {
          if (err instanceof ApiError && err.isOffline) {
            // Still offline. Release the claim without counting an attempt and stop:
            // nothing about this op was judged, so a try that never left the machine
            // must not move it closer to being discarded.
            this.outbox.release(record.opId);
            break;
          }

          // The server answered. A refusal is final, but a rate limit or a server fault
          // is not: those keep their place in the queue and are counted, which is what
          // the attempt ceiling is for.
          const attempts = await this.outbox.markAttempt(record.opId);
          if (isRetriable(err) && attempts < MAX_ATTEMPTS) {
            void this.scheduleDrain();
            break;
          }

          const patch = await this.outbox.rollback(record.opId);
          if (patch) this.store.revertOptimistic(patch);
        }
      }
    } finally {
      this.draining = false;
      this.publishStatus();
    }
  }

  private async onSocketReady(serverVersion: number): Promise<void> {
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
    // A row in this batch may be the one a stand-in is standing in for. The socket pushes it
    // the moment the mutation commits, which on a loaded machine is well before the response
    // gets back here — and until something retires the stand-in the user is looking at their
    // comment twice. Doing it here rather than waiting for `settle` is what makes the
    // duplicate last a frame instead of a round trip, or forever when the response is lost.
    adopt(this.store, this.outbox, changes);
    this.socket.setVersion(this.store.version);
  }

  private onResync(reason: string, retryAfterMs: number): void {
    if (this.resyncTimer) clearTimeout(this.resyncTimer);

    // The server already jittered this. Honouring the delay is what stops a fleet-wide
    // resync — a bad deploy, a schema bump — from arriving at Postgres as one spike.
    this.resyncTimer = setTimeout(() => {
      void (async () => {
        try {
          await this.bootstrap();
          this.socket.connect(this.store.version);
          clearSchemaReloadAttempt();
        } catch (err) {
          if (isOutdatedClientError(err)) {
            await this.recoverOutdatedClient();
          }
          this.setStatus({
            phase: 'failed',
            error: err instanceof Error ? err.message : 'resync failed',
          });
        }
      })();
    }, retryAfterMs);

    void reason;
  }

  private async bootstrap(): Promise<void> {
    this.setStatus({ phase: 'bootstrapping', received: 0 });

    // Clears the previous replica before the first row lands. Ingesting on top of it
    // would leave behind every entity that has since been deleted or revoked — and a
    // resync triggered by "permissions changed" is exactly the case where those stale
    // rows are the ones the client must not keep.
    await this.store.beginBootstrap();

    const result = await streamBootstrap(this.workspaceId, {
      onMeta: (meta) => {
        if (meta.clientSchema !== STORE_SCHEMA) {
          // Reloading is the prescribed recovery, but only a new bundle (or a rebuilt
          // server) can actually change the number. Throwing here lets start() drop the
          // torn replica and auto-reload once, rather than leaving the user on a splash
          // whose "Try again" retries the same disagreement.
          throw new ApiError('CONFLICT', OUTDATED_CLIENT_MESSAGE);
        }
      },
      onBatch: (entities) => {
        const rows: EntityRow[] = entities.map((e) => ({
          type: e.type as EntityType,
          entity: e.payload as Entity,
        }));
        this.store.ingestBootstrapPage(rows);
      },
      onProgress: (received) => this.setStatus({ phase: 'bootstrapping', received }),
    });

    // The commit point. Rows were written as they streamed, but bootstrapAt is only set
    // here — so a connection that drops mid-snapshot leaves a store the next load
    // correctly recognises as torn and re-fetches, rather than one it mistakes for complete.
    await this.store.finishBootstrap(result.version);
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

  private scheduleDrain(): void {
    if (this.stopped) return;
    setTimeout(() => void this.drainOutbox(), 5000);
  }

  private setStatus(status: EngineStatus): void {
    this.status = status;
    this.options.onStatus?.(status);
  }

  private publishStatus(): void {
    if (this.status.phase !== 'ready' && this.status.phase !== 'idle') {
      this.options.onStatus?.(this.status);
      return;
    }
    this.setStatus({
      phase: 'ready',
      connection: this.socket.connectionState(),
      pending: this.outbox.pending().length,
    });
  }
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
