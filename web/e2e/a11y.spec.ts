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
 * three real violations, and the screen list was short by exactly the screens that carried
 * them rather than the threshold being lowered to let them through: a suite that passes at
 * `critical`-only, or with half the rules off, reports a floor the product does not have.
 * All three are fixed, and the walk is the whole list again — which is the only state in
 * which this file means what its name says.
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
 * The two that were held back are in: the issue detail, whose visually-hidden
 * `<input type="file">` behind "Upload image" is now named and out of the tab order, and the
 * team list, which is a `grid` of rows rather than a `listbox` of options — see the comment
 * below for what that was about, because it is the one of the three that was a design
 * question rather than an attribute.
 */
const SCREENS: [name: string, path: string][] = [
  ['inbox', '/inbox'],
  ['projects', '/projects'],
  ['dashboards', '/dashboards'],
  ['profile settings', '/settings/profile'],
  ['issue detail', '/issue/ISSUE'],
  ['team list', '/team/ENG'],
  ['team board', '/team/ENG?layout=board'],
];

/*
 * What the team list cost, kept because the shape of the mistake is reusable.
 *
 * It was a `role="listbox"` whose rows were `role="option"`, and it failed twice:
 * `aria-required-children` on the scroller — "Element has children which are not allowed:
 * button, button[aria-label]", the group headings, since a heading owns the control that
 * folds it and the "+" that files into it — and `nested-interactive` on a row, which owns the
 * select checkbox, the `⋯` menu and the property pills.
 *
 * Two readings were wrong and cost time. The first was that the virtualiser's
 * `role="presentation"` wrappers were in the way; axe walks straight through them, and they
 * never were. The second was that `tabIndex={-1}` on a control inside an option would do it;
 * axe answers that one in the failure text — a negative tabindex still leaves the element
 * focusable to assistive technology. No arrangement of wrappers or tabindexes could have
 * worked, because an option's children are presentational and a listbox may not own controls
 * at all, while this list is made of them.
 *
 * So the roles were the bug rather than the markup around them, and the list is now the
 * `grid` that `views/Trash.tsx` and `views/Archives.tsx` already use for the same shape. That
 * renamed what a dozen specs here select the list by, which is why this is a wide diff for
 * two violations: `getByRole('grid', { name: /issues/i })` for the list, `row` for a whole
 * row and the selection on it, `gridcell` for an issue's body — the element that carries the
 * row's id, its click and its context menu — and `rowheader` for a group heading.
 *
 * The board followed, for the reason the file it lives in gives for everything else: it is
 * the list turned on its side, and the way that goes wrong is by being written twice. Each
 * column is a one-column `grid` of card rows — same roles, same cursor, same selection — and
 * `?layout=board` is the sixth screen here.
 *
 * What this walk sees of it is one column with one card, which is all a fresh workspace draws.
 * The two shapes that carried the bugs are display state no URL reaches: an empty column, and
 * a folded one. `src/features/view/ui/Board.a11y.test.tsx` runs the same rules over both in
 * jsdom, and it is worth knowing why it exists — an empty column used to draw "Nothing here"
 * *inside* the listbox, which is a third critical nobody had seen, because the only screen
 * that showed it was never walked.
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
