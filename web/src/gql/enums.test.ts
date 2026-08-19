/**
 * Two claims that `enums.ts` rests on, checked against the schema itself rather than restated.
 *
 * 1. **The conversion is mechanical.** Every GraphQL enum value is exactly the upper-case of
 *    the TypeScript union member it corresponds to, so `toUpperCase`/`toLowerCase` is a total
 *    translation and not a lucky one. If somebody adds `IN_PROGRESS` to an enum while the
 *    union says `'inprogress'`, the pair stops being mechanical and this fails — which is the
 *    moment to write the table of pairs, not months later when a value silently does not match.
 *
 * 2. **The table of enum-bearing fields is complete.** `ENUM_FIELDS` is rebuilt here by
 *    walking the schema, so adding an enum field to an entity is a failing test rather than a
 *    field that quietly arrives in the wrong case. This is the half that cannot be derived at
 *    runtime: the client sees a string either way, and nothing about `"BLOCKS"` says it was
 *    supposed to be `'blocks'`.
 *
 * Both read `schema/schema.graphql` and `web/src/store/types.ts` off disk. That is the point:
 * a copy of either in here would be a third place to forget.
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { ENUM_FIELDS_FOR_TEST, fromWire, toWire } from './enums';

const HERE = dirname(fileURLToPath(import.meta.url));
const SDL = readFileSync(resolve(HERE, '../../../schema/schema.graphql'), 'utf8');
const TYPES = readFileSync(join(HERE, '..', 'store', 'types.ts'), 'utf8');

/**
 * SDL enum name → the TypeScript union that mirrors it.
 *
 * Listed rather than inferred from the name, because two of them do not share one:
 * `StateCategory` is spelled the same on both sides but several enums exist in the schema
 * that the replica has no equivalent for at all, and silently skipping those would let a
 * genuinely missing union look like a deliberate omission.
 */
const MIRRORED: Readonly<Record<string, string>> = {
  StateCategory: 'StateCategory',
  UserRole: 'UserRole',
  UserStatus: 'UserStatus',
  UserKind: 'UserKind',
  TeamRole: 'TeamRole',
  ActorType: 'ActorType',
  EstimateScale: 'EstimateScale',
  DueDateSource: 'DueDateSource',
  RelationType: 'RelationType',
  SubscriptionReason: 'SubscriptionReason',
  NotificationType: 'NotificationType',
  FavoriteKind: 'FavoriteKind',
  ProjectStatusCategory: 'ProjectStatusCategory',
  InitiativeStatus: 'InitiativeStatus',
  TimeframeGranularity: 'TimeframeGranularity',
};

describe('the enum spellings on the two sides of the API', () => {
  const enums = schemaEnums(SDL);

  it('finds the schema enums at all', () => {
    // Without this the suite below would pass by iterating an empty list on the day the
    // schema moves, which is exactly the day it stops being checked.
    expect(Object.keys(enums).length).toBeGreaterThan(10);
  });

  it.each(Object.entries(MIRRORED))(
    'schema enum %s is the upper-case of the union %s',
    (schemaName, unionName) => {
      const wire = enums[schemaName];
      expect(wire, `no \`enum ${schemaName}\` in schema.graphql`).toBeDefined();

      const union = tsUnion(TYPES, unionName);
      expect(union, `no \`export type ${unionName}\` in store/types.ts`).not.toBeNull();

      expect(
        [...(wire ?? [])].sort(),
        'The two spellings are no longer a pure case change, so toWire/fromWire in enums.ts ' +
          'is no longer a total translation and needs an explicit mapping.',
      ).toEqual([...(union ?? [])].map((value) => value.toUpperCase()).sort());
    },
  );
});

