import { expect } from '@playwright/test';
import { test, signIn } from './fixtures';

// Release lookup is external; this regression tests navigation and session retention.
test('workspace menu reaches the website and downloads without signing out', async ({
  page,
  workspace,
}) => {
  await page.route('https://api.github.com/repos/mcpeixoto/polaris/releases/latest', (route) =>
    route.fulfill({ status: 503, body: '{}' }),
  );
  await signIn(page, workspace.account);
  await page.getByRole('button', { name: 'Workspace menu' }).click();
  await page.getByRole('menuitem', { name: 'Polaris website', exact: true }).click();
  await expect(page).toHaveURL(/\/welcome$/);
  await expect(
    page.getByRole('heading', { name: 'Issue tracking without the wait.' }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Open workspace', exact: true }).first().click();
  await page.getByRole('button', { name: 'Workspace menu' }).click();
  await page.getByRole('menuitem', { name: 'Downloads', exact: true }).click();
  await expect(page).toHaveURL(/\/downloads$/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('On your desktop.');
  await page.reload();
  await page.getByRole('link', { name: 'Open workspace', exact: true }).first().click();
  await expect(page.getByRole('button', { name: 'Workspace menu' })).toBeVisible();
});

test('the sidebar offers each desktop build', async ({ page, workspace }) => {
  await signIn(page, workspace.account);
  await page.getByRole('button', { name: 'Download apps' }).click();
  const menu = page.getByRole('menu', { name: 'Download Polaris' });
  await expect(menu.getByRole('menuitem', { name: /Apple Silicon/ })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: /Intel/ })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: /Installer/ })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: /AppImage/ })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: /Debian/ })).toBeVisible();
  await menu.getByRole('menuitem', { name: 'All downloads' }).click();
  await expect(page).toHaveURL(/\/downloads$/);
});
