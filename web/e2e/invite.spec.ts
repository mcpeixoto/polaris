/**
 * Joining a workspace from an invitation link.
 *
 * This is the one journey in the product that a person makes exactly once, from an email,
 * usually on a browser that has never seen Polaris — so there is nobody to notice it is
 * broken until it is broken for a real person, and no way for them to retry their way out of
 * it. It is also the only way in at all on a default install: `POLARIS_REGISTRATION_MODE` is
 * `invite`, and open registration is refused for everybody except the very first account on
 * an empty server.
 *
 * The two branches are genuinely different requests and both are covered here:
 *
 *   - Somebody with **no account** registers and joins in ONE call. The token rides on
 *     `POST /auth/register`, and the server creates the account and the membership in one
 *     transaction. The client must NOT follow it with `/auth/invites/accept`: the membership
 *     already exists and the token is spent, so the second call fails — and it fails saying
 *     the invitation cannot be used, on a join that had just worked.
 *   - Somebody who **already has an account** signs in and then accepts, which is the path
 *     for joining a second workspace and has no registration to fold anything into.
 *
 * Written as browser tests rather than API tests on purpose. The bug this covers was entirely
 * in the client's sequencing of two calls that each worked perfectly on their own.
 */

import {
  expect,
  inviteToWorkspace,
  registerAccount,
  test,
  uniqueEmail,
  createIssueViaApi,
} from './fixtures';

test.describe('invitation', () => {
  test('somebody with no account registers and joins on one submit', async ({
    browser,
    workspace,
  }) => {
    await createIssueViaApi(workspace, 'Work that was already here');

    const email = uniqueEmail('invited');
    const { token } = await inviteToWorkspace(workspace, email);

    // A brand-new profile: no session, no replica, nothing but the link from the email.
    const context = await browser.newContext();
    const page = await context.newPage();

    const failures: string[] = [];
    page.on('response', (response) => {
      if (response.status() >= 400 && response.url().includes('/auth/')) {
        failures.push(`${response.status()} ${response.request().method()} ${response.url()}`);
      }
    });

    await page.goto(`/invite/${token}`);
    await page.getByLabel(/^email$/i).fill(email);
    await page.getByLabel(/^password$/i).fill('e2e-placeholder-password');
    await page.getByLabel(/your name/i).fill('Ada Lovelace');
    await page.getByRole('button', { name: /create account and join/i }).click();

    // Straight into the workspace. Not a second form, not a "now accept your invitation"
    // screen — the whole point of the token travelling on the register call.
    await expect(page.getByRole('navigation', { name: /workspace/i })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByText('Work that was already here')).toBeVisible({ timeout: 20_000 });

    // The `/auth/register` 403 this test exists for, and the `/auth/invites/accept` 403 that
    // a redundant second call would produce, both land here.
    expect(failures.filter((f) => !f.includes('/auth/refresh'))).toEqual([]);

    // And the name they gave is the name the workspace knows them by. Located by the row's
    // header rather than by the text, because the role select in the same row is labelled
    // "Role for Ada Lovelace" and a text match finds both.
    await page.goto('/settings/members');
    await expect(page.getByRole('rowheader', { name: /Ada Lovelace/ })).toBeVisible({
      timeout: 20_000,
    });

    await context.close();
  });

  test('somebody who already has an account signs in and joins', async ({ browser, workspace }) => {
    await createIssueViaApi(workspace, 'Visible once joined');

    const existing = await registerAccount(uniqueEmail('already'));
    const { token } = await inviteToWorkspace(workspace, existing.email);

    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto(`/invite/${token}`);
    await page.getByRole('button', { name: /sign in instead/i }).click();
    await page.getByLabel(/^email$/i).fill(existing.email);
    await page.getByLabel(/^password$/i).fill(existing.password);
    await page.getByRole('button', { name: /sign in and join/i }).click();

    await expect(page.getByRole('navigation', { name: /workspace/i })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByText('Visible once joined')).toBeVisible({ timeout: 20_000 });

    await context.close();
  });

  test('a token that has already been spent says so rather than half-joining', async ({
    browser,
    workspace,
  }) => {
    const email = uniqueEmail('spent');
    const { token } = await inviteToWorkspace(workspace, email);

    const first = await browser.newContext();
    const firstPage = await first.newPage();
    await firstPage.goto(`/invite/${token}`);
    await firstPage.getByLabel(/^email$/i).fill(email);
    await firstPage.getByLabel(/^password$/i).fill('e2e-placeholder-password');
    await firstPage.getByRole('button', { name: /create account and join/i }).click();
    await expect(firstPage.getByRole('navigation', { name: /workspace/i })).toBeVisible({
      timeout: 20_000,
    });
    await first.close();

    // The same link, followed again — the shape of a forwarded email.
    const second = await browser.newContext();
    const page = await second.newPage();
    await page.goto(`/invite/${token}`);
    await page.getByLabel(/^email$/i).fill(uniqueEmail('second-taker'));
    await page.getByLabel(/^password$/i).fill('e2e-placeholder-password');
    await page.getByRole('button', { name: /create account and join/i }).click();

    // Refused, out loud, on the screen they are looking at — not a spinner that stops.
    await expect(page.getByRole('alert')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('navigation', { name: /workspace/i })).toBeHidden();

    await second.close();
  });
});
