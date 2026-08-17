/**
 * Every `…Fields` fragment must ask for exactly the fields its store entity holds.
 *
 * This test exists because three of them had already drifted, silently, in the same way.
 * `IssueFields` did not request `estimate`, `dueDate`, `dueDateSource`, `parentId`,
 * `subIssueSortOrder` or `templateId`; `TeamFields` did not request the three estimate-scale
 * columns; `UserFields` did not request `notificationPrefs`. All six had been added to the
 * store's types and to the GraphQL schema, and nobody thought to widen the fragment in
 * between.
 *
 * Nothing caught it and nothing could have. A fragment is a string: TypeScript does not read
 * it, ESLint does not read it, and the server answers a narrow query perfectly happily. The
 * only visible symptom is at runtime, in one specific place — an entity that arrives by
 * *query* or in a *mutation response* is missing fields that the same entity arriving as a
 * sync delta carries. So an issue you have open shows its estimate until you edit its title,
 * and then the estimate disappears, because the update response overwrote the row with a
 * copy that had no estimate in it. That is the worst kind of bug to be handed: intermittent,
 * data-dependent, and indistinguishable from "the server lost my work".
 *
 * The rule enforced here is the one the operations files already state in prose — "fragments
 * mirror the fields the sync stream carries, so an entity fetched by query and the same
 * entity arriving as a delta land in the store with identical shapes". This turns that
 * sentence into a failing test.
 *
 * Scope: any fragment named `<Something>Fields` whose target type is one of the store's
 * entity interfaces, in any `operations.ts` under `web/src`. A deliberately partial
 * projection is legal — name it something that does not end in `Fields`, and this test will
 * leave it alone. That is the whole opt-out, and it is deliberately awkward to reach for.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = join(SRC, 'store', 'types.ts');

/**
 * Store fields that are deliberately not on the wire.
 *
 * Empty today, and it should be argued for before it is not: a field the client invents is a
 * field the sync stream cannot correct, and the reason for each entry belongs beside it.
 */
const CLIENT_ONLY: Readonly<Record<string, readonly string[]>> = {};

describe('the GraphQL fragments and the store entity types', () => {
  const source = readFileSync(TYPES, 'utf8');
  const replicated = replicatedEntities(source);
  const fragments = collectFragments(SRC).filter((fragment) => replicated.has(fragment.entity));

  it('finds fragments to check at all', () => {
    // A guard on the guard. If the file layout or the naming convention moves, this test
    // would otherwise pass by checking nothing, which is worse than not existing.
    expect(fragments.length).toBeGreaterThan(4);
  });

  it.each(fragments)('$name selects exactly what $entity holds', ({ entity, selected }) => {
    const declared = interfaceFields(source, entity);
    expect(declared, `no \`export interface ${entity}\` in store/types.ts`).not.toBeNull();

    const expected = new Set(declared ?? []);
    for (const field of CLIENT_ONLY[entity] ?? []) expected.delete(field);

    const missing = [...expected].filter((field) => !selected.includes(field));
    const extra = selected.filter((field) => !expected.has(field));

    expect(
      { missing, extra },
      'A fragment and its store entity have drifted. An entity fetched by query or returned ' +
        'by a mutation will land in the store with a different shape from the same entity ' +
        'arriving as a delta, and the difference will look like lost data.',
    ).toEqual({ missing: [], extra: [] });
  });
});

/**
 * The entity types the sync stream carries, read out of `EntityByType`.
 *
 * The rule this test enforces is about *replicated* entities, and only about those: it says
 * that a row fetched by query must look identical to the same row arriving as a delta, which
 * is a statement with no content for something that never arrives as a delta. `ApiKey` is the
 * deliberate example — M1 keeps keys off the sync stream on purpose, so `ApiKeyFields` is
 * free to project whatever its one screen needs and this test must leave it alone.
 *
 * Derived rather than listed, so that adding an entity to the replica automatically brings
 * its fragment under the rule instead of quietly leaving it outside.
 */
function replicatedEntities(source: string): ReadonlySet<string> {
  const header = /export interface EntityByType\s*\{/.exec(source);
  if (header === null) return new Set();

  const body = balanced(source, header.index + header[0].length - 1) ?? '';
  return new Set([...body.matchAll(/^\s*\w+:\s*(\w+);/gm)].map((match) => match[1] ?? ''));
}

interface FragmentCase {
  readonly name: string;
  readonly entity: string;
  readonly selected: readonly string[];
  readonly file: string;
}

/** Every `<Entity>Fields` fragment in every `operations.ts` under `src`. */
function collectFragments(root: string): FragmentCase[] {
  const found: FragmentCase[] = [];

  for (const file of operationFiles(root)) {
    const text = readFileSync(file, 'utf8');
    const pattern = /fragment\s+(\w+Fields)\s+on\s+(\w+)\s*\{/g;

    for (let match = pattern.exec(text); match !== null; match = pattern.exec(text)) {
      const [, name, entity] = match;
      if (name === undefined || entity === undefined) continue;

      const body = balanced(text, match.index + match[0].length - 1);
      if (body === null) continue;

      found.push({
        name,
        entity,
        selected: topLevelSelections(body),
        file: relative(root, file),
      });
    }
  }

  return found;
}

function operationFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      // `generated/` holds graphql-codegen output, which is not hand-written and not
      // subject to this rule.
      if (entry.name === 'generated' || entry.name === 'node_modules') continue;
      files.push(...operationFiles(path));
    } else if (entry.name === 'operations.ts') {
      files.push(path);
    }
  }
  return files;
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

/**
 * The field names a selection set asks for at its own level.
 *
 * Nested selections count as their parent — `actor { type }` is the `actor` field — because
 * that is how the store holds it. Fragment spreads are skipped: a spread's fields belong to
 * the fragment it names, which is checked on its own.
 */
function topLevelSelections(body: string): string[] {
  const fields: string[] = [];
  let depth = 0;

  for (const rawLine of body.split('\n')) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('...') || line.startsWith('#')) continue;

    if (depth === 0) {
      const name = /^(\w+)/.exec(line)?.[1];
      if (name !== undefined) fields.push(name);
    }

    for (const char of line) {
      if (char === '{') depth += 1;
      else if (char === '}') depth -= 1;
    }
  }

  return fields;
}

/** The `readonly` field names an exported interface declares, or null if there is no such interface. */
function interfaceFields(source: string, name: string): string[] | null {
  const header = new RegExp(`export interface ${name}\\s*\\{`).exec(source);
  if (header === null) return null;

  const body = balanced(source, header.index + header[0].length - 1);
  if (body === null) return null;

  return [...body.matchAll(/^\s*readonly (\w+)\??:/gm)].map((match) => match[1] ?? '');
}
