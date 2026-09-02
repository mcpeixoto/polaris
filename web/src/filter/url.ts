/**
 * Filters and display options in a URL.
 *
 * "A filtered view must be a shareable link" is a requirement, not a nicety, and it is the
 * reason this is a readable grammar rather than base64-encoded JSON. A link somebody pastes
 * into a chat is read by a human before it is clicked: `?filter=assignee.eq(ada)` says what
 * it will show, and `?filter=eyJjb25qIjoiYW5kIiwibm9kZXMi...` says nothing at all. It also
 * means a support conversation can be about a URL rather than about a screenshot of one.
 *
 * The grammar:
 *
 *     filter := node ("," node)*          the top level is an implicit AND
 *     node   := clause | group
 *     clause := field "." op [ "(" value ("," value)* ")" ]
 *     group  := ("and" | "or") "(" node ("," node)* ")"
 *
 *     priority.in(1,2),assignee.isNull
 *     or(priority.eq(1),dueDate.lt(-7d))
 *
 * Values are percent-encoded, which is what makes the commas and parentheses above
 * unambiguous. A `contains` clause can hold arbitrary text, including both, and a grammar
 * that only works until somebody searches for "a, b)" is one that will fail in front of a
 * customer rather than in a test.
 *
 * Round-tripping is total: `parseFilterParam(toFilterParam(f))` is `f` for every filter the
 * validator accepts, and there is a property test asserting it over the conformance
 * fixture's cases rather than over examples chosen here.
 */

import {
  DEFAULT_DISPLAY,
  DISPLAY_PROPERTIES,
  EMPTY_FILTER,
  isFilterClause,
  isFilterField,
  isFilterGroup,
  isFilterOp,
  takesNoValues,
  takesSingleValue,
  type Conjunction,
  type DisplayDirection,
  type DisplayGroupBy,
  type DisplayOptions,
  type DisplayOrderBy,
  type DisplayProperty,
  type FilterNode,
  type ViewLayout,
} from './types';
import { FilterError, validateFilter } from './validate';

/** The query parameters this module owns. Named here so callers cannot misspell one. */
export const FILTER_PARAM = 'filter';
export const DISPLAY_PARAMS = {
  layout: 'layout',
  groupBy: 'group',
  subGroupBy: 'sub',
  orderBy: 'order',
  direction: 'dir',
  showSubIssues: 'subissues',
  showCompleted: 'completed',
  showSnoozed: 'snoozed',
  showEmptyGroups: 'empty',
  properties: 'show',
} as const;

// ---------------------------------------------------------------------------------------
// Writing

/**
 * Serialises a filter to its URL form. Returns an empty string for a filter that matches
 * everything, so an unfiltered view has a clean URL rather than `?filter=`.
 */
export function toFilterParam(filter: FilterNode): string {
  const encoded = writeNode(filter, true);
  return encoded === '' ? '' : encoded;
}

/**
 * Percent-encodes a value so that none of the grammar's punctuation survives inside one.
 *
 * `encodeURIComponent` alone is not enough, which is worth knowing because it looks like it
 * is: it deliberately leaves `!'()*-._~` unescaped, as they are legal in a URI component.
 * Two of those — the parentheses — are this grammar's delimiters, so a `contains` clause
 * searching for "a, b) and (c" produced a URL that parsed as something else entirely. The
 * comma it does escape, which is exactly what makes the omission easy to miss.
 */
function encodeValue(value: string): string {
  return encodeURIComponent(value).replace(/\(/g, '%28').replace(/\)/g, '%29');
}

function writeNode(node: FilterNode, topLevel = false): string {
  if (isFilterClause(node)) {
    const head = `${node.field}.${node.op}`;
    if (takesNoValues(node.op)) return head;
    // An empty value list is meaningful — `in ()` matches nothing — so the parentheses are
    // written even when there is nothing between them. Omitting them would make an empty
    // IN indistinguishable from `isNull`, which is the opposite predicate.
    const values = (node.values ?? []).map(encodeValue).join(',');
    return `${head}(${values})`;
  }

  const nodes = node.nodes ?? [];
  const conj: Conjunction = node.conj ?? 'and';

  // The top level is an implicit AND, so an AND group there needs no wrapper. An OR does,
  // because dropping it would silently change the meaning.
  if (topLevel && conj === 'and') {
    return nodes.map((child) => writeNode(child)).join(',');
  }
  return `${conj}(${nodes.map((child) => writeNode(child)).join(',')})`;
}

