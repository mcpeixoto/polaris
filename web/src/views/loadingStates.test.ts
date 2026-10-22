import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * No screen waits for a list behind a spinner.
 *
 * Nearly everything here renders from the local replica, so it is instantaneous or genuinely
 * empty. The dozen screens that are the exception — the invite list, API keys, the archives,
 * the integration settings — are the ones whose answer is precisely what the replica does not
 * hold, and every one of them drew a centred `Spinner`. A spinner is the right shape for an
 * action and the wrong one for a list: it says "something is happening" where the screen could
 * say "rows, this many, about this wide", and the layout jumps when the real rows land under
 * it. `LoadingRows` is the list-shaped answer, and it carries the live region a spinner's
 * `label` used to be.
 *
 * Source text rather than rendering, in the style of `views/screens.test.ts`: rendering twelve
 * settings screens to see which placeholder they draw would need twelve sets of fetch mocks,
 * and would be testing the mocks.
 */

const VIEWS = __dirname;

/**
 * Screens where a spinner is still the right shape, and why.
 *
 * Listed by hand, with the reason, because "this one is different" is a claim somebody has to
 * make on purpose — an empty allowance here is how the next list-behind-a-spinner becomes an
 * exemption nobody argued for.
 */
const SPINNER_IS_RIGHT: Record<string, string> = {
  'Gallery.tsx': 'the dev-only component gallery, where Spinner is one of the specimens on display',
  'Search.tsx': 'an in-toolbar progress indicator beside the query, not a list standing in',
  'ExportSettings.tsx':
    "resolves to a single value — the role's export cap — rendered as one note and a " +
    'button; the file says so in its own comment',
  'GitHubSettings.tsx':
    "one webhook's URL and secret arriving, which is one entity's detail rather than rows",
  'GitLabSettings.tsx':
    "one webhook's URL and secret arriving, which is one entity's detail rather than rows",
};

function viewFiles(): string[] {
  return readdirSync(VIEWS)
    .filter((name) => name.endsWith('.tsx') && !name.includes('.test.'))
    .sort();
}

describe('screens that really load', () => {
  const files = viewFiles();

  it('finds the screens to check', () => {
    expect(
      files.length,
      'no view files were readable, so this test is asserting nothing — the layout has ' +
        'changed shape and this needs to learn the new one',
    ).toBeGreaterThan(40);
  });

  it.each(files)('%s does not wait for a list behind a spinner', (name) => {
    const source = readFileSync(join(VIEWS, name), 'utf8');
    if (!source.includes('<Spinner')) return;

    expect(
      SPINNER_IS_RIGHT[name],
      `${name} renders a Spinner. If it is standing in for rows that are on their way, use ` +
        `LoadingRows instead — it draws the shape of the list and carries the same live ` +
        `region the spinner's label was. If the spinner is right because what lands is one ` +
        `value, one entity's detail, or a control's own busy state, add the file to ` +
        `SPINNER_IS_RIGHT with the reason.`,
    ).toBeDefined();
  });

  it('keeps the allowance honest, so a screen that stops using a spinner leaves the list', () => {
    const stale = Object.keys(SPINNER_IS_RIGHT).filter((name) => {
      try {
        return !readFileSync(join(VIEWS, name), 'utf8').includes('<Spinner');
      } catch {
        return true;
      }
    });

    expect(stale, `these no longer render a Spinner and should leave SPINNER_IS_RIGHT`).toEqual([]);
  });
});
