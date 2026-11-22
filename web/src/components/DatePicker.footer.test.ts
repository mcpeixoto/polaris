/**
 * The footer stays inside the panel however many buttons a caller adds.
 *
 * The due date picker's footer holds "No due date" plus two SLA buttons, wider than the
 * 240px panel. With `justify-content: flex-end` and no wrap the overflow spilled out of the
 * popover's left edge. Read as text: vitest runs with `css: false` and jsdom does no layout.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const sheet = readFileSync(join(here, 'DatePicker.module.css'), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
);

function ruleFor(selector: string): string[] {
  const at = sheet.indexOf(`${selector} {`);
  expect(at, `expected a rule for \`${selector}\``).toBeGreaterThan(-1);
  return sheet
    .slice(sheet.indexOf('{', at) + 1, sheet.indexOf('}', at))
    .split(';')
    .map((one) => one.trim())
    .filter((one) => one !== '');
}

describe('the date picker footer', () => {
  it('wraps rather than overflowing the panel', () => {
    expect(ruleFor('.footer')).toContain('flex-wrap: wrap');
  });
});