/** Serialises display options, omitting every value that is already the default. */
export function toDisplayParams(display: DisplayOptions): Record<string, string> {
  const out: Record<string, string> = {};
  const put = <K extends keyof typeof DISPLAY_PARAMS>(key: K, value: string, dflt: string) => {
    // Defaults are omitted so that a shared link carries the choices somebody actually made.
    // A URL restating every default is longer, harder to read, and — worse — pins today's
    // defaults into links that outlive them, so a change to DEFAULT_DISPLAY would not reach
    // anybody who had ever shared a view.
    if (value !== dflt) out[DISPLAY_PARAMS[key]] = value;
  };

  put('layout', display.layout ?? DEFAULT_DISPLAY.layout, DEFAULT_DISPLAY.layout);
  put('groupBy', display.groupBy ?? DEFAULT_DISPLAY.groupBy, DEFAULT_DISPLAY.groupBy);
  put('subGroupBy', display.subGroupBy ?? DEFAULT_DISPLAY.subGroupBy, DEFAULT_DISPLAY.subGroupBy);
  put('orderBy', display.orderBy ?? DEFAULT_DISPLAY.orderBy, DEFAULT_DISPLAY.orderBy);
  put('direction', display.direction ?? DEFAULT_DISPLAY.direction, DEFAULT_DISPLAY.direction);
  put(
    'showSubIssues',
    String(display.showSubIssues ?? DEFAULT_DISPLAY.showSubIssues),
    String(DEFAULT_DISPLAY.showSubIssues),
  );
  put(
    'showCompleted',
    String(display.showCompleted ?? DEFAULT_DISPLAY.showCompleted),
    String(DEFAULT_DISPLAY.showCompleted),
  );
  put(
    'showSnoozed',
    String(display.showSnoozed ?? DEFAULT_DISPLAY.showSnoozed),
    String(DEFAULT_DISPLAY.showSnoozed),
  );
  put(
    'showEmptyGroups',
    String(display.showEmptyGroups ?? DEFAULT_DISPLAY.showEmptyGroups),
    String(DEFAULT_DISPLAY.showEmptyGroups),
  );
  if (display.properties !== undefined) {
    const value = display.properties.join(',');
    if (value !== DEFAULT_DISPLAY.properties.join(',')) out[DISPLAY_PARAMS.properties] = value;
  }
  return out;
}

/**
 * The characters that would change what a query string means, and their escapes.
 *
 * `%` is the load-bearing one. `toFilterParam` percent-encodes the values inside a filter
 * — that is what makes a `contains` clause holding "a, b)" unambiguous — so writing its
 * output into the URL raw would let the URL's own decoder unwrap those escapes a second
 * time, and the clause would come back as three values. Doubling the `%` puts the escaping
 * back where it belongs. The rest are insurance: the grammar's field and operator names
 * cannot contain them today, and a link that breaks because one day they can is not a
 * failure anybody would trace back to here.
 */
const QUERY_ESCAPES: Readonly<Record<string, string>> = {
  '%': '%25',
  '&': '%26',
  '#': '%23',
  '+': '%2B',
  ' ': '%20',
};

/**
 * A query string, with the filter grammar's own punctuation left readable.
 *
 * `URLSearchParams.toString()` is the obvious way to do this and it is the wrong one: it
 * escapes the parentheses and commas the grammar is built from, so a shared view arrives
 * as `?filter=priority.in%281%2C2%29`. It parses — but "a link a human reads before they
 * click it" is the entire reason this module is a grammar rather than base64, and that link
 * says nothing at all. Every character `toFilterParam` leaves raw is legal in a query
 * component; the ones that are not are escaped above.
 *
 * It lives here rather than beside the one caller that first needed it because it is the
 * other half of `toFilterParam`, and every screen that puts a filter in the address bar has
 * to use it: opening a saved view, opening a project's attached view, `G A`, clicking a
 * member in the cycle sidebar. Each of those went through react-router's own serialiser and
 * produced the unreadable form, so the promise held for a filter typed into the bar and for
 * nothing else — which is the half of the product where links are actually made.
 */
export function filterSearchString(params: URLSearchParams): string {
  const parts: string[] = [];
  for (const [key, value] of params) {
    parts.push(
      key === FILTER_PARAM
        ? `${key}=${value.replace(/[%&#+ ]/g, (char) => QUERY_ESCAPES[char] ?? char)}`
        : // Every other parameter keeps the serialisation the platform gives it —
          // `application/x-www-form-urlencoded`, so a space is `+`. Reaching for
          // `encodeURIComponent` here instead would be a quiet second dialect: `?q=` written
          // by this function would say `%20` where the same search written by
          // `URLSearchParams`, by the server, or by a link somebody already saved says `+`.
          // Only the filter parameter has a reason to leave the standard.
          new URLSearchParams([[key, value]]).toString(),
    );
  }
  return parts.length === 0 ? '' : `?${parts.join('&')}`;
}

