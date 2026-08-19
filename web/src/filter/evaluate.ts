/**
 * Compiles a validated filter into a predicate over an issue.
 *
 * Compiled, not interpreted, and that is the whole design. This runs over five thousand
 * issues on every keystroke — there is deliberately no debouncing, because a list that
 * lags a keystroke feels broken in a way no amount of eventual correctness fixes — and the
 * budget is under 50ms for the lot. Walking the AST per row would pay the cost of reading
 * the filter five thousand times over: a switch on the field, a switch on the operator,
 * a parse of every value, per issue. Here every one of those decisions is made once, when
 * the filter changes, and what survives into the loop is a closure that reads two
 * properties and compares them.
 *
 * The semantics are pinned by `schema/filter-conformance.json`, which the server's
 * compiler runs against the same cases. Where a rule below looks arbitrary it is almost
 * certainly a case in that file, and the comment says which.
 */

import { foldExact } from '~/store/indexes';
import type { Issue, UUID, WorkflowState } from '~/store/types';

import { resolveRelative, type TimeContext } from './relative';
import { isFilterClause, type FilterClause, type FilterField, type FilterNode } from './types';
import { FilterError } from './validate';

export type IssuePredicate = (issue: Issue) => boolean;

/**
 * Everything a filter needs that is not on the issue itself.
 *
 * Maps rather than callbacks: the store already holds these as maps, so passing them
 * costs nothing, and a callback per lookup would put a call in the inner loop for a
 * `.get`. Absent from a map means "none" in every case — an issue with no labels simply is
 * not a key.
 */
export interface FilterContext {
  readonly time: TimeContext;
  /** Workflow states by id, for the `stateCategory` field. */
  readonly states: ReadonlyMap<UUID, WorkflowState>;
  readonly labels: ReadonlyMap<UUID, ReadonlySet<UUID>>;
  /** Subscribers per issue, with the unsubscribed already removed — see `subscriber`. */
  readonly subscribers: ReadonlyMap<UUID, ReadonlySet<UUID>>;
  /** For each issue, the issues blocking it. */
  readonly blockedBy: ReadonlyMap<UUID, ReadonlySet<UUID>>;
  /** For each issue, the issues it blocks: the same `blocks` rows read from the other end. */
  readonly blocking: ReadonlyMap<UUID, ReadonlySet<UUID>>;
  /**
   * Issues the caller knows to be soft-deleted.
   *
   * Empty or absent in every ordinary view, and that is not an omission: `model.Issue`
   * does not serialise `deleted_at`, so a delete reaches the client as `op: 'delete'` and
   * the issue leaves the replica entirely. The set exists because trash — issues inside
   * the restore window, fetched deliberately — is the one screen that holds them, and a
   * `deleted` field the client silently ignored would be a second grammar.
   */
  readonly deleted?: ReadonlySet<UUID> | undefined;
}

const ALWAYS: IssuePredicate = () => true;
const NEVER: IssuePredicate = () => false;

/**
 * Compiles a filter, including the archived and deleted defaults.
 *
 * Those defaults are applied here, once, over the whole filter rather than inside each
 * group. That placement is the rule, not an implementation detail: a group is allowed to
 * turn the default off for the entire query, and scoping it per group would let an OR
 * resurrect deleted issues into a view that never asked for them.
 */
export function compileFilter(filter: FilterNode, context: FilterContext): IssuePredicate {
  const mentioned = new Set<FilterField>();
  collectFields(filter, mentioned);

  const parts: IssuePredicate[] = [];
  if (!mentioned.has('archived')) {
    parts.push((issue) => issue.archivedAt === undefined);
  }
  if (!mentioned.has('deleted') && context.deleted !== undefined) {
    const deleted = context.deleted;
    parts.push((issue) => !deleted.has(issue.id));
  }
  if (!mentioned.has('state') && !mentioned.has('stateCategory')) {
    const states = context.states;
    parts.push((issue) => states.get(issue.stateId)?.category !== 'triage');
  }
  // The gates go first so a filter over a corpus full of archived work stops before it
  // reads anything the clauses would have had to compute.
  parts.push(compileNode(filter, context));
  return all(parts);
}

