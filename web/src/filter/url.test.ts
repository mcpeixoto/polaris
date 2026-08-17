import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { DEFAULT_DISPLAY, EMPTY_FILTER, type FilterNode } from './types';
import { parseDisplayParams, parseFilterParam, toDisplayParams, toFilterParam } from './url';

describe('filter URLs', () => {
  // The whole reason this is a grammar and not base64: a link pasted into a chat is read
  // by a human before it is clicked.
  it('reads as what it will show', () => {
    expect(toFilterParam({ field: 'assignee', op: 'eq', values: ['ada'] })).toBe(
      'assignee.eq(ada)',
    );
    expect(
      toFilterParam({
        conj: 'and',
        nodes: [
          { field: 'priority', op: 'in', values: ['1', '2'] },
          { field: 'assignee', op: 'isNull' },
        ],
      }),
    ).toBe('priority.in(1,2),assignee.isNull');
  });

  it('leaves the top-level AND implicit and never an OR', () => {
    const or: FilterNode = {
      conj: 'or',
      nodes: [
        { field: 'priority', op: 'eq', values: ['1'] },
        { field: 'priority', op: 'eq', values: ['4'] },
      ],
    };
    // Dropping the wrapper here would silently change the meaning from "either" to "both".
    expect(toFilterParam(or)).toBe('or(priority.eq(1),priority.eq(4))');
    expect(parseFilterParam(toFilterParam(or))).toEqual(or);
  });

  it('gives an unfiltered view a clean URL', () => {
    expect(toFilterParam(EMPTY_FILTER)).toBe('');
    expect(parseFilterParam('')).toEqual(EMPTY_FILTER);
    expect(parseFilterParam(null)).toEqual(EMPTY_FILTER);
  });

  // `in ()` matches nothing and `isNull` matches the unset. Writing the empty parentheses
  // is what keeps those two apart.
  it('keeps an empty value list distinguishable from no value list', () => {
    expect(toFilterParam({ field: 'priority', op: 'in', values: [] })).toBe('priority.in()');
    expect(parseFilterParam('priority.in()')).toEqual({
      conj: 'and',
      nodes: [{ field: 'priority', op: 'in', values: [] }],
    });
    expect(parseFilterParam('assignee.isNull')).toEqual({
      conj: 'and',
      nodes: [{ field: 'assignee', op: 'isNull' }],
    });
  });

  // A grammar that only works until somebody searches for "a, b)" fails in front of a
  // customer rather than in a test.
  it('survives values containing its own punctuation', () => {
    const filter: FilterNode = {
      field: 'title',
      op: 'contains',
      values: ['a, b) and (c'],
    };
    const url = toFilterParam(filter);
    expect(url).not.toContain('a, b)');
    expect(parseFilterParam(url)).toEqual({ conj: 'and', nodes: [filter] });
  });

  it('round-trips nesting', () => {
    const filter: FilterNode = {
      conj: 'and',
      nodes: [
        {
          conj: 'or',
          nodes: [
            { field: 'assignee', op: 'eq', values: ['01900000-0000-7000-8000-0000000000a1'] },
            { field: 'assignee', op: 'eq', values: ['01900000-0000-7000-8000-0000000000a2'] },
          ],
        },
        { field: 'stateCategory', op: 'neq', values: ['completed'] },
      ],
    };
    expect(parseFilterParam(toFilterParam(filter))).toEqual(filter);
  });

  describe('untrusted input', () => {
    // A link that opens an unfiltered list is a mild disappointment. A link that throws is
    // a page somebody cannot open and cannot repair, because the broken part is in the
    // address bar.
    const unreadable = [
      'sprint.eq(x)', // a field this build does not have
      'assignee.matches(x)', // an operator that does not exist
      'assignee.eq(', // truncated by a chat client
      'and(assignee.eq(a)', // unbalanced
      'assignee', // no operator
      ')))', // noise
      'priority.contains(1)', // an operator the field's type refuses
    ];

    for (const raw of unreadable) {
      it(`falls back rather than throwing on ${JSON.stringify(raw)}`, () => {
        expect(() => parseFilterParam(raw)).not.toThrow();
        expect(parseFilterParam(raw)).toEqual(EMPTY_FILTER);
      });
    }

    it('tells the caller why, so the interface can say so', () => {
      const messages: string[] = [];
      parseFilterParam('sprint.eq(x)', (m) => messages.push(m));
      expect(messages).toHaveLength(1);
      expect(messages[0]).toMatch(/sprint/);
    });

    // The URL is exactly the path by which a filter the compiler would reject reaches a
    // saved view.
    it('validates, not merely parses', () => {
      // Syntactically fine, semantically not: eq takes exactly one value.
      expect(parseFilterParam('assignee.eq(a,b)')).toEqual(EMPTY_FILTER);
    });
  });

  // Round-tripping asserted over the conformance fixture rather than over examples chosen
  // here, so the property holds for every filter the grammar actually has to carry.
  describe('every conformance filter round-trips', () => {
    // resolve() rather than `new URL(path, import.meta.url)`: vite rewrites that form into
    // an asset URL served over http, which readFileSync cannot open. Same reason and same
    // shape as conformance.test.ts.
    const fixture = JSON.parse(
      readFileSync(
        resolve(dirname(fileURLToPath(import.meta.url)), '../../../schema/filter-conformance.json'),
        'utf8',
      ),
    ) as { cases: { name: string; filter: FilterNode }[] };

    // The fixture writes ids as short names — 'e1' for
    // 01900000-0000-7000-8000-0000000000e1 — because the arrays are unreadable otherwise.
    // They have to be expanded here for the same reason the other loaders expand them:
    // parseFilterParam validates, and 'b1' is correctly not a uuid.
    const expand = (node: FilterNode): FilterNode => {
      if ('field' in node) {
        if (node.values === undefined) return node;
        return {
          ...node,
          values: node.values.map((value) =>
            /^[a-z][0-9a-f]{1,3}$/.test(value)
              ? `01900000-0000-7000-8000-${value.padStart(12, '0')}`
              : value,
          ),
        };
      }
      return { ...node, nodes: (node.nodes ?? []).map(expand) };
    };

    for (const testCase of fixture.cases) {
      it(testCase.name, () => {
        const url = toFilterParam(expand(testCase.filter));
        const back = parseFilterParam(url);
        // Compared after normalising through the writer, because the fixture writes `{}`
        // for the empty filter and the parser produces the canonical form of it. What
        // must hold is that the URL means the same thing, not that the objects are
        // byte-identical.
        expect(toFilterParam(back)).toBe(url);
      });
    }
  });
});