describe('the table of which fields hold enums', () => {
  /**
   * Only this level can prove the table is *complete*. `fromWire` converting what it is told
   * to convert is easy to test and proves nothing about the field somebody forgot to list.
   */
  it('matches what the schema says about every replicated entity', () => {
    const enums = new Set(Object.keys(schemaEnums(SDL)));
    const types = schemaTypes(SDL);
    const entities = new Set(Object.keys(ENUM_FIELDS_FOR_TEST));

    const derived: Record<string, string[]> = {};
    for (const entity of entities) {
      const typeName = entity.charAt(0).toUpperCase() + entity.slice(1);
      derived[entity] = enumPaths(typeName, types, enums, entities).sort();
    }

    const declared: Record<string, string[]> = {};
    for (const [entity, paths] of Object.entries(ENUM_FIELDS_FOR_TEST)) {
      declared[entity] = [...paths].sort();
    }

    expect(
      declared,
      'ENUM_FIELDS in enums.ts and the schema disagree about which fields are enums. A field ' +
        'that is missing here arrives in the store in the wire spelling — present, plausible, ' +
        'and not equal to anything the readers compare against.',
    ).toEqual(derived);
  });
});

describe('fromWire', () => {
  /** Only this level can prove the conversion touches the right fields and nothing else. */
  it('lower-cases an enum field and leaves the rest alone', () => {
    const relation = { id: 'r1', type: 'BLOCKS', issueId: 'i1' } as never;
    const converted = fromWire('issueRelation', relation) as unknown as Record<string, unknown>;
    expect(converted['type']).toBe('blocks');
    expect(converted['issueId']).toBe('i1');
  });

  it('descends one level for an enum inside an embedded object', () => {
    const comment = { id: 'c1', actor: { type: 'APP_USER', id: 'u1' } } as never;
    const converted = fromWire('comment', comment) as unknown as Record<string, unknown>;
    expect((converted['actor'] as Record<string, unknown>)['type']).toBe('app_user');
    expect((converted['actor'] as Record<string, unknown>)['id']).toBe('u1');
  });

  it('does not mutate the object it was given', () => {
    const comment = { id: 'c1', actor: { type: 'SYSTEM' } };
    fromWire('comment', comment as never);
    expect(comment.actor.type).toBe('SYSTEM');
  });

  it('leaves a partial projection alone rather than inventing fields', () => {
    const issue = { id: 'i1', title: 'A' } as never;
    expect(fromWire('issue', issue)).toEqual({ id: 'i1', title: 'A' });
  });

  it('returns the same object when there is nothing to convert', () => {
    const label = { id: 'l1', name: 'Bug' } as never;
    expect(fromWire('label', label)).toBe(label);
  });

  /**
   * The regression that made an issue disappear from the list it was created in.
   *
   * GraphQL spells absence `null`; the store spells it by not having the key, and
   * `compileFilter` gates every list on `archivedAt === undefined`. A `null` written through
   * therefore reads as archived — half the time, because the socket delta for the same row
   * carries the stream's spelling and whichever landed second won.
   */
  it('drops a null field rather than storing it as a present value', () => {
    const issue = {
      id: 'i1',
      title: 'A',
      archivedAt: null,
      parentId: null,
      assigneeId: null,
    } as never;
    const converted = fromWire('issue', issue) as unknown as Record<string, unknown>;
    expect('archivedAt' in converted).toBe(false);
    expect('parentId' in converted).toBe(false);
    expect('assigneeId' in converted).toBe(false);
    expect(converted['title']).toBe('A');
  });

  it('drops a null inside an embedded object it understands', () => {
    const comment = { id: 'c1', actor: { type: 'SYSTEM', id: null } } as never;
    const actor = (fromWire('comment', comment) as unknown as Record<string, unknown>)['actor'];
    expect(actor).toEqual({ type: 'system' });
  });

  /**
   * `payload`, `filter` and `display` are `JSON` scalars in the schema: documents belonging
   * to somebody else's shape, where a `null` may be a value rather than an absence.
   */
  it('leaves an opaque JSON scalar exactly as it arrived', () => {
    const payload = { from: null, to: 'done' };
    const notification = { id: 'n1', type: 'ISSUE_STATUS_CHANGED', payload } as never;
    const converted = fromWire('notification', notification) as unknown as Record<string, unknown>;
    expect(converted['type']).toBe('issue_status_changed');
    expect(converted['payload']).toEqual({ from: null, to: 'done' });
  });

  it('does not mutate the object it was given when it strips a null', () => {
    const issue = { id: 'i1', archivedAt: null };
    fromWire('issue', issue as never);
    expect(issue.archivedAt).toBeNull();
  });
});

describe('toWire', () => {
  it('is the inverse of the store spelling for a multi-word value', () => {
    expect(toWire('issue_assigned')).toBe('ISSUE_ASSIGNED');
  });
});

