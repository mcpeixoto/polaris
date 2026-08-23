/**
 * The command menu's section keys.
 *
 * A group can appear twice in one result list — `Issues` as a group of commands, then
 * `Issues` as the issues that matched — because sections follow the ranking rather than
 * reordering it. Keying the heading by its name therefore produced two identical React
 * keys, and React logged "Encountered two children with the same key" on every keystroke
 * that ranked them apart. The warning was the visible half; the invisible half is that
 * React may reuse the wrong element between renders when keys collide.
 */

import { describe, expect, it } from 'vitest';

import { grouped } from './CommandMenu';

describe('grouped', () => {
  it('gives two runs of the same group two different keys', () => {
    const sections = grouped([
      { group: 'Issues' },
      { group: 'Customers' },
      { group: 'Issues' },
      { group: 'Customers' },
    ]);

    expect(sections.map((s) => s.group)).toEqual(['Issues', 'Customers', 'Issues', 'Customers']);

    // What the heading used to be keyed by, spelled out so this test says what broke:
    // two sections, one key, and React reusing an element across a render boundary.
    const oldScheme = sections.map((s) => `group-${s.group}`);
    expect(new Set(oldScheme).size).toBeLessThan(sections.length);

    const keys = sections.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('keeps a run together and does not reorder to merge headings', () => {
    const sections = grouped([
      { group: 'Commands', id: 'a' },
      { group: 'Commands', id: 'b' },
      { group: 'Issues', id: 'c' },
      { group: 'Commands', id: 'd' },
    ]);

    // Three sections, not two: 'd' stays where the ranking put it.
    expect(sections.map((s) => s.rows.map((r) => r.id))).toEqual([['a', 'b'], ['c'], ['d']]);
  });

  it('has nothing to key when there are no rows', () => {
    expect(grouped([])).toEqual([]);
  });
});
