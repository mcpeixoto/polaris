import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { DEFAULT_DISPLAY, EMPTY_FILTER, type FilterNode } from './types';
import {
  FILTER_PARAM,
  filterSearchString,
  parseDisplayParams,
  parseFilterParam,
  toDisplayParams,
  toFilterParam,
} from './url';

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

  // The empty string is a legal text value meaning "matches everything", and it is what the
  // filter bar puts in a freshly added — or freshly cleared — Title or Description clause.
  // It encodes to nothing at all, so the same `()` that means "no values" for `in` has to
  // mean "one empty value" for an operator that takes exactly one. Reading it back as zero
  // values made the clause fail validation on its way out of the address bar, and the user's
  // own filter came back as "this link carried a filter this build could not read".
  it('round-trips a single empty value', () => {
    for (const filter of [
      { field: 'title', op: 'contains', values: [''] },
      { field: 'description', op: 'notContains', values: [''] },
    ] satisfies FilterNode[]) {
      const url = toFilterParam(filter);
      expect(parseFilterParam(url)).toEqual({ conj: 'and', nodes: [filter] });
    }

    // And the multi-valued operators keep meaning what they meant.
    expect(parseFilterParam('label.in()')).toEqual({
      conj: 'and',
      nodes: [{ field: 'label', op: 'in', values: [] }],
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

describe('the query string a filter goes into', () => {
  // `URLSearchParams.toString()` escapes the grammar's own punctuation, which turns a link
  // somebody can read into one that says nothing. Every screen that writes a filter into the
  // address bar has to go through this instead.
  it('leaves the grammar readable', () => {
    const params = new URLSearchParams();
    params.set(FILTER_PARAM, 'priority.in(1,2),assignee.isNull');
    expect(filterSearchString(params)).toBe('?filter=priority.in(1,2),assignee.isNull');
  });

  it('still escapes what would change the query string itself', () => {
    const params = new URLSearchParams();
    // `%` is load-bearing: the values inside a filter are already percent-encoded, so a raw
    // `%` here would be unwrapped a second time by the URL's own decoder.
    params.set(FILTER_PARAM, 'title.contains(a%20b&c#d)');
    expect(filterSearchString(params)).toBe('?filter=title.contains(a%2520b%26c%23d)');
  });

  it('escapes everything that is not the filter, and returns nothing for nothing', () => {
    const params = new URLSearchParams({ group: 'assignee', show: 'priority,labels' });
    expect(filterSearchString(params)).toBe('?group=assignee&show=priority%2Clabels');
    expect(filterSearchString(new URLSearchParams())).toBe('');
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
      showSnoozed: true,
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

  // Turning every property off is a choice, and `show=` is what it encodes to. Reading that
  // back as "nothing was said" put all five properties back, so the fifth tick in the menu
  // silently undid the other four.
  it('round-trips a row with no properties at all', () => {
    const params = new URLSearchParams(toDisplayParams({ properties: [] }));
    expect(params.get('show')).toBe('');
    expect(parseDisplayParams(params)).toEqual({ properties: [] });
  });

  // Still graceful the other way: a value naming only properties this build has never heard
  // of falls back to the defaults rather than leaving a row with nothing on it.
  it('falls back to the defaults when nothing in the list is recognised', () => {
    expect(parseDisplayParams(new URLSearchParams({ show: 'sla,sentry' }))).toEqual({});
  });
});
