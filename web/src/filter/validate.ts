/**
 * Strict validation of a filter AST, matching the server's compiler clause for clause.
 *
 * Everything here rejects rather than repairs. An unknown field, an operator that cannot
 * apply, a value of the wrong shape: each of them is a hard error, because the alternative
 * — skipping the clause — silently widens the result set, and a filter that matches more
 * than it says is the precise bug that makes people stop trusting filters. The user who
 * asked for "assigned to nobody in this list" and got "no filter at all" does not report a
 * bug; they stop using saved views.
 *
 * The messages matter as much as the rejection. They are shown in the view bar next to the
 * clause that produced them, and `schema/filter-conformance.json` pins a fragment of each
 * so the two implementations cannot drift into rejecting the same input for different
 * stated reasons.
 */

import {
  FILTER_FIELDS,
  isFilterField,
  isFilterOp,
  isStateCategory,
  operatorApplies,
  takesNoValues,
  takesSingleValue,
  type FilterClause,
  type FilterField,
  type FilterGroup,
  type FilterNode,
  type FilterOp,
} from './types';
import { isRelativeToken } from './relative';

/**
 * A rejected filter, with the path to the node that caused it.
 *
 * The path is what lets the view bar highlight one chip rather than colouring the whole
 * filter red — `nodes[1].values[0]` names the value the user typed, and a message with
 * nowhere to point is a message people learn to ignore.
 */
export class FilterError extends Error {
  readonly path: string;

  constructor(path: string, detail: string) {
    super(path === '' ? detail : `${path}: ${detail}`);
    this.name = 'FilterError';
    this.path = path;
  }
}

/**
 * How deep a filter may nest.
 *
 * Not a product rule — nobody builds a filter eight levels deep, let alone thirty-two. It
 * is a bound on the recursion, so a malformed payload off the socket fails as a rejected
 * filter rather than as a stack overflow that takes the tab with it.
 */
const MAX_DEPTH = 32;

/** Canonical hyphenated form. The version and variant nibbles are the server's business. */
const UUID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/** Integers only: priority is a fixed scale and an estimate is a point value. */
const INTEGER_PATTERN = /^[+-]?\d+$/;

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** RFC 3339, which is what the server writes and what `Time` carries on the wire. */
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2}(\.\d+)?([Zz]|[+-]\d{2}:\d{2})$/;

/**
 * Validates a filter off the wire, out of a saved view, or out of the view bar.
 *
 * Returns a rebuilt tree rather than the input. It costs one small object per node, once
 * per filter change rather than per row, and it buys the guarantee the rest of the module
 * relies on: what comes back carries the grammar's keys and nothing else, so `evaluate.ts`
 * never has to ask whether a node it is compiling was checked.
 */
export function validateFilter(input: unknown): FilterNode {
  return validateNode(input, '', 0);
}

/** Whether a value is a filter this build can evaluate. For call sites with no error to show. */
export function isValidFilter(input: unknown): input is FilterNode {
  try {
    validateFilter(input);
    return true;
  } catch (error) {
    if (error instanceof FilterError) return false;
    throw error;
  }
}

function validateNode(input: unknown, path: string, depth: number): FilterNode {
  if (depth > MAX_DEPTH) {
    throw new FilterError(path, `a filter may not nest more than ${MAX_DEPTH} levels deep`);
  }
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new FilterError(path, 'a node must be a clause or a group');
  }

  const record = input as Record<string, unknown>;
  if ('field' in record) return validateClause(record, path);
  if ('conj' in record || 'nodes' in record) return validateGroup(record, path, depth);
  // `{}` is the column default and means the canonical empty filter — an AND over nothing,
  // which matches everything. Rejecting it would make a freshly created view unopenable.
  if (Object.keys(record).length === 0) return { conj: 'and', nodes: [] };

  throw new FilterError(path, 'a node must be a clause or a group');
}

const CLAUSE_KEYS: ReadonlySet<string> = new Set(['field', 'op', 'values']);
const GROUP_KEYS: ReadonlySet<string> = new Set(['conj', 'nodes']);

