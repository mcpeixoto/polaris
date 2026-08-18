/**
 * The performance budget, as a test.
 *
 * This product's entire differentiator is that it is fast, and a differentiator that is
 * not measured in CI is one you discover you have lost from a user report six weeks after
 * the commit that lost it. The budgets come from
 * docs/07-milestones/00-milestone-0.md — acceptance tests 13 and 14.
 *
 * These run in jsdom on whatever CI box is free, so the assertions carry deliberate
 * headroom over the real budget. They are regression detectors, not benchmarks: a 3x
 * regression fails, a 10% drift does not.
 */

import { describe, expect, it } from 'vitest';

import { Store } from './store';
import type { EntityRow } from './db';
import type { Issue, IssueLabel, Label, Team, User, WorkflowState, Workspace } from './types';

const WORKSPACE = 'w-perf';
const TEAMS = 3;
const STATES_PER_TEAM = 5;
const USERS = 12;
const ISSUES = 5000;
/** Twenty labels, up to three per issue: a real workspace's shape, and ~14,000 `issueLabel` rows. */
const LABELS = 20;

/**
 * The budget the product publishes, and the one this test asserts against.
 *
 * Two numbers rather than one, because they answer different questions and collapsing them
 * loses the answer to both. PRODUCT_FILTER_BUDGET_MS is the promise — 50ms, in M0 acceptance
 * test 13 and again in M1 acceptance test 6 — and FILTER_BUDGET_MS is what a shared CI box
 * can be held to without failing for reasons that have nothing to do with this code.
 *
 * The gap between them used to be silent, and silence was the problem: a run at 249ms passed
 * while being five times the published budget, and nothing in the output would have said so.
 * Measuring it settled the question — the median is 0.3ms with four active clauses over
 * 5,000 issues — so the filter test now asserts the PRODUCT budget with a hundred-fold
 * margin and no flake risk, and the CI allowance is kept only for the queries below that
 * genuinely do more work per run.
 *
 * The median is logged on every run either way, because a number that is only checked
 * against a threshold is a number nobody watches drift.
 */
const PRODUCT_FILTER_BUDGET_MS = 50;
const FILTER_BUDGET_MS = 250;
/** The M0 budget is one 16ms frame; 80 is the same trade. */
const MUTATION_BUDGET_MS = 80;
/**
 * Resolving every visible row's labels is part of one render, not a budget of its own, so
 * it is held to the whole 50ms filter budget with no CI allowance on top. It measures far
 * below that — a map probe per row — and the point of asserting the un-inflated number is
 * that the day this becomes a scan it fails here rather than in a report about scrolling.
 */
const LABEL_LOOKUP_BUDGET_MS = 50;

function buildRows(): {
  rows: EntityRow[];
  teamIds: string[];
  stateIds: string[];
  userIds: string[];
  labelIds: string[];
} {
  const now = new Date().toISOString();
  const rows: EntityRow[] = [];

  const workspace: Workspace = {
    id: WORKSPACE,
    name: 'Perf',
    urlKey: 'perf',
    plan: 'free',
    createdAt: now,
    updatedAt: now,
  };
  rows.push({ type: 'workspace', entity: workspace });

  const userIds: string[] = [];
  for (let i = 0; i < USERS; i++) {
    const id = `u${i}`;
    userIds.push(id);
    const user: User = {
      id,
      workspaceId: WORKSPACE,
      name: `User ${i}`,
      displayName: `user${i}`,
      timezone: 'UTC',
      role: 'member',
      status: 'active',
      kind: 'human',
      createdAt: now,
      updatedAt: now,
    };
    rows.push({ type: 'user', entity: user });
  }

  const teamIds: string[] = [];
  const stateIds: string[] = [];
  const categories = ['backlog', 'unstarted', 'started', 'completed', 'canceled'] as const;

  for (let t = 0; t < TEAMS; t++) {
    const teamId = `t${t}`;
    teamIds.push(teamId);
    const team: Team = {
      id: teamId,
      workspaceId: WORKSPACE,
      key: `T${t}`,
      name: `Team ${t}`,
      timezone: 'UTC',
      private: false,
      estimateScale: 'fibonacci',
      estimateAllowZero: false,
      estimateExtended: false,
      createdAt: now,
      updatedAt: now,
    };
    rows.push({ type: 'team', entity: team });

    for (let s = 0; s < STATES_PER_TEAM; s++) {
      const stateId = `t${t}s${s}`;
      stateIds.push(stateId);
      const state: WorkflowState = {
        id: stateId,
        workspaceId: WORKSPACE,
        teamId,
        name: categories[s]!,
        color: '#888888',
        category: categories[s]!,
        position: `a${s}`,
        isDefault: s === 0,
        isSystem: false,
        createdAt: now,
        updatedAt: now,
      };
      rows.push({ type: 'workflowState', entity: state });
    }
  }

  const labelIds: string[] = [];
  for (let l = 0; l < LABELS; l++) {
    const id = `l${l}`;
    labelIds.push(id);
    const label: Label = {
      id,
      workspaceId: WORKSPACE,
      isGroup: false,
      name: `label-${l}`,
      color: '#4488cc',
      position: `a${String(l).padStart(3, '0')}`,
      createdAt: now,
      updatedAt: now,
    };
    rows.push({ type: 'label', entity: label });
  }

  for (let i = 0; i < ISSUES; i++) {
    const t = i % TEAMS;
    const s = i % STATES_PER_TEAM;
    const issue: Issue = {
      id: `i${i}`,
      workspaceId: WORKSPACE,
      teamId: `t${t}`,
      number: i + 1,
      identifier: `T${t}-${i + 1}`,
      title: `Issue ${i} about ${i % 7 === 0 ? 'authentication' : 'rendering'}`,
      description: '',
      stateId: `t${t}s${s}`,
      // Two thirds assigned, matching a real backlog. An all-assigned or all-unassigned
      // corpus hides grouping cost.
      assigneeId: i % 3 === 0 ? undefined : userIds[i % USERS],
      priority: i % 5,
      sortOrder: `a${String(i).padStart(6, '0')}`,
      dueDateSource: 'manual',
      createdAt: now,
      updatedAt: now,
    };
    rows.push({ type: 'issue', entity: issue });

    // Three labels each, spread by coprime strides so no two issues share a label set and
    // no label ends up on everything — an even spread would make the postings uniformly
    // sized and hide the cost of the selective case.
    const applied = new Set<number>([i % LABELS, (i * 7) % LABELS, (i * 13) % LABELS]);
    for (const l of applied) {
      const labelId = `l${l}`;
      const row: IssueLabel = {
        id: `il-${i}-${l}`,
        workspaceId: WORKSPACE,
        issueId: `i${i}`,
        labelId,
        teamId: `t${t}`,
        createdAt: now,
      };
      rows.push({ type: 'issueLabel', entity: row });
    }
  }

  return { rows, teamIds, stateIds, userIds, labelIds };
}

