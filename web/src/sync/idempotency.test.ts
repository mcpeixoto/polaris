/**
 * Every mutation the outbox can replay must actually send the key that makes a replay safe.
 *
 * `SyncEngine.drainOutbox` re-sends a queued mutation with the *original* `(clientId, opId)`
 * — on purpose, and the comment there says why: the server's idempotency table recognises
 * the pair and answers with the result the first attempt earned instead of writing again.
 * The engine merges both values into the variables of every `mutate` call, so from the call
 * site it looks like the protection is automatic.
 *
 * It is not. GraphQL ignores a variable the operation does not declare, so a document that
 * omits `$clientId`/`$opId` sends them into nothing, and every replay arrives at the server
 * looking like a brand-new operation. There is no error, no warning and no failing request:
 * the mutation succeeds, and then it succeeds again — which for a create means a second row
 * that is indistinguishable afterwards from something the user meant to make.
 *
 * That is what happened to createRecurringIssue (#107): a reload taken in the couple of
 * hundred milliseconds between the optimistic row and the response produced two schedules
 * and two first occurrences, every time.
 *
 * So this walks the real call sites — `engine.mutate({ mutation: X })` — resolves each
 * document, and requires that any of them whose field the schema marks `@idempotent` both
 * declares the two variables and passes them along. The server half of the same contract is
 * checked by services/internal/graph/idempotency_contract_test.go.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCHEMA = resolve(SRC, '..', '..', 'schema', 'schema.graphql');

interface CallSite {
  /** The exported constant handed to `engine.mutate`, e.g. `CREATE_VIEW`. */
  readonly constant: string;
  /** The mutation field it selects, e.g. `createView`. */
  readonly field: string;
  /** Where the document is declared, relative to `web/src`. */
  readonly where: string;
  readonly declaresVariables: boolean;
  readonly passesArguments: boolean;
}

describe('the documents the sync engine can replay', () => {
  const idempotent = idempotentMutations(readFileSync(SCHEMA, 'utf8'));
  const files = sourceFiles(SRC);
  const documents = collectDocuments(files);
  const replayable = collectCallSites(files, documents).filter((site) =>
    idempotent.has(site.field),
  );

  it('finds the schema, the documents and the call sites at all', () => {
    // Guards on the guard. Each of these three lookups is a regex over a file layout, and
    // any of them returning nothing would leave the assertion below passing vacuously —
    // which is the one outcome worse than not having written it.
    expect(idempotent.size, 'no @idempotent mutations found in schema.graphql').toBeGreaterThan(90);
    expect(documents.size, 'no GraphQL documents found under web/src').toBeGreaterThan(100);
    expect(
      replayable.length,
      'no engine.mutate call site resolved to an @idempotent field',
    ).toBeGreaterThan(50);
  });

  it.each(replayable)(
    '$constant sends the idempotency key ($where)',
    ({ constant, field, declaresVariables, passesArguments }) => {
      expect(
        { declaresVariables, passesArguments },
        `${constant} is handed to engine.mutate, so the outbox will re-send it with the ` +
          `(clientId, opId) of the first attempt, and \`${field}\` carries @idempotent so the ` +
          `server is ready to recognise that pair. The document has to carry it: declare ` +
          `$clientId: UUID! and $opId: UUID! and pass them to ${field}(...). Without both ` +
          `halves the variables are dropped on the floor and every replay writes again.`,
      ).toEqual({ declaresVariables: true, passesArguments: true });
    },
  );
});

/** The mutation fields the schema marks `@idempotent`. */
function idempotentMutations(schema: string): ReadonlySet<string> {
  const block = /^type Mutation \{$([\s\S]*?)^\}$/m.exec(schema);
  if (block === null) return new Set();

  const marked = new Set<string>();
  for (const line of block[1]?.split('\n') ?? []) {
    if (!line.includes('@idempotent')) continue;
    const name = /^\s{2}([a-zA-Z_][A-Za-z0-9_]*)\s*\(/.exec(line);
    if (name?.[1] !== undefined) marked.add(name[1]);
  }
  return marked;
}

/** `export const NAME = /* GraphQL *\/ \`…\`` → NAME → the document text. */
function collectDocuments(
  files: readonly string[],
): ReadonlyMap<string, { text: string; where: string }> {
  const documents = new Map<string, { text: string; where: string }>();
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    const pattern = /export const ([A-Z0-9_]+) = \/\* GraphQL \*\/ `([\s\S]*?)`;/g;
    for (const match of source.matchAll(pattern)) {
      const [, name, text] = match;
      if (name === undefined || text === undefined) continue;
      documents.set(name, { text, where: relative(SRC, file) });
    }
  }
  return documents;
}

/**
 * The documents actually handed to `engine.mutate`, which is the set that matters.
 *
 * A document sent with a bare `gql(...)` is not queued and not replayed, so it is out of
 * scope here — the engine is the only thing that re-sends, and it is the re-send that makes
 * the key load-bearing.
 */
function collectCallSites(
  files: readonly string[],
  documents: ReadonlyMap<string, { text: string; where: string }>,
): CallSite[] {
  const constants = new Set<string>();
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/\bmutation:\s*([A-Z0-9_]+)\s*,/g)) {
      if (match[1] !== undefined) constants.add(match[1]);
    }
  }

  const sites: CallSite[] = [];
  for (const constant of [...constants].sort()) {
    const document = documents.get(constant);
    if (document === undefined) continue;

    const root =
      /\bmutation\s+[A-Za-z0-9_]+\s*(\([\s\S]*?\))?\s*\{\s*([a-zA-Z_][A-Za-z0-9_]*)\s*(\([\s\S]*?\))?\s*\{/.exec(
        document.text,
      );
    if (root?.[2] === undefined) continue;

    const variables = root[1] ?? '';
    const args = root[3] ?? '';
    sites.push({
      constant,
      field: root[2],
      where: document.where,
      declaresVariables: variables.includes('$clientId') && variables.includes('$opId'),
      passesArguments: /clientId:\s*\$clientId/.test(args) && /opId:\s*\$opId/.test(args),
    });
  }
  return sites;
}

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'generated') continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...sourceFiles(path));
    else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) found.push(path);
  }
  return found;
}
