/**
 * The conformance fixture, run against this evaluator.
 *
 * `schema/filter-conformance.json` holds a small workspace, a list of filters and the ids
 * each must return. The Go suite inserts the same workspace into Postgres and runs its
 * compiled SQL against the same cases. Neither suite computes the expected answer — it is
 * recorded in the file, so a change that makes both implementations agree on something
 * wrong still fails.
 *
 * Adding a case is the way to fix a filter bug. Fixing one implementation without adding a
 * case leaves the other one wrong, which is the state this file exists to make impossible.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type { Issue, StateCategory, Timestamp, UUID, WorkflowState } from '~/store/types';

import { filterIssues, type FilterContext } from './evaluate';
import { RELATIVE_KEYWORDS, resolveRelative } from './relative';
import { FILTER_FIELDS, isFilterField } from './types';
import { FilterError, validateFilter } from './validate';

interface FixtureTeam {
  readonly id: UUID;
  readonly key: string;
  readonly name: string;
}

interface FixtureState {
  readonly id: UUID;
  readonly teamId: UUID;
  readonly name: string;
  readonly category: StateCategory;
  readonly position: string;
  readonly isDefault: boolean;
}

interface FixtureIssue {
  readonly id: UUID;
  readonly teamId: UUID;
  readonly number: number;
  readonly title: string;
  readonly description: string;
  readonly stateId: UUID;
  readonly assigneeId?: UUID;
  readonly creatorId?: UUID;
  readonly priority: number;
  readonly estimate?: number;
  readonly dueDate?: string;
  readonly sortOrder: string;
  readonly parentId?: UUID;
  readonly subIssueSortOrder?: string;
  readonly labelIds: readonly UUID[];
  readonly templateId?: UUID;
  readonly recurringIssueId?: UUID;
  readonly completedAt?: Timestamp;
  readonly archivedAt?: Timestamp;
  readonly deletedAt?: Timestamp;
  readonly createdAt: Timestamp;
  readonly updatedAt: Timestamp;
}

interface FixtureRelation {
  readonly issueId: UUID;
  readonly relatedIssueId: UUID;
  readonly type: string;
}

interface FixtureSubscription {
  readonly issueId: UUID;
  readonly userId: UUID;
  readonly unsubscribed: boolean;
}

interface FixtureCustomer {
  readonly id: UUID;
  readonly status: string;
  readonly tier?: string;
  readonly revenue?: number;
  readonly size?: number;
}

interface FixtureCustomerRequest {
  readonly issueId: UUID;
  readonly customerId?: UUID;
  readonly important: boolean;
}

interface Fixture {
  readonly evaluatedAt: Timestamp;
  readonly timezone: string;
  /** Token to the exact UTC instant it resolves to at `evaluatedAt`. `$comment` is lines. */
  readonly relativeTokens: Readonly<Record<string, string | readonly string[]>>;
  readonly workspace: { readonly id: UUID };
  readonly teams: readonly FixtureTeam[];
  readonly workflowStates: readonly FixtureState[];
  readonly issues: readonly FixtureIssue[];
  readonly relations: readonly FixtureRelation[];
  readonly subscriptions: readonly FixtureSubscription[];
  readonly customers: readonly FixtureCustomer[];
  readonly customerRequests: readonly FixtureCustomerRequest[];
  readonly cases: readonly {
    readonly name: string;
    readonly filter: unknown;
    readonly expect: readonly string[];
  }[];
  readonly errors: readonly {
    readonly name: string;
    readonly filter: unknown;
    readonly message: string;
  }[];
}

/**
 * Read rather than imported: the fixture is the schema's, shared with the Go suite, and
 * `import`ing it would inline a copy into the bundle graph and give TypeScript a literal
 * type for a file whose shape is declared above anyway.
 */
// Resolved from this file rather than from the working directory so the suite runs the
// same whether vitest was started in `web/` or at the repository root. Deliberately not
// `new URL(path, import.meta.url)`: vite rewrites that form into an asset URL served over
// http, which node:fs cannot open.
const FIXTURE_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../schema/filter-conformance.json',
);

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as Fixture;

/**
 * Short names expand to `01900000-0000-7000-8000-` + the name left-padded to twelve.
 *
 * Written out in full these arrays are unreadable, and an unreadable fixture is one nobody
 * checks when it disagrees with them. Both loaders expand the same way.
 */
const ID_PREFIX = '01900000-0000-7000-8000-';
const SHORT_NAME = /^[0-9a-f]{1,12}$/;

function expandId(name: string): UUID {
  return SHORT_NAME.test(name) ? ID_PREFIX + name.padStart(12, '0') : name;
}

