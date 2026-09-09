/**
 * Initiative updates: posting, correcting and withdrawing a status post.
 *
 * Initiative health is *derived* from the newest live update, exactly as a project's is. So
 * an edit has to move the badge on the overview and on the Initiatives list without a
 * reload, and it has to survive one — a corrected update that reverts on reload is the
 * failure this is for. Deleting the newest post has to fall health back to the one before it
 * rather than leaving the initiative asserting something nobody said.
 *
 * The badge is found by a marker rather than by its position. It used to be read as "the
 * element around the h1", which was true only while health and the heading shared a parent;
 * they no longer do — the heading and the properties are in the reading column, and health
 * is at the end of the property row.
 *
 * A test id rather than an accessible name, matching the project header's cell: `getByLabel`
 * matches on substring, so any name with "health" in it also answers the `getByLabel('Health')`
 * below, which belongs to the composer's own select. It also means these assertions belong on
 * Overview, where the derived value is drawn, so the ones that follow an edit made on Activity
 * come back first.
 *
 * The edit and the delete are author-only on the server, so the affordances are drawn for
 * the author alone; a member looking at somebody else's post must not be offered a button
 * whose only possible outcome is a refusal.
 */

import type { Page } from '@playwright/test';

import { expect, inviteToWorkspace, signIn, test, uniqueEmail } from './fixtures';

async function newInitiative(page: Page, name: string): Promise<void> {
  await page.goto('/initiatives');
  await page.getByRole('button', { name: 'New initiative' }).first().click();
  await page.getByLabel('Name').fill(name);
  await page.getByRole('button', { name: 'Create initiative' }).click();
  await page.waitForURL(/\/initiative\/[0-9a-f-]{36}/);
  await page.getByRole('heading', { name, level: 1 }).waitFor();
}

/** The derived health badge, marked rather than located. Drawn on the Overview tab. */
function health(page: Page) {
  return page.getByTestId('initiative-health');
}

async function postUpdate(page: Page, healthOption: string, body: string): Promise<void> {
  await page.getByLabel('Health').selectOption({ label: healthOption });
  await page.getByLabel('Update', { exact: true }).fill(body);
  await page.getByRole('button', { name: 'Post update' }).click();
  // The compose box clears once the mutation has resolved.
  await expect(page.getByLabel('Update', { exact: true })).toHaveValue('');
}

test('an author edits their initiative update and the derived health follows', async ({
  page,
  workspace,
}) => {
  await signIn(page, workspace.account);
  const name = `Health ${Date.now().toString(36)}`;
  await newInitiative(page, name);

  await postUpdate(page, 'On track', 'Kickoff went fine.');
  await expect(health(page)).toContainText('On track');

  await page.getByRole('link', { name: 'Activity' }).click();
  await page.getByRole('button', { name: /^Edit update from/ }).click();
  await page.getByLabel('Health').selectOption('off_track');
  await page.getByLabel('Edit update', { exact: true }).fill('Vendor pulled out.');
  await page.getByRole('button', { name: 'Save changes' }).click();

  // The form stands down once the edit lands.
  await expect(page.getByRole('button', { name: 'Save changes' })).toHaveCount(0);
  await expect(page.getByText('Vendor pulled out.')).toBeVisible();
  await expect(page.getByRole('listitem').first()).toContainText('edited');

  // The derived health is the newest update's health, so the overview moves with it —
  // without a reload, and then across one.
  await page.getByRole('link', { name: 'Overview' }).click();
  await expect(health(page)).toContainText('Off track');
  await expect(page.getByText('Vendor pulled out.')).toBeVisible();

  await page.reload();
  await expect(health(page)).toContainText('Off track');
  await expect(page.getByText('Vendor pulled out.')).toBeVisible();

  await page.goto('/initiatives');
  await expect(page.getByRole('link', { name: new RegExp(name) })).toContainText('Off track');
});

test('deleting the newest initiative update falls health back', async ({ page, workspace }) => {
  await signIn(page, workspace.account);
  const name = `Fallback ${Date.now().toString(36)}`;
  await newInitiative(page, name);

  await postUpdate(page, 'On track', 'Week one.');
  await postUpdate(page, 'Off track', 'Week two, badly.');
  await expect(health(page)).toContainText('Off track');

  await page.getByRole('link', { name: 'Activity' }).click();
  const items = page.getByRole('listitem');
  await expect(items).toHaveCount(2);
  // Newest first.
  await expect(items.first()).toContainText('Week two, badly.');

  await page
    .getByRole('button', { name: /^Delete update from/ })
    .first()
    .click();
  await page.getByRole('button', { name: 'Delete update', exact: true }).click();

  await expect(page.getByRole('listitem')).toHaveCount(1);

  await page.reload();
  await expect(page.getByRole('listitem')).toHaveCount(1);

  // Health falls back to the update before the one that was deleted, and stays there.
  await page.getByRole('link', { name: 'Overview' }).click();
  await expect(health(page)).toContainText('On track');
  await page.reload();
  await expect(health(page)).toContainText('On track');
});

test('somebody else’s initiative update carries no edit or delete', async ({
  page,
  browser,
  workspace,
}) => {
  await signIn(page, workspace.account);
  const name = `Shared ${Date.now().toString(36)}`;
  await newInitiative(page, name);
  await postUpdate(page, 'At risk', 'Owner speaking.');

  const invited = uniqueEmail('initiative-update-mate');
  const { token } = await inviteToWorkspace(workspace, invited, 'ADMIN');

  const other = await browser.newContext();
  const otherPage = await other.newPage();
  await otherPage.goto(`/invite/${token}`);
  await otherPage.getByLabel(/^email$/i).fill(invited);
  await otherPage.getByLabel(/^password$/i).fill('e2e-placeholder-password');
  await otherPage.getByLabel(/your name/i).fill('Grace Hopper');
  await otherPage.getByRole('button', { name: /create account and join/i }).click();
  await expect(otherPage.getByRole('navigation', { name: /workspace/i })).toBeVisible({
    timeout: 20_000,
  });

  await otherPage.goto('/initiatives');
  await otherPage.getByRole('link', { name: new RegExp(name) }).click();
  await otherPage.getByRole('link', { name: 'Activity' }).click();
  await expect(otherPage.getByText('Owner speaking.')).toBeVisible({ timeout: 20_000 });
  await expect(otherPage.getByRole('button', { name: /^Edit update from/ })).toHaveCount(0);
  await expect(otherPage.getByRole('button', { name: /^Delete update from/ })).toHaveCount(0);

  await other.close();
});
