import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * Tertiary ink never sits on a raised surface.
 *
 * `docs/03-architecture/08-ui-composition.md` calls this "the single most repeated contrast
 * defect in the codebase", and until now nothing could see it. The token cannot be fixed,
 * which is the whole reason this test is about *usage*: `pageSurface.test.ts` deliberately
 * asserts that `--text-tertiary` **fails** 4.5:1 on neutral-900 and neutral-800. It is ink
 * measured against the page, and the page is the only ground it is legal on — 4.56:1 there,
 * 4.42:1 one surface up, 3.67:1 on a control. A rule that puts it on a card is not a near
 * miss; it is the token being used for something it was never measured for.
 *
 * `--text-secondary` is what those rules want. It clears 4.5:1 on every raised surface in
 * both themes — 5.39:1 and 6.50:1 in dark, 6.09:1 and 6.71:1 in light — which is why this
 * ships with an empty allowance rather than a debt list. Two rules were doing it when this
 * was written, the collapsed-label count and the marketing page's logo tiles, and both are
 * fixed in the same change.
 *
 * Only a rule that sets *both* is caught, which is the honest limit of reading CSS as text:
 * ink inherited from an ancestor that paints the surface is invisible here. That case is
 * what the composition doc's per-file checklist is for, and narrowing the claim is better
 * than a test that guesses at the cascade and is wrong in both directions.
 */

const here = dirname(fileURLToPath(import.meta.url));
const ROOTS = [join(here, '..'), join(here, '..', '..', '..', 'ee', 'web')];

/** Surfaces that sit above the page. The page itself is where tertiary ink is legal. */
const RAISED = ['--bg-elevated', '--bg-secondary', '--bg-tertiary', '--bg-sidebar'];

/**
 * Rules allowed to put tertiary ink on a raised surface, and why.
 *
 * Empty, and meant to stay that way: `--text-secondary` is a drop-in that clears the floor
 * on every one of those grounds, so an entry here would have to argue that a specific piece
 * of text is decorative enough to be illegible. Listed by hand if that argument is ever
 * made, because it is a claim somebody has to put their name to.
 */
const ALLOWED: Record<string, string> = {};

function stylesheets(dir: string): string[] {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return stylesheets(path);
    return entry.name.endsWith('.module.css') ? [path] : [];
  });
}

/** The raised surface a rule paints under tertiary ink, or null when it does neither. */
function offence(rule: string): string | null {
  if (!/color:\s*var\(--text-tertiary\)/.test(rule)) return null;
  return (
    RAISED.find((surface) =>
      new RegExp(`background(-color)?:\\s*var\\(${surface}\\)`).test(rule),
    ) ?? null
  );
}

describe('tertiary ink', () => {
  const files = ROOTS.flatMap((root) => stylesheets(root));

  it('finds the stylesheets to check', () => {
    expect(
      files.length,
      'no *.module.css was readable, so this test is asserting nothing — the stylesheets ' +
        'have moved and this needs to learn where',
    ).toBeGreaterThan(50);
  });

  it('is never painted on a surface above the page', () => {
    const offences: string[] = [];
    for (const file of files) {
      // Splitting on the closing brace is enough to keep declarations with their selector,
      // which is all this needs: it asks whether one rule sets both.
      for (const rule of readFileSync(file, 'utf8').split('}')) {
        const surface = offence(rule);
        if (surface === null) continue;
        const name = relative(join(here, '..', '..', '..'), file);
        if (ALLOWED[name] !== undefined) continue;
        offences.push(`${name} paints --text-tertiary on ${surface}`);
      }
    }

    expect(
      offences,
      'tertiary ink is measured against the page and fails on every surface above it: ' +
        '4.42:1 on a panel and 3.67:1 on a control in dark, 3.63:1 on a control in light. ' +
        'Use --text-secondary, which clears 4.5:1 on all of them. If a rule genuinely has ' +
        'to keep tertiary, add it to ALLOWED with the argument for it.',
    ).toEqual([]);
  });
});
