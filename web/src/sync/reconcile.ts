/**
 * Pairing the server's row with the stand-in that stood for it while the request was out.
 *
 * Most entities need nothing here: the client mints their id, so the response upserts over
 * the same key and there is no pairing to make. A few — a comment, an issue relation, an
 * issue subscription — still have their id allocated by the API, and for those the client
 * renders a row under an id it invented and has to replace it when the real one arrives.
 *
 * The pairing used to be written at each call site, in the `await` that sent the mutation.
 * That works for exactly as long as the `await` does. A reload taken between the optimistic
 * write and the response throws the closure away — and the stand-in is *persisted*, because
 * an optimistic write that vanished on refresh would be worse — so the outbox replays the
 * op, the server's idempotency table answers with the original row, and that row lands in
 * the replica beside a stand-in nothing is left holding. The screen then shows one comment
 * twice, one link twice, and no amount of reloading clears it: both rows are real rows now.
 *
 * So the pairing is stored with the mutation, as data (see `Reconciliation`), and applied
 * here — from `SyncEngine.mutate` when the response comes back to the caller, and from
 * `SyncEngine.drainOutbox` when it comes back to nobody.
 *
 * That covers every way the *response* can arrive, and it is still not every way the row
 * can. The sync socket carries the same row, pushed the instant the mutation commits, and
 * on a loaded machine it routinely arrives first: the response has to travel back and be
 * parsed by a main thread that is busy rendering, while the delta is already in. Until the
 * response lands there are two rows in the replica for one comment on the server, and the
 * issue shows it twice. Delaying the response by hand makes it certain rather than one run
 * in five — see `web/e2e/comments.spec.ts`.
 *
 * So `adopt` below closes the same hole from the other side: a delta row that *is* the
 * stand-in retires it on arrival, without waiting for a response that may never come.
 */

import type {
  Entity,
  EntityOf,
  EntityPatch,
  EntityType,
  Outbox,
  Reconciliation,
  Store,
} from '~/store';
import { fromWire } from '~/gql/enums';
import type { Change } from './socket';

/**
 * Puts the server's row in place of the stand-in, in one store write.
 *
 * One write rather than two because a row that disappears for a frame on its way to being
 * replaced by itself is the exact flicker an optimistic create exists to prevent.
 *
 * `fromWire` because this row came back over GraphQL, where enumerated values are spelled in
 * upper case, while everything already in the store came off the sync stream in the
 * database's spelling. Writing the response through unconverted puts `"BLOCKS"` where every
 * reader compares against `'blocks'` — a value that is present, plausible, and equal to
 * nothing.
 *
 * A response that holds no row where the reconciliation says one should be is left alone
 * rather than guessed at: the delta stream carries the authoritative row either way, and the
 * stand-in is the user's own write, which must not be deleted on a hunch.
 */
export function settle(store: Store, spec: Reconciliation, data: unknown): void {
  let node: unknown = data;
  for (const key of spec.path) {
    if (typeof node !== 'object' || node === null) return;
    node = (node as Record<string, unknown>)[key];
  }
  if (typeof node !== 'object' || node === null) return;
  if (typeof (node as { id?: unknown }).id !== 'string') return;

  const real = fromWire(spec.type, node as EntityOf<EntityType>);
  const patch: EntityPatch[] = [
    {
      type: spec.type,
      id: real.id,
      before: store.get(spec.type, real.id) ?? null,
      after: real,
    },
  ];
  if (real.id !== spec.provisionalId) {
    patch.unshift({ type: spec.type, id: spec.provisionalId, before: null, after: null });
  }
  store.applyOptimistic(patch);
}

/**
 * Retires stand-ins whose real row has just arrived on the delta stream.
 *
 * Called with each delta batch, after it has been applied, so the store holds the server's
 * row and the stand-in side by side and this removes the second of them. After rather than
 * before because the alternative — dropping the stand-in first — puts an empty comment
 * thread on the screen for one frame, and a comment that blinks out and back is a worse
 * artefact than the one being fixed. Both writes land in the same task, so React renders
 * the pair once.
 *
 * A row is matched to a stand-in on the fields the client chose (`Reconciliation.match`),
 * because the one field it could not choose is the id. Each stand-in is claimed at most
 * once per batch, so two identical comments posted in quick succession retire one row each
 * rather than both collapsing onto the first delta.
 *
 * A wrong match is survivable by construction, which is why near-unique fields are enough.
 * Suppose a teammate posts a byte-identical comment on the same issue while yours is still
 * in flight: this retires your stand-in against their row, and your own row arrives moments
 * later on the response, where `settle` writes it. The screen is one comment short for the
 * length of that gap and correct afterwards. The opposite bargain — demanding a key only
 * the server can mint — is what leaves the duplicate on screen indefinitely.
 */
export function adopt(store: Store, outbox: Outbox, changes: readonly Change[]): void {
  // The overwhelmingly common case: nothing is waiting, and this runs on every delta batch
  // the socket delivers. Checking the size first keeps that path free of an array copy.
  if (outbox.size === 0) return;
  const pending = outbox.list().filter((record) => record.reconcile?.match !== undefined);
  if (pending.length === 0) return;

  const drops: EntityPatch[] = [];
  const claimed = new Set<string>();

  for (const change of changes) {
    if (change.op !== 'upsert') continue;
    const row = change.payload;
    if (typeof row !== 'object' || row === null) continue;

    for (const record of pending) {
      const spec = record.reconcile;
      if (spec?.match === undefined) continue;
      if (spec.type !== change.type || spec.provisionalId === change.id) continue;
      if (claimed.has(spec.provisionalId)) continue;

      const standIn = store.get(spec.type, spec.provisionalId);
      if (standIn === undefined) continue;
      if (!spec.match.every((field) => same(standIn, row as Entity, field))) continue;

      claimed.add(spec.provisionalId);
      drops.push({ type: spec.type, id: spec.provisionalId, before: null, after: null });
      break;
    }
  }

  if (drops.length > 0) store.applyOptimistic(drops);
}

/**
 * Compares one field of a stand-in against the same field of a delta row.
 *
 * `?? null` on both sides because the two rows are spelled differently by construction: the
 * stand-in is built in TypeScript, where an absent parent is `undefined`, and the delta row
 * comes off Postgres through JSON, where it is `null`. Comparing those with `===` would
 * make every root comment fail to match its own row — the one case that matters most.
 */
function same(standIn: Entity, row: Entity, field: string): boolean {
  const a = (standIn as unknown as Record<string, unknown>)[field] ?? null;
  const b = (row as unknown as Record<string, unknown>)[field] ?? null;
  return a === b;
}
