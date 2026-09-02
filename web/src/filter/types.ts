/**
 * The filter grammar, as types.
 *
 * One grammar, one AST, two evaluators: this file is the client's half of the first two.
 * The same bytes live in `view.filter`, in a `SearchInput` and in the store, and the
 * server compiles them to SQL while `evaluate.ts` compiles them to a predicate. What must
 * never exist is a second *grammar* — a filter that means one thing in a saved view and
 * another in search is the failure docs/03-architecture/06-filter-grammar.md was written
 * to prevent, and it is found by a user who stops trusting the tool rather than by a test.
 *
 * So the field table below is not a convenience: it is the definition both `validate.ts`
 * and `evaluate.ts` read, and the one place a new field is added. A field described in two
 * places is a field that will be described differently in two places.
 */

import { CATEGORY_ORDER } from '~/store/types';

/**
 * A node is either a clause or a group, distinguished by their keys rather than by a
 * discriminator field.
 *
 * That is the wire shape and it is not negotiable here: the server writes these bytes and
 * a `kind` field the server does not send would have to be invented on ingest, which is a
 * second definition of the grammar wearing a different hat.
 */
export type FilterNode = FilterClause | FilterGroup;

export interface FilterClause {
  readonly field: FilterField;
  readonly op: FilterOp;
  /**
   * Absent only for `isNull` and `isNotNull`. Every other operator requires it, and an
   * empty array is a meaningful value rather than a missing one: `in []` matches nothing.
   */
  readonly values?: readonly string[];
}

export interface FilterGroup {
  /** Absent means `and`, so that the column default `{}` is a legal, meaningful filter. */
  readonly conj?: Conjunction;
  /** Absent means empty, for the same reason. An AND over nothing is vacuously true. */
  readonly nodes?: readonly FilterNode[];
}

export type Conjunction = 'and' | 'or';

/** The canonical empty filter: matches everything, and what a freshly created view holds. */
export const EMPTY_FILTER: FilterGroup = { conj: 'and', nodes: [] };

export type FilterField =
  | 'state'
  | 'stateCategory'
  | 'assignee'
  | 'creator'
  | 'subscriber'
  | 'priority'
  | 'label'
  | 'team'
  | 'estimate'
  | 'dueDate'
  | 'createdAt'
  | 'updatedAt'
  | 'completedAt'
  | 'title'
  | 'description'
  | 'parent'
  | 'blockedBy'
  | 'blocking'
  | 'archived'
  | 'deleted'
  | 'template'
  | 'recurring'
  | 'customer'
  | 'customerCount'
  | 'customerStatus'
  | 'customerTier'
  | 'customerRevenue'
  | 'customerSize'
  | 'customerImportant';

/** Closed set for `customerStatus`. Wire values match `Customer.status`. */
export const CUSTOMER_STATUSES = ['active', 'prospect', 'churned'] as const;
export type CustomerFilterStatus = (typeof CUSTOMER_STATUSES)[number];

export type FilterOp =
  | 'eq'
  | 'neq'
  | 'in'
  | 'notIn'
  | 'contains'
  | 'notContains'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'isNull'
  | 'isNotNull';

/** Every operator, in the order a picker should offer them. */
export const FILTER_OPS: readonly FilterOp[] = [
  'eq',
  'neq',
  'in',
  'notIn',
  'contains',
  'notContains',
  'gt',
  'gte',
  'lt',
  'lte',
  'isNull',
  'isNotNull',
];

const FILTER_OP_SET: ReadonlySet<string> = new Set<string>(FILTER_OPS);

/**
 * What a field's values are, which decides both how they parse and which operators apply.
 *
 * `enum` is the state category and nothing else today; it is kept general because the next
 * enumerated field will want the same treatment rather than its own branch.
 */
export type FilterValueType =
  'uuid' | 'enum' | 'number' | 'date' | 'timestamp' | 'text' | 'boolean';

export interface FilterFieldSpec {
  readonly type: FilterValueType;
  /**
   * Whether the field can be absent on an issue, which decides two things: whether
   * `isNull` applies, and whether `neq` includes the rows that have no value. It does —
   * see `evaluate.ts`.
   */
  readonly nullable: boolean;
  /**
   * Whether an issue holds a *set* of these rather than one. A multi-valued field matches
   * on "any of", and its `notIn` means "has none of these" rather than "has some other".
   */
  readonly multi: boolean;
  /**
   * Closed vocabulary when `type` is `enum`. `stateCategory` uses the workflow categories;
   * `customerStatus` uses the customer ones. An unknown value is a hard error.
   */
  readonly enums?: readonly string[];
}

/**
 * Every field the grammar knows, and everything the two evaluators need to know about it.
 *
 * An unknown field is a hard error rather than an ignored clause. Ignoring one silently
 * widens the result set, and a filter that matches more than it says is exactly the bug
 * that makes people stop trusting filters.
 */
