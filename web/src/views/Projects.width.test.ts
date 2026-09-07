/**
 * The projects table fills the window.
 *
 * `.body` is a flex row — the list on the left, Peek on the right — and `.table` was a flex
 * item with no basis, so it was sized to its content. Its grid's only flexible track is the
 * name column's `minmax(0, 1fr)`, which contributes nothing to an intrinsic width, so the
 * whole table shrank to the fixed `ch` tracks: rows and headings ended a third of the way
 * across a wide window, with empty page beside them. `.board` next to it already had
 * `flex: 1`; the table simply never got one.
 *
 * Read as text for the reason `features/triage/header.fit.test.ts` gives: vitest runs with
 * `css: false` and jsdom does no layout, so the shape of the rule is what can be pinned.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const sheet = readFileSync(join(here, 'Projects.module.css'), 'utf8').replace(
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

describe('the projects table inside the Peek row', () => {
  const table = ruleFor('.table');

  it('takes the width the row has left', () => {
    expect(table).toContain('flex: 1');
  });

  it('may shrink below its content so long names ellipsis instead of pushing', () => {
    expect(table).toContain('min-width: 0');
  });

  it('may shrink below its content vertically, so it scrolls rather than growing', () => {
    expect(table).toContain('min-height: 0');
    expect(table).toContain('overflow-y: auto');
  });

  it('is laid out in the same row as the board, which already claimed its share', () => {
    expect(ruleFor('.body')).toContain('display: flex');
    expect(ruleFor('.board')).toContain('flex: 1');
  });
});
