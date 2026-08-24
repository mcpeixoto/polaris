/**
 * Settings → Workspace.
 *
 * The logo is here rather than in a unit test because the bug it guards was the absence of
 * a render: the URL saved, synced and survived a reload, and no client anywhere drew it, so
 * the field's own promise — "blank keeps the letter mark", which says a value replaces it —
 * was untrue and nothing below the store could notice. Proving it needs the shell.
 *
 * A data URI rather than a hosted image, so the assertion is about this application and not
 * about whether the machine running the suite can reach a picture.
 */

import type { Page } from '@playwright/test';

import { expect, test, signIn } from './fixtures';

/** A 1×1 red square, inline, so nothing has to be fetched. */
const LOGO =
  'data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%221%22%20height%3D%221%22%3E%3Crect%20width%3D%221%22%20height%3D%221%22%20fill%3D%22red%22%2F%3E%3C%2Fsvg%3E';

/**
 * The mark lives in the workspace sidebar, and settings replaced that sidebar with its own.
 *
 * So the round trip is the test: set the value in settings, come back out through the mode's
 * own way back, and read the mark on the other side. That is also the honest shape of the
 * bug this guards — the logo is set on one screen and drawn on every other one.
 */
function workspaceMark(page: Page) {
  return page
    .getByRole('navigation', { name: 'Workspace' })
    .getByRole('button', { name: 'Workspace menu' });
}

async function backToApp(page: Page): Promise<void> {
  await page.getByRole('link', { name: 'Back to app' }).click();
  await expect(page.getByRole('navigation', { name: 'Workspace' })).toBeVisible();
}

test('a workspace logo replaces the letter mark, and blank brings it back', async ({
  page,
  workspace,
}) => {
  await signIn(page, workspace.account);

  // The letter of the workspace's name, which is what an unset logo shows.
  await expect(workspaceMark(page)).toContainText('E');
  await expect(workspaceMark(page).locator('img')).toHaveCount(0);

  await page.goto('/settings/workspace');
  await page.getByLabel('Logo URL').fill(LOGO);
  await page.getByLabel('Logo URL').blur();
  await backToApp(page);

  await expect(workspaceMark(page).locator('img')).toHaveAttribute('src', LOGO, {
    timeout: 10_000,
  });

  // Written, not just drawn.
  await page.reload();
  await expect(workspaceMark(page).locator('img')).toHaveAttribute('src', LOGO, {
    timeout: 10_000,
  });

  // And clearing it is a real clear rather than an empty image box.
  await page.goto('/settings/workspace');
  await page.getByLabel('Logo URL').fill('');
  await page.getByLabel('Logo URL').blur();
  await backToApp(page);
  await expect(workspaceMark(page).locator('img')).toHaveCount(0, { timeout: 10_000 });
  await expect(workspaceMark(page)).toContainText('E');
});

test('a logo that cannot be loaded falls back to the letter', async ({ page, workspace }) => {
  await signIn(page, workspace.account);
  await page.goto('/settings/workspace');

  // A URL that resolves to nothing. The mark must not be left as a broken-image glyph in
  // the corner of every screen for the rest of the session.
  await page.getByLabel('Logo URL').fill('data:image/png;base64,bm90YW5pbWFnZQ==');
  await page.getByLabel('Logo URL').blur();
  await backToApp(page);

  await expect(workspaceMark(page)).toContainText('E', { timeout: 10_000 });
  await expect(workspaceMark(page).locator('img')).toHaveCount(0);
});

/**
 * The way in, and the way back out.
 *
 * Settings used to be twenty-eight rows pinned to the bottom of the workspace sidebar, below
 * a spacer, in a column they overflowed — always rendered and always out of sight. The menu
 * behind the workspace mark, meanwhile, listed workspaces and nothing else, which for the
 * many people who belong to exactly one is a menu that answers no question at all.
 */
test('the workspace menu opens settings, and settings can be left', async ({ page, workspace }) => {
  await signIn(page, workspace.account);
  await workspaceMark(page).click();

  const menu = page.getByRole('menu', { name: 'Workspace menu' });
  await expect(menu.getByRole('menuitem', { name: 'Invite people' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Log out' })).toBeVisible();
  await menu.getByRole('menuitem', { name: /^Settings/ }).click();

  // `/settings` is a redirect rather than a screen: it used to render the workspace general
  // form, which is admin-only, so the one entry point into settings refused half the people
  // who used it.
  await expect
    .poll(() => new URL(page.url()).pathname, { message: 'Settings did not open' })
    .toBe('/settings/profile');
  await expect(page.getByRole('navigation', { name: 'Settings' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Workspace' })).toHaveCount(0);
  // Grouped rather than one flat list, and named for the scope each row belongs to — five
  // of them used to sit under a heading reading "Workspace" while being an account.
  await expect(page.getByRole('heading', { name: 'Account', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Integrations', exact: true })).toBeVisible();

  await backToApp(page);
});

/**
 * Invite is two screens away from anywhere in the product, and was two screens away from the
 * one menu people open looking for it. It hands off through the URL, so the seat check that
 * guards the dialog still runs and the address is worth sending to somebody.
 */
test('the workspace menu opens the invite dialog', async ({ page, workspace }) => {
  await signIn(page, workspace.account);
  await workspaceMark(page).click();
  await page
    .getByRole('menu', { name: 'Workspace menu' })
    .getByRole('menuitem', { name: 'Invite people' })
    .click();

  await expect(page.getByRole('dialog', { name: 'Invite somebody' })).toBeVisible();
  // Spent, and taken out of the address bar with it: left in, the back button reopens it.
  await expect
    .poll(() => new URL(page.url()).search, { message: 'the invite parameter was left behind' })
    .toBe('');
});