export const FILTER_FIELDS: Readonly<Record<FilterField, FilterFieldSpec>> = {
  state: { type: 'uuid', nullable: false, multi: false },
  // Filtering by category rather than by status id survives a team renaming its statuses.
  stateCategory: {
    type: 'enum',
    nullable: false,
    multi: false,
    enums: Object.keys(CATEGORY_ORDER),
  },
  assignee: { type: 'uuid', nullable: true, multi: false },
  creator: { type: 'uuid', nullable: true, multi: false },
  // A set per issue: whether that user is subscribed and has not unsubscribed.
  subscriber: { type: 'uuid', nullable: false, multi: true },
  // The raw value — 0 none, 1 urgent … 4 low — not the display rank.
  priority: { type: 'number', nullable: false, multi: false },
  label: { type: 'uuid', nullable: false, multi: true },
  team: { type: 'uuid', nullable: false, multi: false },
  estimate: { type: 'number', nullable: true, multi: false },
  dueDate: { type: 'date', nullable: true, multi: false },
  createdAt: { type: 'timestamp', nullable: false, multi: false },
  updatedAt: { type: 'timestamp', nullable: false, multi: false },
  completedAt: { type: 'timestamp', nullable: true, multi: false },
  title: { type: 'text', nullable: false, multi: false },
  description: { type: 'text', nullable: false, multi: false },
  parent: { type: 'uuid', nullable: true, multi: false },
  // One hop along the `blocks` relation, read from each end.
  blockedBy: { type: 'uuid', nullable: false, multi: true },
  blocking: { type: 'uuid', nullable: false, multi: true },
  // Both are excluded by default; a clause mentioning one turns that default off for the
  // whole filter. See `compileFilter`.
  archived: { type: 'boolean', nullable: false, multi: false },
  deleted: { type: 'boolean', nullable: false, multi: false },
  template: { type: 'uuid', nullable: true, multi: false },
  recurring: { type: 'boolean', nullable: false, multi: false },
  // Requests attributed onto the issue. Multi because one issue can carry several customers.
  customer: { type: 'uuid', nullable: false, multi: true },
  // How many requests the issue has, unattributed ones included. Zero, not null, when none.
  customerCount: { type: 'number', nullable: false, multi: false },
  customerStatus: {
    type: 'enum',
    nullable: false,
    multi: true,
    enums: CUSTOMER_STATUSES,
  },
  // Workspace-defined plan names. Any related customer matching is enough.
  customerTier: { type: 'text', nullable: true, multi: true },
  customerRevenue: { type: 'number', nullable: true, multi: false },
  customerSize: { type: 'number', nullable: true, multi: false },
  customerImportant: { type: 'boolean', nullable: false, multi: false },
};

/**
 * Whether a string names a field this grammar knows.
 *
 * Goes through `hasOwnProperty` rather than indexing: `{"field":"constructor"}` off the
 * wire would otherwise resolve to `Object`'s and be treated as a valid spec.
 */
export function isFilterField(value: string): value is FilterField {
  return Object.prototype.hasOwnProperty.call(FILTER_FIELDS, value);
}

export function isFilterOp(value: string): value is FilterOp {
  return FILTER_OP_SET.has(value);
}

/** Whether a string names one of the seven state categories. */
export function isStateCategory(value: string): boolean {
  return Object.prototype.hasOwnProperty.call(CATEGORY_ORDER, value);
}

const CUSTOMER_STATUS_SET: ReadonlySet<string> = new Set<string>(CUSTOMER_STATUSES);

/** Whether a string names a customer status the grammar accepts. */
export function isCustomerStatus(value: string): boolean {
  return CUSTOMER_STATUS_SET.has(value);
}

/** The types an ordering comparison means anything for. */
const ORDERED: ReadonlySet<FilterValueType> = new Set<FilterValueType>([
  'number',
  'date',
  'timestamp',
]);

/**
 * Whether an operator applies to a field.
 *
 * A mismatch is a hard error for the same reason an unknown field is: `priority contains
 * "1"` has no meaning, and the only ways to handle it are to reject it or to guess.
 */
export function operatorApplies(field: FilterField, op: FilterOp): boolean {
  const spec = FILTER_FIELDS[field];
  switch (op) {
    case 'eq':
    case 'neq':
      return true;
    case 'in':
    case 'notIn':
      // A list of prose is the one pairing the URL cannot carry. `title in [""]` and
      // `title in []` both write as `title.in()` — the empty string encodes to nothing —
      // and the reader has to pick one, so a filter somebody built came back meaning the
      // opposite of what they said. It is also a pairing nobody wants: a title is matched
      // by `contains`, and an exact list of full titles is a query for an id.
      //
      // `customerTier` is the exception and keeps both, because it is text an issue holds
      // a *set* of: "tier is any of Enterprise, Pro" is the natural question about it, its
      // values are workspace-defined names rather than prose, and none of them is empty —
      // `filterContextFor` drops the blank ones before they reach the index.
      return spec.type !== 'text' || spec.multi;
    case 'contains':
    case 'notContains':
      return spec.type === 'text';
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte':
      return ORDERED.has(spec.type);
    case 'isNull':
    case 'isNotNull':
      // A multi-valued field is never null — it is an empty set, which `notIn` over every
      // candidate already expresses.
      return spec.nullable;
  }
}