/**
 * Expands short names inside a filter's `values`, and only for the fields that hold ids.
 *
 * Type-driven rather than shape-driven on purpose: `"1"` is a short name by every pattern
 * you could write, and expanding a priority into a uuid would make the fixture's simplest
 * case fail for a reason nobody would find.
 */
function expandFilter(node: unknown): unknown {
  if (typeof node !== 'object' || node === null) return node;
  const record = node as Record<string, unknown>;

  const nodes = record['nodes'];
  if (Array.isArray(nodes)) return { ...record, nodes: nodes.map(expandFilter) };

  const field = record['field'];
  const values = record['values'];
  if (
    typeof field === 'string' &&
    isFilterField(field) &&
    FILTER_FIELDS[field].type === 'uuid' &&
    Array.isArray(values)
  ) {
    return {
      ...record,
      values: values.map((value: unknown) => (typeof value === 'string' ? expandId(value) : value)),
    };
  }
  return record;
}

const NOW: Timestamp = '2026-01-01T00:00:00Z';

const teamKeys = new Map<UUID, string>(fixture.teams.map((team) => [team.id, team.key]));

const issues: Issue[] = fixture.issues.map((row) => ({
  id: row.id,
  workspaceId: fixture.workspace.id,
  teamId: row.teamId,
  number: row.number,
  identifier: `${teamKeys.get(row.teamId) ?? '?'}-${row.number}`,
  title: row.title,
  description: row.description,
  stateId: row.stateId,
  assigneeId: row.assigneeId,
  creatorId: row.creatorId,
  priority: row.priority,
  sortOrder: row.sortOrder,
  estimate: row.estimate,
  dueDate: row.dueDate,
  dueDateSource: 'manual',
  parentId: row.parentId,
  subIssueSortOrder: row.subIssueSortOrder,
  templateId: row.templateId,
  recurringIssueId: row.recurringIssueId,
  completedAt: row.completedAt,
  archivedAt: row.archivedAt,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
}));

const states = new Map<UUID, WorkflowState>(
  fixture.workflowStates.map((row) => [
    row.id,
    {
      id: row.id,
      workspaceId: fixture.workspace.id,
      teamId: row.teamId,
      name: row.name,
      color: '#888888',
      category: row.category,
      position: row.position,
      isDefault: row.isDefault,
      isSystem: false,
      createdAt: NOW,
      updatedAt: NOW,
    },
  ]),
);

function collect(rows: Iterable<readonly [UUID, UUID]>): ReadonlyMap<UUID, ReadonlySet<UUID>> {
  const out = new Map<UUID, Set<UUID>>();
  for (const [key, value] of rows) {
    const bucket = out.get(key);
    if (bucket === undefined) out.set(key, new Set([value]));
    else bucket.add(value);
  }
  return out;
}

function addToSet(map: Map<UUID, Set<string>>, issueId: UUID, value: string): void {
  const bucket = map.get(issueId);
  if (bucket === undefined) map.set(issueId, new Set([value]));
  else bucket.add(value);
}

const byCustomer = new Map(fixture.customers.map((row) => [row.id, row]));

const customerMaps = (() => {
  const customers = new Map<UUID, Set<UUID>>();
  const counts = new Map<UUID, number>();
  const statuses = new Map<UUID, Set<string>>();
  const tiers = new Map<UUID, Set<string>>();
  const revenues = new Map<UUID, number[]>();
  const sizes = new Map<UUID, number[]>();
  const important = new Set<UUID>();
  for (const request of fixture.customerRequests ?? []) {
    counts.set(request.issueId, (counts.get(request.issueId) ?? 0) + 1);
    if (request.important) important.add(request.issueId);
    if (request.customerId === undefined) continue;
    const customer = byCustomer.get(request.customerId);
    if (customer === undefined) continue;
    addToSet(customers, request.issueId, customer.id);
    addToSet(statuses, request.issueId, customer.status);
    if (customer.tier !== undefined) addToSet(tiers, request.issueId, customer.tier);
    if (customer.revenue !== undefined) {
      const bucket = revenues.get(request.issueId);
      if (bucket === undefined) revenues.set(request.issueId, [customer.revenue]);
      else bucket.push(customer.revenue);
    }
    if (customer.size !== undefined) {
      const bucket = sizes.get(request.issueId);
      if (bucket === undefined) sizes.set(request.issueId, [customer.size]);
      else bucket.push(customer.size);
    }
  }
  return { customers, counts, statuses, tiers, revenues, sizes, important };
})();

