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

import { expect, test, signIn } from './fixtures';

/** A 1×1 red square, inline, so nothing has to be fetched. */
const LOGO =
  'data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%221%22%20height%3D%221%22%3E%3Crect%20width%3D%221%22%20height%3D%221%22%20fill%3D%22red%22%2F%3E%3C%2Fsvg%3E';

test('a workspace logo replaces the letter mark, and blank brings it back', async ({
  page,
  workspace,
}) => {
  await signIn(page, workspace.account);

  const sidebar = page.getByRole('navigation', { name: /workspace/i });
  const mark = sidebar.getByRole('button', { name: 'Switch workspace' });

  // The letter of the workspace's name, which is what an unset logo shows.
  await expect(mark).toContainText('E');
  await expect(mark.locator('img')).toHaveCount(0);

  await page.goto('/settings/workspace');
  await page.getByLabel('Logo URL').fill(LOGO);
  await page.getByLabel('Logo URL').blur();

  await expect(mark.locator('img')).toHaveAttribute('src', LOGO, { timeout: 10_000 });

  // Written, not just drawn.
  await page.reload();
  await expect(mark.locator('img')).toHaveAttribute('src', LOGO, { timeout: 10_000 });

  // And clearing it is a real clear rather than an empty image box.
  await page.getByLabel('Logo URL').fill('');
  await page.getByLabel('Logo URL').blur();
  await expect(mark.locator('img')).toHaveCount(0, { timeout: 10_000 });
  await expect(mark).toContainText('E');
});

test('a logo that cannot be loaded falls back to the letter', async ({ page, workspace }) => {
  await signIn(page, workspace.account);
  await page.goto('/settings/workspace');

  // A URL that resolves to nothing. The mark must not be left as a broken-image glyph in
  // the corner of every screen for the rest of the session.
  await page.getByLabel('Logo URL').fill('data:image/png;base64,bm90YW5pbWFnZQ==');
  await page.getByLabel('Logo URL').blur();

  const mark = page
    .getByRole('navigation', { name: /workspace/i })
    .getByRole('button', { name: 'Switch workspace' });
  await expect(mark).toContainText('E', { timeout: 10_000 });
  await expect(mark.locator('img')).toHaveCount(0);
});