function validateClause(record: Record<string, unknown>, path: string): FilterClause {
  rejectUnknownKeys(record, CLAUSE_KEYS, path, 'a clause carries field, op and values');

  const name = record['field'];
  if (typeof name !== 'string' || !isFilterField(name)) {
    throw new FilterError(path, `unknown field ${quote(name)}`);
  }
  const field: FilterField = name;

  const operator = record['op'];
  if (typeof operator !== 'string' || !isFilterOp(operator)) {
    throw new FilterError(path, `unknown operator ${quote(operator)}`);
  }
  const op: FilterOp = operator;

  if (!operatorApplies(field, op)) {
    throw new FilterError(
      path,
      `operator "${op}" does not apply to ${field}, which holds ${describe(field)}`,
    );
  }

  const raw = record['values'];
  if (takesNoValues(op)) {
    // Absent, not merely empty. A clause carrying values its operator cannot use was built
    // by something that believes the operator means something else.
    if (raw !== undefined) throw new FilterError(path, `"${op}" takes no values`);
    return { field, op };
  }

  if (raw === undefined) throw new FilterError(path, `"${op}" requires values`);
  if (!Array.isArray(raw)) throw new FilterError(path, 'values must be an array of strings');
  if (takesSingleValue(op) && raw.length !== 1) {
    throw new FilterError(path, `"${op}" takes exactly one value, and values has ${raw.length}`);
  }

  const values: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    const value: unknown = raw[i];
    const at = join(path, `values[${i}]`);
    if (typeof value !== 'string') {
      throw new FilterError(at, 'values must be an array of strings');
    }
    validateValue(value, field, at);
    values.push(value);
  }

  return { field, op, values };
}

function validateGroup(record: Record<string, unknown>, path: string, depth: number): FilterGroup {
  rejectUnknownKeys(record, GROUP_KEYS, path, 'a group carries conj and nodes');

  const conj = record['conj'];
  if (conj !== undefined && conj !== 'and' && conj !== 'or') {
    throw new FilterError(path, `${quote(conj)} is not a conjunction`);
  }

  const raw = record['nodes'];
  if (raw !== undefined && !Array.isArray(raw)) {
    throw new FilterError(path, 'nodes must be an array of clauses and groups');
  }

  const nodes: FilterNode[] =
    raw === undefined
      ? []
      : raw.map((child: unknown, i: number) =>
          validateNode(child, join(path, `nodes[${i}]`), depth + 1),
        );

  // An absent conjunction means `and`, and stating it in the validated tree means nothing
  // downstream has to remember that.
  return { conj: conj ?? 'and', nodes };
}

function rejectUnknownKeys(
  record: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  path: string,
  detail: string,
): void {
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) throw new FilterError(path, `${detail}; "${key}" is not one of them`);
  }
}

function validateValue(value: string, field: FilterField, path: string): void {
  switch (FILTER_FIELDS[field].type) {
    case 'uuid':
      if (!UUID_PATTERN.test(value)) throw new FilterError(path, `"${value}" is not a uuid`);
      return;
    case 'number':
      if (!INTEGER_PATTERN.test(value)) throw new FilterError(path, `"${value}" is not a number`);
      return;
    case 'enum':
      if (!isStateCategory(value)) {
        throw new FilterError(path, `"${value}" is not a state category`);
      }
      return;
    case 'boolean':
      if (value !== 'true' && value !== 'false') {
        throw new FilterError(path, `"${value}" is not a boolean`);
      }
      return;
    case 'date':
      // A relative token stays a token: resolving it here would freeze "this week" to the
      // week the view was saved in, which is the bug the grammar's relative dates exist to
      // avoid.
      if (isRelativeToken(value)) return;
      if (!isCalendarDate(value)) throw new FilterError(path, `"${value}" is not a date`);
      return;
    case 'timestamp':
      if (isRelativeToken(value)) return;
      if (!TIMESTAMP_PATTERN.test(value) || Number.isNaN(Date.parse(value))) {
        throw new FilterError(path, `"${value}" is not an RFC 3339 timestamp`);
      }
      return;
    case 'text':
      // Anything a person can type, the empty string included: `contains ""` matches
      // everything, which is what a cleared search box should do.
      return;
  }
}

/**
 * A date that exists. The pattern alone accepts `2026-02-31`, and a day that is not a day
 * compares perfectly happily against every stored due date — silently, and wrongly.
 */
function isCalendarDate(value: string): boolean {
  const parts = DATE_PATTERN.exec(value);
  if (parts === null) return false;
  const year = Number(parts[1]);
  const month = Number(parts[2]);
  const day = Number(parts[3]);
  if (month < 1 || month > 12 || day < 1) return false;
  return day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function join(path: string, suffix: string): string {
  return path === '' ? suffix : `${path}.${suffix}`;
}

function describe(field: FilterField): string {
  switch (FILTER_FIELDS[field].type) {
    case 'uuid':
      return 'an id';
    case 'enum':
      return 'a state category';
    case 'number':
      return 'a number';
    case 'date':
      return 'a date';
    case 'timestamp':
      return 'a timestamp';
    case 'text':
      return 'text';
    case 'boolean':
      return 'a flag';
  }
}

function quote(value: unknown): string {
  return typeof value === 'string' ? `"${value}"` : String(value);
}
