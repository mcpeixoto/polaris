import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Every routed screen names itself in the tab strip.
 *
 * `hooks/useDocumentTitle` existed, documented, for months with exactly one call site — the
 * shell, passing an empty array — so every tab, every history entry and every bookmark in a
 * product people keep six tabs of read "Polaris". The module was not the hard part; calling
 * it on seventy-four screens was, and the seventy-fifth is the one that would be forgotten.
 *
 * Asserted against the router rather than a hand-kept list, for the reason `screens.test.ts`
 * gives about headings: a screen added tomorrow is exactly the one nobody remembers. Reading
 * source text is crude and is the point — rendering seventy-four screens to read
 * `document.title` would need seventy-four sets of fixtures, routes and stores, and would be
 * testing the fixtures.
 *
 * This file resolves routes more thoroughly than `screens.test.ts` does, and deliberately so.
 * Nearly every screen is now `lazy(async () => ({ default: (await import('~/views/X')).X }))`
 * rather than a static import, and most of the settings routes are wrapped in `<AdminOnly>`,
 * so a pattern that only reads `element={<Component` finds eight screens out of seventy-four.
 * Both forms are resolved here, and `element={…}` is brace-matched so a screen inside a role
 * gate is found rather than the gate.
 */

const SRC = join(__dirname, '..');
const APP = join(SRC, 'app', 'App.tsx');

/**
 * Components the router mounts as a whole screen, and the file each one lives in.
 *
 * The path comes from App.tsx's own import rather than from a guess at `src/views/`: four of
 * the settings screens live under `src/features/`, and a test that assumed otherwise would
 * report a missing file as a missing title — the wrong defect, in the wrong place.
 */
function routedScreens(): Record<string, string> {
  const app = readFileSync(APP, 'utf8');

  const importedFrom = new Map<string, string>();
  for (const match of app.matchAll(/import\s+\{([^}]+)\}\s+from\s+'~\/([^']+)'/g)) {
    for (const name of match[1]!.split(',')) importedFrom.set(name.trim(), match[2]!);
  }
  for (const match of app.matchAll(
    /const\s+(\w+)\s*=\s*lazy\(async[\s\S]{0,200}?await import\('~\/([^']+)'\)/g,
  )) {
    importedFrom.set(match[1]!, match[2]!);
  }

  // Brace-matched rather than pattern-matched: `element={<AdminOnly><Webhooks /></AdminOnly>}`
  // spans four lines, and the screen is the inner element.
  const mounted = new Set<string>();
  const needle = 'element={';
  for (let at = app.indexOf(needle); at !== -1; at = app.indexOf(needle, at + 1)) {
    let depth = 0;
    let end = at + needle.length - 1;
    for (; end < app.length; end += 1) {
      if (app[end] === '{') depth += 1;
      else if (app[end] === '}') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    for (const match of app.slice(at, end + 1).matchAll(/<(\w+)[\s/>]/g)) mounted.add(match[1]!);
  }

  const screens: Record<string, string> = {};
  for (const name of [...mounted].sort()) {
    const module = importedFrom.get(name);
    if (module !== undefined) screens[name] = join(SRC, `${module}.tsx`);
  }
  return screens;
}

/**
 * Frames that name the tab on behalf of whatever they wrap.
 *
 * A screen that renders one of these has already said what it is called — `SettingsPage` is
 * given a `title`, `AuthLayout` a `title`, `IssueList` a scope whose `heading` is the string.
 * Thirty-one settings screens do not each need a line in an exemption list to say the frame
 * they all use works; what needs arguing is the frame, and the frame is argued here.
 */
const TITLING_FRAMES = ['<SettingsPage', '<AuthLayout', '<IssueList'];

/**
 * Screens whose title comes from a shell they do not themselves render, or that are
 * deliberately nameless.
 *
 * Listed by hand, with the reason, because "it is provided elsewhere" is a claim somebody has
 * to make on purpose — an empty allowance here is how a missing title becomes an exemption
 * nobody argued for.
 */
const TITLE_FROM_A_WRAPPER: Record<string, string> = {
  ProjectOverview: 'ProjectShell names the tab for every nested project tab',
  ProjectIssues: 'ProjectShell names the tab; IssueList fills the issues tab',
  ProjectAttachedView: 'ProjectShell names the tab; IssueList fills the view tab',
  ProjectActivity: 'ProjectShell names the tab for every nested project tab',
  InitiativeDetail: 'InitiativeShell names the tab for every nested initiative tab',
  InitiativeActivity: 'InitiativeShell names the tab for every nested initiative tab',
  Landing:
    'the product poster, where the bare product name is the title: "Polaris · Polaris" is ' +
    'what naming it would produce',
};

describe('routed screens', () => {
  const screens = routedScreens();

  it('finds the routes to check', () => {
    expect(
      Object.keys(screens).length,
      'no route element resolved to an import in App.tsx, so this test is asserting nothing ' +
        '— the router, the import style or the lazy wrapper has changed shape and this needs ' +
        'to learn the new one',
    ).toBeGreaterThan(50);
  });

  it.each(Object.entries(screens))('%s names the tab', (name, file) => {
    const excuse = TITLE_FROM_A_WRAPPER[name];
    if (excuse !== undefined) return;

    let source: string;
    try {
      source = readFileSync(file, 'utf8');
    } catch {
      throw new Error(
        `${name} is routed as a screen and ${file} cannot be read. Either it moved — in which ` +
          `case App.tsx's import says where and this test follows it — or the route points at ` +
          `something that no longer exists.`,
      );
    }

    const named =
      source.includes('useDocumentTitle') || TITLING_FRAMES.some((frame) => source.includes(frame));

    expect(
      named,
      `${name} (${file}) is a routed screen that never names itself, so opening it leaves the ` +
        `tab, the history entry and any bookmark saved from it reading "Polaris" — which is ` +
        `what every other tab reads too. Call useDocumentTitle with what the screen's own <h1> ` +
        `says, most specific part first. If the name genuinely comes from a shell this screen ` +
        `does not render, add it to TITLE_FROM_A_WRAPPER with the reason.`,
    ).toBe(true);
  });
});
