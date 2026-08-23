/**
 * Pairing the server's row with the stand-in that stood for it while the request was out.
 *
 * Almost every entity needs one. `CreateIssueInput` takes an `id`, so an issue's response
 * upserts over the key the client already used and there is no pairing to make — and it is
 * the only input in the schema that does. Everything else has its id allocated by the API,
 * so the client renders a row under an id it invented and has to replace it when the real
 * one arrives. That was true of five features when the bug was found in them one at a time,
 * and of thirty-five more that nobody had reported yet.
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
 *
 * And `unpairedCreates` at the bottom is what stops the next feature writing the original
 * mistake again. It is called from `SyncEngine.mutate` in dev builds and mirrored by
 * `scripts/lint-optimistic-reconcile.mjs` in CI: an optimistic create under an id the server
 * never sees, with no pairing declared for it, is refused rather than shipped.
 */

import {
  reconciliations,
  type Entity,
  type EntityOf,
  type EntityPatch,
  type EntityType,
  type OptimisticPatch,
  type Outbox,
  type Reconciliation,
  type Store,
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
export function settle(
  store: Store,
  spec: Reconciliation | readonly Reconciliation[] | undefined,
  data: unknown,
): void {
  for (const one of reconciliations(spec)) settleOne(store, one, data);
}

function settleOne(store: Store, spec: Reconciliation, data: unknown): void {
  // No path means the response never carried this row: an `issueLabel` written beside a
  // created issue, a duplicate link written beside a triaged one. The mutation has just
  // been confirmed, so the server holds the real row and the delta stream is carrying it —
  // usually it has already arrived and `adopt` has retired this stand-in, which is why the
  // `get` below is the common answer. What is left is the case where the response won the
  // race, and there the stand-in has to go now rather than wait: once the op leaves the
  // outbox nothing is holding this pairing, and a stand-in that outlives it is a row on
  // the screen for good.
  if (spec.path === undefined) {
    if (store.get(spec.type, spec.provisionalId) !== undefined) {
      store.applyOptimistic(retire(spec));
    }
    return;
  }
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
  if (real.id !== spec.provisionalId) patch.unshift(...retire(spec));
  store.applyOptimistic(patch);
}

/**
 * The writes that take a stand-in and everything hanging off it out of the replica.
 *
 * `before: null, after: null` rather than the row's real `before`, because this is not an
 * undo: the stand-in is being superseded, not rejected, and a patch that could restore it
 * is a patch something might.
 */
function retire(spec: Reconciliation): EntityPatch[] {
  const drops: EntityPatch[] = [
    { type: spec.type, id: spec.provisionalId, before: null, after: null },
  ];
  for (const dependent of spec.dependents ?? []) {
    drops.push({ type: dependent.type, id: dependent.id, before: null, after: null });
  }
  return drops;
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
  const pending = outbox
    .list()
    .flatMap((record) => reconciliations(record.reconcile))
    .filter((spec) => spec.match !== undefined);
  if (pending.length === 0) return;

  const drops: EntityPatch[] = [];
  const claimed = new Set<string>();

  for (const change of changes) {
    if (change.op !== 'upsert') continue;
    const row = change.payload;
    if (typeof row !== 'object' || row === null) continue;

    for (const spec of pending) {
      if (spec.match === undefined) continue;
      if (spec.type !== change.type || spec.provisionalId === change.id) continue;
      if (claimed.has(spec.provisionalId)) continue;

      const standIn = store.get(spec.type, spec.provisionalId);
      if (standIn === undefined) continue;
      if (!spec.match.every((field) => same(standIn, row as Entity, field))) continue;

      claimed.add(spec.provisionalId);
      drops.push(...retire(spec));
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

/**
 * The optimistic creates in a mutation that nothing will ever pair with the server's row.
 *
 * This is the check that stops the bug at the top of this file being written a sixth time.
 * Five features shipped it independently — comments, relations, issue subscriptions,
 * attachments, project dependencies — and every one was found by a user seeing a row twice,
 * because nothing about writing it wrong looks wrong. The call site reads perfectly: mint a
 * stand-in, render it, await the mutation, swap in the real row. The defect is what happens
 * when the `await` does not come back, and no reviewer sees an absence.
 *
 * So it is derived rather than declared, from two things the call site cannot fake:
 *
 *   - an optimistic entry with `before: null` is a create, and its `id` is a stand-in;
 *   - if that id is not somewhere in `variables`, the server never saw it, which means the
 *     server is minting its own and the two rows will not share a key.
 *
 * A create that satisfies both and declares no `reconcile` for that id has no way back. It
 * is not a race and not a rare path: it is every reload, every navigation, every 429, every
 * dropped response. Whereas an `id` the client sent is by definition the id the row will
 * have, and needs nothing.
 *
 * Derived, so it needs no registry of which entities the API mints ids for — a list that
 * would be correct on the day it was written and quietly wrong after the next schema change.
 * `createIssue` passes because it sends its id, and would start failing the moment somebody
 * stopped sending it, which is exactly the change that would reintroduce the bug.
 */
export function unpairedCreates(input: {
  readonly variables: Readonly<Record<string, unknown>>;
  readonly optimistic?: OptimisticPatch | undefined;
  readonly reconcile?: Reconciliation | readonly Reconciliation[] | undefined;
}): readonly EntityPatch[] {
  const creates = (input.optimistic ?? []).filter(
    (entry) => entry.before === null && entry.after !== null,
  );
  if (creates.length === 0) return [];

  const declared = new Set<string>();
  for (const spec of reconciliations(input.reconcile)) declared.add(spec.provisionalId);
  for (const spec of reconciliations(input.reconcile)) {
    for (const dependent of spec.dependents ?? []) declared.add(dependent.id);
  }

  const sent = new Set<string>();
  collectStrings(input.variables, sent);

  return creates.filter((entry) => !declared.has(entry.id) && !sent.has(entry.id));
}

/**
 * Every string anywhere in the mutation's variables.
 *
 * Whole-value equality against the stand-in's id, so this cannot be fooled by an id that
 * merely appears inside a longer string, and a depth cap because these are hand-written
 * variable objects and a cycle here would hang a keystroke.
 */
function collectStrings(value: unknown, into: Set<string>, depth = 0): void {
  if (depth > 8) return;
  if (typeof value === 'string') {
    into.add(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, into, depth + 1);
    return;
  }
  if (typeof value === 'object' && value !== null) {
    for (const item of Object.values(value)) collectStrings(item, into, depth + 1);
  }
}
