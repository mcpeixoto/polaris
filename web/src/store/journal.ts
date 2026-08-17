import type { OutboxRecord } from './outbox';
import type { UUID } from './types';

/**
 * The write-ahead journal: the few milliseconds of the outbox that IndexedDB cannot cover.
 *
 * The outbox is durable and awaited before anything is sent, which is the right shape and
 * still leaves a window. `putOutbox` is an IndexedDB transaction, so between the user's
 * keystroke and the row committing there is an `await` — and a document torn down inside it
 * takes the transaction with it. The browser aborts in-flight IndexedDB work on discard;
 * there is no flush, no `beforeunload` hook that can wait, and no way to make an IndexedDB
 * write synchronous.
 *
 * Measured, not theorised: delete an issue and navigate in the same tick and the outbox is
 * empty afterwards, the issue is back in the replica, and the server never heard about it —
 * permanently, because nothing is left to replay. At 150ms it lands normally. The gap is
 * small and it is on the path of every write in the product, so it is hit by the ordinary
 * things people do: pressing a shortcut and closing the tab, clicking a link straight after
 * an action, a phone discarding a background page.
 *
 * `localStorage` closes it because it is the one durable store in a browser whose write is
 * *synchronous*: `setItem` has committed by the time it returns, so an entry recorded before
 * the first `await` cannot be lost to a teardown during that await. It is a poor queue —
 * small, string-only, and it blocks the main thread — which is why it holds nothing but the
 * in-flight moment. An entry is written just before the IndexedDB write starts and removed
 * as soon as it commits, so in a healthy session this key is empty; anything found in it at
 * boot is, by construction, a write that was interrupted.
 *
 * Scoped per workspace, matching the replica's own database name. An entry recovered into
 * the wrong replica would be a mutation replayed against a server that never issued it.
 */

/** One interrupted write, as it is stored. The outbox record itself, nothing added. */
export type JournalEntry = OutboxRecord;

/**
 * A cap on how much of somebody's storage this may hold.
 *
 * There is no legitimate way to accumulate entries — each is removed within milliseconds of
 * being written — so a journal near this size means writes are being interrupted faster than
 * IndexedDB commits them, or one variables payload is enormous. Either way the honest answer
 * is to stop growing rather than to fill the origin's quota and take `localStorage` down for
 * the theme, the last-workspace pointer and everything else sharing it.
 */
const MAX_JOURNAL_BYTES = 512 * 1024;

function keyFor(workspaceId: UUID): string {
  return `polaris.outboxJournal/${workspaceId}`;
}

/**
 * Every touch is wrapped, and not out of habit: the `localStorage` property access itself
 * throws a SecurityError in a sandboxed iframe and in Safari's private mode, before any
 * method is called — and `setItem` throws QuotaExceededError when the origin is full.
 *
 * Failing degrades to exactly the behaviour this module exists to improve on, which is the
 * right trade: a journal that cannot be written must not be a write that cannot be made.
 */
function read(workspaceId: UUID): Record<UUID, JournalEntry> {
  try {
    const raw = globalThis.localStorage?.getItem(keyFor(workspaceId));
    if (raw === null || raw === undefined) return {};
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as Record<UUID, JournalEntry>;
  } catch {
    // Unreadable and corrupt are the same answer as absent. A half-written value came from
    // a build that is no longer running, and there is nothing to recover from a string that
    // will not parse.
    return {};
  }
}

function write(workspaceId: UUID, entries: Record<UUID, JournalEntry>): void {
  try {
    const key = keyFor(workspaceId);
    if (Object.keys(entries).length === 0) {
      globalThis.localStorage?.removeItem(key);
      return;
    }
    const serialised = JSON.stringify(entries);
    if (serialised.length > MAX_JOURNAL_BYTES) return;
    globalThis.localStorage?.setItem(key, serialised);
  } catch {
    // The window stays open for this one write. Nothing else changes: the IndexedDB append
    // is still awaited, still durable, and still the thing that actually carries the queue.
  }
}

/**
 * Records a write about to be attempted. Synchronous, and must be called before the first
 * `await` of the durable write it is covering — that ordering is the whole mechanism.
 */
export function journalWrite(workspaceId: UUID, record: JournalEntry): void {
  const entries = read(workspaceId);
  entries[record.opId] = record;
  write(workspaceId, entries);
}

/** Forgets a write that reached IndexedDB. Synchronous, so it cannot itself be interrupted. */
export function journalForget(workspaceId: UUID, opId: UUID): void {
  const entries = read(workspaceId);
  if (!(opId in entries)) return;
  delete entries[opId];
  write(workspaceId, entries);
}

/**
 * Forgets everything for a workspace.
 *
 * Called when the replica is deleted — sign-out, a schema rebuild, or this installation
 * being pointed at a different server. The journal deliberately survives IndexedDB going
 * away, which is the point during a session and exactly wrong at that moment: a surviving
 * entry would be replayed against a workspace the person may no longer be in.
 */
export function clearJournal(workspaceId: UUID): void {
  write(workspaceId, {});
}

/**
 * Everything the journal is still holding, and clears it.
 *
 * Called once when the outbox opens. Clearing as part of reading is deliberate: the caller
 * writes what it finds into IndexedDB, which is strictly more durable, and an entry left
 * behind after that would be recovered again on every subsequent boot forever.
 *
 * A recovered entry may duplicate one the outbox already loaded — the tab can die between
 * the IndexedDB commit and the removal — and that is harmless twice over: the outbox is
 * keyed by `opId`, so re-adding writes the same row, and the server records `(client_id,
 * op_id)` and returns the original result rather than applying anything again.
 */
export function drainJournal(workspaceId: UUID): readonly JournalEntry[] {
  const entries = read(workspaceId);
  const found = Object.values(entries).filter(isEntry);
  if (Object.keys(entries).length > 0) write(workspaceId, {});
  // Creation order, because that is the order the user made these edits in and replaying
  // "set status" after "set assignee" is a different final state. UUIDv7 sorts by mint time.
  return [...found].sort((a, b) => (a.opId < b.opId ? -1 : a.opId > b.opId ? 1 : 0));
}

/**
 * Rejects anything that is not a journal entry this build wrote.
 *
 * The origin is shared — with older builds of Polaris, and with whatever else is served from
 * it — and a recovered "mutation" that is really somebody else's JSON would be sent to the
 * server as one. Checking the fields this code depends on is cheaper than trusting the key.
 */
function isEntry(value: unknown): value is JournalEntry {
  if (value === null || typeof value !== 'object') return false;
  const entry = value as Partial<JournalEntry>;
  return (
    typeof entry.opId === 'string' &&
    typeof entry.mutation === 'string' &&
    typeof entry.variables === 'object' &&
    entry.variables !== null &&
    Array.isArray(entry.optimisticPatch)
  );
}
