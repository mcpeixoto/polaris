/**
 * Pulse is a workspace surface, and a guest is not on it.
 *
 * The milestone docs say a guest sees neither the page nor the sidebar item, and the code
 * said so too — but it asked the wrong oracle. Both gates read the viewer's profile out of
 * the replica, and a guest's replica carries no `user` rows at all: the directory is
 * workspace-scoped and `sync.go` does not hand it to guests. So for the one person the gate
 * exists to exclude, the profile is permanently `null`, the guest branch never ran, and a
 * guest got the whole feed plus a link to it in the sidebar — including project updates for
 * their own team's projects, which a guest's replica does receive.
 *
 * Nothing below the browser could catch it. The unit tests mock `useViewer`, so they can
 * hand it a guest profile that a real guest never has, and the server was never the thing
 * that was wrong. It takes a real guest, in a real browser, with a real replica.
 */

import type { Page } from '@playwright/test';

import { expect, inviteToWorkspace, signIn, test, uniqueEmail } from './fixtures';

async function projectWithAnUpdate(page: Page, name: string): Promise<void> {
  await page.goto('/projects');
  await page.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel(/^name$/i).fill(name);
  await page.getByRole('button', { name: /^create/i }).click();
  await page.waitForURL(/\/project\/[0-9a-f-]{36}/);
  await page.getByRole('heading', { name, level: 1 }).waitFor();
  await page.getByLabel('Health').selectOption({ label: 'On track' });
  await page.getByLabel('Update', { exact: true }).fill('An update a guest must not read.');
  await page.getByRole('button', { name: 'Post update' }).click();
  await expect(page.getByLabel('Update', { exact: true })).toHaveValue('');
}

test('a guest gets neither the Pulse feed nor a link to it', async ({
  page,
  browser,
  workspace,
}) => {
  await signIn(page, workspace.account);
  await projectWithAnUpdate(page, `Shared ${Date.now().toString(36)}`);

  const email = uniqueEmail('pulse-guest');
  const { token } = await inviteToWorkspace(workspace, email, 'GUEST');

  const guestContext = await browser.newContext();
  const guest = await guestContext.newPage();
  const errors: string[] = [];
  guest.on('pageerror', (error) => errors.push(error.message));

  await guest.goto(`/invite/${token}`);
  await guest.getByLabel(/^email$/i).fill(email);
  await guest.getByLabel(/^password$/i).fill('e2e-placeholder-password');
  await guest.getByLabel(/your name/i).fill('Grace Guest');
  await guest.getByRole('button', { name: /create account and join/i }).click();
  await expect(guest.getByRole('navigation', { name: /workspace/i })).toBeVisible({
    timeout: 20_000,
  });

  // The sidebar item. Located by href rather than by name: Settings → Pulse is also called
  // "Pulse", and only the feed link is this test's business.
  await expect(
    guest.locator('nav a[href="/pulse"]'),
    'the sidebar offered a guest the Pulse feed',
  ).toHaveCount(0);

  // And the URL typed in directly, which is how somebody who was shown the link once gets
  // back to it.
  await guest.goto('/pulse');
  await expect(
    guest.getByRole('tablist', { name: /pulse tabs/i }),
    'a guest was served the Pulse feed',
  ).toHaveCount(0, { timeout: 10_000 });
  await expect(guest.getByText('An update a guest must not read.')).toHaveCount(0);
  expect(guest.url(), 'a guest was left on /pulse').not.toContain('/pulse');

  expect(errors, errors.join('\n')).toEqual([]);
  await guestContext.close();
});

test('a member still gets Pulse', async ({ page, workspace }) => {
  await signIn(page, workspace.account);
  await expect(page.locator('nav a[href="/pulse"]')).toHaveCount(1);
  await page.goto('/pulse');
  await expect(page.getByRole('tablist', { name: /pulse tabs/i })).toBeVisible();
});