describe('display options in a URL', () => {
  it('omits everything that is already the default', () => {
    expect(toDisplayParams(DEFAULT_DISPLAY)).toEqual({});
    expect(toDisplayParams({})).toEqual({});
  });

  it('carries only the choices somebody actually made', () => {
    expect(toDisplayParams({ layout: 'board', groupBy: 'assignee' })).toEqual({
      layout: 'board',
      group: 'assignee',
    });
  });

  it('round-trips', () => {
    const display = {
      layout: 'board' as const,
      groupBy: 'assignee' as const,
      orderBy: 'dueDate' as const,
      direction: 'desc' as const,
      showSubIssues: false,
      showCompleted: false,
      properties: ['priority', 'labels'] as const,
    };
    const params = new URLSearchParams(toDisplayParams(display));
    expect(parseDisplayParams(params)).toEqual(display);
  });

  // A link made by a newer build must still open in an older one, showing what it
  // understands.
  it('ignores what it does not recognise instead of failing', () => {
    const params = new URLSearchParams({
      group: 'cycle',
      order: 'chaos',
      layout: 'timeline',
      dir: 'sideways',
      show: 'priority,cycle,labels',
    });
    expect(parseDisplayParams(params)).toEqual({ properties: ['priority', 'labels'] });
  });
});
