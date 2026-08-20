import { act, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { validateFilter, type FilterNode } from '~/filter';
import {
  Store,
  type EntityRow,
  type Issue,
  type IssueLabel,
  type Label,
  type Team,
  type User,
  type WorkflowState,
  type Workspace,
} from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { useView } from './useView';

/**
 * Acceptance test 6 in docs/07-milestones/01-milestone-1.md:
 *
 *     Filter with four active clauses re-renders in < 50 ms.
 *
 * Two tests already measure halves of this and neither measures the claim.
 * `filter/evaluate.test.ts` runs the four-clause shape over 5,000 issues against the real
 * 50 ms budget — but it calls `filterIssues` on a plain array, so it measures a compiled
 * predicate and nothing else: no store, no grouping, no ordering, no render.
 * `store/perf.test.ts` has the seeded 5,000-issue Store — but its filters carry at most TWO
 * clauses, it exercises `store.query`, which the view pipeline does not use for filtering at
 * all, and it asserts a 250 ms budget, five times the product's own. So the four clauses and
 * the seeded workspace have never been in the same test, and the word "re-renders" has never
 * been measured by anything.
 *
 * This measures a re-render: a mounted component that calls `useView`, given a new
 * four-clause filter, timed from the call that changes it to the render that reflects it.
 * That is filter, display options, grouping, ordering and React's own reconciliation — every
 * cost between a keystroke and the list, which is what the 50 ms is a budget for.
 *
 * The budget is asserted un-inflated. That is a deliberate departure from `store/perf.test.ts`,
 * which allows 250 ms for a loaded CI box, and it is affordable for the same reason
 * `evaluate.test.ts` can do it: the work measures well under a millisecond, so there are two
 * orders of magnitude of headroom before a busy machine could reach the line, and the
 * regression that matters — a debounce removed, an index abandoned, the AST interpreted per
 * row — costs far more than that. A budget of 250 ms against a real cost of 0.5 ms is not a
 * budget; it is a number that cannot fail.
 */

/**
 * Ids are real UUIDs because the grammar insists: `validateFilter` rejects a `team` or
 * `label` value that is not one, so the short ids `store/perf.test.ts` uses cannot appear in
 * a filter AST at all. Generated rather than written out, since there are five thousand.
 */
function uuid(kind: number, n: number): string {
  return `0000000${kind}-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
}

const WORKSPACE = uuid(0, 1);
const teamId = (t: number) => uuid(1, t);
const stateId = (t: number, s: number) => uuid(2, t * 100 + s);
const userId = (u: number) => uuid(3, u);
const labelId = (l: number) => uuid(4, l);
const issueId = (i: number) => uuid(5, i);
const ISSUES = 5000;
const TEAMS = 3;
const STATES_PER_TEAM = 5;
const USERS = 12;
const LABELS = 20;

/** The product's own budget, from the milestone. Not padded — see the note above. */
const RENDER_BUDGET_MS = 50;

const AT = '2026-01-01T00:00:00Z';
const CATEGORIES = ['backlog', 'unstarted', 'started', 'completed', 'canceled'] as const;

/**
 * The same corpus shape `store/perf.test.ts` seeds, for the same reasons recorded there:
 * two thirds of issues assigned, three labels each spread by coprime strides so no label
 * lands on everything and the postings are unevenly sized.
 */
function buildRows(): EntityRow[] {
  const rows: EntityRow[] = [];

  const workspace: Workspace = {
    id: WORKSPACE,
    name: 'View perf',
    urlKey: 'view-perf',
    plan: 'free',
    projectUpdateReminderIntervalDays: 7,
    projectUpdateReminderWeekday: 3,
    projectUpdateReminderHour: 9,
    pulseEnabled: true,
    pulseDigestCadence: 'daily',
    createdAt: AT,
    updatedAt: AT,
  };
  rows.push({ type: 'workspace', entity: workspace });

  for (let i = 0; i < USERS; i++) {
    const user: User = {
      id: userId(i),
      workspaceId: WORKSPACE,
      name: `User ${i}`,
      displayName: `user${i}`,
      timezone: 'UTC',
      role: 'member',
      status: 'active',
      kind: 'human',
      createdAt: AT,
      updatedAt: AT,
    };
    rows.push({ type: 'user', entity: user });
  }

  for (let t = 0; t < TEAMS; t++) {
    const team: Team = {
      id: teamId(t),
      workspaceId: WORKSPACE,
      key: `T${t}`,
      name: `Team ${t}`,
      timezone: 'UTC',
      private: false,
      estimateScale: 'fibonacci',
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
    rows.push({ type: 'team', entity: team });

    for (let s = 0; s < STATES_PER_TEAM; s++) {
      const workflowState: WorkflowState = {
        id: stateId(t, s),
        workspaceId: WORKSPACE,
        teamId: teamId(t),
        name: CATEGORIES[s]!,
        color: '#888888',
        category: CATEGORIES[s]!,
        position: `a${s}`,
        isDefault: s === 0,
        isSystem: false,
        createdAt: AT,
        updatedAt: AT,
      };
      rows.push({ type: 'workflowState', entity: workflowState });
    }
  }

  for (let l = 0; l < LABELS; l++) {
    const label: Label = {
      id: labelId(l),
      workspaceId: WORKSPACE,
      isGroup: false,
      name: `label-${l}`,
      color: '#4488cc',
      position: `a${String(l).padStart(3, '0')}`,
      createdAt: AT,
      updatedAt: AT,
    };
    rows.push({ type: 'label', entity: label });
  }

  for (let i = 0; i < ISSUES; i++) {
    const t = i % TEAMS;
    const s = i % STATES_PER_TEAM;
    const issue: Issue = {
      id: issueId(i),
      workspaceId: WORKSPACE,
      teamId: teamId(t),
      number: i + 1,
      identifier: `T${t}-${i + 1}`,
      title: `Issue ${i} about ${i % 7 === 0 ? 'authentication' : 'rendering'}`,
      description: '',
      stateId: stateId(t, s),
      assigneeId: i % 3 === 0 ? undefined : userId(i % USERS),
      priority: i % 5,
      sortOrder: `a${String(i).padStart(6, '0')}`,
      dueDateSource: 'manual',
      createdAt: AT,
      updatedAt: AT,
    };
    rows.push({ type: 'issue', entity: issue });

    for (const l of new Set<number>([i % LABELS, (i * 7) % LABELS, (i * 13) % LABELS])) {
      const applied: IssueLabel = {
        id: uuid(6, i * 100 + l),
        workspaceId: WORKSPACE,
        issueId: issueId(i),
        labelId: labelId(l),
        teamId: teamId(t),
        createdAt: AT,
      };
      rows.push({ type: 'issueLabel', entity: applied });
    }
  }

  return rows;
}

async function seededStore(): Promise<Store> {
  // No db: this measures the in-memory read path, which is the one on the hot path.
  const store = new Store(WORKSPACE);
  await store.beginBootstrap();
  store.ingestBootstrapPage(buildRows());
  await store.finishBootstrap(1);
  return store;
}

/**
 * Four clauses, ordered broadest first so that as much of the corpus as possible pays for
 * as many of them as possible.
 *
 * This is worth being precise about, because a four-clause filter can easily measure like a
 * one-clause filter and report a number that means nothing. `filterIssues` is a linear scan
 * with an ANDed predicate, so a row that fails the first clause never reaches the other
 * three. Put the narrowest clause first and 5,000 rows pay one comparison each; the test
 * still says "four clauses" and has measured almost none of them.
 *
 * With this ordering the arithmetic is: all 5,000 rows evaluate the priority clause, about
 * 4,000 reach the state clause, about 1,600 reach the team clause and about 530 reach the
 * label clause — roughly 11,000 clause evaluations against a theoretical maximum of 20,000.
 * That is the honest shape of a real filter rather than a contrived one: a filter that
 * narrows is the only kind anybody builds, and short-circuiting is a property of the
 * evaluator under test rather than a flaw in the measurement. What the ordering rules out is
 * the accident of measuring a quarter of the work and calling it four clauses.
 */
function fourClauseFilter(states: readonly string[], labels: readonly string[]): FilterNode {
  return validateFilter({
    conj: 'and',
    nodes: [
      { field: 'priority', op: 'notIn', values: ['0'] },
      { field: 'stateCategory', op: 'in', values: ['unstarted', 'started'] },
      { field: 'team', op: 'eq', values: [teamId(0)] },
      { field: 'label', op: 'in', values: [...labels] },
    ],
  }) as FilterNode;
}

/**
 * A probe that renders the view's size and nothing else.
 *
 * Rendering five thousand rows would measure jsdom's DOM construction, which no user pays:
 * the list is virtualised and draws about thirty. What every keystroke does pay in full is
 * the recompute behind `useView` plus React's reconciliation of the component that holds it,
 * and that is what this renders.
 */
function Probe({ onView }: { onView: (setFilter: (next: FilterNode) => void) => void }) {
  const view = useView({
    issues: (store) => store.issues.values(),
    timezone: 'UTC',
    // The clock is pinned so a relative clause could not make one run differ from another.
    now: Date.parse(AT),
  });
  onView(view.setFilter);
  return <output data-testid="count">{view.count}</output>;
}

describe('view performance', () => {
  /**
   * Only this level can prove acceptance test 6. `filterIssues` measured alone cannot,
   * because grouping and ordering are half the pipeline and are where an O(n log n) sort
   * over a badly chosen key would show up; a store benchmark cannot, because the view does
   * not filter through `store.query`. The re-render is the unit the budget is stated in and
   * this is the only place it exists.
   */
  it(`re-renders a four-clause filter over ${ISSUES} issues inside the frame budget`, async () => {
    const store = await seededStore();
    const engine = { store, mutate: async () => ({}) } as unknown as SyncEngine;

    let setFilter: ((next: FilterNode) => void) | undefined;
    render(
      <MemoryRouter>
        <KeymapProvider>
          <EngineProvider engine={engine} status={{ phase: 'idle' }}>
            <Probe
              onView={(fn) => {
                setFilter = fn;
              }}
            />
          </EngineProvider>
        </KeymapProvider>
      </MemoryRouter>,
    );

    const states = [stateId(0, 1), stateId(0, 2)];
    // Two different four-clause filters, so consecutive samples ask different questions and
    // nothing downstream can answer from a cache keyed on the filter it saw last.
    const filters = [
      fourClauseFilter(states, [labelId(3), labelId(11)]),
      fourClauseFilter(states, [labelId(5), labelId(13)]),
    ];

    // One untimed pass. The first render compiles the predicate, warms React's fibers and
    // pays for the module's first-touch costs, none of which a keystroke in a running app
    // pays again.
    for (const filter of filters) {
      act(() => {
        setFilter!(filter);
      });
    }

    const samples: number[] = [];
    for (let i = 0; i < 20; i++) {
      const filter = filters[i % filters.length]!;
      const start = performance.now();
      act(() => {
        setFilter!(filter);
      });
      samples.push(performance.now() - start);
    }
    samples.sort((a, b) => a - b);
    const median = samples[Math.floor(samples.length / 2)]!;

    // The filter has to have done something. A four-clause filter that matched everything,
    // or nothing, would be a fast filter that measured the wrong thing entirely.
    const matched = Number(document.querySelector('[data-testid="count"]')!.textContent);
    expect(matched, 'the four-clause filter matched nothing; the corpus is wrong').toBeGreaterThan(
      0,
    );
    expect(matched, 'the four-clause filter matched everything; it is not narrowing').toBeLessThan(
      ISSUES,
    );

    expect(
      median,
      `re-rendering a four-clause filter over ${ISSUES} issues took ${median.toFixed(1)}ms ` +
        `against the product's own ${RENDER_BUDGET_MS}ms budget ` +
        `(docs/07-milestones/01-milestone-1.md, acceptance test 6), matching ${matched} issues. ` +
        `This is the whole path a keystroke pays — filter, display options, grouping, ordering ` +
        `and React's reconciliation — and there is no debouncing in front of it by design, so ` +
        `exceeding this is a list that lags the character that caused it.`,
    ).toBeLessThan(RENDER_BUDGET_MS);
  });
});