/** Every `enum X { … }` in the SDL, as name → values. */
function schemaEnums(sdl: string): Record<string, readonly string[]> {
  const found: Record<string, readonly string[]> = {};
  const pattern = /enum\s+(\w+)\s*\{([^}]*)\}/g;

  for (let match = pattern.exec(sdl); match !== null; match = pattern.exec(sdl)) {
    const [, name, body] = match;
    if (name === undefined || body === undefined) continue;
    found[name] = body
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '' && !line.startsWith('#') && !line.startsWith('"'))
      .map((line) => line.split(/\s/)[0] ?? '');
  }

  return found;
}

/** Every `type X { … }` in the SDL, as name → (field → type name, stripped of !/[] wrappers). */
function schemaTypes(sdl: string): Record<string, Record<string, { type: string; list: boolean }>> {
  const found: Record<string, Record<string, { type: string; list: boolean }>> = {};
  const pattern = /(?:^|\n)type\s+(\w+)(?:\s+implements[^{]*)?\s*\{/g;

  for (let match = pattern.exec(sdl); match !== null; match = pattern.exec(sdl)) {
    const name = match[1];
    if (name === undefined) continue;

    const open = match.index + match[0].length - 1;
    const body = balanced(sdl, open);
    if (body === null) continue;

    const fields: Record<string, { type: string; list: boolean }> = {};
    let inBlockComment = false;

    for (const rawLine of body.split('\n')) {
      const line = rawLine.trim();
      // Triple-quoted descriptions are common in this schema and can contain colons, so
      // they are skipped as a block rather than pattern-matched around.
      if (line.startsWith('"""')) {
        if (!(line.length > 3 && line.endsWith('"""'))) inBlockComment = !inBlockComment;
        continue;
      }
      if (inBlockComment || line === '' || line.startsWith('#')) continue;

      const field = /^(\w+)(?:\([^)]*\))?\s*:\s*(.+)$/.exec(line);
      if (field === null) continue;
      const [, fieldName, rawType] = field;
      if (fieldName === undefined || rawType === undefined) continue;

      fields[fieldName] = {
        type: rawType.replace(/[[\]!\s]/g, ''),
        list: rawType.includes('['),
      };
    }

    found[name] = fields;
  }

  return found;
}

/**
 * The dotted paths of a type's enum fields, descending one level into embedded objects.
 *
 * Fields whose type is another replicated entity are not followed: those arrive as their own
 * rows and are converted on their own. Lists are not followed either — no entity embeds a
 * list of objects carrying an enum, and following one would mean the converter had to walk
 * arrays, which is a shape the store does not hold.
 */
function enumPaths(
  typeName: string,
  types: Record<string, Record<string, { type: string; list: boolean }>>,
  enums: ReadonlySet<string>,
  entities: ReadonlySet<string>,
  prefix = '',
  depth = 0,
): string[] {
  const fields = types[typeName];
  if (fields === undefined) return [];

  const paths: string[] = [];
  for (const [name, { type, list }] of Object.entries(fields)) {
    if (enums.has(type)) {
      paths.push(`${prefix}${name}`);
      continue;
    }
    if (depth > 0 || list) continue;

    const isEntity = entities.has(type.charAt(0).toLowerCase() + type.slice(1));
    if (isEntity || types[type] === undefined) continue;

    paths.push(...enumPaths(type, types, enums, entities, `${prefix}${name}.`, depth + 1));
  }

  return paths;
}

/** The members of `export type X = 'a' | 'b';`, or null when there is no such type. */
function tsUnion(source: string, name: string): string[] | null {
  const header = new RegExp(`export type ${name}\\s*=`).exec(source);
  if (header === null) return null;

  const end = source.indexOf(';', header.index);
  if (end === -1) return null;

  const body = source.slice(header.index + header[0].length, end);
  return [...body.matchAll(/'([^']+)'/g)].map((match) => match[1] ?? '');
}

/** The text between a `{` at `open` and its matching `}`, exclusive. */
function balanced(text: string, open: number): string | null {
  let depth = 0;
  for (let index = open; index < text.length; index += 1) {
    const char = text[index];
    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(open + 1, index);
    }
  }
  return null;
}
