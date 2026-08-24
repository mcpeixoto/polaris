/**
 * Turning triage off, with work still in the queue.
 *
 * The switch is about intake and the server treats it that way: disabling keeps the
 * reserved statuses and leaves whatever is sitting in them exactly where it is. The client
 * used to disagree — the inbox refused to render, the team page dropped its link, and
 * because every ordinary view excludes triage-category work by default, those issues were
 * then reachable from nothing but Search. There was no route left that could accept or
 * decline them, so a switch flipped in settings quietly stranded somebody's queue.
 *
 * Here rather than in a component test because the whole point is the round trip: the
 * settings mutation, the delta that carries the team back, and the inbox re-deciding what
 * screen it is — three things that only meet in a browser against a real server.
 */

import { test, expect, signIn, type SeededWorkspace } from './fixtures';
import type { Page } from '@playwright/test';

async function setTriage(page: Page, ws: SeededWorkspace, on: boolean): Promise<void> {
  await page.goto(`/team/${ws.teamKey}/settings`);
  const box = page.getByLabel('Run triage');
  await box.waitFor();
  await box.setChecked(on);
  // Polled rather than read once: the checkbox is optimistic and the team is only really
  // changed when the delta comes back, which is what the next navigation depends on.
  await expect(box).toBeChecked({ checked: on });
}

/**
 * Opens the inbox and waits for it to be a screen.
 *
 * `page.goto` resolves several frames before the replica is open and the keymap has
 * registered anything, so a test that navigates and immediately presses a key is racing
 * the boot. The heading is what both states of this screen have — a list with rows and a
 * list without — so waiting on the listbox would be waiting for one of the two answers.
 */
async function openTriage(page: Page, ws: SeededWorkspace): Promise<void> {
  await page.goto(`/team/${ws.teamKey}/triage`);
  await page.getByRole('heading', { name: /triage/i }).waitFor();
}

test('a queue outlives the switch that filled it', async ({ page, workspace }) => {
  await signIn(page, workspace.account);
  await setTriage(page, workspace, true);

  await openTriage(page, workspace);

  // File one, from the inbox, which is one of the ways work lands in triage.
  await page.keyboard.press('c');
  const composer = page.getByRole('dialog', { name: /new issue/i });
  await expect(composer).toBeVisible();
  await composer.getByLabel('Title').fill('Left behind by the switch');
  await composer.getByRole('button', { name: 'Create issue' }).click();
  await expect(composer).toBeHidden();

  const row = page.getByRole('option', { name: /Left behind by the switch/ });
  await expect(row).toBeVisible();

  await setTriage(page, workspace, false);

  // The team's page still offers the way in, because the queue is what the link is for.
  await page.goto(`/team/${workspace.teamKey}/home`);
  await page.getByRole('link', { name: 'Triage' }).click();

  // And the screen is the inbox saying why it is still here, not a refusal.
  await expect(page.getByText(/Intake is off/)).toBeVisible();
  await expect(row).toBeVisible();

  // Still read-write: the same key that accepts with triage on accepts with it off, and
  // the server agrees, because `1` is about the issue's status and not the team's switch.
  await page.keyboard.press('1');
  await expect(row).toBeHidden();

  // Drained, the screen retires itself — off now means off, with nothing left to hold it.
  await expect(page.getByText('Triage is off')).toBeVisible();

  // And the issue is in the team's ordinary list, where accepting put it. Reloaded, so
  // this is the server's answer rather than an optimistic patch still sitting in memory.
  await page.goto(`/team/${workspace.teamKey}`);
  await page.reload();
  await expect(page.getByRole('option', { name: /Left behind by the switch/ })).toBeVisible();
});

/**
 * The inbox's account of its own keyboard, which lives in its empty state and nowhere else.
 *
 * Grouping by status — the default — pads a group per status the view can admit, and a
 * padded group is still a row, so the list was never made of zero rows and this never
 * rendered. The accept below is what makes the assertion honest rather than a race: it
 * proves the replica is holding the Triage status the padding comes from, so an empty
 * screen here is the empty state having been chosen and not the roster being late.
 */
test('the inbox explains its keys once it is clear', async ({ page, workspace }) => {
  await signIn(page, workspace.account);
  await setTriage(page, workspace, true);

  await openTriage(page, workspace);
  await page.keyboard.press('c');
  const composer = page.getByRole('dialog', { name: /new issue/i });
  await expect(composer).toBeVisible();
  await composer.getByLabel('Title').fill('Something to clear');
  await composer.getByRole('button', { name: 'Create issue' }).click();
  await expect(composer).toBeHidden();

  const row = page.getByRole('option', { name: /Something to clear/ });
  await expect(row).toBeVisible();
  await page.keyboard.press('1');
  await expect(row).toBeHidden();

  await expect(page.getByText('Inbox is clear')).toBeVisible();
  await expect(page.getByText(/Press C to file into triage/)).toBeVisible();
});

/**
 * The same rule, on the screen everybody meets first. A team with no issues at all is five
 * status headings reading zero, and the sentence that says how to file the first one was
 * underneath the padding rather than on the screen.
 */
test('a team with no work says so', async ({ page, workspace }) => {
  await signIn(page, workspace.account);
  await page.goto(`/team/${workspace.teamKey}`);

  await expect(page.getByText('No issues in this team yet')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create an issue' })).toBeVisible();
});
