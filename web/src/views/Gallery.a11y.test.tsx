import { render } from '@testing-library/react';
import axe, { type Result } from 'axe-core';
import { describe, expect, it } from 'vitest';

import { Gallery } from './Gallery';

/**
 * axe over the component gallery — every primitive, in every state, in one tree.
 *
 * The gallery exists so a polish pass can see all of it at once, and that is exactly what
 * makes it the cheapest accessibility check in the repo: a nameless control or an orphaned
 * label is caught here against a specimen rather than against whichever screen happened to
 * mount the primitive. It is also the only way to audit the states the product cannot hold
 * still — a loading Button, an invalid Input, a disabled danger IconButton.
 *
 * In jsdom rather than in Playwright, because `/gallery` is matched before the router under
 * `import.meta.env.DEV` and is dropped from a production bundle entirely — so the route does
 * not exist in the build CI serves, and an e2e spec pointed at it would pass here and 404
 * there. `web/e2e/a11y.spec.ts` covers the assembled screens instead, which is the half this
 * cannot see.
 *
 * `color-contrast` is off for a reason stronger than the e2e suite's: jsdom computes no
 * layout and loads no stylesheet, so axe has nothing to sample and the rule can only be
 * wrong in both directions. Colour is asserted against the token source.
 *
 * `region` is off because it is a landmark rule about a whole document, and this renders a
 * fragment with no shell around it — the product's landmarks belong to the e2e walk.
 */

const RULES_OFF = ['color-contrast', 'region'];
const BLOCKING: ReadonlySet<string> = new Set(['serious', 'critical']);

function describeViolations(violations: readonly Result[]): string {
  return violations
    .map(
      (v) =>
        `${v.id} (${v.impact}): ${v.help}\n` +
        v.nodes.map((n) => `    ${n.target.join(' ')}`).join('\n'),
    )
    .join('\n');
}

describe('the component gallery', () => {
  it('has no serious or critical WCAG A/AA violations', async () => {
    const { container } = render(<Gallery />);

    const results = await axe.run(container, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] },
      rules: Object.fromEntries(RULES_OFF.map((id) => [id, { enabled: false }])),
    });
    const blocking = results.violations.filter((v) => BLOCKING.has(v.impact ?? ''));

    // Asserted on the rule ids rather than on the violation objects: the failure then names
    // the rules in one line, with the offending selectors in the message, instead of
    // printing a page of axe internals as a diff.
    expect(
      blocking.map((v) => v.id),
      describeViolations(blocking),
    ).toEqual([]);
  }, 60_000);
});
