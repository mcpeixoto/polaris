import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Every archive the client can perform has a way back.
 *
 * The undo stack was built, bounded, keyboard-bound and documented, and five call sites used
 * it — all of them on issues and the inbox. Everything else the product archives went one
 * way, because `archiveX` sent `archived: true` as a literal and no function anywhere sent
 * `false`. `archiveLabel`'s own comment said so out loud: "the server takes a boolean and
 * would restore happily".
 *
 * This asserts the inverse exists, which is the half a test can see. Whether a screen offers
 * it is the screens' own tests; whether it is the right inverse is `engine.mutate`'s
 * variables, asserted beside each one. What this stops is the next archive path shipping with
 * no way back at all, which is how the first seventeen happened.
 *
 * Source text rather than imports, deliberately: importing every mutations module to
 * enumerate its exports pulls in the engine, the store and the generated operations, which is
 * a great deal of machinery to answer a question about which functions were written.
 */

const FEATURES = join(__dirname, '..');

/**
 * Where an inverse may live besides the module that declares the archive.
 *
 * One entry, and it is the oldest: issues, cycles and projects were given their inverses when
 * the archives *screen* was built, so they sit with the queries that screen reads. New ones
 * belong beside the archive they undo — a reader asking "can this be taken back" should find
 * the answer in the file they are already in.
 */
const SHARED_INVERSES = join(FEATURES, 'archive', 'mutations.ts');

/**
 * Archives with no `unarchiveX`, and why that is correct rather than missing.
 *
 * Listed by hand, with the reason, because "this one does not need one" is a claim somebody
 * has to make on purpose. An empty allowance here is how a one-way delete becomes an
 * exemption nobody argued for.
 */
const NO_INVERSE_NEEDED: Record<string, string> = {
  archiveDocument:
    'takes `archived: boolean` rather than sending a literal, so it is already its own ' +
    'inverse — archiveDocument(engine, id, false) is the way back',
};

function mutationModules(): string[] {
  return readdirSync(FEATURES, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(FEATURES, entry.name, 'mutations.ts'))
    .filter((path) => {
      try {
        readFileSync(path, 'utf8');
        return true;
      } catch {
        return false;
      }
    });
}

function exported(source: string, prefix: string): string[] {
  return [...source.matchAll(new RegExp(`export (?:async )?function (${prefix}\\w*)`, 'g'))].map(
    (match) => match[1]!,
  );
}

describe('archiving', () => {
  const modules = mutationModules();
  const shared = readFileSync(SHARED_INVERSES, 'utf8');

  it('finds the mutation modules to check', () => {
    expect(
      modules.length,
      'no features/*/mutations.ts was readable, so this test is asserting nothing — the ' +
        'feature layout has changed shape and this needs to learn the new one',
    ).toBeGreaterThan(10);
  });

  it.each(
    modules.flatMap((path) =>
      exported(readFileSync(path, 'utf8'), 'archive').map((name) => [name, path] as const),
    ),
  )('%s has an inverse', (name, path) => {
    const excuse = NO_INVERSE_NEEDED[name];
    if (excuse !== undefined) return;

    // `archiveIssues` → `unarchiveIssues`: the plural survives the swap.
    const inverse = name.replace(/^archive/, 'unarchive');
    const source = readFileSync(path, 'utf8');
    const found =
      exported(source, 'unarchive').includes(inverse) ||
      exported(shared, 'unarchive').includes(inverse);

    expect(
      found,
      `${name} archives something and nothing anywhere declares ${inverse}, so whatever it ` +
        `archives goes one way. The server takes \`archived\` either way: write ${inverse} ` +
        `beside ${name}, as a three-line engine.mutate sending \`archived: false\`, and offer ` +
        `it with offerUndo where ${name} is called. If the archive genuinely cannot be ` +
        `reversed, add it to NO_INVERSE_NEEDED with the reason.`,
    ).toBe(true);
  });
});
