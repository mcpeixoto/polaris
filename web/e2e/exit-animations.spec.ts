/**
 * What a surface is allowed to do on its way out.
 *
 * Animating a dismissal means holding a fully rendered dialog on top of the page for the
 * length of its exit, after the user has already decided they are finished with it. That is a
 * safety question before it is a design one, and it is not a question jsdom can answer:
 * `inert` is not implemented there, computed animation durations are all zero, and the whole
 * mechanism collapses into the hard cut it replaces. It has to be asked of a real browser.
 *
 * Three things are asserted, and they are the three ways this could go wrong in the wild.
 *
 * The leaving node must not be reachable — not by the pointer, not by Tab, not by the
 * accessibility tree. `inert` and `pointer-events: none` together are what make that true, so
 * both are read off the live element rather than assumed from the stylesheet.
 *
 * The keyboard must come back immediately. Escape is a keystroke on a path where the next
 * keystroke is usually already on its way, so focus returns to the trigger on the frame the
 * key lands, whatever the scrim is still doing.
 *
 * And it has to actually leave. An exit that never fires its animation — a collapsed
 * duration, a backgrounded tab — must still unmount, or the surface is stranded on the page
 * forever. `prefers-reduced-motion` is the case that would strand it, so it is the case that
 * is checked.
 *
 * Nothing here waits out a duration or races one. The exiting state is observed by a
 * MutationObserver installed before the dismissal, which records what it saw; the assertions
 * then read the record. A test that tried to catch a fifty-millisecond window with a round
 * trip would be a flake generator on a loaded CI box, and would be measuring the runner.
 */

import { createIssueViaApi, test, expect, signIn, openTeamList } from './fixtures';

interface ExitReport {
  /** Whether an exiting surface was ever observed at all. */
  seen: boolean;
  /** Whether every observation of it carried `inert`. */
  alwaysInert: boolean;
  /** Whether every observation of it computed to `pointer-events: none`. */
  alwaysUnclickable: boolean;
  /** Whether focus was ever inside it while it was leaving. */
  everHeldFocus: boolean;
}

/**
 * Watches for `[data-exiting]` and remembers what it was like, for as long as it existed.
 *
 * Attribute and child-list mutations both, because the state arrives as an attribute on a
 * node that is already there and departs with the node itself.
 */
async function watchExits(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate(() => {
    const report: ExitReport = {
      seen: false,
      alwaysInert: true,
      alwaysUnclickable: true,
      everHeldFocus: false,
    };
    (window as unknown as { __exitReport: ExitReport }).__exitReport = report;

    const sample = () => {
      for (const node of document.querySelectorAll('[data-exiting]')) {
        report.seen = true;
        if (!node.hasAttribute('inert')) report.alwaysInert = false;
        if (getComputedStyle(node).pointerEvents !== 'none') report.alwaysUnclickable = false;
        const active = document.activeElement;
        if (active !== null && node.contains(active)) report.everHeldFocus = true;
      }
    };

    new MutationObserver(sample).observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['data-exiting', 'inert'],
    });
    // The observer only fires on changes, and a surface can be marked in the same commit that
    // installs it; one immediate sample closes that gap.
    sample();
  });
}

async function exitReport(page: import('@playwright/test').Page): Promise<ExitReport> {
  return page.evaluate(() => (window as unknown as { __exitReport: ExitReport }).__exitReport);
}

test('a dismissed dialogue cannot be clicked, tabbed into, or focused while it leaves', async ({
  page,
  workspace,
}) => {
  const issue = await createIssueViaApi(workspace, 'Dismissed while it leaves');
  await signIn(page, workspace.account);
  await page.goto(`/issue/${issue.identifier}`);

  // A confirmation, because it is the dialogue with the most to lose from being clickable on
  // its way out: the button under the fading scrim is the one that deletes the issue.
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  const confirm = page.getByRole('dialog', { name: `Delete ${issue.identifier}?` });
  await expect(confirm).toBeVisible();

  await watchExits(page);
  await page.keyboard.press('Escape');
  await expect(confirm).toBeHidden();

  const report = await exitReport(page);
  expect(report.seen).toBe(true);
  expect(report.alwaysInert).toBe(true);
  expect(report.alwaysUnclickable).toBe(true);
  expect(report.everHeldFocus).toBe(false);

  // Dismissing it dismissed it: the issue is still here, and the page underneath answers the
  // keyboard again rather than being held under a scrim that has not finished.
  await expect(page.getByRole('button', { name: 'Delete', exact: true })).toBeFocused();
});

test('a picker leaves without swallowing the keystroke after it', async ({ page, workspace }) => {
  await createIssueViaApi(workspace, 'Picked and unpicked');
  await signIn(page, workspace.account);
  await openTeamList(page, workspace.teamKey);

  // Menu is the surface with the most to prove here: it holds the keyboard while it is open,
  // so an exit that kept hold of it would leave S, A and P landing inside a menu the user
  // believes they have closed. Reopening immediately is the other half — the first menu is
  // still fading when the second is asked for.
  const menu = page.getByRole('menu', { name: 'Status' });
  await page.keyboard.press('s');
  await expect(menu).toBeVisible();

  await watchExits(page);
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();

  const report = await exitReport(page);
  expect(report.seen).toBe(true);
  expect(report.alwaysInert).toBe(true);
  expect(report.alwaysUnclickable).toBe(true);
  expect(report.everHeldFocus).toBe(false);

  await page.keyboard.press('s');
  await expect(menu).toBeVisible();
});

test('a surface still unmounts when motion is collapsed to nothing', async ({
  page,
  workspace,
}) => {
  // The reduced-motion collapse in tokens.css is 1ms rather than 0ms precisely so that
  // anything waiting on the end of an animation is not left waiting forever. This is the
  // assertion that keeps that comment honest.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await signIn(page, workspace.account);
  await openTeamList(page, workspace.teamKey);

  const panel = page.getByRole('dialog', { name: 'Display options' });
  const trigger = page.getByRole('button', { name: /display/i }).first();
  await trigger.click();
  await expect(panel).toBeVisible();

  await page.keyboard.press('Escape');
  // Deliberately tight. Under reduced motion the surface has no fade to wait out, and a
  // generous timeout here would pass just as happily against a node that never left.
  await expect(panel).toBeHidden({ timeout: 1_000 });

  // And it can be summoned again — a stranded exit would leave the old node in the way.
  await trigger.click();
  await expect(panel).toBeVisible();
});
