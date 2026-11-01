/**
 * The arrangement as a table, one family shape per row. Each row is written the way it should
 * read on screen: two spaces per indent level, a `~` for a dimmed context row.
 */

import { describe, expect, it } from 'vitest';

import { nestFamilies, reorderPlan, type FamilySource, type NestedRow } from './nestFamilies';

/** `{ child: 'parent' }`, with every id named in either place existing unless `missing`. */
function source(parents: Record<string, string | null>, missing: readonly string[] = []) {
  const issues = new Map<string, { parentId?: string }>();
  for (const [id, parentId] of Object.entries(parents)) {
    if (missing.includes(id)) continue;
    issues.set(id, parentId === null ? {} : { parentId });
  }
  return { issues } as FamilySource;
}

function drawn(rows: readonly NestedRow[]): string[] {
  return rows.map(
    (row) => `${'  '.repeat(row.depth)}${row.kind === 'parentContext' ? '~' : ''}${row.id}`,
  );
}

describe('nestFamilies', () => {
  const cases: {
    name: string;
    ids: string[];
    parents: Record<string, string | null>;
    missing?: string[];
    rows: string[];
  }[] = [
    {
      name: 'no families leaves the order alone',
      ids: ['a', 'b'],
      parents: { a: null, b: null },
      rows: ['a', 'b'],
    },
    {
      name: 'a child goes right under its parent, past whatever sat between',
      ids: ['p', 'x', 'c'],
      parents: { p: null, x: null, c: 'p' },
      rows: ['p', '  c', 'x'],
    },
    {
      name: 'a child ordered before its parent still goes under it',
      ids: ['c', 'x', 'p'],
      parents: { c: 'p', x: null, p: null },
      rows: ['x', 'p', '  c'],
    },
    {
      name: 'siblings stay together in the group order',
      ids: ['c2', 'p', 'x', 'c1'],
      parents: { c2: 'p', p: null, x: null, c1: 'p' },
      rows: ['p', '  c2', '  c1', 'x'],
    },
    {
      name: 'nesting goes as deep as the family does',
      ids: ['g', 'p', 'c', 'x'],
      parents: { g: null, p: 'g', c: 'p', x: null },
      rows: ['g', '  p', '    c', 'x'],
    },
    {
      name: 'a parent outside the group is drawn once, above its first child',
      ids: ['x', 'c1', 'y', 'c2'],
      parents: { x: null, c1: 'out', y: null, c2: 'out', out: null },
      rows: ['x', '~out', '  c1', '  c2', 'y'],
    },
    {
      name: 'only the immediate parent is drawn, not the whole chain above it',
      ids: ['c'],
      parents: { c: 'out', out: 'top', top: null },
      rows: ['~out', '  c'],
    },
    {
      name: 'a context row sits under its own parent when that is in the group',
      ids: ['g', 'x', 'c'],
      parents: { g: null, x: null, c: 'out', out: 'g' },
      rows: ['g', '  ~out', '    c', 'x'],
    },
    {
      name: 'a context row nests under another context row',
      ids: ['c', 'd'],
      parents: { c: 'inner', d: 'outer', inner: 'outer', outer: null },
      rows: ['~outer', '  ~inner', '    c', '  d'],
    },
    {
      name: 'a parent nobody can read is no parent: a normal row, no indent',
      ids: ['x', 'c1', 'c2'],
      parents: { x: null, c1: 'private', c2: 'private', private: null },
      missing: ['private'],
      rows: ['x', 'c1', 'c2'],
    },
    {
      name: 'a parent chain that loops still lists every issue',
      ids: ['a', 'b', 'x'],
      parents: { a: 'b', b: 'a', x: null },
      rows: ['x', 'a', '  b'],
    },
    {
      name: 'an empty group has no rows',
      ids: [],
      parents: {},
      rows: [],
    },
  ];

  it.each(cases)('$name', ({ ids, parents, missing, rows }) => {
    expect(drawn(nestFamilies(ids, source(parents, missing)))).toEqual(rows);
  });

  it('says where each connector stops and which ancestors pass through', () => {
    const rows = nestFamilies(
      ['g', 'p1', 'c', 'p2'],
      source({ g: null, p1: 'g', c: 'p1', p2: 'g' }),
    );
    const byId = Object.fromEntries(rows.map((row) => [row.id, row]));
    expect(byId['p1']).toMatchObject({ under: 'g', last: false, through: [] });
    // p1 has a sibling below, so its line runs through c's row on its way to p2.
    expect(byId['c']).toMatchObject({ under: 'p1', last: true, through: [0] });
    expect(byId['p2']).toMatchObject({ under: 'g', last: true, through: [] });
  });

  it('does a fixed number of lookups per issue, whatever the size of the list', () => {
    const lookups = (size: number) => {
      const parents: Record<string, string | null> = {};
      const ids: string[] = [];
      for (let at = 0; at < size; at++) {
        const id = `i${at}`;
        ids.push(id);
        parents[id] = at % 3 === 0 ? null : `i${at - (at % 3)}`;
      }
      const issues = source(parents).issues as Map<string, { parentId?: string }>;
      let count = 0;
      const get = issues.get.bind(issues);
      issues.get = (id) => {
        count += 1;
        return get(id);
      };
      expect(nestFamilies(ids, { issues })).toHaveLength(size);
      return count;
    };
    expect(lookups(5000)).toBeLessThanOrEqual(lookups(500) * 10);
    expect(lookups(5000)).toBeLessThanOrEqual(5000 * 3);
  });
});