// ---------------------------------------------------------------------------------------
// Reading

/**
 * Parses a filter from its URL form, and validates it.
 *
 * A URL is untrusted input — hand-edited, truncated by a chat client, written by an older
 * build — so this returns `EMPTY_FILTER` rather than throwing when it cannot make sense of
 * one. A link that opens an unfiltered list is a mild disappointment; a link that throws is
 * a page somebody cannot open at all, and they have no way to repair it because the broken
 * part is in the address bar.
 *
 * `onError` lets a caller say so in the interface instead of swallowing it silently.
 */
export function parseFilterParam(
  raw: string | null | undefined,
  onError?: (message: string) => void,
): FilterNode {
  if (raw === null || raw === undefined || raw.trim() === '') return EMPTY_FILTER;

  try {
    const parser = new Parser(raw);
    const nodes = parser.readNodeList();
    parser.expectEnd();
    const filter: FilterNode =
      nodes.length === 1 && isFilterGroup(nodes[0]!) ? nodes[0]! : { conj: 'and', nodes };
    // Validated by the same validator the server's compiler mirrors. A URL is exactly the
    // path by which a filter the compiler would reject reaches a saved view.
    validateFilter(filter);
    return filter;
  } catch (error) {
    onError?.(error instanceof FilterError ? error.message : 'that filter could not be read');
    return EMPTY_FILTER;
  }
}

/** Parses display options, ignoring anything unrecognised rather than failing. */
export function parseDisplayParams(params: URLSearchParams): DisplayOptions {
  const out: {
    layout?: ViewLayout;
    groupBy?: DisplayGroupBy;
    subGroupBy?: DisplayGroupBy;
    orderBy?: DisplayOrderBy;
    direction?: DisplayDirection;
    showSubIssues?: boolean;
    showCompleted?: boolean;
    showSnoozed?: boolean;
    showEmptyGroups?: boolean;
    properties?: DisplayProperty[];
  } = {};

  const layout = params.get(DISPLAY_PARAMS.layout);
  if (layout === 'list' || layout === 'board') out.layout = layout;

  const groupBy = params.get(DISPLAY_PARAMS.groupBy);
  if (groupBy !== null && isGroupBy(groupBy)) out.groupBy = groupBy;

  const subGroupBy = params.get(DISPLAY_PARAMS.subGroupBy);
  if (subGroupBy !== null && isGroupBy(subGroupBy)) out.subGroupBy = subGroupBy;

  const orderBy = params.get(DISPLAY_PARAMS.orderBy);
  if (orderBy !== null && isOrderBy(orderBy)) out.orderBy = orderBy;

  const direction = params.get(DISPLAY_PARAMS.direction);
  if (direction === 'asc' || direction === 'desc') out.direction = direction;

  const subIssues = params.get(DISPLAY_PARAMS.showSubIssues);
  if (subIssues === 'true' || subIssues === 'false') out.showSubIssues = subIssues === 'true';

  const completed = params.get(DISPLAY_PARAMS.showCompleted);
  if (completed === 'true' || completed === 'false') out.showCompleted = completed === 'true';

  const snoozed = params.get(DISPLAY_PARAMS.showSnoozed);
  if (snoozed === 'true' || snoozed === 'false') out.showSnoozed = snoozed === 'true';

  const empty = params.get(DISPLAY_PARAMS.showEmptyGroups);
  if (empty === 'true' || empty === 'false') out.showEmptyGroups = empty === 'true';

  const properties = params.get(DISPLAY_PARAMS.properties);
  if (properties === '') {
    // Every property turned off, which is a choice and not an absence. `show=` is exactly
    // what `toDisplayParams` writes for it, so reading it as "nothing was said" made the
    // fifth tick in the Properties group silently restore the four already unticked.
    out.properties = [];
  } else if (properties !== null) {
    // Unknown property names are dropped rather than rejected: a link made by a newer build
    // must still open in an older one, showing what it understands. A value that is entirely
    // unknown falls back to the defaults rather than to nothing, because the alternative is a
    // row with no properties at all on a link whose author asked for five.
    const known = properties.split(',').filter(isDisplayProperty);
    if (known.length > 0) out.properties = known;
  }

  return out;
}

const GROUP_BY: ReadonlySet<string> = new Set<string>([
  'none',
  'state',
  'stateCategory',
  'assignee',
  'priority',
  'label',
  'team',
  'dueDate',
  'parent',
]);

const ORDER_BY: ReadonlySet<string> = new Set<string>([
  'manual',
  'priority',
  'dueDate',
  'estimate',
  'createdAt',
  'updatedAt',
  'title',
  'customerCount',
]);

