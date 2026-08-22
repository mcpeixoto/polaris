/**
 * Adding a link card, and the pairing of the stand-in with the server's row.
 *
 * The interesting case is not the happy one. An attachment's id is the server's, so the
 * client shows a stand-in under an id it invented and swaps it when the response names the
 * real one. That swap has to be reachable from somewhere other than the call that sent the
 * mutation, because the call is not always there when the answer arrives: the user opens
 * another issue, or the request takes a 429 and goes to the outbox. The stand-in is
 * persisted like every other write, so it survives that; the real row then arrives on the
 * delta stream beside it, and the panel shows one link as two cards for good.
 *
 * So these tests pin the declaration rather than the await — `reconcile`, which
 * `SyncEngine.settle` runs from the outbox as well as from `mutate`.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  Outbox,
  Store,
  type Attachment,
  type Change,
  type Issue,
  type Reconciliation,
  type Team,
} from '~/store';
import type { SyncEngine } from '~/sync/engine';
import { adopt, settle } from '~/sync/reconcile';

import { createAttachment } from './mutations';

const WORKSPACE = '01900000-0000-7000-8000-000000000001';
const TEAM = '01900000-0000-7000-8000-000000000002';
const ISSUE = '01900000-0000-7000-8000-000000000003';
const SERVER_ID = '01900000-0000-7000-8000-000000000004';
const AT = '2026-01-01T00:00:00.000Z';
const URL = 'https://github.com/acme/app/pull/4';

let store: Store;
let mutate: ReturnType<typeof vi.fn>;
let engine: SyncEngine;

function seeded(): Store {
  const created = new Store(WORKSPACE);
  const team = {
    id: TEAM,
    workspaceId: WORKSPACE,
    key: 'ENG',
    name: 'Engineering',
    timezone: 'UTC',
    private: false,
    estimateScale: 'none',
    estimateAllowZero: false,
    estimateExtended: false,
    cyclesEnabled: false,
    cycleDurationWeeks: 1,
    cycleCooldownWeeks: 0,
    cycleStartDay: 'monday',
    cycleUpcomingCount: 2,
    cycleAutoAddStarted: false,
    cycleAutoAddCompleted: false,
    triageEnabled: false,
    triageRequirePriority: false,
    autoCloseDays: 0,
    autoArchiveDays: 0,
    autoCloseParent: false,
    autoCloseChildren: false,
    createdAt: AT,
    updatedAt: AT,
  } satisfies Team;
  const issue = {
    id: ISSUE,
    workspaceId: WORKSPACE,
    teamId: TEAM,
    number: 1,
    identifier: 'ENG-1',
    title: 'Broken importer',
    description: '',
    stateId: '01900000-0000-7000-8000-00000000000a',
    priority: 0,
    sortOrder: 'a0',
    dueDateSource: 'manual',
    createdAt: AT,
    updatedAt: AT,
  } satisfies Issue;
  created.applyChanges([
    { v: 1, type: 'team', id: TEAM, op: 'upsert', actor: { type: 'system' }, payload: team },
    { v: 2, type: 'issue', id: ISSUE, op: 'upsert', actor: { type: 'system' }, payload: issue },
  ] as Change[]);
  return created;
}

/** The row the server would mint for the same URL, under an id only it could choose. */
const serverRow: Attachment = {
  id: SERVER_ID,
  workspaceId: WORKSPACE,
  issueId: ISSUE,
  teamId: TEAM,
  url: URL,
  title: 'PR 4',
  createdAt: AT,
  updatedAt: AT,
};

/** The stand-in as `createAttachment` builds it, for the outbox record `adopt` reads. */
function standIn(): Attachment {
  const patch = mutate.mock.calls[0]?.[0] as { optimistic: { after: Attachment }[] };
  return patch.optimistic[0]!.after;
}

function cardsOnIssue(): Attachment[] {
  return [...store.attachmentIdsFor(ISSUE)]
    .map((id) => store.get('attachment', id))
    .filter((row): row is Attachment => row !== undefined);
}

beforeEach(() => {
  store = seeded();
  mutate = vi.fn(async (input: { optimistic?: Parameters<Store['applyOptimistic']>[0] }) => {
    if (input.optimistic !== undefined) store.applyOptimistic(input.optimistic);
    return { createAttachment: { attachment: serverRow } };
  });
  engine = { store, mutate } as unknown as SyncEngine;
});

describe('createAttachment', () => {
  it('shows the card in the frame of the click', async () => {
    await createAttachment(engine, { issueId: ISSUE, url: URL, title: 'PR 4' });

    const cards = cardsOnIssue();
    expect(cards).toHaveLength(1);
    expect(cards[0]?.url).toBe(URL);
  });

  it('declares the pairing rather than doing it after the await', async () => {
    await createAttachment(engine, { issueId: ISSUE, url: URL, title: 'PR 4' });

    const sent = mutate.mock.calls[0]?.[0] as {
      optimistic: { id: string }[];
      reconcile?: Reconciliation;
    };
    expect(sent.reconcile).toEqual({
      type: 'attachment',
      provisionalId: sent.optimistic[0]?.id,
      path: ['createAttachment', 'attachment'],
      match: ['issueId', 'url'],
    });
  });

  it('leaves one card when the response is paired from the outbox', async () => {
    // Nothing after the `await` in `createAttachment` gets to run in this story: the reply
    // came back to a page that had moved on, and the outbox settled it instead.
    await createAttachment(engine, { issueId: ISSUE, url: URL, title: 'PR 4' });
    const spec = (mutate.mock.calls[0]?.[0] as { reconcile: Reconciliation }).reconcile;

    settle(store, spec, { createAttachment: { attachment: serverRow } });

    const cards = cardsOnIssue();
    expect(cards).toHaveLength(1);
    expect(cards[0]?.id).toBe(SERVER_ID);
  });

  it('leaves one card when the delta beat the response', async () => {
    // The sync stream routinely carries the real row before the mutation's own answer gets
    // back, and `adopt` is what stops that second row being a second card. The pairing is
    // made on issue and URL, which is the pair the server itself holds unique.
    await createAttachment(engine, { issueId: ISSUE, url: URL, title: 'PR 4' });
    const spec = (mutate.mock.calls[0]?.[0] as { reconcile: Reconciliation }).reconcile;
    const outbox = new Outbox();
    await outbox.append({
      mutation: 'CreateAttachment',
      variables: {},
      optimisticPatch: [
        { type: 'attachment', id: spec.provisionalId, before: null, after: standIn() },
      ],
      reconcile: spec,
    });

    const changes = [
      {
        v: 3,
        type: 'attachment',
        id: SERVER_ID,
        op: 'upsert',
        actor: { type: 'system' },
        payload: serverRow,
      },
    ] as Change[];
    store.applyChanges(changes);
    adopt(store, outbox, changes as never);

    const cards = cardsOnIssue();
    expect(cards).toHaveLength(1);
    expect(cards[0]?.id).toBe(SERVER_ID);
  });
});