/**
 * The ids matching a filter, in the order the source yields them.
 *
 * Ordering is a display option and is applied separately — mixing the two here would make
 * a change to a sort look like a filter regression.
 */
export function filterIssues(
  issues: Iterable<Issue>,
  filter: FilterNode,
  context: FilterContext,
): UUID[] {
  const matches = compileFilter(filter, context);
  const ids: UUID[] = [];
  for (const issue of issues) {
    if (matches(issue)) ids.push(issue.id);
  }
  return ids;
}

function collectFields(node: FilterNode, into: Set<FilterField>): void {
  if (isFilterClause(node)) {
    into.add(node.field);
    return;
  }
  for (const child of node.nodes ?? []) collectFields(child, into);
}

function compileNode(node: FilterNode, context: FilterContext): IssuePredicate {
  if (isFilterClause(node)) return compileClause(node, context);
  const parts = (node.nodes ?? []).map((child) => compileNode(child, context));
  // An AND over nothing is vacuously true, which is what makes `{}` — the column default —
  // a filter that matches everything. An OR over nothing is vacuously false by the same
  // arithmetic.
  return node.conj === 'or' ? any(parts) : all(parts);
}

function all(parts: readonly IssuePredicate[]): IssuePredicate {
  if (parts.length === 0) return ALWAYS;
  const only = parts[0];
  if (parts.length === 1 && only !== undefined) return only;
  return (issue) => {
    for (const part of parts) {
      if (!part(issue)) return false;
    }
    return true;
  };
}

function any(parts: readonly IssuePredicate[]): IssuePredicate {
  if (parts.length === 0) return NEVER;
  const only = parts[0];
  if (parts.length === 1 && only !== undefined) return only;
  return (issue) => {
    for (const part of parts) {
      if (part(issue)) return true;
    }
    return false;
  };
}

function compileClause(clause: FilterClause, context: FilterContext): IssuePredicate {
  switch (clause.field) {
    case 'state':
      return compileEquality(clause, (issue) => issue.stateId, asText);
    case 'stateCategory': {
      const states = context.states;
      // An issue whose status this replica has not received yet reads as having no
      // category, and is then treated exactly like a null: `eq` misses it, `neq` keeps it.
      // Dropping it from both would make a clause and its negation disagree about how many
      // issues the workspace has.
      return compileEquality(clause, (issue) => states.get(issue.stateId)?.category, asText);
    }
    case 'assignee':
      return compileEquality(clause, (issue) => issue.assigneeId, asText);
    case 'creator':
      return compileEquality(clause, (issue) => issue.creatorId, asText);
    case 'team':
      return compileEquality(clause, (issue) => issue.teamId, asText);
    case 'parent':
      return compileEquality(clause, (issue) => issue.parentId, asText);

    case 'title':
      return compileTextClause(clause, (issue) => issue.title);
    case 'description':
      return compileTextClause(clause, (issue) => issue.description);

    case 'priority':
      return compileOrdered(clause, (issue) => issue.priority, asNumber);
    case 'estimate':
      // Absent is unestimated, which is not zero: `estimate lt 3` must not sweep up every
      // issue nobody has sized yet.
      return compileOrdered(clause, (issue) => issue.estimate, asNumber);

    case 'dueDate':
      // Compared as `2006-01-02` strings, which sort as dates for free. A due date is a day
      // in the team's calendar, not an instant, and turning it into one moves it a day for
      // everybody west of whoever set it.
      return compileOrdered(clause, (issue) => issue.dueDate, dateParser(context.time));

    case 'createdAt':
      return compileTimestamp(clause, (issue) => issue.createdAt, context.time);
    case 'updatedAt':
      return compileTimestamp(clause, (issue) => issue.updatedAt, context.time);
    case 'completedAt':
      return compileTimestamp(clause, (issue) => issue.completedAt, context.time);

    case 'label': {
      const labels = context.labels;
      return compileMembership(clause, (issue) => labels.get(issue.id));
    }
    case 'subscriber': {
      const subscribers = context.subscribers;
      return compileMembership(clause, (issue) => subscribers.get(issue.id));
    }
    case 'blockedBy': {
      const blockedBy = context.blockedBy;
      return compileMembership(clause, (issue) => blockedBy.get(issue.id));
    }
    case 'blocking': {
      const blocking = context.blocking;
      return compileMembership(clause, (issue) => blocking.get(issue.id));
    }

    case 'archived':
      return compileEquality(clause, (issue) => issue.archivedAt !== undefined, asBoolean);
    case 'deleted': {
      const deleted = context.deleted;
      return compileEquality(
        clause,
        (issue) => deleted !== undefined && deleted.has(issue.id),
        asBoolean,
      );
    }
    case 'template':
      return compileEquality(clause, (issue) => issue.templateId, asText);
    case 'recurring':
      return compileEquality(clause, (issue) => issue.recurringIssueId !== undefined, asBoolean);
  }
}