const context: FilterContext = {
  time: { now: Date.parse(fixture.evaluatedAt), timezone: fixture.timezone },
  states,
  labels: collect(fixture.issues.flatMap((row) => row.labelIds.map((id) => [row.id, id] as const))),
  // An explicit unsubscribe is a flag rather than a missing row, so the flagged rows are
  // dropped here: `subscriber eq grace` must not return an issue she unsubscribed from.
  subscribers: collect(
    fixture.subscriptions
      .filter((row) => !row.unsubscribed)
      .map((row) => [row.issueId, row.userId] as const),
  ),
  // Only `blocks` is stored, and "blocked by" is the same row read from the other end.
  blockedBy: collect(
    fixture.relations
      .filter((row) => row.type === 'blocks')
      .map((row) => [row.relatedIssueId, row.issueId] as const),
  ),
  blocking: collect(
    fixture.relations
      .filter((row) => row.type === 'blocks')
      .map((row) => [row.issueId, row.relatedIssueId] as const),
  ),
  customers: customerMaps.customers,
  customerCount: customerMaps.counts,
  customerStatus: customerMaps.statuses,
  customerTier: customerMaps.tiers,
  customerRevenue: customerMaps.revenues,
  customerSize: customerMaps.sizes,
  customerImportant: customerMaps.important,
  // The replica normally holds no deleted issues at all; the fixture supplies them the way
  // a trash view would, so that `deleted eq true` has something to find.
  deleted: new Set(
    fixture.issues.filter((row) => row.deletedAt !== undefined).map((row) => row.id),
  ),
};

describe('filter conformance', () => {
  it('loaded the fixture the Go suite runs', () => {
    expect(fixture.cases.length).toBeGreaterThan(0);
    expect(fixture.errors.length).toBeGreaterThan(0);
    expect(issues).toHaveLength(fixture.issues.length);
  });

  for (const testCase of fixture.cases) {
    it(testCase.name, () => {
      const filter = validateFilter(expandFilter(testCase.filter));
      // Compared as a set, sorted: ordering is a display option and is tested separately.
      // Mixing the two here would make an ordering change look like a filter regression.
      const got = filterIssues(issues, filter, context).sort();
      expect(got).toEqual(testCase.expect.map(expandId).sort());
    });
  }
});

describe('filter conformance errors', () => {
  for (const testCase of fixture.errors) {
    it(testCase.name, () => {
      // Rejected, not silently ignored. An ignored clause widens the result set, and a
      // filter that quietly matches more than it says is the bug that makes people stop
      // trusting filters.
      let thrown: unknown;
      try {
        validateFilter(expandFilter(testCase.filter));
      } catch (error) {
        thrown = error;
      }
      expect(thrown, 'the filter must be rejected').toBeInstanceOf(FilterError);
      // The fixture pins a fragment of the message so the two implementations cannot drift
      // into rejecting the same input for different stated reasons.
      expect((thrown as FilterError).message).toContain(testCase.message);
    });
  }
});

/**
 * Every relative token, resolved, against the instants recorded in the fixture.
 *
 * The cases above already compare id sets, and this asks a stricter question of a smaller
 * thing: not "do the two evaluators select the same issues" but "do they resolve the same
 * token to the same instant". The fixture holds seven issues, and with seven issues a great
 * many wrong instants still select the right rows — a resolver that ignored the workspace
 * timezone would pass every date case above, because nothing in the fixture was created
 * within an hour of midnight.
 *
 * It also reaches what the case list structurally cannot. A case using a token only one side
 * accepts fails on the side that rejects it, so nobody writes one, so exactly the divergence
 * this file exists to prevent is the one it cannot see. Five tokens sat in that blind spot:
 * this evaluator shipped `now`, `yesterday`, `tomorrow`, `startOfMonth` and `startOfYear`,
 * and the server's `parseRelative` refused all five — so the filter bar built filters that
 * worked here and that `CreateView` then declined to save.
 *
 * services/internal/filter/relative_conformance_test.go reads the same table.
 */
describe('relative tokens resolve to the instants the fixture records', () => {
  const recorded = Object.entries(fixture.relativeTokens).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string',
  );

  it('covers every keyword this evaluator accepts', () => {
    // Otherwise a token can be added to both implementations and pinned by neither, which
    // is the state that produced the divergence in the first place.
    const pinned = new Set(recorded.map(([token]) => token));
    for (const keyword of RELATIVE_KEYWORDS) {
      expect(pinned.has(keyword), `no instant recorded for "${keyword}"`).toBe(true);
    }
  });

  for (const [token, expected] of recorded) {
    it(`${token} resolves to ${expected}`, () => {
      const { instant } = resolveRelative(token, context.time);
      expect(new Date(instant).toISOString()).toBe(new Date(expected).toISOString());
    });
  }
});
