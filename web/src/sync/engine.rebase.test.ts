/**
 * Two computers, one issue, one user.
 *
 * The server already merges a partial update under a row lock and emits the whole issue.
 * The client used to replace the replica with that payload, so a status this computer had
 * just chosen disappeared until its own delta came back — and a second click in that
 * window planned from the stale row. These tests pin the rebase that keeps only the
 * pending fields, and the echo that stops them from winning once the server has them.
 */

import { describe, expect, it } from 'vitest';

import { Outbox, Store, type Change, type Issue, type UUID } from '~/store';
import type { EngineStatus } from './engine';
import { SyncEngine } from './engine';
import type { Change as SocketChange } from './socket';

const WORKSPACE = '01920000-0000-7000-8000-000000000001' as UUID;
const TEAM = '01920000-0000-7000-8000-000000000011' as UUID;
const ISSUE = '01920000-0000-7000-8000-000000000010' as UUID;
const TODO = '01920000-0000-7000-8000-0000000000a1' as UUID;
const DONE = '01920000-0000-7000-8000-0000000000a2' as UUID;
const CANCELED = '01920000-0000-7000-8000-0000000000a3' as UUID;

const AT = '2026-01-01T00:00:00.000Z';
const OPTIMISTIC_AT = '2026-01-01T00:00:01.000Z';
const REMOTE_AT = '2026-01-01T00:00:02.000Z';
const ECHO_AT = '2026-01-01T00:00:03.000Z';
const LATER_AT = '2026-01-01T00:00:04.000Z';

function issue(over: Partial<Issue> = {}): Issue {
  return {
    id: ISSUE,
    workspaceId: WORKSPACE,
    teamId: TEAM,
    number: 1,
    identifier: 'ENG-1',
    title: 'Fix the login redirect',
    description: '',
    stateId: TODO,
    priority: 0,
    sortOrder: 'a0',
    dueDateSource: 'manual',
    createdAt: AT,
    updatedAt: AT,
    ...over,
  };
}

function delta(v: number, row: Issue): Change<'issue'> {
  return {
    v,
    type: 'issue',
    id: row.id,
    op: 'upsert',
    actor: { type: 'user', id: '01920000-0000-7000-8000-0000000000b1' as UUID },
    payload: row,
  };
}

function rig(onStatus?: (status: EngineStatus) => void): {
  engine: SyncEngine;
  store: Store;
  outbox: Outbox;
} {
  const engine = new SyncEngine(WORKSPACE, onStatus === undefined ? {} : { onStatus });
  const store = new Store(WORKSPACE);
  const outbox = new Outbox(null);
  engine.store = store;
  engine.outbox = outbox;
  return { engine, store, outbox };
}

/** The socket is what normally calls this. The rebase lives on that path. */
function deliver(engine: SyncEngine, changes: readonly Change[]): void {
  (engine as unknown as { onDelta(changes: SocketChange[]): void }).onDelta(
    changes as unknown as SocketChange[],
  );
}

/**
 * A status change, claimed in flight, the way `mutate` leaves it while the request is out.
 *
 * Claimed on purpose: `pending()` hides in-flight ops, and that is the window the other
 * computer's delta arrives in. A rebase that read `pending()` would not see this write.
 */
async function pendStatus(store: Store, outbox: Outbox): Promise<UUID> {
  const before = issue();
  const after = issue({ stateId: DONE, updatedAt: OPTIMISTIC_AT });
  store.applyChanges([delta(1, before)]);
  store.applyOptimistic([{ type: 'issue', id: ISSUE, before, after }]);
  const record = await outbox.append({
    mutation:
      'mutation UpdateIssue($input: UpdateIssueInput!) { updateIssue(input: $input) { id } }',
    variables: { input: { id: ISSUE, stateId: DONE } },
    optimisticPatch: [{ type: 'issue', id: ISSUE, before, after }],
  });
  expect(outbox.markInFlight(record.opId)).toBe(true);
  return record.opId;
}

