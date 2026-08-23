/**
 * A guest sees nothing customer-shaped.
 *
 * Both gates read the viewer's profile out of the replica, and a guest's replica carries no
 * `user` rows at all — the directory is workspace-scoped and guests are not handed it. So
 * `useViewer()` is permanently null for exactly the person the gate exists to exclude, and
 * spelling it `viewer?.role !== 'guest'` read that unknown as "not a guest": a guest got the
 * Customers link, the Dashboards link and the "Open customer" palette entry, and the two
 * customer pages rendered for anyone who typed the URL.
 *
 * Only a real guest in a real browser can catch it. The unit tests mock `useViewer` and can
 * hand it a guest profile that no real guest has.
 */

import { expect, inviteToWorkspace, signIn, test, uniqueEmail } from './fixtures';

test('a guest gets no customer link, list or page', async ({ page, browser, workspace }) => {
  await signIn(page, workspace.account);
  await page.goto('/customers');
  await page.getByRole('button', { name: 'New customer' }).first().click();
  await page.getByLabel('Name').fill('Secretive Corp');
  await page.getByRole('button', { name: 'Create customer' }).click();
  await expect(page).toHaveURL(/\/customer\/[0-9a-f-]{36}/);
  const customerUrl = new URL(page.url()).pathname;

  const email = uniqueEmail('customers-guest');
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

  await expect(
    guest.locator('nav a[href="/customers"]'),
    'the sidebar offered a guest the customer list',
  ).toHaveCount(0);
  await expect(
    guest.getByRole('button', { name: 'Open customer' }),
    'the palette offered a guest a customer to open',
  ).toHaveCount(0);

  // And the URLs typed in directly, which is how somebody shown a link once gets back.
  await guest.goto('/customers');
  await expect
    .poll(() => guest.url(), { message: 'a guest was left on /customers' })
    .not.toContain('/customers');
  await expect(guest.getByText('Secretive Corp')).toHaveCount(0);

  await guest.goto(customerUrl);
  await expect
    .poll(() => guest.url(), { message: 'a guest was left on a customer page' })
    .not.toContain(customerUrl);
  await expect(guest.getByText('Secretive Corp')).toHaveCount(0);

  expect(errors, errors.join('\n')).toEqual([]);
  await guestContext.close();
});

test('a member still gets the customer list', async ({ page, workspace }) => {
  await signIn(page, workspace.account);
  await page.goto('/my-issues');
  await expect(page.locator('nav a[href="/customers"]')).toHaveCount(1);
  await page.goto('/customers');
  await expect(page.getByRole('heading', { name: 'Customers' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'New customer' }).first()).toBeVisible();
});
