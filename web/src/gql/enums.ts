/**
 * The two spellings of an enumerated value, and the one place that translates between them.
 *
 * The sync stream and the GraphQL API disagree about case, on purpose. A delta is the
 * database's own row — `role` is `"admin"`, a relation's type is `"blocks"` — because the
 * bootstrap and the change log stream domain models straight out of Postgres. GraphQL is an
 * enum, and a GraphQL enum value is `ADMIN`, `BLOCKS`, `ISSUE_ASSIGNED`: the server converts
 * at its own boundary (`services/internal/graph/convert.go`) and is right to.
 *
 * The client has the same boundary and did not have the conversion, so three things were
 * quietly wrong:
 *
 *   - `setRole` sent `"admin"` where the schema declares `UserRole`. GraphQL enum values are
 *     case-sensitive, so the server rejected it. Changing a member's role did not work at all.
 *   - `createIssueRelation`'s response was written into the store with `type: "BLOCKS"`,
 *     where every reader compares against `'blocks'`. A relation created in this session was
 *     invisible to the panel that lists relations until a reload re-bootstrapped it from the
 *     stream and replaced the value with the right one.
 *   - `setIssueSubscription` did the same to `reason`.
 *
 * All three share a shape worth naming: the value is *present*, it is *plausible*, and it
 * only differs from the correct one in a way no type system on either side can see. The
 * server's Go enum is a distinct type; the client's is a string union that a response is cast
 * into without being checked. So the bug survives typecheck, lint and every unit test, and
 * shows up as an entity that behaves as though it were not there.
 *
 * The conversion is mechanical and provably total: every enum in `schema/schema.graphql` is
 * SCREAMING_SNAKE_CASE and the matching TypeScript union is exactly its lower-case, which
 * `enums.test.ts` asserts enum by enum against the schema file. That is what licenses
 * `toUpperCase`/`toLowerCase` here rather than a hand-written table of pairs — a table would
 * be a second definition of the schema, and the whole point of this file is that there is
 * only one.
 *
 * What is *not* mechanical is knowing which fields are enums at all. `ENUM_FIELDS` below says
 * so per entity, and the same test rebuilds that table from the schema and fails when they
 * differ — so adding an enum field to an entity in the schema is a failing test here rather
 * than a bug found months later in a permissions question nobody can reproduce.
 */

import type { EntityOf, EntityType } from '~/store';

/**
 * A store value in the spelling GraphQL wants.
 *
 * `Uppercase<T>` rather than `string`, so a call site that passes a literal keeps a literal
 * type and a typo in a variable name does not silently become `string`.
 */
export function toWire<T extends string>(value: T): Uppercase<T> {
  return value.toUpperCase() as Uppercase<T>;
}

/**
 * A GraphQL enum value in the store's spelling, for a value that belongs to no store entity.
 *
 * `toWire`'s counterpart, and deliberately not called `fromWire`: that name is taken by the
 * entity-shaped conversion below, which takes a whole row and knows from `ENUM_FIELDS` which
 * of its fields are enums. This one takes a single value the caller has already identified as
 * one, and the two are not interchangeable.
 *
 * It exists for the handful of types that cross this boundary without being replicated — an
 * `Invite` is the one in the product today. Those have no row in the store, so they are not in
 * `EntityType`, so `fromWire` cannot be given them; without this the only way to spell the
 * conversion at the call site is a bare `.toLowerCase()`, and the whole argument of this file
 * is that a bare `.toLowerCase()` scattered through feature code is how the four silent bugs
 * above happened. A screen matching `"ADMIN"` against `'admin'` renders a blank role badge
 * and nothing anywhere errors.
 */
export function fromWireValue<T extends string>(value: T): Lowercase<T> {
  return value.toLowerCase() as Lowercase<T>;
}

/**
 * Which fields of each replicated entity hold an enum, by path.
 *
 * A dotted path descends into an embedded object — `actor.type` is the actor's type, which
 * is an enum inside a field that is not one. Entities not listed have no enumerated fields;
 * they are named anyway, with an empty tuple, because `Record<EntityType, …>` then makes
 * *forgetting* a new entity a type error rather than a silent exemption.
 */