type Read<T> = (issue: Issue) => T | undefined;

/**
 * Equality and set membership over a single-valued field.
 *
 * `neq` and `notIn` deliberately keep the rows with no value. SQL's three-valued logic
 * drops them — `NULL <> 'ada'` is `NULL` — and the person who asked for "everything not
 * assigned to Ada" does not get the unassigned ones, which is the opposite of what the
 * words mean.
 */
function compileEquality<T extends string | number | boolean>(
  clause: FilterClause,
  read: Read<T>,
  parse: (value: string) => T,
): IssuePredicate {
  switch (clause.op) {
    case 'isNull':
      return (issue) => read(issue) === undefined;
    case 'isNotNull':
      return (issue) => read(issue) !== undefined;
    case 'eq': {
      const wanted = parse(single(clause));
      return (issue) => read(issue) === wanted;
    }
    case 'neq': {
      const wanted = parse(single(clause));
      return (issue) => {
        const value = read(issue);
        return value === undefined || value !== wanted;
      };
    }
    case 'in': {
      // An empty in-list matches nothing. The obvious SQL for it is a syntax error and the
      // obvious fix is to skip the clause, which turns "assigned to nobody in this list"
      // into "no filter at all".
      const wanted = parseSet(clause, parse);
      if (wanted.size === 0) return NEVER;
      return (issue) => {
        const value = read(issue);
        return value !== undefined && wanted.has(value);
      };
    }
    case 'notIn': {
      // And an empty notIn-list matches everything, by the same set semantics.
      const wanted = parseSet(clause, parse);
      if (wanted.size === 0) return ALWAYS;
      return (issue) => {
        const value = read(issue);
        return value === undefined || !wanted.has(value);
      };
    }
    default:
      throw new FilterError('', `operator "${clause.op}" does not apply to ${clause.field}`);
  }
}

/** Everything equality does, plus the ordering comparisons. Null orders against nothing. */
function compileOrdered<T extends string | number>(
  clause: FilterClause,
  read: Read<T>,
  parse: (value: string) => T,
): IssuePredicate {
  switch (clause.op) {
    case 'gt': {
      const bound = parse(single(clause));
      return (issue) => {
        const value = read(issue);
        return value !== undefined && value > bound;
      };
    }
    case 'gte': {
      const bound = parse(single(clause));
      return (issue) => {
        const value = read(issue);
        return value !== undefined && value >= bound;
      };
    }
    case 'lt': {
      const bound = parse(single(clause));
      return (issue) => {
        const value = read(issue);
        return value !== undefined && value < bound;
      };
    }
    case 'lte': {
      const bound = parse(single(clause));
      return (issue) => {
        const value = read(issue);
        return value !== undefined && value <= bound;
      };
    }
    default:
      return compileEquality(clause, read, parse);
  }
}

/**
 * Timestamps compare as parsed instants, never as strings.
 *
 * Go trims trailing zeros from an RFC 3339 fraction, so `…:00.5Z` and `…:00.55Z` compare
 * as `5Z` against `55Z` and the earlier instant wins. `isNull` is answered before the parse
 * because asking whether a field is set does not require knowing when.
 */
function compileTimestamp(
  clause: FilterClause,
  read: Read<string>,
  time: TimeContext,
): IssuePredicate {
  if (clause.op === 'isNull') return (issue) => read(issue) === undefined;
  if (clause.op === 'isNotNull') return (issue) => read(issue) !== undefined;

  return compileOrdered(
    clause,
    (issue) => {
      const raw = read(issue);
      return raw === undefined ? undefined : Date.parse(raw);
    },
    instantParser(time),
  );
}