/**
 * Built from the union's own list rather than typed out again.
 *
 * It was typed out again, and it had drifted: five names here that `DisplayProperty` did
 * not have, so `isDisplayProperty` — a type predicate — was telling the compiler a link
 * could not carry what a link could carry. Deriving it is what makes the predicate true.
 */
const PROPERTIES: ReadonlySet<string> = new Set<string>(DISPLAY_PROPERTIES);

function isGroupBy(value: string): value is DisplayGroupBy {
  return GROUP_BY.has(value);
}
function isOrderBy(value: string): value is DisplayOrderBy {
  return ORDER_BY.has(value);
}
function isDisplayProperty(value: string): value is DisplayProperty {
  return PROPERTIES.has(value);
}

// ---------------------------------------------------------------------------------------
// The parser
//
// Hand-written and about eighty lines, because the grammar is four productions and a
// tokeniser plus a parser generator would be more code than this and one more thing to
// learn before touching it.

const IDENT = /[A-Za-z0-9_]/;

class Parser {
  private pos = 0;

  constructor(private readonly src: string) {}

  /** node ("," node)* */
  readNodeList(): FilterNode[] {
    const nodes: FilterNode[] = [];
    if (this.peek() === ')' || this.done()) return nodes;
    for (;;) {
      nodes.push(this.readNode());
      if (this.peek() !== ',') return nodes;
      this.pos++;
    }
  }

  private readNode(): FilterNode {
    const start = this.pos;
    const word = this.readIdent();
    if (word === 'and' || word === 'or') {
      // A group, unless a field is ever named `and` — which is why this looks ahead for the
      // parenthesis rather than deciding on the word alone.
      if (this.peek() === '(') {
        this.pos++;
        const nodes = this.readNodeList();
        this.expect(')');
        return { conj: word, nodes };
      }
    }

    if (!isFilterField(word)) {
      throw new FilterError(`filter[${start}]`, `unknown field ${JSON.stringify(word)}`);
    }
    this.expect('.');
    const op = this.readIdent();
    if (!isFilterOp(op)) {
      throw new FilterError(
        `filter[${this.pos - op.length}]`,
        `unknown operator ${JSON.stringify(op)}`,
      );
    }

    if (this.peek() !== '(') {
      return { field: word, op };
    }
    this.pos++;
    const values: string[] = [];
    if (this.peek() !== ')') {
      for (;;) {
        values.push(this.readValue());
        if (this.peek() !== ',') break;
        this.pos++;
      }
    }
    this.expect(')');

    // `()` is two different things, and which one it is follows from the operator.
    //
    // For `in` and `notIn` it is an empty list, which is meaningful and must stay
    // distinguishable from `isNull` — that is why the writer emits the parentheses at all.
    // For an operator that takes exactly one value it cannot mean that, because a clause
    // with no value is one the validator rejects outright: it can only be the one value
    // that encodes to nothing, the empty string. That is not a hypothetical. The filter bar
    // seeds a new Title or Description clause with `contains ''` — the empty string is a
    // legal text value meaning "matches everything", which is what an untouched or cleared
    // search box should do — and reading `title.contains()` back as zero values turned the
    // user's own filter into "this link carried a filter this build could not read" the
    // moment it reached the address bar.
    if (values.length === 0 && takesSingleValue(op)) values.push('');

    return { field: word, op, values };
  }

  private readIdent(): string {
    const start = this.pos;
    while (this.pos < this.src.length && IDENT.test(this.src[this.pos]!)) this.pos++;
    if (this.pos === start) {
      throw new FilterError(`filter[${start}]`, 'expected a field or group name');
    }
    return this.src.slice(start, this.pos);
  }

  private readValue(): string {
    const start = this.pos;
    while (this.pos < this.src.length && !',)'.includes(this.src[this.pos]!)) this.pos++;
    const raw = this.src.slice(start, this.pos);
    try {
      return decodeURIComponent(raw);
    } catch {
      // A truncated escape — `%2` at the end of a link a chat client cut off. Taking the
      // raw text is wrong but recoverable; throwing here would mean the whole link fails
      // because one value lost a character.
      return raw;
    }
  }

  private expect(ch: string): void {
    if (this.peek() !== ch) {
      throw new FilterError(`filter[${this.pos}]`, `expected ${JSON.stringify(ch)}`);
    }
    this.pos++;
  }

  expectEnd(): void {
    if (!this.done()) {
      throw new FilterError(`filter[${this.pos}]`, `unexpected ${JSON.stringify(this.peek())}`);
    }
  }

  private peek(): string | undefined {
    return this.src[this.pos];
  }

  private done(): boolean {
    return this.pos >= this.src.length;
  }
}