describe('two computers editing one issue', () => {
  it('keeps a pending status, takes the other priority, then lets the merged write stand', async () => {
    const statuses: EngineStatus[] = [];
    const { engine, store, outbox } = rig((status) => statuses.push(status));
    const opId = await pendStatus(store, outbox);

    deliver(engine, [delta(2, issue({ stateId: TODO, priority: 2, updatedAt: REMOTE_AT }))]);

    // Their priority, our status. The optimistic updatedAt is not put back: the server
    // stamps its own, and treating that stamp as a pending field would hide the echo.
    expect(store.get('issue', ISSUE)).toMatchObject({
      stateId: DONE,
      priority: 2,
      updatedAt: REMOTE_AT,
    });
    expect(statuses.some((status) => status.phase === 'ready' && status.notice)).toBe(false);

    deliver(engine, [delta(3, issue({ stateId: DONE, priority: 2, updatedAt: ECHO_AT }))]);

    expect(store.get('issue', ISSUE)).toMatchObject({
      stateId: DONE,
      priority: 2,
      updatedAt: ECHO_AT,
    });
    // Still queued. The response has not arrived, and replay has to be able to send it.
    // Echo is what stops the rebase — not deleting the op.
    expect(outbox.get(opId)?.optimisticPatch).toHaveLength(1);

    deliver(engine, [delta(4, issue({ stateId: TODO, priority: 2, updatedAt: LATER_AT }))]);

    expect(store.get('issue', ISSUE)).toMatchObject({
      stateId: TODO,
      priority: 2,
      updatedAt: LATER_AT,
    });
  });

  it('keeps our status when the other computer changed it, says so once, then lets the server win', async () => {
    const statuses: EngineStatus[] = [];
    const { engine, store, outbox } = rig((status) => statuses.push(status));
    const opId = await pendStatus(store, outbox);

    deliver(engine, [delta(2, issue({ stateId: CANCELED, priority: 2, updatedAt: REMOTE_AT }))]);

    expect(store.get('issue', ISSUE)).toMatchObject({ stateId: DONE, priority: 2 });
    expect(
      statuses.map((status) => (status.phase === 'ready' ? status.notice : undefined)),
    ).toEqual(['Updated elsewhere']);

    // A second delta while the same edit is in flight is the same fact, not a second notice.
    deliver(engine, [delta(3, issue({ stateId: CANCELED, priority: 3, updatedAt: REMOTE_AT }))]);

    expect(statuses).toHaveLength(1);
    expect(store.get('issue', ISSUE)).toMatchObject({ stateId: DONE, priority: 3 });

    deliver(engine, [delta(4, issue({ stateId: DONE, priority: 3, updatedAt: ECHO_AT }))]);

    expect(store.get('issue', ISSUE)).toMatchObject({
      stateId: DONE,
      priority: 3,
      updatedAt: ECHO_AT,
    });
    const cleared = statuses.at(-1);
    expect(cleared?.phase).toBe('ready');
    expect(cleared?.phase === 'ready' ? cleared.notice : 'still pending').toBeUndefined();
    expect(outbox.get(opId)).toBeDefined();

    deliver(engine, [delta(5, issue({ stateId: CANCELED, priority: 3, updatedAt: LATER_AT }))]);

    expect(store.get('issue', ISSUE)).toMatchObject({
      stateId: CANCELED,
      priority: 3,
      updatedAt: LATER_AT,
    });
  });

  it('puts the remote status back when the pending write is refused', async () => {
    const { engine, store, outbox } = rig();
    const opId = await pendStatus(store, outbox);

    deliver(engine, [delta(2, issue({ stateId: CANCELED, priority: 2, updatedAt: REMOTE_AT }))]);
    expect(store.get('issue', ISSUE)?.stateId).toBe(DONE);

    await (engine as unknown as { undoQueued(opId: UUID): Promise<void> }).undoQueued(opId);

    // The refusal drops our status. Their priority, and the status they set, stay —
    // rolling the whole optimistic snapshot back would wipe the priority too.
    expect(store.get('issue', ISSUE)).toMatchObject({
      stateId: CANCELED,
      priority: 2,
      updatedAt: REMOTE_AT,
    });
    expect(outbox.get(opId)).toBeUndefined();
  });
});
