/**
 * Settings → Preferences.
 *
 * Here end to end rather than as a unit test because the failure this guards is a property
 * of React rather than of the preferences: `getPrefs` is a `useSyncExternalStore` snapshot,
 * and that hook compares snapshots by reference. A `getPrefs` that built a fresh object per
 * call therefore read as "the store changed" on every commit, and React re-rendered until it
 * threw "Maximum update depth exceeded" — which a Settings route has no error boundary to
 * catch, so the whole tree unmounted and `/settings/preferences` was a blank page. Every
 * preference underneath was already correct; none of them was reachable.
 *
 * A unit test pins the snapshot's identity (`features/prefs/prefs.test.ts`). What only the
 * browser can prove is that the screen renders at all, and that the launch preference really
 * moves where `/` lands.
 */

import { expect, test, signIn } from './fixtures';

test('the screen renders, and every control on it survives a reload', async ({
  page,
  workspace,
}) => {
  const crashes: string[] = [];
  page.on('pageerror', (error) => crashes.push(error.message));

  await signIn(page, workspace.account);
  await page.goto('/settings/preferences');
  await page.getByRole('heading', { level: 1, name: 'Preferences' }).waitFor();

  await page.getByLabel('Font size').selectOption('large');
  await page.getByLabel('Underline links').check();
  await page.getByLabel('Show full names').uncheck();
  await page.getByLabel('Comment submit key').selectOption('enter');
  await page.getByLabel('Assign issues I create to myself').check();

  // Written straight through, so a reload is the whole persistence story.
  await page.reload();
  await page.getByRole('heading', { level: 1, name: 'Preferences' }).waitFor();
  await expect(page.getByLabel('Font size')).toHaveValue('large');
  await expect(page.getByLabel('Underline links')).toBeChecked();
  await expect(page.getByLabel('Show full names')).not.toBeChecked();
  await expect(page.getByLabel('Comment submit key')).toHaveValue('enter');
  await expect(page.getByLabel('Assign issues I create to myself')).toBeChecked();

  // The three that are CSS rather than behaviour land on the document element, which is
  // where the cascade reads them.
  await expect(page.locator('html')).toHaveAttribute('data-font-size', 'large');
  await expect(page.locator('html')).toHaveAttribute('data-underline-links', 'on');

  expect(crashes, crashes.join('\n')).toEqual([]);
});

test('the launch preference decides where / lands', async ({ page, workspace }) => {
  await signIn(page, workspace.account);

  for (const [choice, destination] of [
    ['my-issues', '/my-issues'],
    ['inbox', '/inbox'],
    ['drafts', '/drafts'],
  ] as const) {
    await page.goto('/settings/preferences');
    await page.getByLabel('Default home view').selectOption(choice);
    await page.goto('/');
    await expect(page).toHaveURL(new RegExp(`${destination}$`));
  }

  // And back to the product's own default, which is a real list rather than a dashboard.
  await page.goto('/settings/preferences');
  await page.getByLabel('Default home view').selectOption('team');
  await page.goto('/');
  await expect(page).toHaveURL(new RegExp(`/team/${workspace.teamKey}$`));
});
