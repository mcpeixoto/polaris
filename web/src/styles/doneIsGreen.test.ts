/**
 * The colour of "done", asserted as text.
 *
 * `--state-completed` used to be the accent — the same indigo as the selected row, the
 * focused field and the primary button — so the one mark on an issue row that should be
 * findable without reading was the one hue that singles nothing out.
 *
 * This reads the stylesheet as source, for the same reason `Field.composition.test.ts`
 * does: vitest runs with `css: false`, so there is no computed style to interrogate, and
 * the invariant here is not "some green came out" but "every theme block declares the same
 * token, and the hex behind it is the hex the server seeds". A rendering test cannot see
 * either half.
 *
 * The Go seed's value and the iOS palette's are written out rather than imported, because
 * the point is that four separately-edited files agree. A test that read the value it was
 * checking from one of them would pass whenever they agreed *and* whenever they were all
 * wrong together.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');

const tokens = readFileSync(join(here, 'tokens.css'), 'utf8');

/** The one hex: the Go seed, migration 000088, --color-green-500 and Palette.green500. */
const DONE_GREEN = '#188a55';
/** The dark theme's stop. Only the palette holds this one; nothing stores it. */
const DONE_GREEN_DARK = '#20b670';

/** sRGB relative luminance, WCAG 2.1. */
function luminance(hex: string): number {
  const n = Number.parseInt(hex.replace('#', ''), 16);
  const channels = [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** Every declaration of one custom property, in source order across all theme blocks. */
function declarations(token: string): string[] {
  return [...tokens.matchAll(new RegExp(`^\\s*${token}:\\s*([^;]+);`, 'gm'))].map((m) =>
    m[1]!.trim(),
  );
}

describe('done is green', () => {
  it('declares a green primitive family alongside the other functional hues', () => {
    expect(declarations('--color-green-500')).toEqual([DONE_GREEN]);
    expect(declarations('--color-green-400')).toEqual([DONE_GREEN_DARK]);
    // The ramp ships whole, like the other four.
    expect(declarations('--color-green-600')).toHaveLength(1);
  });

  /**
   * Three blocks declare it: light, `[data-theme='dark']`, and the `prefers-color-scheme`
   * media query for the visitor who never chose. Missing one is how a token ends up correct
   * in the theme the author was looking at and stale in the other.
   */
  it('points --state-completed at the green in every theme block', () => {
    const declared = declarations('--state-completed');
    expect(declared).toHaveLength(3);
    expect(declared[0]).toBe('var(--color-green-500)');
    expect(declared.slice(1)).toEqual(['var(--color-green-400)', 'var(--color-green-400)']);
  });

  it('no longer paints completed in the accent', () => {
    expect(declarations('--state-completed')).not.toContain('var(--color-accent-500)');
    expect(declarations('--state-completed')).not.toContain('var(--color-accent-400)');
  });

  /**
   * The server seeds the hex a workspace stores, and both clients prefer that stored value
   * over the token — so the palette alone is only half of "done is green" and the two halves
   * must not drift.
   */
  it('agrees with the colour the server seeds', () => {
    const seed = readFileSync(
      join(repoRoot, 'services', 'internal', 'domain', 'workflowstate.go'),
      'utf8',
    );
    expect(seed).toContain(`{"Done", CategoryCompleted, "${DONE_GREEN}", false}`);

    const projectSeed = readFileSync(
      join(repoRoot, 'services', 'internal', 'domain', 'projects.go'),
      'utf8',
    );
    expect(projectSeed).toContain(
      `{"Completed", model.ProjectCategoryCompleted, "${DONE_GREEN}", false}`,
    );
  });

  it('agrees with the iOS palette', () => {
    const palette = readFileSync(
      join(repoRoot, 'ios', 'PolarisCore', 'Sources', 'PolarisCore', 'Design', 'Palette.swift'),
      'utf8',
    );
    expect(palette).toContain(
      `public static let green500: UInt32 = 0x${DONE_GREEN.slice(1).toUpperCase()}`,
    );
    expect(palette).toContain(
      `public static let green400: UInt32 = 0x${DONE_GREEN_DARK.slice(1).toUpperCase()}`,
    );
  });

  /**
   * WCAG 1.4.11's 3:1 for non-text graphics. The stored hex is theme-blind — the same value
   * renders on a white page and a near-black one — so it has to clear the floor on both
   * rather than on whichever theme it was picked against.
   */
  it('clears 3:1 as a graphic on both themes', () => {
    // --color-white / --color-neutral-950, the two page grounds.
    expect(contrast(DONE_GREEN, '#ffffff')).toBeGreaterThanOrEqual(3);
    expect(contrast(DONE_GREEN, '#0e1013')).toBeGreaterThanOrEqual(3);
    expect(contrast(DONE_GREEN_DARK, '#0e1013')).toBeGreaterThanOrEqual(3);
  });
});