const ENUM_FIELDS: Readonly<Record<EntityType, readonly string[]>> = {
  // `plan` looks like an enum and deliberately is not, on either side: it is `String!` in
  // the schema and `string` in the store, because the entitlement matrix is Go and only the
  // plan's *name* is data. Adding it here would upper-case a value nothing else upper-cases.
  workspace: [],
  user: ['role', 'status', 'kind'],
  team: ['estimateScale'],
  teamMembership: ['role'],
  workflowState: ['category'],
  label: [],
  issueTemplate: [],
  projectStatus: ['category'],
  project: ['startDateGranularity', 'targetDateGranularity', 'updateSchedule'],
  projectTeam: [],
  projectMember: [],
  projectMilestone: [],
  initiative: ['status', 'targetDateGranularity'],
  initiativeProject: [],
  projectUpdate: ['health'],
  projectDependency: [],
  projectLabel: [],
  projectLabelLink: [],
  cycle: [],
  issue: ['dueDateSource'],
  issueLabel: [],
  issueRelation: ['type'],
  attachment: [],
  document: [],
  comment: ['actor.type'],
  issueSubscription: ['reason'],
  notification: ['type', 'actor.type'],
  view: [],
  viewPreference: [],
  favorite: ['kind'],
};

/**
 * An entity as it came back from GraphQL, in the store's spelling.
 *
 * Use this on **every** entity read out of a query or a mutation response before it reaches
 * the store. Entities arriving over the sync socket must *not* go through it: those are
 * already in the database's spelling, and lower-casing them again would be harmless today
 * and wrong the moment a value stops being a single word.
 *
 * Two conversions happen here, and the second one is not about spelling.
 *
 * **Case.** `ENUM_FIELDS` says which fields hold an enum, and those are lower-cased.
 *
 * **Absence.** GraphQL says "this field has no value" with an explicit `null`; the sync
 * stream says it by omitting the key, and every type in `web/src/store/types.ts` says it
 * with an optional property — there is not one `null` in that file. So a response written
 * into the store unchanged puts `null` where the whole client compares against `undefined`,
 * and the value is once again *present*, *plausible* and equal to nothing.
 *
 * That is not hypothetical. `createIssue` upserts the server's row over the optimistic one,
 * and the server's row carries `archivedAt: null`. `compileFilter` gates every list on
 * `issue.archivedAt === undefined`, and `IssueIndex.add` decides `live` the same way — so
 * the issue the user had just created vanished from the list it was created in, and stayed
 * gone across a reload because the `null` had been persisted to IndexedDB. It only happened
 * about half the time, because the socket delta for the same issue carries the row in the
 * stream's spelling and whichever landed second won. The inbox had the same fault through
 * `hydrateInbox`: `readAt: null` reads as read, so a hydrated page arrived with every row
 * already dealt with and a badge of zero.
 *
 * Null-stripping is confined to the entity's own fields and to the nested objects this table
 * claims to understand — an `actor`, today. `notification.payload`, `view.filter` and
 * `view.display` are `JSON` scalars: opaque documents that belong to somebody else's schema,
 * where a `null` may well be a value rather than an absence, and they are carried through
 * exactly as they arrived.
 *
 * Absent fields stay absent, and `raw` is returned unchanged when there was nothing to
 * convert. A partial projection is a legitimate thing for a caller to have — this converts
 * what is there rather than asserting a shape.
 */
export function fromWire<T extends EntityType>(type: T, raw: EntityOf<T>): EntityOf<T> {
  const converted = convert(raw as unknown as Record<string, unknown>, ENUM_FIELDS[type]);
  return (converted ?? raw) as EntityOf<T>;
}

/** Exposed for the test that rebuilds this table from the schema. Not part of the API. */
export const ENUM_FIELDS_FOR_TEST: Readonly<Record<EntityType, readonly string[]>> = ENUM_FIELDS;

/**
 * One object's worth of the conversion, or `null` when nothing needed changing.
 *
 * Reporting "unchanged" rather than always copying is what lets a caller keep object
 * identity for the overwhelmingly common row that has no enums and no nulls — the store
 * compares subscription results structurally, and a fresh object per response would be a
 * re-render per response for every list watching that entity.
 */
function convert(
  source: Record<string, unknown>,
  paths: readonly string[],
): Record<string, unknown> | null {
  let result: Record<string, unknown> | null = null;

  for (const key of Object.keys(source)) {
    const value = source[key];

    if (value === null) {
      result ??= { ...source };
      delete result[key];
      continue;
    }

    if (typeof value === 'string') {
      if (!paths.includes(key)) continue;
      const lowered = value.toLowerCase();
      if (lowered === value) continue;
      result ??= { ...source };
      result[key] = lowered;
      continue;
    }

    // Only the nested objects the table names — see the note about JSON scalars above.
    if (typeof value !== 'object' || Array.isArray(value)) continue;
    const prefix = `${key}.`;
    const nested = paths
      .filter((path) => path.startsWith(prefix))
      .map((p) => p.slice(prefix.length));
    if (nested.length === 0) continue;

    // Copied rather than mutated: `raw` may be shared with a caller that has already put it
    // somewhere, and an in-place edit of a nested object would reach through the spread.
    const converted = convert(value as Record<string, unknown>, nested);
    if (converted === null) continue;
    result ??= { ...source };
    result[key] = converted;
  }

  return result;
}
