import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Every routed screen carries a heading.
 *
 * Not decoration. A heading is how somebody using a screen reader finds out where they are:
 * the heading list is a primary means of navigation, and a screen absent from it is one that
 * can only be explored by reading it top to bottom. Every screen in the product had one
 * except `/search`, which had a search box whose own label is hidden — so the answer to
 * "where am I" was nothing at all.
 *
 * Asserted against the router rather than a hand-kept list, because a screen added tomorrow
 * is exactly the one that would be forgotten. Reading source text is crude and is the point:
 * rendering fourteen screens to count their headings would need fourteen sets of fixtures,
 * routes and stores, and would test the fixtures.
 */

const SRC = join(__dirname, '..');
const APP = join(SRC, 'app', 'App.tsx');

/**
 * Components the router mounts as a whole screen, and the file each one lives in.
 *
 * The path comes from App.tsx's own import rather than from a guess at `src/views/`:
 * LabelSettings sits under `src/features/labels/`, and a test that assumed otherwise would
 * report a missing file as a missing heading — the wrong defect, in the wrong place.
 */
function routedScreens(): Record<string, string> {
  const app = readFileSync(APP, 'utf8');

  const importedFrom = new Map<string, string>();
  for (const match of app.matchAll(/import\s+\{([^}]+)\}\s+from\s+'~\/([^']+)'/g)) {
    for (const name of match[1]!.split(',')) {
      importedFrom.set(name.trim(), match[2]!);
    }
  }

  const screens: Record<string, string> = {};
  for (const match of app.matchAll(/<Route\s+path="[^"]*"\s+element=\{<(\w+)/g)) {
    const name = match[1]!;
    const module = importedFrom.get(name);
    if (module !== undefined) screens[name] = join(SRC, `${module}.tsx`);
  }
  return screens;
}

/**
 * Screens whose heading comes from a wrapper rather than from their own file.
 *
 * Listed by hand, with the reason, because "it is provided elsewhere" is a claim somebody
 * has to make on purpose — an empty allowance here is how a missing heading becomes an
 * exemption nobody argued for.
 */
const HEADING_FROM_A_WRAPPER: Record<string, string> = {
  SignIn: 'AuthLayout renders the h1 for all three auth screens',
  SignUp: 'AuthLayout renders the h1 for all three auth screens',
  AcceptInvite: 'AuthLayout renders the h1 for all three auth screens',
  CreateWorkspace: 'AuthLayout renders the h1 for all three auth screens',
  FirstTeam: 'redirects to a team; it renders no screen of its own',
  SavedView: 'renders IssueList, which carries the heading',
  ProjectDetail: 'renders IssueList, which carries the heading',
  CycleDetail: 'renders IssueList, which carries the heading',
  MyIssues: 'renders IssueList, which carries the heading',
};

describe('routed screens', () => {
  const screens = routedScreens();

  it('finds the routes to check', () => {
    expect(
      Object.keys(screens).length,
      'no <Route element={<Component />}> resolved to an import in App.tsx, so this test is ' +
        'asserting nothing — the router or the import style has changed shape and this ' +
        'needs to learn the new one',
    ).toBeGreaterThan(5);
  });

  it.each(Object.entries(routedScreens()))('%s has a heading', (name, file) => {
    const excuse = HEADING_FROM_A_WRAPPER[name];
    if (excuse !== undefined) return;

    let source: string;
    try {
      source = readFileSync(file, 'utf8');
    } catch {
      throw new Error(
        `${name} is routed as a screen and ${file} cannot be read. Either it moved — in ` +
          `which case App.tsx's import says where and this test follows it — or the route ` +
          `points at something that no longer exists.`,
      );
    }

    expect(
      source.includes('<h1'),
      `${name} (${file}) is a routed screen with no <h1>. Somebody using a screen reader arrives with ` +
        `no answer to "where am I": the heading list, which is how many people navigate, ` +
        `skips the screen entirely. If the design has no room for a visible title, hide it ` +
        `from the page and not from the accessibility tree — Search.module.css's ` +
        `.screenTitle is the recipe. If the heading genuinely comes from a wrapper, add it ` +
        `to HEADING_FROM_A_WRAPPER with the reason.`,
    ).toBe(true);
  });
});
