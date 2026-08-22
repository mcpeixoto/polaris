/**
 * Project updates: posting, correcting and withdrawing a status post.
 *
 * The interesting half is not the posting — that is a mutation with a Go test behind it —
 * but that health on the project is *derived* from the newest live update. So an edit and a
 * delete have to move the badge on the shell without anybody reloading, and the edit has to
 * survive one: a corrected update that reverts on reload is the failure this is for.
 */

import type { Page } from '@playwright/test';

import { expect, inviteToWorkspace, signIn, test, uniqueEmail } from './fixtures';

async function newProject(page: Page, name: string): Promise<void> {
  await page.goto('/projects');
  await page.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel(/^name$/i).fill(name);
  await page.getByRole('button', { name: /^create/i }).click();
  await page.waitForURL(/\/project\/[0-9a-f-]{36}/);
  await page.getByRole('heading', { name, level: 1 }).waitFor();
}

async function postUpdate(page: Page, health: string, body: string): Promise<void> {
  await page.getByLabel('Health').selectOption({ label: health });
  await page.getByLabel('Update', { exact: true }).fill(body);
  await page.getByRole('button', { name: 'Post update' }).click();
  // The compose box clears once the mutation has resolved.
  await expect(page.getByLabel('Update', { exact: true })).toHaveValue('');
}

test('an author edits their update and the derived health follows', async ({ page, workspace }) => {
  await signIn(page, workspace.account);
  const name = `Health ${Date.now().toString(36)}`;
  await newProject(page, name);

  await postUpdate(page, 'On track', 'Kickoff went fine.');
  const shell = page.locator('h1').locator('..');
  await expect(shell).toContainText('On track');

  await page.getByRole('button', { name: 'Edit update' }).click();
  await page.getByLabel('Health').selectOption('off_track');
  await page.getByLabel('Edit update', { exact: true }).fill('Vendor pulled out.');
  await page.getByRole('button', { name: 'Save changes' }).click();

  // Derived health is the newest update's health, so the header moves with the edit.
  await expect(shell).toContainText('Off track');
  await expect(page.getByText('Vendor pulled out.')).toBeVisible();

  await page.reload();
  await expect(page.locator('h1').locator('..')).toContainText('Off track');
  await expect(page.getByText('Vendor pulled out.')).toBeVisible();

  await page.goto('/projects');
  await expect(page.getByRole('link', { name: new RegExp(name) })).toContainText('Off track');
});

test('deleting the newest update falls health back to the one before it', async ({
  page,
  workspace,
}) => {
  await signIn(page, workspace.account);
  const name = `Delete ${Date.now().toString(36)}`;
  await newProject(page, name);

  await postUpdate(page, 'On track', 'first');
  await postUpdate(page, 'Off track', 'second');
  const shell = page.locator('h1').locator('..');
  await expect(shell).toContainText('Off track');

  await page.getByRole('link', { name: 'Activity' }).click();
  await expect(page.getByRole('listitem')).toHaveCount(2);

  // Newest first, so the first row is the off-track one.
  await page
    .getByRole('listitem')
    .first()
    .getByRole('button', { name: /^Delete update/ })
    .click();
  await page.getByRole('button', { name: 'Delete update', exact: true }).click();

  await expect(page.getByRole('listitem')).toHaveCount(1);
  await expect(shell).toContainText('On track');

  await page.reload();
  await expect(page.getByRole('listitem')).toHaveCount(1);
  await expect(page.locator('h1').locator('..')).toContainText('On track');
});

test("another member's update carries no edit or delete affordance", async ({
  browser,
  page,
  workspace,
}) => {
  await signIn(page, workspace.account);
  const name = `Author ${Date.now().toString(36)}`;
  await newProject(page, name);
  await postUpdate(page, 'At risk', 'mine');
  const url = page.url();

  const email = uniqueEmail('pu-other');
  const { token } = await inviteToWorkspace(workspace, email);

  const second = await browser.newContext();
  const otherPage = await second.newPage();
  await otherPage.goto(`/invite/${token}`);
  await otherPage.getByLabel(/^email$/i).fill(email);
  await otherPage.getByLabel(/^password$/i).fill('e2e-placeholder-password');
  await otherPage.getByLabel(/your name/i).fill('Grace Hopper');
  await otherPage.getByRole('button', { name: /create account and join/i }).click();
  await otherPage.getByRole('navigation', { name: /workspace/i }).waitFor({ timeout: 20_000 });

  await otherPage.goto(`${url}/activity`);
  await expect(otherPage.getByRole('listitem')).toHaveCount(1);
  await expect(otherPage.getByText('mine')).toBeVisible();
  await expect(otherPage.getByRole('button', { name: /^Edit update/ })).toHaveCount(0);
  await expect(otherPage.getByRole('button', { name: /^Delete update/ })).toHaveCount(0);
  await second.close();
});
