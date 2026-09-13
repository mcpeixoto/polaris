/**
 * The accent ramp, asserted as numbers.
 *
 * The accent's jobs are the primary button's fill, accent-coloured text on a page, and the
 * focus ring — so the hex behind it is only right if white on 500 and the text stops on
 * their pages clear WCAG's 4.5:1. The ramp was replaced wholesale once, from indigo to polar
 * cyan, and a replacement is exactly when a stop can be picked by eye and fail.
 *
 * Read as source, like `doneIsGreen.test.ts`: vitest runs with `css: false`, so there is no
 * computed style, and the question is what the token file declares.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const tokens = readFileSync(join(here, 'tokens.css'), 'utf8');

const STOPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900] as const;

function primitive(name: string): string {
  const m = tokens.match(new RegExp(`^\\s*--color-${name}:\\s*(#[0-9a-f]{6});`, 'm'));
  if (!m) throw new Error(`--color-${name} is not a six-digit hex in tokens.css`);
  return m[1]!;
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

describe('accent ramp', () => {
  it('carries a white label on the primary fill', () => {
    expect(contrast('#ffffff', primitive('accent-500'))).toBeGreaterThanOrEqual(4.5);
  });

  it('reads as text in both themes', () => {
    // --accent-text is 600 on the light page and 400 on the dark one.
    for (const page of [primitive('white'), primitive('neutral-50')]) {
      expect(contrast(primitive('accent-600'), page)).toBeGreaterThanOrEqual(4.5);
    }
    for (const page of [primitive('neutral-950'), primitive('neutral-900')]) {
      expect(contrast(primitive('accent-400'), page)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('gets darker at every step, so a theme reaching for a stop gets what its number says', () => {
    const values = STOPS.map((s) => luminance(primitive(`accent-${s}`)));
    for (let i = 1; i < values.length; i++) {
      expect(values[i]!).toBeLessThan(values[i - 1]!);
    }
  });

  it('is no longer the indigo it replaced', () => {
    expect(primitive('accent-500')).not.toBe('#5e6ad2');
  });
});