/** `contains` folds; `eq` does not. Exact is what somebody typing a full title into `eq` meant. */
function compileTextClause(clause: FilterClause, read: Read<string>): IssuePredicate {
  if (clause.op !== 'contains' && clause.op !== 'notContains') {
    return compileEquality(clause, read, asText);
  }

  // Folded once here rather than per row, and folded with `foldExact` — the restatement of
  // the database's `search_fold` — because this clause has a second implementation in
  // internal/filter that compiles it to `search_fold(col) LIKE …`. The store's `fold` also
  // collapses whitespace and trims, which is right for ordering and wrong here: it rewrites
  // the needle, so a filter matched on screen and returned nothing from the API. See the
  // whitespace cases in schema/filter-conformance.json.
  const needle = foldExact(single(clause));
  const negated = clause.op === 'notContains';
  return (issue) => {
    const value = read(issue);
    const hit = value !== undefined && foldExact(value).includes(needle);
    return negated ? !hit : hit;
  };
}

/**
 * A multi-valued field: label, subscriber, and the two ends of a blocks relation.
 *
 * `notIn` means "has none of these", not "has some label that is not one of these". Every
 * issue with two labels matches the second reading, and almost none of them are what was
 * asked for.
 */
function compileMembership(
  clause: FilterClause,
  read: (issue: Issue) => ReadonlySet<UUID> | undefined,
): IssuePredicate {
  switch (clause.op) {
    case 'eq': {
      const wanted = single(clause);
      return (issue) => read(issue)?.has(wanted) === true;
    }
    case 'neq': {
      const wanted = single(clause);
      return (issue) => read(issue)?.has(wanted) !== true;
    }
    case 'in': {
      const wanted = distinct(values(clause));
      if (wanted.length === 0) return NEVER;
      return (issue) => holdsAny(read(issue), wanted);
    }
    case 'notIn': {
      const wanted = distinct(values(clause));
      if (wanted.length === 0) return ALWAYS;
      return (issue) => !holdsAny(read(issue), wanted);
    }
    default:
      throw new FilterError('', `operator "${clause.op}" does not apply to ${clause.field}`);
  }
}

/**
 * Walks the wanted values rather than the issue's set: a clause names one or two labels
 * while an issue can carry a dozen, and `Set.has` is the cheap side of the pair.
 */
function holdsAny(held: ReadonlySet<UUID> | undefined, wanted: readonly UUID[]): boolean {
  if (held === undefined || held.size === 0) return false;
  for (const value of wanted) {
    if (held.has(value)) return true;
  }
  return false;
}

function distinct(list: readonly string[]): string[] {
  return [...new Set(list)];
}

function asText(value: string): string {
  return value;
}

function asNumber(value: string): number {
  return Number(value);
}

function asBoolean(value: string): boolean {
  return value === 'true';
}

/** Resolves a relative token to a calendar day, and passes an absolute date through. */
function dateParser(time: TimeContext): (value: string) => string {
  return (value) => (isAbsolute(value) ? value : resolveRelative(value, time).date);
}

/** Resolves a relative token to an instant, and parses an absolute timestamp into one. */
function instantParser(time: TimeContext): (value: string) => number {
  return (value) => (isAbsolute(value) ? Date.parse(value) : resolveRelative(value, time).instant);
}

/**
 * Absolute values start with a digit; every relative token starts with a sign or a letter.
 * Cheaper and more honest than re-running the validator's patterns at compile time.
 */
function isAbsolute(value: string): boolean {
  const first = value.charCodeAt(0);
  return first >= 48 && first <= 57;
}

function values(clause: FilterClause): readonly string[] {
  if (clause.values === undefined) {
    throw new FilterError('', `"${clause.op}" requires values; compile a validated filter`);
  }
  return clause.values;
}

function single(clause: FilterClause): string {
  const first = values(clause)[0];
  if (first === undefined) {
    throw new FilterError('', `"${clause.op}" takes exactly one value; compile a validated filter`);
  }
  return first;
}

function parseSet<T>(clause: FilterClause, parse: (value: string) => T): ReadonlySet<T> {
  const out = new Set<T>();
  for (const value of values(clause)) out.add(parse(value));
  return out;
}
