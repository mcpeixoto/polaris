/**
 * Sessions, from two real browsers.
 *
 * This is here rather than in Go for the reason the config gives: it is about the browser
 * itself. Two contexts with their own cookie jars and their own user agents are two devices
 * as far as the server is concerned, and the thing being asserted — that the row one of them
 * draws a Revoke button for is the login the other one is actually holding — cannot be seen
 * from a single process.
 *
 * The regression it guards is specific. A refresh used to revoke the session row and insert a
 * new one, so a live device changed identity on every page load. The Sessions screen names a
 * session by id, so pressing Revoke on any device that had loaded a page since the list was
 * drawn answered "session not found" and left it signed in — the one flow this screen exists
 * for. Anything that reintroduces rotation-by-replacement fails here.
 */

import { expect, seedWorkspace, signIn, test } from './fixtures';

const CHROME_ON_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
const FIREFOX_ON_LINUX = 'Mozilla/5.0 (X11; Linux x86_64; rv:129.0) Gecko/20100101 Firefox/129.0';

test('one browser revokes another, and the revoked one cannot renew its login', async ({
  browser,
}) => {
  const workspace = await seedWorkspace('sessions');

  const laptopCtx = await browser.newContext({ userAgent: CHROME_ON_MAC });
  const deskCtx = await browser.newContext({ userAgent: FIREFOX_ON_LINUX });
  const laptop = await laptopCtx.newPage();
  const desk = await deskCtx.newPage();

  await signIn(laptop, workspace.account);
  await signIn(desk, workspace.account);

  await laptop.goto('/settings/sessions');
  await expect(laptop.getByRole('heading', { name: 'Sessions', level: 1 })).toBeVisible();

  // Each device is named by what it is, and only the browser reading the list is Current.
  const here = laptop.getByRole('row', { name: /Chrome on macOS/ });
  const there = laptop.getByRole('row', { name: /Firefox on Linux/ });
  await expect(here).toBeVisible();
  await expect(there).toBeVisible();
  await expect(here.getByText('Current')).toBeVisible();
  await expect(there.getByText('Current')).toHaveCount(0);

  // The other device goes on being used. This is what used to invalidate the id above:
  // every page load refreshed the access token, and every refresh replaced the session.
  await desk.goto('/settings/sessions');
  await expect(
    desk.getByRole('row', { name: /Firefox on Linux/ }).getByText('Current'),
  ).toBeVisible();
  await desk.reload();
  await expect(desk.getByRole('heading', { name: 'Sessions', level: 1 })).toBeVisible();

  // Now revoke it from the list the first browser is still showing.
  await laptop.getByRole('button', { name: 'Revoke Firefox on Linux' }).click();
  await laptop.getByRole('button', { name: 'Revoke this session' }).click();
  await expect(there, 'the revoked session must leave the list').toHaveCount(0);
  await laptop.reload();
  await expect(laptop.getByRole('row', { name: /Firefox on Linux/ })).toHaveCount(0);
  await expect(laptop.getByRole('row', { name: /Chrome on macOS/ })).toBeVisible();

  // And the server refuses to renew it. The access token it is holding is a short-lived JWT
  // the API does not re-check per request, so this — not the next GraphQL call — is what
  // actually ends the login, and it is what the screen's wording promises.
  const renewed = await desk.evaluate(
    async () => (await fetch('/auth/refresh', { method: 'POST', credentials: 'include' })).status,
  );
  expect(renewed, 'a revoked device must not be able to mint a fresh access token').toBe(401);

  await laptopCtx.close();
  await deskCtx.close();
});
