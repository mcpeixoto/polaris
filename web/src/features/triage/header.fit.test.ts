/**
 * The list header, at the width triage gives it.
 *
 * Triage is the screen that squeezes it: `Triage.module.css` splits the pane in two and holds
 * the queue at `min-width: 26rem`, so the same header that has a whole window on `/issues` has
 * roughly 384px of usable width here. Every item in that header carries `white-space: nowrap`,
 * which makes a flex item's automatic minimum its entire label — so nothing shrank, the single
 * line ran past the end of the pane, and Insights, Display and the four team links were painted
 * over the issue beside them. Measured in a browser at 416px before the fix: 647px of content
 * in a 416px header, the last link ending 231px outside the pane.
 *
 * `.title`'s `min-width` floor is a different bug from a different pass — it stopped the
 * *heading* collapsing to nothing. The heading was never what overflowed.
 *
 * This reads the stylesheet as text, the way `components/Field.composition.test.ts` does, for
 * the same reason: vitest runs with `css: false`, so there is no computed style to interrogate
 * and jsdom does no layout at all. What can be pinned here is the shape of the rule — that the
 * row wraps rather than overflowing, that product strings are never squeezed into an ellipsis,
 * and that a header with one line in it is still exactly `--header-height` so the list below it
 * does not move.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));

function read(...parts: readonly string[]): string {
  return readFileSync(join(here, ...parts), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
}

const list = read('..', '..', 'views', 'IssueList.module.css');
const tokens = read('..', '..', 'styles', 'tokens.css');

/** The declarations of one exact rule, trimmed, with comments already gone. */
function ruleFor(source: string, selector: string): string[] {
  const at = source.indexOf(`${selector} {`);
  expect(at, `expected a rule for \`${selector}\``).toBeGreaterThan(-1);
  return source
    .slice(source.indexOf('{', at) + 1, source.indexOf('}', at))
    .split(';')
    .map((one) => one.trim())
    .filter((one) => one !== '');
}

/** A `--token: 24px;` value from tokens.css, in pixels. */
function pixels(name: string): number {
  const match = new RegExp(`${name}:\\s*(\\d+)px`).exec(tokens);
  expect(match, `expected ${name} to be a pixel value in tokens.css`).not.toBeNull();
  return Number(match?.[1]);
}

describe('the issue list header in a narrow pane', () => {
  const header = ruleFor(list, '.header');

  it('wraps instead of running out of the pane', () => {
    expect(header).toContain('flex-wrap: wrap');
  });

  it('has no fixed height to stop it wrapping', () => {
    // `height: 44px` and `flex-wrap: wrap` together are worse than either alone: the row wraps
    // and the second line is drawn outside the box, over the rows beneath it.
    expect(header.filter((one) => one.startsWith('height:'))).toEqual([]);
    expect(header).toContain('min-height: var(--header-height)');
  });

  it('is still exactly one header tall while one line fits', () => {
    // The pane below must not move by a pixel on the wide screens where nothing wrapped. The
    // minimum only decides that if the padded, bordered content of a single line stays under
    // it — which is arithmetic on four tokens, and so is worth failing on if one of them moves.
    const single = pixels('--control-height-md') + 2 * pixels('--space-1') + 1;
    expect(header).toContain('padding-block: var(--space-1)');
    expect(single).toBeLessThanOrEqual(pixels('--header-height'));
  });

  it('keeps every control at the width of its own label', () => {
    // Insights, Display, Team settings: product strings, which `08-ui-composition.md` says may
    // not be truncated. They are not allowed to be shrunk into an ellipsis either.
    expect(ruleFor(list, '.header > *:not(.title, .spacer)')).toContain('flex: none');
  });

  it('exempts the two items that are meant to flex, by specificity rather than order', () => {
    // `.title` is user-supplied text and is the one thing here that may ellipsis; `.spacer` is
    // nothing but slack. Both are excluded inside the selector, so no equal-weight rule has to
    // win a tie the bundler decides.
    expect(list).toContain('.header > *:not(.title, .spacer)');
    expect(ruleFor(list, '.title')).toEqual(
      expect.arrayContaining(['min-width: 4rem', 'overflow: hidden', 'text-overflow: ellipsis']),
    );
  });

  it('does not clip what it can no longer fit', () => {
    // Hiding the overflow would trade a header drawn over the next pane for controls that are
    // simply gone, and would cut the focus ring off anything on the last line.
    expect(header.filter((one) => one.startsWith('overflow'))).toEqual([]);
  });
});
