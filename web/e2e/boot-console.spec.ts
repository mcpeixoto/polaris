/**
 * What the browser's console receives during a cold boot.
 *
 * This suite already had a rule that a red console error during an otherwise passing flow
 * is a failure — and one blanket exemption, in `inbox.spec.ts`, for "anything containing
 * 401", because every single boot produced one. `Boot` asks `/auth/refresh` "am I signed
 * in?" before any cookie can exist, and the honest answer, 401, is drawn in red by the
 * browser itself.
 *
 * Two costs, neither of them cosmetic. It teaches everyone working on this product that the
 * console is noisy and worth ignoring, which is how a white-screen crash stays invisible.
 * And it is a real request: a public `/ask/:token` form load spent TWO of an IP's anonymous
 * rate-limit tokens rather than one, halving the effective capacity of the one page in the
 * product designed to be handed to strangers.
 *
 * So the assertions here are on the console itself, because nothing else is evidence. The
 * third test is the other half: a session that genuinely expired must still be loud.
 */

import type { Browser, ConsoleMessage, Page } from '@playwright/test';

import { expect, signIn, test, type SeededWorkspace } from './fixtures';

/** Every red line the browser drew, in order. */
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message: ConsoleMessage) => {
    if (message.type() === 'error') errors.push(`console.error: ${message.text()}`);
  });
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  return errors;
}

/** Every auth endpoint the page reached for. */
function watchAuthCalls(page: Page): string[] {
  const calls: string[] = [];
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith('/auth/')) calls.push(`${request.method()} ${path}`);
  });
  return calls;
}

/** A context that has never seen this origin: no cookie, no token, no IndexedDB. */
async function stranger(browser: Browser) {
  const context = await browser.newContext();
  return { context, page: await context.newPage() };
}

/** Creates a form on the settings screen and returns the token out of its public link. */
async function createAskForm(page: Page, name: string): Promise<string> {
  await page.goto('/settings/asks');
  await page.getByRole('heading', { name: 'Asks', exact: true }).waitFor();
  await page.getByLabel('Name').fill(name);
  await page.getByLabel('Description').fill('Tell us what broke.');
  await page.getByRole('button', { name: 'Create form' }).click();

  const row = page.locator('li', { hasText: name }).first();
  await expect(row).toContainText(/\/ask\//);
  const match = /\/ask\/([0-9a-f]+)/.exec(await row.innerText());
  expect(match, 'the settings row has to show the public link').not.toBeNull();
  return match![1]!;
}

test('the sign-in page boots without a red line in the console', async ({ browser }) => {
  const { context, page } = await stranger(browser);
  const errors = watchErrors(page);
  const auth = watchAuthCalls(page);

  await page.goto('/signin');
  await page
    .getByRole('button', { name: /sign in/i })
    .first()
    .waitFor();
  // The form is up; anything the boot was going to say, it has said.
  await expect
    .poll(() => errors, { timeout: 5_000, message: 'the console during a cold boot' })
    .toEqual([]);

  // And the reason it is quiet is that the question was never asked. A browser that has
  // never held a session here has nothing to refresh, and the sign-in page is the one
  // screen where that is guaranteed.
  expect(auth).toEqual([]);

  await context.close();
});

test('a public ask form spends one anonymous request, not two', async ({
  page,
  browser,
  workspace,
}) => {
  await signIn(page, workspace.account);
  const token = await createAskForm(page, 'Report a bug');

  const { context, page: pub } = await stranger(browser);
  const errors = watchErrors(pub);
  const auth = watchAuthCalls(pub);

  await pub.goto(`/ask/${token}`);
  await expect(pub.getByRole('heading', { name: 'Report a bug' })).toBeVisible();

  // Nothing on this page is ever authenticated — the token in the URL is the credential —
  // so a session probe here is a wasted rate-limit token against the IP of a stranger the
  // product has one chance to serve.
  expect(auth).toEqual([]);
  await expect
    .poll(() => errors, { timeout: 5_000, message: 'the console on the public ask form' })
    .toEqual([]);

  await context.close();
});

test('a session that really expired is still reported', async ({ page, workspace }) => {
  const errors = watchErrors(page);
  const auth = watchAuthCalls(page);

  await signIn(page, workspace.account);
  await page.goto(`/team/${workspace.teamKey}`);
  await page.getByRole('listbox', { name: /issues/i }).waitFor();

  // Revoke the session the way a server-side sign-out or an expiry does: the refresh
  // cookie stops working, while this browser still has every reason to believe it is
  // signed in. That 401 is a fault, not an answer, and hiding it would be the bug this
  // file's other two tests must not introduce.
  await page.context().clearCookies();
  errors.length = 0;
  auth.length = 0;
  await page.reload();
  await page
    .getByRole('button', { name: /sign in/i })
    .first()
    .waitFor();

  expect(auth).toContain('POST /auth/refresh');
  await expect
    .poll(() => errors.join('\n'), { timeout: 5_000, message: 'an expired session must be loud' })
    .toContain('401');
});