/** Operators taking exactly one value. `in` and `notIn` take any number, including none. */
const SINGLE_VALUE: ReadonlySet<FilterOp> = new Set<FilterOp>([
  'eq',
  'neq',
  'contains',
  'notContains',
  'gt',
  'gte',
  'lt',
  'lte',
]);

export function takesSingleValue(op: FilterOp): boolean {
  return SINGLE_VALUE.has(op);
}

/** `isNull` and `isNotNull` carry no values at all; anything in `values` is a mistake. */
export function takesNoValues(op: FilterOp): boolean {
  return op === 'isNull' || op === 'isNotNull';
}

export function isFilterClause(node: FilterNode): node is FilterClause {
  return 'field' in node;
}

export function isFilterGroup(node: FilterNode): node is FilterGroup {
  return !('field' in node);
}

/**
 * How a view renders what the filter selected. Stored beside the filter and equally
 * shared, so "group by assignee, ordered by priority" survives being saved, shared and
 * reopened.
 *
 * Every key is optional and absence means the default, because a client built before an
 * option existed must render a view that uses it — degraded, never broken.
 */
export interface DisplayOptions {
  readonly layout?: ViewLayout;
  readonly groupBy?: DisplayGroupBy;
  /**
   * The swimlane inside each group, or `none`. The same vocabulary as `groupBy` because it
   * is the same question asked twice — "status by assignee" and "assignee by status" are
   * one list read two ways, and a second union would have to be kept in step with the
   * first for no gain.
   *
   * Grouping by the dimension already grouped on is not a state the menu offers: every
   * swimlane would hold one row and the header above it would repeat the header above that.
   */
  readonly subGroupBy?: DisplayGroupBy;
  readonly orderBy?: DisplayOrderBy;
  readonly direction?: DisplayDirection;
  /** False hides children whose parent is in the same view. */
  readonly showSubIssues?: boolean;
  readonly showCompleted?: boolean;
  /**
   * Triage only. Snoozed issues stay out of the inbox until the time (or the next
   * edit) unless this is on — Linear's view-options toggle for the queue.
   */
  readonly showSnoozed?: boolean;
  /**
   * Whether a group with nothing in it is still drawn.
   *
   * Off by default, and the default is the interesting half: an empty status column is a
   * place to drop work into, but an assignee with no issues is a person the list has no
   * reason to name. Off keeps the common case quiet; on is what somebody planning a board
   * turns on so every column they can drag into is on screen.
   */
  readonly showEmptyGroups?: boolean;
  /** Which properties each row shows. Unknown names are ignored, never fatal. */
  readonly properties?: readonly DisplayProperty[];
}

export type ViewLayout = 'list' | 'board';

export type DisplayGroupBy =
  | 'none'
  | 'state'
  | 'stateCategory'
  | 'assignee'
  | 'priority'
  | 'label'
  | 'team'
  | 'dueDate'
  | 'parent';

export type DisplayOrderBy =
  | 'manual'
  | 'priority'
  | 'dueDate'
  | 'estimate'
  | 'createdAt'
  | 'updatedAt'
  | 'title'
  | 'customerCount';

export type DisplayDirection = 'asc' | 'desc';

/**
 * Every property a row can be told to show, as data rather than as a bare union.
 *
 * The union is derived from it, and `url.ts` filters an incoming `show=` against this same
 * array — which is the point. The two were written separately once, and the URL's list had
 * grown five names the union had never heard of: `isDisplayProperty` narrowed a string to
 * `DisplayProperty` and returned true for `'progress'`, so a link could put a value into
 * `DisplayOptions` that no exhaustive switch over the union would ever handle. A list and a
 * type that must agree, kept in two places, is a list and a type that will not.
 */
export const DISPLAY_PROPERTIES = [
  'priority',
  'assignee',
  'labels',
  'estimate',
  'dueDate',
  'state',
  'team',
  'project',
  'cycle',
  'createdAt',
  'updatedAt',
  'progress',
] as const;

export type DisplayProperty = (typeof DISPLAY_PROPERTIES)[number];

/**
 * What absence means, mirroring the block in docs/03-architecture/06-filter-grammar.md.
 *
 * Written once here rather than as `?? 'list'` at each read: defaults spread across call
 * sites drift, and a list that groups by status while the board groups by assignee for the
 * same saved view is the visible result.
 */
export const DEFAULT_DISPLAY: Required<DisplayOptions> = {
  layout: 'list',
  groupBy: 'state',
  subGroupBy: 'none',
  orderBy: 'manual',
  direction: 'asc',
  showSubIssues: true,
  showCompleted: true,
  showSnoozed: false,
  showEmptyGroups: false,
  properties: ['priority', 'assignee', 'labels', 'estimate', 'dueDate'],
};
