/**
 * The accessibility floor, from the browser.
 *
 * `docs/03-architecture/08-ui-composition.md` states it — every interactive element
 * reachable from the keyboard, every icon-only control named, every dialog trapping focus,
 * every error wired through `aria-describedby` — and until this file existed, nothing in CI
 * could see any of it. The per-file checklist at the end of that document was a thing a
 * reviewer might remember.
 *
 * axe is the right instrument for about half of it: it cannot tell whether a focus trap
 * returns focus to its trigger, but it catches every nameless control, every orphaned
 * label, every list whose children are not list items, and it catches them on the real
 * screens rather than on a specimen page. The jsdom companion over the component gallery —
 * `src/views/Gallery.a11y.test.tsx` — covers the primitives in isolation, and runs under
 * `pnpm test`. This one covers them assembled, which is where the composition rules live.
 *
 * Two deliberate narrowings:
 *
 * `color-contrast` is off. Colour is asserted from the token source, where the answer is
 * exact and both themes can be checked at once; axe can only sample what it happens to
 * have painted, and sampling a virtualised list of rows is slow and tells you about the
 * twenty rows that were mounted.
 *
 * The screens are walked at `serious` and `critical` for `wcag2a` and `wcag2aa`. The lower
 * two impact levels are not a threshold to hold a merge on — `moderate` is largely
 * best-practice landmark advice — and the two tags are the conformance level the document
 * actually commits to.
 *
 * The threshold is the thing not to negotiate with. The first run of this file failed on
 * three real violations, and the screen list below is short by exactly the screens that carry
 * them — named below SCREENS — rather than the threshold being lowered to let them through: a
 * suite that passes at `critical`-only, or with half the rules off, reports a floor the
 * product does not have. One of those three is fixed and the issue detail is back in the
 * walk; the other two are both the issue list, and the comment below SCREENS says what axe
 * reports on it and why no arrangement of wrappers answers it.
 */

import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import type { Result } from 'axe-core';

import { test, expect, signIn, createIssueViaApi, openTeamList } from './fixtures';

/**
 * The screens, in the style of keymap.spec.ts: `/ENG` is substituted for the fixture's team
 * key and `/ISSUE` for the probe issue's identifier.
 *
 * These are assembled surfaces rather than every route: the screen whose chrome is its own
 * (inbox), the two entity lists that each own a different empty state, and a settings page,
 * which is the one surface that swaps the shell's sidebar for its own nav. A fresh workspace
 * reaches `/projects` and `/dashboards` as empty states, which is the shape every screen in
 * the product is in on its first day and the shape an `EmptyState` bug hides in.
 *
 * The issue detail is here because the one violation it carried is fixed: the visually-hidden
 * `<input type="file">` behind "Upload image" is named and out of the tab order.
 */
const SCREENS: [name: string, path: string][] = [
  ['inbox', '/inbox'],
  ['projects', '/projects'],
  ['dashboards', '/dashboards'],
  ['profile settings', '/settings/profile'],
  ['issue detail', '/issue/ISSUE'],
];

/*
 * The one screen this walk does not visit yet, and why — recorded here rather than in a
 * commit message, because the next person to add a screen needs to know it was audited and
 * found wanting rather than overlooked.
 *
 * `/team/ENG` — the issue list. Both of its violations are the same fact about the markup,
 * and axe's wording is worth reading rather than the one in the first draft of this comment,
 * which blamed the virtualiser's wrappers: axe walks straight through a `role="presentation"`
 * div, and the wrappers are not the problem.
 *
 *   - `aria-required-children` (critical) on `.scroller`: "Element has children which are not
 *     allowed: button, button[aria-label]" — the group headings. A heading owns the control
 *     that folds its group away and the "+" that files an issue into it, and a listbox may
 *     own options and groups, not buttons.
 *   - `nested-interactive` (serious) on an issue row: a `role="option"` owning the select
 *     checkbox, the `⋯` menu and the property pills. `tabIndex={-1}` does not help, and axe
 *     says why — a negative tabindex still leaves the element focusable to assistive
 *     technology.
 *
 * So no arrangement of wrappers fixes it: a listbox subtree may not contain controls at all,
 * and this list is full of them. The fix is the `role="grid"` idiom the sibling `Trash` and
 * `Archives` views already use for the same shape — rows and gridcells, which do own
 * controls — and that renames the roles a dozen pre-existing specs select the list by
 * (`getByRole('listbox', { name: /issues/i })`, `getByRole('option')`). It is one line in
 * SCREENS away from being covered once that lands: `['team list', '/team/ENG']`.
 */

const TAGS = ['wcag2a', 'wcag2aa'];
const BLOCKING: ReadonlySet<string> = new Set(['serious', 'critical']);

async function scan(page: Page): Promise<Result[]> {
  const results = await new AxeBuilder({ page })
    .withTags(TAGS)
    .disableRules(['color-contrast'])
    .analyze();
  return results.violations.filter((v) => BLOCKING.has(v.impact ?? ''));
}

/** A failure message somebody can act on without opening a trace: rule, impact, selector. */
function describeViolations(screen: string, violations: readonly Result[]): string {
  return violations
    .map((v) => {
      const where = v.nodes
        .slice(0, 5)
        .map((n) => `      ${n.target.join(' ')}`)
        .join('\n');
      const more = v.nodes.length > 5 ? `\n      … and ${v.nodes.length - 5} more` : '';
      return `  ${screen}: ${v.id} (${v.impact})\n    ${v.help}\n${where}${more}`;
    })
    .join('\n');
}

test('the signed-out screens clear the accessibility floor', async ({ page }) => {
  // Signed out, and therefore before the fixture's workspace exists: the sign-in form is
  // the first thing anybody meets, the only screen a person cannot navigate away from
  // towards their goal, and the one surface in the product with no shell around it.
  await page.goto('/signin');
  await page.getByRole('button', { name: /sign in/i }).waitFor();

  const violations = await scan(page);
  expect(violations, describeViolations('/signin', violations)).toEqual([]);
});

test('every assembled screen clears the accessibility floor', async ({ page, workspace }) => {
  await signIn(page, workspace.account);
  const probe = await createIssueViaApi(workspace, 'Accessibility probe');

  // The team list first, and through the fixture, because `openTeamList` is the one wait
  // that knows a team list has two shapes — rows, or the empty state and its create button.
  // It is the warm-up rather than a scan: a workspace whose replica has opened and drawn one
  // issue is a workspace the screens below are being audited on, not a loading shell.
  await openTeamList(page, workspace.teamKey);
  await expect(page.getByText(probe.identifier).first()).toBeVisible();

  const failures: string[] = [];
  for (const [name, path] of SCREENS) {
    await page.goto(
      path.replace('/ENG', `/${workspace.teamKey}`).replace('/ISSUE', `/${probe.identifier}`),
    );
    // Every one of these routes is lazy, so the chrome is up under Suspense several frames
    // before the screen itself is. Scanning between the two would audit a spinner and pass,
    // which is the quiet way an assertion like this becomes decorative.
    //
    // The `h1` is the wait rather than the workspace nav, because `/settings/*` swaps that
    // nav out for its own — the trap that keeps Templates out of keymap.spec.ts's walk —
    // and every screen here titles itself with exactly one level-1 heading.
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => document.readyState), { timeout: 10_000 })
      .toBe('complete');

    const violations = await scan(page);
    if (violations.length > 0) failures.push(describeViolations(name, violations));
  }

  expect(failures, `axe found serious or critical violations:\n${failures.join('\n')}`).toEqual([]);
});