async function seededStore(): Promise<{
  store: Store;
  teamIds: string[];
  stateIds: string[];
  userIds: string[];
  labelIds: string[];
}> {
  const { rows, teamIds, stateIds, userIds, labelIds } = buildRows();
  // No db: this measures the in-memory read path, which is the one on the hot path. The
  // durable write is asynchronous by design and is covered by db.test.ts.
  const store = new Store(WORKSPACE);
  await store.beginBootstrap();
  store.ingestBootstrapPage(rows);
  await store.finishBootstrap(1);
  return { store, teamIds, stateIds, userIds, labelIds };
}

/** Median of several runs: a single timing on a shared CI box is mostly noise. */
function medianMs(runs: number, fn: () => void): number {
  const samples: number[] = [];
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    fn();
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length / 2)]!;
}

describe('store performance', () => {
  it(`filters, groups and sorts ${ISSUES} issues within the frame budget`, async () => {
    const { store, teamIds, userIds, stateIds } = await seededStore();

    const elapsed = medianMs(20, () => {
      // Four active clauses, because that is the number the criterion names
      // (docs/07-milestones/01-milestone-1.md acceptance test 6) and two would be a
      // measurement of something easier than the thing promised.
      const result = store.query({
        filter: {
          teamIds: [teamIds[0]!],
          assigneeIds: [userIds[1]!, null],
          stateIds: [stateIds[0]!, stateIds[1]!],
          priorities: [1, 2],
        },
        groupBy: 'state',
        sortBy: 'priority',
      });
      // Touch the answer so a clever engine cannot optimise the whole call away.
      if (result.ids.length < 0) throw new Error('unreachable');
    });

    console.log(`[perf] filter+group+sort median over ${ISSUES} issues: ${elapsed.toFixed(1)}ms`);
    expect(
      elapsed,
      `filter+group+sort over ${ISSUES} issues took ${elapsed.toFixed(1)}ms. ` +
        `The product budget is ${PRODUCT_FILTER_BUDGET_MS}ms ` +
        `(docs/07-milestones/00-milestone-0.md acceptance test 13, and ` +
        `docs/07-milestones/01-milestone-1.md acceptance test 6); ` +
        `this test allows ${FILTER_BUDGET_MS}ms to tolerate a loaded CI box. ` +
        `Exceeding it means a list is now scanning entities instead of using the indexes.`,
    ).toBeLessThan(PRODUCT_FILTER_BUDGET_MS);
  });

  it('runs an unfiltered grouped query within the frame budget', async () => {
    const { store } = await seededStore();

    const elapsed = medianMs(20, () => {
      store.query({ groupBy: 'state', sortBy: 'sortOrder' });
    });

    expect(
      elapsed,
      `an unfiltered grouped query over ${ISSUES} issues took ${elapsed.toFixed(1)}ms, ` +
        `budget ${FILTER_BUDGET_MS}ms`,
    ).toBeLessThan(FILTER_BUDGET_MS);
  });

  it('searches titles within the frame budget', async () => {
    const { store } = await seededStore();

    const elapsed = medianMs(20, () => {
      store.query({ filter: { text: 'authentication' } });
    });

    expect(
      elapsed,
      `title search over ${ISSUES} issues took ${elapsed.toFixed(1)}ms. ` +
        `In-view find runs on every keystroke, so this is the budget the trigram index exists to meet.`,
    ).toBeLessThan(FILTER_BUDGET_MS);
  });

  it(`resolves the labels of all ${ISSUES} issues inside one render`, async () => {
    const { store } = await seededStore();
    const ids = store.query({ sortBy: 'sortOrder' }).ids;
    expect(ids).toHaveLength(ISSUES);

    const elapsed = medianMs(20, () => {
      // What a virtualised list does per frame, except for every row rather than the
      // thirty on screen: the whole point of the index is that the answer is a set that
      // already exists, so drawing the labels never becomes a reason to paginate.
      let seen = 0;
      for (const id of ids) seen += store.labelIdsFor(id).size;
      if (seen === 0) throw new Error('the fixture applied no labels');
    });

    expect(
      elapsed,
      `resolving labels for ${ISSUES} issues took ${elapsed.toFixed(1)}ms against the ` +
        `${LABEL_LOOKUP_BUDGET_MS}ms filter budget (docs/07-milestones/01-milestone-1.md, ` +
        `acceptance test 6). Exceeding it means labels-by-issue is being derived per row ` +
        `instead of read from the index.`,
    ).toBeLessThan(LABEL_LOOKUP_BUDGET_MS);
  });

  it('filters by label out of the postings rather than by scanning', async () => {
    const { store, labelIds } = await seededStore();

    const elapsed = medianMs(20, () => {
      const result = store.query({
        filter: { labelIds: [labelIds[3]!, labelIds[11]!], teamIds: ['t0'] },
        groupBy: 'state',
        sortBy: 'priority',
      });
      if (result.ids.length === 0) throw new Error('the fixture matched no issues');
    });

    expect(
      elapsed,
      `a label-filtered grouped query over ${ISSUES} issues took ${elapsed.toFixed(1)}ms, ` +
        `budget ${FILTER_BUDGET_MS}ms`,
    ).toBeLessThan(FILTER_BUDGET_MS);
  });

  it('applies a single change without re-indexing the workspace', async () => {
    const { store, stateIds } = await seededStore();

    // Acceptance test 14: a keystroke must render inside one frame. Incremental index
    // maintenance is what makes that possible — a full rebuild per change would be
    // O(issues) and would show up here as a hundredfold regression.
    let version = 1;
    const elapsed = medianMs(50, () => {
      version++;
      const existing = store.get('issue', 'i42')!;
      store.applyChanges([
        {
          v: version,
          type: 'issue',
          id: 'i42',
          op: 'upsert',
          actor: { type: 'user', id: 'u1' },
          payload: {
            ...existing,
            stateId: stateIds[(version % STATES_PER_TEAM) + 0]!,
            updatedAt: new Date().toISOString(),
          },
        },
      ]);
    });

    expect(
      elapsed,
      `applying one change to a ${ISSUES}-issue store took ${elapsed.toFixed(1)}ms. ` +
        `The budget is one 16ms frame (acceptance test 14); this test allows ${MUTATION_BUDGET_MS}ms. ` +
        `Exceeding it means index maintenance stopped being incremental.`,
    ).toBeLessThan(MUTATION_BUDGET_MS);
  });

  it('notifies a subscriber once per batch, not once per change', async () => {
    const { store, teamIds } = await seededStore();

    let notifications = 0;
    const stop = store.subscribe({
      select: (s) => s.query({ filter: { teamIds: [teamIds[0]!] } }).ids.length,
      onChange: () => {
        notifications++;
      },
      deps: ['issue'],
    });

    const now = new Date().toISOString();
    store.applyChanges(
      Array.from({ length: 50 }, (_, i) => ({
        v: 100 + i,
        type: 'issue' as const,
        id: `new-${i}`,
        op: 'upsert' as const,
        actor: { type: 'user', id: 'u1' },
        payload: {
          id: `new-${i}`,
          workspaceId: WORKSPACE,
          teamId: teamIds[0]!,
          number: 90000 + i,
          identifier: `T0-${90000 + i}`,
          title: `Batched ${i}`,
          description: '',
          stateId: 't0s0',
          priority: 0,
          sortOrder: `z${i}`,
          dueDateSource: 'manual' as const,
          createdAt: now,
          updatedAt: now,
        },
      })),
    );
    stop();

    // Fifty deltas arriving in one frame is the normal case when a teammate runs a bulk
    // action. Fifty re-renders of a virtualised list is a visible stall.
    expect(
      notifications,
      `a 50-change batch produced ${notifications} notifications; it must produce exactly one`,
    ).toBe(1);
  });
});
