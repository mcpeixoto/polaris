import { describe, expect, it } from 'vitest';

import type { Issue, StateCategory, UUID, WorkflowState } from '~/store/types';

import { compileFilter, filterIssues, type FilterContext } from './evaluate';
import type { FilterNode } from './types';
import { validateFilter } from './validate';

const NOW = '2026-08-15T12:00:00Z';
const CLOCK = Date.parse(NOW);

const id = (suffix: string): UUID => `01900000-0000-7000-8000-${suffix.padStart(12, '0')}`;

const ADA = id('a1');
const GRACE = id('a2');
const TODO = id('c1');
const DONE = id('c3');
const BUG = id('d3');
const CHORE = id('d4');

function issue(name: string, over: Partial<Issue> = {}): Issue {
  return {
    id: id(name),
    workspaceId: id('1'),
    teamId: id('b1'),
    number: 1,
    identifier: 'ENG-1',
    title: 'Fix the login redirect',
    description: '',
    stateId: TODO,
    priority: 0,
    sortOrder: 'a0',
    dueDateSource: 'manual',
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

function state(stateId: UUID, category: StateCategory): WorkflowState {
  return {
    id: stateId,
    workspaceId: id('1'),
    teamId: id('b1'),
    name: category,
    color: '#888888',
    category,
    position: 'a0',
    isDefault: false,
    isSystem: false,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function context(over: Partial<FilterContext> = {}): FilterContext {
  return {
    time: { now: CLOCK, timezone: 'Europe/Lisbon' },
    states: new Map([
      [TODO, state(TODO, 'unstarted')],
      [DONE, state(DONE, 'completed')],
    ]),
    labels: new Map(),
    subscribers: new Map(),
    blockedBy: new Map(),
    blocking: new Map(),
    ...over,
  };
}

/** Validate then compile, which is the only supported order and the one every caller uses. */
function matching(
  filter: unknown,
  issues: readonly Issue[],
  over: Partial<FilterContext> = {},
): string[] {
  return filterIssues(issues, validateFilter(filter), context(over)).sort();
}

describe('compileFilter', () => {
  it('includes the rows with no value in neq, for every nullable field', () => {
    // SQL's three-valued logic drops them, and the person who asked for "everything not
    // assigned to Ada" does not get the unassigned ones — the opposite of what the words
    // mean. Each nullable field is listed because each is a separate branch.
    const issues = [
      issue('e1', { assigneeId: ADA, estimate: 3, parentId: id('e9'), dueDate: '2026-09-01' }),
      issue('e2'),
    ];

    expect(matching({ field: 'assignee', op: 'neq', values: [ADA] }, issues)).toEqual([id('e2')]);
    expect(matching({ field: 'estimate', op: 'neq', values: ['3'] }, issues)).toEqual([id('e2')]);
    expect(matching({ field: 'parent', op: 'neq', values: [id('e9')] }, issues)).toEqual([
      id('e2'),
    ]);
    expect(matching({ field: 'dueDate', op: 'neq', values: ['2026-09-01'] }, issues)).toEqual([
      id('e2'),
    ]);
    expect(matching({ field: 'completedAt', op: 'neq', values: [NOW] }, issues).sort()).toEqual([
      id('e1'),
      id('e2'),
    ]);
  });

  it('includes them in notIn too, by the same set semantics', () => {
    const issues = [issue('e1', { assigneeId: ADA }), issue('e2')];
    expect(matching({ field: 'assignee', op: 'notIn', values: [ADA] }, issues)).toEqual([id('e2')]);
  });

  it('distinguishes an estimate of zero from no estimate', () => {
    // Zero is falsy, which is how "unestimated" and "estimated at nothing" become the same
    // issue in a filter written with a truthiness check.
    const issues = [issue('e1', { estimate: 0 }), issue('e2')];
    expect(matching({ field: 'estimate', op: 'isNull' }, issues)).toEqual([id('e2')]);
    expect(matching({ field: 'estimate', op: 'eq', values: ['0'] }, issues)).toEqual([id('e1')]);
    expect(matching({ field: 'estimate', op: 'lt', values: ['1'] }, issues)).toEqual([id('e1')]);
  });

  it('reads a set field as a set: any of them matches, none of them is the negation', () => {
    const issues = [issue('e1'), issue('e2'), issue('e3')];
    const labels = new Map([
      [id('e1'), new Set([BUG, CHORE])],
      [id('e2'), new Set([CHORE])],
    ]);

    expect(matching({ field: 'label', op: 'in', values: [BUG] }, issues, { labels })).toEqual([
      id('e1'),
    ]);
    // "Has no label from this set", not "has some label that is not in it" — e1 carries a
    // second label and still must not match.
    expect(matching({ field: 'label', op: 'notIn', values: [BUG] }, issues, { labels })).toEqual([
      id('e2'),
      id('e3'),
    ]);
    expect(matching({ field: 'label', op: 'eq', values: [CHORE] }, issues, { labels })).toEqual([
      id('e1'),
      id('e2'),
    ]);
  });

  it('matches nothing for an empty in-list and everything for an empty notIn-list', () => {
    const issues = [issue('e1'), issue('e2')];
    expect(matching({ field: 'priority', op: 'in', values: [] }, issues)).toEqual([]);
    expect(matching({ field: 'label', op: 'in', values: [] }, issues)).toEqual([]);
    expect(matching({ field: 'priority', op: 'notIn', values: [] }, issues)).toEqual([
      id('e1'),
      id('e2'),
    ]);
    expect(matching({ field: 'label', op: 'notIn', values: [] }, issues)).toEqual([
      id('e1'),
      id('e2'),
    ]);
  });

  it('folds case and diacritics for contains, and only for contains', () => {
    const issues = [issue('e1', { title: 'Ação de limpeza' }), issue('e2', { title: 'Cleanup' })];
    expect(matching({ field: 'title', op: 'contains', values: ['acao'] }, issues)).toEqual([
      id('e1'),
    ]);
    expect(matching({ field: 'title', op: 'contains', values: ['AÇÃO'] }, issues)).toEqual([
      id('e1'),
    ]);
    // `eq` is exact: somebody pasting a full title into an equality clause meant that title.
    expect(matching({ field: 'title', op: 'eq', values: ['acao de limpeza'] }, issues)).toEqual([]);
    expect(matching({ field: 'title', op: 'eq', values: ['Ação de limpeza'] }, issues)).toEqual([
      id('e1'),
    ]);
  });

  it('treats an empty needle as no constraint, which is what a cleared search box is', () => {
    const issues = [issue('e1'), issue('e2', { title: '' })];
    expect(matching({ field: 'title', op: 'contains', values: [''] }, issues)).toEqual([
      id('e1'),
      id('e2'),
    ]);
  });

  it('treats an issue whose status has not replicated yet as having no category', () => {
    // `eq` misses it and `neq` keeps it, exactly as for a null. Dropping it from both would
    // make a clause and its negation disagree about how many issues the workspace has.
    const issues = [issue('e1', { stateId: id('c9') })];
    expect(matching({ field: 'stateCategory', op: 'eq', values: ['unstarted'] }, issues)).toEqual(
      [],
    );
    expect(matching({ field: 'stateCategory', op: 'neq', values: ['unstarted'] }, issues)).toEqual([
      id('e1'),
    ]);
  });

  it('excludes archived work unless a clause mentions it, however deeply nested', () => {
    const issues = [issue('e1'), issue('e2', { archivedAt: NOW })];
    expect(matching({ conj: 'and', nodes: [] }, issues)).toEqual([id('e1')]);

    // The default is turned off for the whole filter by a clause anywhere in it — not for
    // the group the clause sits in. Scoping it per group would let an OR resurrect archived
    // issues into a view that never asked for them.
    const nested = {
      conj: 'or',
      nodes: [
        { field: 'priority', op: 'eq', values: ['0'] },
        { conj: 'and', nodes: [{ field: 'archived', op: 'eq', values: ['true'] }] },
      ],
    };
    expect(matching(nested, issues)).toEqual([id('e1'), id('e2')]);
  });

  it('excludes deleted work the same way, when the caller supplies any', () => {
    const issues = [issue('e1'), issue('e2')];
    const deleted = new Set([id('e2')]);

    expect(matching({ conj: 'and', nodes: [] }, issues, { deleted })).toEqual([id('e1')]);
    expect(matching({ field: 'deleted', op: 'eq', values: ['true'] }, issues, { deleted })).toEqual(
      [id('e2')],
    );
    expect(
      matching({ field: 'deleted', op: 'eq', values: ['false'] }, issues, { deleted }),
    ).toEqual([id('e1')]);
    // With no deleted set at all — the ordinary replica, where a delete removed the issue —
    // the field is simply false everywhere rather than an error.
    expect(matching({ field: 'deleted', op: 'eq', values: ['true'] }, issues)).toEqual([]);
  });

  it('is vacuously true for an empty AND and vacuously false for an empty OR', () => {
    const issues = [issue('e1')];
    expect(matching({}, issues)).toEqual([id('e1')]);
    expect(matching({ conj: 'and', nodes: [] }, issues)).toEqual([id('e1')]);
    // An OR over nothing is false by the same arithmetic that makes an AND over nothing
    // true. It is not reachable from the view bar, which never leaves a group empty.
    expect(matching({ conj: 'or', nodes: [] }, issues)).toEqual([]);
  });

  it('traverses a blocks relation from either end', () => {
    const issues = [issue('e1'), issue('e5')];
    const relations = {
      blocking: new Map([[id('e1'), new Set([id('e5')])]]),
      blockedBy: new Map([[id('e5'), new Set([id('e1')])]]),
    };
    expect(
      matching({ field: 'blockedBy', op: 'in', values: [id('e1')] }, issues, relations),
    ).toEqual([id('e5')]);
    expect(
      matching({ field: 'blocking', op: 'in', values: [id('e5')] }, issues, relations),
    ).toEqual([id('e1')]);
  });

  it('resolves a relative date once, at compile time, against the injected clock', () => {
    const issues = [
      issue('e1', { createdAt: '2026-08-01T09:00:00Z' }),
      issue('e2', { createdAt: '2026-08-14T09:00:00Z' }),
    ];
    const filter = validateFilter({ field: 'createdAt', op: 'gte', values: ['-10d'] });

    const matches = compileFilter(filter, context());
    expect(issues.filter(matches).map((row) => row.id)).toEqual([id('e2')]);

    // The same AST against a clock a month later answers differently, which is the whole
    // point of resolving at evaluation time: a view called "updated this week" must not
    // mean the week it was saved in.
    const later = compileFilter(
      filter,
      context({ time: { now: Date.parse('2026-09-15T12:00:00Z'), timezone: 'Europe/Lisbon' } }),
    );
    expect(issues.filter(later)).toEqual([]);
  });

  it('compares timestamps as instants, not as strings', () => {
    // Go trims trailing zeros from an RFC 3339 fraction, so ".5Z" and ".55Z" compare as
    // "5Z" against "55Z" and the earlier instant wins.
    const issues = [
      issue('e1', { updatedAt: '2026-08-15T00:00:00.5Z' }),
      issue('e2', { updatedAt: '2026-08-15T00:00:00.55Z' }),
    ];
    expect(
      matching({ field: 'updatedAt', op: 'gt', values: ['2026-08-15T00:00:00.52Z'] }, issues),
    ).toEqual([id('e2')]);
  });

  it('gives the same answer for the same issue however many times it is asked', () => {
    const matches = compileFilter(
      validateFilter({ field: 'assignee', op: 'eq', values: [ADA] }),
      context(),
    );
    const row = issue('e1', { assigneeId: ADA });
    expect([matches(row), matches(row), matches(row)]).toEqual([true, true, true]);
    expect(matches(issue('e2', { assigneeId: GRACE }))).toBe(false);
  });
});

/**
 * The performance budget, as a test.
 *
 * A filtered list re-renders on every keystroke and there is deliberately no debouncing,
 * so this cost is paid in full between one character and the next.
 *
 * The assertion is the product's own 50ms budget rather than a padded version of it. A
 * compiled predicate runs the four-clause shape over five thousand issues in about half a
 * millisecond, so this leaves two orders of magnitude of headroom for a loaded CI box
 * while still catching the regression that matters: an evaluator that walks the AST per
 * row instead of compiling it once lands within a factor of a few of this line.
 */
describe('filter performance', () => {
  const ISSUES = 5000;
  const BUDGET_MS = 50;

  function corpus(): { issues: Issue[]; ctx: FilterContext } {
    const issues: Issue[] = [];
    const labels = new Map<UUID, Set<UUID>>();
    for (let i = 0; i < ISSUES; i++) {
      const row = issue(`f${i.toString(16)}`, {
        title: `Issue ${i} about ${i % 7 === 0 ? 'authentication' : 'rendering'}`,
        stateId: i % 3 === 0 ? DONE : TODO,
        assigneeId: i % 3 === 0 ? undefined : i % 2 === 0 ? ADA : GRACE,
        priority: i % 5,
        createdAt: `2026-08-${String((i % 14) + 1).padStart(2, '0')}T09:00:00Z`,
      });
      issues.push(row);
      labels.set(row.id, new Set(i % 2 === 0 ? [BUG] : [CHORE]));
    }
    return { issues, ctx: context({ labels }) };
  }

  function medianMs(runs: number, fn: () => void): number {
    const samples: number[] = [];
    for (let i = 0; i < runs; i++) {
      const start = performance.now();
      fn();
      samples.push(performance.now() - start);
    }
    samples.sort((a, b) => a - b);
    return samples[Math.floor(samples.length / 2)] ?? 0;
  }

  it(`evaluates the four-clause shape over ${ISSUES} issues inside the frame budget`, () => {
    const { issues, ctx } = corpus();
    const filter: FilterNode = validateFilter({
      conj: 'and',
      nodes: [
        { field: 'team', op: 'eq', values: [id('b1')] },
        { field: 'stateCategory', op: 'in', values: ['unstarted', 'started'] },
        { field: 'priority', op: 'notIn', values: ['0'] },
        { field: 'label', op: 'in', values: [BUG, CHORE] },
      ],
    });

    const elapsed = medianMs(20, () => {
      const ids = filterIssues(issues, filter, ctx);
      // Touch the answer so a clever engine cannot optimise the whole call away.
      if (ids.length < 0) throw new Error('unreachable');
    });

    expect(
      elapsed,
      `filtering ${ISSUES} issues took ${elapsed.toFixed(1)}ms against the product's own ` +
        `${BUDGET_MS}ms budget. Exceeding it means the AST is being interpreted per row ` +
        `instead of compiled once per filter.`,
    ).toBeLessThan(BUDGET_MS);
  });

  it(`runs a folded text search over ${ISSUES} issues inside the frame budget`, () => {
    const { issues, ctx } = corpus();
    const filter = validateFilter({ field: 'title', op: 'contains', values: ['authentication'] });

    const elapsed = medianMs(20, () => {
      filterIssues(issues, filter, ctx);
    });

    expect(
      elapsed,
      `a folded title search over ${ISSUES} issues took ${elapsed.toFixed(1)}ms, ` +
        `budget ${BUDGET_MS}ms. This is the clause that folds every row, so it is the one ` +
        `that decides whether typing in the view bar stays smooth.`,
    ).toBeLessThan(BUDGET_MS);
  });
});
