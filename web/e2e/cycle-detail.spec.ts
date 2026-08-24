/**
 * The cycle screen, and the two things its graph is allowed to say instead of drawing.
 *
 * A burn-up has three answers, and the two quiet ones are the easy ones to lose. A cycle
 * that has not started has nothing to burn down — the graph is generated once a cycle
 * begins, and the capacity dial is what a planned window gets — and a cycle with no issues
 * on it has nothing to plot however wide its window is. Neither was reachable: the only
 * guard was a window shorter than two days, which the server refuses to create, so both
 * states drew a flat line under a *Cycle success 0%* verdict on work nobody could have done.
 *
 * Driving it from the browser is the point. The distinction is between three renders of one
 * component chosen by data the store assembles, and every one of them is a sentence a person
 * reads on arrival.
 */

import { expect, test, signIn } from './fixtures';
import type { Page } from '@playwright/test';

const NOT_STARTED = 'The graph appears once this cycle begins.';
const NO_DATA = 'Not enough data to chart this cycle yet.';

const graph = (page: Page) => page.getByRole('region', { name: 'Cycle graph' });

async function enableCycles(page: Page, teamKey: string): Promise<void> {
  await page.goto(`/team/${teamKey}/settings`);
  const box = page.getByLabel('Run cycles');
  await box.waitFor();
  if (!(await box.isChecked())) await box.check();
  // The cadence controls only exist once the team runs cycles, so this is the write landing
  // rather than a fixed pause — the windows are minted by the same mutation.
  await expect(page.getByLabel('Duration')).toBeVisible();
}

/**
 * A ready issue list, in either of its two shapes: the rows, or the empty state that stands
 * in for them while nothing is on this cycle. Waiting on the listbox alone would hang on
 * the empty window, which is the state both tests here start from.
 */
function listOrEmpty(page: Page) {
  return page
    .getByRole('listbox', { name: /issues/i })
    .or(page.getByRole('button', { name: 'Create an issue' }))
    .first();
}

/** Opens the team's current or next window from the Cycles page, the way a person does. */
async function openCycle(page: Page, teamKey: string, phase: 'Current' | 'Upcoming') {
  await page.goto(`/team/${teamKey}/cycles`);
  const row = page.locator('li').filter({ hasText: phase }).getByRole('link').first();
  await row.waitFor();
  await row.click();
  await expect(page).toHaveURL(/\/cycle\/[0-9a-f-]{36}$/);
  await listOrEmpty(page).waitFor();
}

async function fileIssue(page: Page, title: string): Promise<void> {
  // The composer has to be opened from the list, because `C` is registered by it and a
  // create from anywhere else files into the team rather than into this cycle. With rows
  // on screen that means clicking into them first; with none, it means the empty state's
  // own button, which invokes the same action in the same context.
  const rows = page.getByRole('listbox', { name: /issues/i });
  if (await rows.isVisible()) {
    await rows.click({ position: { x: 4, y: 4 } });
    await page.keyboard.press('c');
  } else {
    await page.getByRole('button', { name: 'Create an issue' }).click();
  }
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Title').fill(title);
  await dialog.getByRole('button', { name: 'Create issue' }).click();
  await expect(page.getByRole('option', { name: new RegExp(title) })).toBeVisible();
}

/** Moves the row under the cursor, which is what the property shortcuts act on. */
async function setStatus(page: Page, title: string, status: string): Promise<void> {
  await page.getByRole('option', { name: new RegExp(title) }).hover();
  const item = page.getByRole('menuitem', { name: status, exact: true });
  await page.keyboard.press('s');
  await item.waitFor();
  await item.click({ force: true });
  await expect(item).toHaveCount(0);
}

test('a cycle that has not started says so instead of grading it', async ({ page, workspace }) => {
  await signIn(page, workspace.account);
  await enableCycles(page, workspace.teamKey);

  await openCycle(page, workspace.teamKey, 'Upcoming');
  await expect(page.getByText(NOT_STARTED)).toBeVisible();
  await expect(graph(page)).toHaveCount(0);

  // Planning work into next cycle is not doing it, so the answer does not change.
  await fileIssue(page, 'Planned for next time');
  await expect(page.getByText(NOT_STARTED)).toBeVisible();
  await expect(graph(page)).toHaveCount(0);
});

test('a running cycle charts what is on it, and nothing before that', async ({
  page,
  workspace,
}) => {
  await signIn(page, workspace.account);
  await enableCycles(page, workspace.teamKey);

  await openCycle(page, workspace.teamKey, 'Current');
  // Started, but empty: the window is real and there is genuinely nothing on it.
  await expect(page.getByText(NO_DATA)).toBeVisible();
  await expect(graph(page)).toHaveCount(0);

  await fileIssue(page, 'First of the cycle');
  await fileIssue(page, 'Second of the cycle');
  await expect(graph(page)).toBeVisible();
  await expect(graph(page)).toContainText('Completed 0 / 2 issues');
  await expect(page.getByText(NO_DATA)).toHaveCount(0);

  await setStatus(page, 'First of the cycle', 'In Progress');
  // Anchored: "In progress 1 issues" contains "In progress 1 issue", so a substring would
  // pass on the plural this is here to pin.
  await expect(graph(page).getByText(/^In progress 1 issue$/)).toBeVisible();

  await setStatus(page, 'First of the cycle', 'Done');
  await expect(graph(page)).toContainText('Completed 1 / 2 issues');

  // And it is read back off the replica, not held in the component.
  await page.reload();
  await expect(graph(page)).toContainText('Completed 1 / 2 issues');
});
