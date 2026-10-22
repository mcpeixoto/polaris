import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * The marks that carry meaning are legible on the surfaces they are drawn on.
 *
 * A priority arrow, a state ring and a relation mark are the product's only way of saying
 * what a row is — the list shows a glyph where a sentence would not fit — so WCAG 1.4.11
 * asks 3:1 of each against its background, in both themes. Nothing checked that. The three
 * token tests beside this one measure the accent, the done green and the page surfaces; the
 * five-hue ramps themselves were measured by eye when they were chosen and never since.
 *
 * Source text rather than a rendered page, like `pageSurface.test.ts` — vitest runs with
 * `css: false`, and reading the declarations is what makes this cheap enough to run on every
 * commit.
 *
 * ## What it found
 *
 * One colour, in light only: amber-600 was `#b3862f`, which read 3.30:1 on the page and
 * 2.89:1 on a control — and it is not only a glyph. The sidebar's reconnecting badge sets it
 * as *text*, where the floor is 4.5:1, not 3:1. It is now `#936e27`, the first step down its
 * own hue that clears the text floor on the page and the sidebar, which carries every other
 * surface with it. The dark ramps were already clear by a wide margin; nothing there moved.
 *
 * Two marks still read between 3:1 and 4.5:1 in light — orange-600, as `--priority-high`,
 * `--state-triage` and `--relation-blocked`. That is legal for the glyphs they are, and it
 * is why this test asserts the non-text floor. The one place orange-600 is set as words, the
 * "soon" due date in `features/issue/properties.module.css`, is therefore under the text
 * floor at 3.71:1 and is recorded rather than changed: a second ramp is a second visual
 * decision, and this change makes one.
 */

const here = dirname(fileURLToPath(import.meta.url));
const tokens = readFileSync(join(here, 'tokens.css'), 'utf8');
const lines = tokens.split('\n');

/**
 * The two theme blocks, by the selector that opens them.
 *
 * The `prefers-color-scheme` copy is deliberately not read: `pageSurface.test.ts` already
 * asserts that it and the explicit dark block agree, and reading both here would report one
 * drift twice while testing nothing extra.
 */
function themeBlock(selector: string): string {
  const start = lines.findIndex((line) => line.startsWith(selector));
  if (start === -1) throw new Error(`${selector} is not a top-level block in tokens.css`);
  const end = lines.indexOf('}', start);
  return lines.slice(start, end).join('\n');
}

const THEMES: Readonly<Record<string, string>> = {
  light: themeBlock(':root {'),
  dark: themeBlock(":root[data-theme='dark'] {"),
};

function primitive(name: string): string {
  const found = tokens.match(new RegExp(`^\\s*--color-${name}:\\s*(#[0-9a-f]{6});`, 'm'));
  if (!found) throw new Error(`--color-${name} is not a six-digit hex in tokens.css`);
  return found[1]!;
}

/** A semantic token's colour in one theme, followed through the one `var()` hop it takes. */
function resolve(theme: string, name: string): string {
  const block = THEMES[theme]!;
  const found = block.match(new RegExp(`^\\s*--${name}:\\s*([^;]+);`, 'm'));
  if (!found) throw new Error(`--${name} is not declared in the ${theme} block`);
  const value = found[1]!.trim();
  const ref = value.match(/^var\(--color-([\w-]+)\)$/);
  if (ref) return primitive(ref[1]!);
  if (/^#[0-9a-f]{6}$/i.test(value)) return value;
  throw new Error(`--${name} in ${theme} is ${value}, which this test cannot resolve to a hex`);
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

/** Every token in the three meaning-carrying ramps, read from the file rather than listed. */
function ramp(prefix: string): string[] {
  const names = new Set<string>();
  for (const match of THEMES.light!.matchAll(new RegExp(`^\\s*--(${prefix}-[\\w-]+):`, 'gm'))) {
    names.add(match[1]!);
  }
  return [...names].sort();
}

const MARKS = [...ramp('priority'), ...ramp('state'), ...ramp('relation')];

/**
 * Every ground one of these marks is drawn on: the page, a panel or card, the sidebar, and
 * the controls — chips, tabs and pills — that sit above all three.
 */
const SURFACES = ['bg-primary', 'bg-elevated', 'bg-sidebar', 'bg-tertiary'];

const NON_TEXT_FLOOR = 3;

describe('the ramps that carry meaning', () => {
  it('finds the tokens to check', () => {
    expect(
      MARKS.length,
      'no --priority-*, --state-* or --relation-* token was found, so this test is asserting ' +
        'nothing — the ramps have been renamed and this needs to learn the new names',
    ).toBeGreaterThan(10);
  });

  it.each(
    Object.keys(THEMES).flatMap((theme) =>
      MARKS.flatMap((mark) => SURFACES.map((surface) => [theme, mark, surface] as const)),
    ),
  )('%s: --%s clears the non-text floor on --%s', (theme, mark, surface) => {
    const ratio = contrast(resolve(theme, mark), resolve(theme, surface));

    expect(
      ratio,
      `--${mark} reads at ${ratio.toFixed(2)}:1 on --${surface} in the ${theme} theme, under ` +
        `the ${NON_TEXT_FLOOR}:1 WCAG 1.4.11 asks of a graphic that carries meaning. These ` +
        `marks are how a row says what it is when there is no room for a sentence, so a ` +
        `reader who cannot separate two of them cannot read the list. Fix the token rather ` +
        `than this threshold.`,
    ).toBeGreaterThanOrEqual(NON_TEXT_FLOOR);
  });
});