describe('reorderPlan', () => {
  it('in a flat list steps past the neighbour, as it always did', () => {
    const store = source({ a: null, b: null, c: null });
    const order = ['a', 'b', 'c'];
    expect(reorderPlan(order, store, ['b'], 1)?.target).toEqual({ afterId: 'c', beforeId: null });
    expect(reorderPlan(order, store, ['b'], -1)?.target).toEqual({ afterId: null, beforeId: 'a' });
    expect(reorderPlan(order, store, ['a'], -1)).toBeNull();
    expect(reorderPlan(order, store, ['a', 'b'], 1)).toBeNull();
    expect(reorderPlan(order, store, ['gone'], 1)).toBeNull();
  });

  it('moves a child among its siblings and not past the row below them', () => {
    // On screen: p, c1, c2, x. Flat order keeps x between the two children.
    const store = source({ p: null, c1: 'p', x: null, c2: 'p' });
    const order = ['p', 'c1', 'x', 'c2'];
    expect(reorderPlan(order, store, ['c1'], 1)?.target).toEqual({ afterId: 'c2', beforeId: null });
    expect(reorderPlan(order, store, ['c2'], -1)?.target).toEqual({
      afterId: 'p',
      beforeId: 'c1',
    });
    // Already last among its siblings. The row under it on screen is someone else's.
    expect(reorderPlan(order, store, ['c2'], 1)).toBeNull();
  });

  it('moves a top-level row past a whole family as one place', () => {
    // On screen: a, p, c, b.
    const store = source({ a: null, p: null, c: 'p', b: null });
    const order = ['a', 'p', 'c', 'b'];
    expect(reorderPlan(order, store, ['a'], 1)?.target).toEqual({ afterId: 'p', beforeId: 'c' });
    expect(reorderPlan(order, store, ['b'], -1)?.target).toEqual({ afterId: 'a', beforeId: 'p' });
  });

  it('never lands next to a context row by any key of its own', () => {
    // On screen: a, ~out, c1, c2, b. The context row sits where c1 does.
    const store = source({ a: null, c1: 'out', b: null, c2: 'out', out: null });
    const order = ['a', 'c1', 'b', 'c2'];
    expect(reorderPlan(order, store, ['a'], 1)?.target).toEqual({ afterId: 'c1', beforeId: 'b' });
    expect(reorderPlan(order, store, ['b'], -1)?.target).toEqual({ afterId: 'a', beforeId: 'c1' });
  });

  it('keeps a family where it is when its first child goes to the top of it', () => {
    // On screen: a, ~out, c1, c2. "To the top" must not send c2 to the top of the whole list,
    // which would carry the context row up with it.
    const store = source({ a: null, c1: 'out', c2: 'out', out: null });
    const order = ['a', 'c1', 'c2'];
    expect(reorderPlan(order, store, ['c2'], -100)?.target).toEqual({
      afterId: 'a',
      beforeId: 'c1',
    });
  });

  it('lands where the plan says once the list is arranged again', () => {
    const parents = { a: null, p: null, c1: 'p', x: null, c2: 'p', b: null };
    const store = source(parents);
    const order = ['a', 'p', 'c1', 'x', 'c2', 'b'];
    const plan = reorderPlan(order, store, ['c2'], -1)!;
    const without = order.filter((id) => id !== 'c2');
    const at = plan.target.afterId === null ? 0 : without.indexOf(plan.target.afterId) + 1;
    without.splice(at, 0, 'c2');
    expect(drawn(nestFamilies(without, store))).toEqual(['a', 'p', '  c2', '  c1', 'x', 'b']);
  });
});
