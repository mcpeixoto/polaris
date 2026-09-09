/**
 * The rules the relations panel and the row menu now share.
 *
 * Two of them are the kind that fail silently rather than loudly. A `blocks` row written the
 * wrong way round is present, well-formed and says the opposite of what the user asked for; a
 * duplicate that never took the team's Duplicate status is a closed issue sitting open in
 * every list it was in. Both had a test inside the panel's own file and neither had one that
 * survives the move to a shared module — so they have one here.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  Store,
  type Change,
  type Issue,
  type IssueRelation,
  type OptimisticPatch,
  type RelationType,
  type Team,
  type WorkflowState,
} from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { blockedBy, blockedTitle, markIssueAs, NEW_LINK, searchIssues } from './relationLinks';

const WORKSPACE = 'workspace-1';
const ENG = 'team-eng';
const AT = '2026-01-01T00:00:00Z';

function team(): Team {
  return {
    id: ENG,
    workspaceId: WORKSPACE,
    key: 'ENG',
    name: 'Engineering',
    timezone: 'Europe/Lisbon',
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
  };
}

function state(
  id: string,
  name: string,
  category: WorkflowState['category'],
  isSystem = false,
): WorkflowState {
  return {
    id,
    workspaceId: WORKSPACE,
    teamId: ENG,
    name,
    color: '#5e6ad2',
    category,
    position: 'V',
    isDefault: category === 'unstarted',
    isSystem,
    createdAt: AT,
    updatedAt: AT,
  };
}

function issue(id: string, number: number, title: string, stateId = 's-todo'): Issue {
  return {
    id,
    workspaceId: WORKSPACE,
    teamId: ENG,
    number,
    identifier: `ENG-${number}`,
    title,
    description: '',
    stateId,
    priority: 0,
    sortOrder: 'V',
    dueDateSource: 'manual',
    createdAt: AT,
    updatedAt: AT,
  };
}

function relation(id: string, issueId: string, relatedIssueId: string, type: RelationType) {
  return {
    id,
    workspaceId: WORKSPACE,
    issueId,
    relatedIssueId,
    type,
    teamId: ENG,
    relatedTeamId: ENG,
    createdAt: AT,
  } satisfies IssueRelation;
}

function seeded(rows: readonly [string, { id: string }][]): Store {
  const store = new Store(WORKSPACE);
  store.applyChanges(
    rows.map(([type, entity], index) => ({
      v: index + 1,
      type,
      id: entity.id,
      op: 'upsert' as const,
      actor: { type: 'system' as const },
      payload: entity,
    })) as Change[],
  );
  return store;
}

function engineFor(store: Store) {
  const mutate = vi.fn(async (request: { optimistic?: OptimisticPatch }) => {
    const patch = request.optimistic ?? [];
    store.applyOptimistic(patch);
    const created = patch[patch.length - 1]?.after ?? null;
    return { createIssueRelation: { relation: created } };
  });
  return { mutate, engine: { store, mutate } as unknown as SyncEngine };
}

const BASE: [string, { id: string }][] = [
  ['team', team()],
  ['workflowState', state('s-todo', 'Todo', 'unstarted')],
  ['workflowState', state('s-done', 'Done', 'completed')],
  ['issue', issue('issue-1', 1, 'Ship the importer')],
  ['issue', issue('issue-2', 2, 'Fix the flake')],
];

describe('NEW_LINK', () => {
  it('swaps the ids for a blocker, because only `blocks` is stored', () => {
    // "Blocked by" is a `blocks` row read from the other end. Getting this backwards is the
    // one mistake in this module that produces a valid row saying the opposite thing.
    expect(NEW_LINK.blockedBy?.('issue-1', 'issue-2')).toEqual({
      issueId: 'issue-2',
      relatedIssueId: 'issue-1',
      type: 'blocks',
    });
    expect(NEW_LINK.blocking?.('issue-1', 'issue-2')).toEqual({
      issueId: 'issue-1',
      relatedIssueId: 'issue-2',
      type: 'blocks',
    });
  });
});

describe('markIssueAs', () => {
  it('writes the relation and then closes the duplicate, in that order', async () => {
    const store = seeded([
      ...BASE,
      ['workflowState', state('s-dup', 'Duplicate', 'duplicate', true)],
    ]);
    const { engine, mutate } = engineFor(store);

    await markIssueAs(engine, 'issue-1', 'duplicateOf', 'issue-2', null);

    const calls = mutate.mock.calls.map(
      ([request]) => (request as { variables: unknown }).variables,
    );
    expect(calls[0]).toEqual({
      issueId: 'issue-1',
      relatedIssueId: 'issue-2',
      type: 'DUPLICATE',
    });
    expect(calls[1]).toMatchObject({ input: { id: 'issue-1', stateId: 's-dup' } });
  });

  it('still writes the link when the team’s Duplicate status is not in the replica', async () => {
    const { engine, mutate } = engineFor(seeded(BASE));

    await markIssueAs(engine, 'issue-1', 'duplicateOf', 'issue-2', null);

    // The relation is the write that matters and is not gated on a status this client may
    // simply not have received yet.
    expect(mutate).toHaveBeenCalledTimes(1);
  });

  it('writes parenthood as a field rather than as a relation', async () => {
    const { engine, mutate } = engineFor(seeded(BASE));

    await markIssueAs(engine, 'issue-1', 'subIssueOf', 'issue-2', null);
    expect(mutate.mock.calls[0]?.[0]).toMatchObject({
      variables: { input: { id: 'issue-1', parentId: 'issue-2' } },
    });

    // "Parent of" is the same field written from the other end: the *other* issue gets the
    // parent, and it is this one.
    const second = engineFor(seeded(BASE));
    await markIssueAs(second.engine, 'issue-1', 'parentOf', 'issue-2', null);
    expect(second.mutate.mock.calls[0]?.[0]).toMatchObject({
      variables: { input: { id: 'issue-2', parentId: 'issue-1' } },
    });
  });

  it('refuses to link an issue to itself', async () => {
    const { engine, mutate } = engineFor(seeded(BASE));

    await markIssueAs(engine, 'issue-1', 'related', 'issue-1', null);

    expect(mutate).not.toHaveBeenCalled();
  });
});

describe('blockedBy', () => {
  it('names the blockers that are still in the way', () => {
    const store = seeded([
      ...BASE,
      ['issueRelation', relation('rel-1', 'issue-2', 'issue-1', 'blocks')],
    ]);

    expect(blockedBy(store, 'issue-1')).toEqual(['ENG-2']);
    // The blocker itself is not blocked: a `blocks` row read from the other end is "blocking".
    expect(blockedBy(store, 'issue-2')).toEqual([]);
  });

  it('drops a blocker that has been finished', () => {
    // 03-issue-properties.md: once the blocker resolves the pair moves under Related. A flag
    // that outlived its blocker is a flag people learn to ignore.
    const store = seeded([
      ...BASE,
      ['issue', issue('issue-3', 3, 'Land the migration', 's-done')],
      ['issueRelation', relation('rel-1', 'issue-3', 'issue-1', 'blocks')],
    ]);

    expect(blockedBy(store, 'issue-1')).toEqual([]);
  });

  it('ignores a related row, which says nothing about being stuck', () => {
    const store = seeded([
      ...BASE,
      ['issueRelation', relation('rel-1', 'issue-2', 'issue-1', 'related')],
    ]);

    expect(blockedBy(store, 'issue-1')).toEqual([]);
  });
});

describe('blockedTitle', () => {
  it('names the blockers rather than counting them', () => {
    expect(blockedTitle(['ENG-2'])).toBe('Blocked by ENG-2');
    expect(blockedTitle(['ENG-2', 'ENG-9'])).toBe('Blocked by ENG-2, ENG-9');
  });
});

describe('searchIssues', () => {
  it('finds by identifier and leaves out what is already linked', () => {
    const store = seeded([
      ...BASE,
      ['issueRelation', relation('rel-1', 'issue-1', 'issue-2', 'related')],
    ]);

    expect(searchIssues(store, 'issue-1', 'ENG-2')).toEqual([]);
    // And nothing at all until something is typed: an arbitrary eight issues under an empty
    // box reads as a suggestion the product is not in a position to make.
    expect(searchIssues(store, 'issue-1', '   ')).toEqual([]);
  });

  it('carries the candidate’s status, so a menu row can draw its ring', () => {
    const store = seeded(BASE);

    expect(searchIssues(store, 'issue-1', 'ENG-2')).toEqual([
      {
        id: 'issue-2',
        identifier: 'ENG-2',
        title: 'Fix the flake',
        category: 'unstarted',
        color: '#5e6ad2',
      },
    ]);
  });
});
