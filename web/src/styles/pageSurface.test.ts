/**
 * The dark page is one shade lighter than the sidebar.
 *
 * Both used to be neutral-950, so the pane to the right of the navigation was the same
 * black as the navigation and the only edge between them was a hairline. The page moved
 * to neutral-925; the sidebar stayed on 950. Panels stay on 900, above the page, so a
 * card still lifts.
 *
 * Tertiary ink moved with the page. Neutral-500 clears 4.5:1 on 950 and fails on 925, so
 * dark `--text-tertiary` is neutral-450: still legal on the page, still illegal on a
 * raised surface. Read as source, like `accent.test.ts` — vitest runs with `css: false`.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const tokens = readFileSync(join(here, 'tokens.css'), 'utf8');

function primitive(name: string): string {
  const m = tokens.match(new RegExp(`^\\s*--color-${name}:\\s*(#[0-9a-f]{6});`, 'm'));
  if (!m) throw new Error(`--color-${name} is not a six-digit hex in tokens.css`);
  return m[1]!;
}

function count(declaration: string): number {
  const needle = `${declaration};`;
  let n = 0;
  let from = 0;
  while (from < tokens.length) {
    const at = tokens.indexOf(needle, from);
    if (at === -1) break;
    n += 1;
    from = at + needle.length;
  }
  return n;
}

/** sRGB relative luminance, WCAG 2.1. */
function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

describe('dark page surface', () => {
  it('keeps the sidebar on 950 and paints the page one shade lighter, in both dark blocks', () => {
    // The explicit theme and the system-preference block are copies. One of them drifting
    // is a user whose OS is dark seeing a different page from a user who picked dark.
    expect(count('--bg-sidebar: var(--color-neutral-950)')).toBe(2);
    expect(count('--bg-primary: var(--color-neutral-925)')).toBe(2);
    expect(count('--bg-primary: var(--color-neutral-950)')).toBe(0);
    expect(count('--text-tertiary: var(--color-neutral-450)')).toBe(2);
    // Light is untouched: a white page, and tertiary that was already measured for it.
    expect(count('--bg-primary: var(--color-white)')).toBe(1);
    expect(count('--text-tertiary: var(--color-neutral-500)')).toBe(1);
  });

  it('steps sidebar, page, panel from dark to light', () => {
    const sidebar = luminance(primitive('neutral-950'));
    const page = luminance(primitive('neutral-925'));
    const panel = luminance(primitive('neutral-900'));
    expect(page).toBeGreaterThan(sidebar);
    expect(panel).toBeGreaterThan(page);
  });

  it('keeps tertiary text legal on the page and illegal on a raised surface', () => {
    const ink = primitive('neutral-450');
    const page = primitive('neutral-925');
    expect(contrast(ink, page)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(ink, primitive('neutral-900'))).toBeLessThan(4.5);
    expect(contrast(ink, primitive('neutral-800'))).toBeLessThan(4.5);
    // The old ink is why the page could not simply move: it fails the new ground.
    expect(contrast(primitive('neutral-500'), page)).toBeLessThan(4.5);
  });

  it('keeps accent text and the done mark readable on the lighter page', () => {
    const page = primitive('neutral-925');
    expect(contrast(primitive('accent-400'), page)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(primitive('neutral-400'), page)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(primitive('green-400'), page)).toBeGreaterThanOrEqual(3);
    expect(contrast(primitive('green-500'), page)).toBeGreaterThanOrEqual(3);
  });
});
