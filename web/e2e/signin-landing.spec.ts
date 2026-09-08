import { expect } from '@playwright/test';
import { test, signIn } from './fixtures';

/**
 * Where a successful sign-in leaves the browser.
 *
 * The form does not navigate — the signed-out catch-all keeps the URL so a deep link
 * survives sign-in — so the shell mounts on /signin itself, and for a while answered that
 * with "Page not found". `signIn` waits for the workspace nav, which is rendered beside the
 * 404 rather than instead of it, so nothing in this suite noticed.
 */
test('lands on the workspace rather than a 404 after signing in', async ({ page, workspace }) => {
  await signIn(page, workspace.account);

  await expect(page).not.toHaveURL(/\/signin$/);
  await expect(page.getByText('Page not found')).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: /workspace/i })).toBeVisible();
});
