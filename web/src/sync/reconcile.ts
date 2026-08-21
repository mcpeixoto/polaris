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
 */

import type { EntityOf, EntityPatch, EntityType, Reconciliation, Store } from '~/store';
import { fromWire } from '~/gql/enums';

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
