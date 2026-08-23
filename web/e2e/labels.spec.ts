/**
 * Creating a label, with the reload that used to leave it in the list twice.
 *
 * A label is one of the thirty-odd entities whose id the API mints. The client draws a
 * stand-in under an id it invented and has to put the server's row in its place — and that
 * swap used to be written in the `await` that sent the mutation, which works for exactly as
 * long as the closure does. A reload taken while the request is out throws it away. The
 * stand-in is *persisted*, deliberately, so it survives; the outbox replays the op; the
 * server's idempotency table answers with the original row; and that row lands in the
 * replica beside a stand-in nothing is left holding. The settings screen then lists one
 * label twice, and no reload clears it, because by then both rows are real rows.
 *
 * The pairing is declared on the outbox record instead (`reconcile`, see
 * web/src/sync/reconcile.ts), which the replay reaches as readily as the response did.
 *
 * This covers by example what `scripts/lint-optimistic-reconcile.mjs` and the assertion in
 * `SyncEngine.mutate` cover by rule: `createLabel` stands in here for every create of its
 * shape, and the browser is the only place the shape can actually be caught misbehaving.
 */

import { expect, signIn, test } from './fixtures';

test('a label created once is listed once, even across a reload mid-write', async ({
  page,
  workspace,
}) => {
  const problems: string[] = [];
  page.on('console', (message) => {
    // Two errors this test causes rather than finds: the anonymous boot posts /auth/refresh
    // with no session and is told 401, and the write below has its answer cut off on purpose.
    const text = message.text();
    const induced = text.includes('401') || text.includes('ERR_CONNECTION_FAILED');
    if (message.type() === 'error' && !induced) problems.push(text);
  });
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));

  await signIn(page, workspace.account);
  await page.goto('/settings/labels');

  // The mutation is really sent and the server really commits it; only the answer is kept
  // from the client, which is the state a reload finds when the network is slow.
  let sent = false;
  await page.route('**/graphql', async (route) => {
    if (!(route.request().postData() ?? '').includes('CreateLabel')) {
      await route.continue();
      return;
    }
    await route.fetch();
    sent = true;
    await route.abort('connectionfailed');
  });

  const name = page.getByLabel('Name').first();
  await name.waitFor();
  await name.fill('regression');
  await page.getByRole('button', { name: 'Add' }).first().click();

  // The stand-in is on screen and the op is in the outbox, waiting for an answer that is not
  // coming. This is the window under test.
  const row = page.getByRole('button', { name: /^(Archive regression|regression is on)/ });
  await expect(row).toHaveCount(1);
  await expect.poll(() => sent, { timeout: 30_000 }).toBe(true);

  await page.unroute('**/graphql');
  await page.reload();
  await expect(row).toHaveCount(1, { timeout: 30_000 });

  // The replay has to have happened for this to be the assertion it looks like, so give the
  // drain and the delta a moment and then read once. A retrying assertion would wait the
  // duplicate out and report the bug as fixed.
  await page.waitForTimeout(1_000);
  expect(await row.count(), 'one label was created, so the list holds one row').toBe(1);

  // And a stand-in that survived into the replica would still be there on the next boot.
  await page.reload();
  await expect(row).toHaveCount(1, { timeout: 30_000 });
  await page.waitForTimeout(1_000);
  expect(await row.count()).toBe(1);

  expect(problems, 'no console errors during the flow').toEqual([]);
});
