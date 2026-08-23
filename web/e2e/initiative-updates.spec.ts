/**
 * Initiative updates: posting, correcting and withdrawing a status post.
 *
 * Initiative health is *derived* from the newest live update, exactly as a project's is. So
 * an edit has to move the badge on the shell and on the Initiatives list without a reload,
 * and it has to survive one — a corrected update that reverts on reload is the failure this
 * is for. Deleting the newest post has to fall health back to the one before it rather than
 * leaving the initiative asserting something nobody said.
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

async function postUpdate(page: Page, health: string, body: string): Promise<void> {
  await page.getByLabel('Health').selectOption({ label: health });
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
  const shell = page.locator('h1').locator('..');
  await expect(shell).toContainText('On track');

  await page.getByRole('link', { name: 'Activity' }).click();
  await page.getByRole('button', { name: /^Edit update from/ }).click();
  await page.getByLabel('Health').selectOption('off_track');
  await page.getByLabel('Edit update', { exact: true }).fill('Vendor pulled out.');
  await page.getByRole('button', { name: 'Save changes' }).click();

  // The form stands down once the edit lands, and the derived health is the newest
  // update's health, so the header moves with it.
  await expect(page.getByRole('button', { name: 'Save changes' })).toHaveCount(0);
  await expect(page.locator('h1').locator('..')).toContainText('Off track');
  await expect(page.getByText('Vendor pulled out.')).toBeVisible();
  await expect(page.getByRole('listitem').first()).toContainText('edited');

  await page.reload();
  await expect(page.locator('h1').locator('..')).toContainText('Off track');
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
  await expect(page.locator('h1').locator('..')).toContainText('Off track');

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
  await expect(page.locator('h1').locator('..')).toContainText('On track');

  await page.reload();
  await expect(page.getByRole('listitem')).toHaveCount(1);
  await expect(page.locator('h1').locator('..')).toContainText('On track');
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
