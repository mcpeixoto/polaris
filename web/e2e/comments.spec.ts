/**
 * Posting a comment, with the two halves of its arrival pulled apart.
 *
 * A comment's id is the server's, so the client renders a stand-in under an id it invented
 * and swaps it for the real row when that row turns up. The row turns up twice, by two
 * different routes: on the mutation's response, and on the sync socket, which is pushed the
 * moment the mutation commits. Nothing makes the response the winner. On a machine busy
 * enough — a loaded CI runner, a laptop with a build going — the delta lands first, and for
 * the length of the gap the replica holds the stand-in *and* the server's row, and the issue
 * shows one comment twice. That was one run in five of `inbox.spec.ts`, reported as a strict
 * mode violation on the text of a comment nobody posted twice, and it was written off as
 * flake because it never reproduced on a quiet machine.
 *
 * Waiting for the race to happen is not a test. This holds the response until the socket has
 * been seen delivering the row, which turns "one run in five" into every run, on any machine.
 *
 * It is deliberately about what a person sees — the comment appears once — and not about
 * which mechanism retired the stand-in. There have now been two ways to leave a duplicate on
 * this screen (see `web/src/sync/reconcile.ts`), and an assertion pinned to one of them would
 * have passed through the second.
 */

import { createIssueViaApi, expect, signIn, test } from './fixtures';

const COMPOSER = /leave a comment/i;

test.describe('comments', () => {
  test('a comment posted once appears once, even when the socket beats the response', async ({
    page,
    workspace,
  }) => {
    const problems: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error' && !message.text().includes('401')) {
        problems.push(message.text());
      }
    });
    page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));

    const body = `The socket got here first ${Date.now()}`;

    // Every frame the sync socket delivers, so the test can tell the server's row apart from
    // the stand-in the client drew — they are identical on screen, which is the whole point.
    let delivered = false;
    page.on('websocket', (socket) => {
      socket.on('framereceived', (frame) => {
        if (typeof frame.payload === 'string' && frame.payload.includes(body)) delivered = true;
      });
    });

    const issue = await createIssueViaApi(workspace, 'Two arrivals, one comment');
    await signIn(page, workspace.account);
    await page.goto(`/issue/${issue.identifier}`);
    await page.getByPlaceholder(COMPOSER).first().waitFor();

    // The mutation runs for real; only its answer is held, and it is held until this test
    // says so rather than for a guessed number of milliseconds — on a runner slow enough to
    // matter, a fixed delay is the same coin flip being tested.
    let released = false;
    let release = false;
    await page.route('**/graphql', async (route) => {
      if (!(route.request().postData() ?? '').includes('CreateComment')) {
        await route.continue();
        return;
      }
      const response = await route.fetch();
      const payload = await response.text();
      const deadline = Date.now() + 60_000;
      while (!release && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      released = true;
      await route.fulfill({ response, body: payload });
    });

    await page.getByPlaceholder(COMPOSER).first().fill(body);
    await page.getByRole('button', { name: /^comment$/i }).click();

    const posted = page.getByText(body, { exact: true });

    // The window under test: the server's row is in the replica and the response is not back
    // yet. One comment was posted, so one comment is on the screen.
    await expect.poll(() => delivered, { timeout: 60_000 }).toBe(true);
    // Received is not applied. Waiting for the row to be *drawn* is what makes the count
    // below a statement about the replica rather than about how fast the socket was.
    await expect
      .poll(async () => page.getByRole('article').count(), { timeout: 30_000 })
      .toBeGreaterThan(0);
    await page.waitForTimeout(1_000);

    expect(released, 'the response must still be held for this to be the race under test').toBe(
      false,
    );
    // Read once, not polled: a retrying assertion here would simply wait out the duplicate
    // and report the bug as fixed.
    expect(await posted.count(), 'one comment was posted, so one is on the screen').toBe(1);

    // And it stays one once the response lands and the pairing is made the ordinary way.
    release = true;
    await expect.poll(() => released, { timeout: 60_000 }).toBe(true);
    await expect(posted).toHaveCount(1);

    // A stand-in is persisted on purpose, so a duplicate that survives here is one the user
    // could never clear. Polled, because the reload rebuilds the replica from IndexedDB.
    await page.unroute('**/graphql');
    await page.reload();
    await page.getByPlaceholder(COMPOSER).first().waitFor();
    await expect(posted).toHaveCount(1, { timeout: 30_000 });
    await page.waitForTimeout(1_000);
    await expect(posted).toHaveCount(1);

    expect(problems).toEqual([]);
  });

  test('a reply typed while its parent is still being saved is kept', async ({
    page,
    workspace,
  }) => {
    const problems: string[] = [];
    page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));

    const issue = await createIssueViaApi(workspace, 'A reply while the parent is in flight');

    // No deltas. The sync socket normally delivers the server's own row within milliseconds
    // of the mutation committing, which retires the stand-in and closes the window this test
    // is about; blocking it makes the window last exactly as long as the response is held.
    await page.routeWebSocket('**/sync**', () => {});

    await signIn(page, workspace.account);
    await page.goto(`/issue/${issue.identifier}`);
    await page.getByPlaceholder(COMPOSER).first().waitFor();

    const root = `Root ${Date.now()}`;
    const reply = `The reply that used to disappear ${Date.now()}`;

    // Only the root's create is held. The reply's must be free to go out once it can.
    let release = false;
    await page.route('**/graphql', async (route) => {
      const sent = route.request().postData() ?? '';
      if (!sent.includes('CreateComment') || !sent.includes(root)) {
        await route.continue();
        return;
      }
      const response = await route.fetch();
      const payload = await response.text();
      const deadline = Date.now() + 60_000;
      while (!release && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      await route.fulfill({ response, body: payload });
    });

    await page.getByPlaceholder(COMPOSER).first().fill(root);
    await page
      .getByRole('button', { name: /^comment$/i })
      .first()
      .click();
    await expect(page.getByText(root, { exact: true })).toHaveCount(1, { timeout: 30_000 });

    // The comment on the screen is a stand-in under an id this client invented. Replying to
    // it names a parent the server has never heard of.
    await page
      .getByRole('button', { name: /^reply to /i })
      .first()
      .click();
    await page.getByPlaceholder(/write a reply/i).fill(reply);
    await page
      .getByRole('button', { name: /^comment$/i })
      .first()
      .click();

    // Refused, and said so — with every character still in the box. This is the assertion
    // the whole test exists for: the sentence did not evaporate into a console error.
    await expect(page.getByPlaceholder(/write a reply/i)).toHaveValue(reply, { timeout: 30_000 });
    await expect(page.getByRole('alert').first()).toBeVisible();

    // The parent settles. The refusal is about a condition that has just passed, so the app
    // taking it down is the client saying it has seen the real row — which is what makes the
    // press below deterministic rather than a guess at how long a round trip takes.
    release = true;
    await expect(page.getByRole('alert')).toHaveCount(0, { timeout: 60_000 });
    // The composer followed its parent onto the id the server chose rather than vanishing
    // with the stand-in, and is still holding every character.
    await expect(page.getByPlaceholder(/write a reply/i)).toHaveValue(reply);
    await page
      .getByRole('button', { name: /^comment$/i })
      .first()
      .click();
    await expect(page.getByText(reply, { exact: true })).toHaveCount(1, { timeout: 30_000 });

    await page.unroute('**/graphql');
    await page.reload();
    await page.getByPlaceholder(COMPOSER).first().waitFor();
    await expect(page.getByText(root, { exact: true })).toHaveCount(1, { timeout: 30_000 });
    await expect(page.getByText(reply, { exact: true })).toHaveCount(1, { timeout: 30_000 });

    const thread = page.locator('li').filter({ hasText: root }).first();
    await expect(thread.getByText(reply, { exact: true })).toHaveCount(1);

    expect(problems).toEqual([]);
  });

  test('a reply hangs under the comment it answers, and survives a reload', async ({
    page,
    workspace,
  }) => {
    const issue = await createIssueViaApi(workspace, 'Threads, one level deep');
    await signIn(page, workspace.account);
    await page.goto(`/issue/${issue.identifier}`);

    const root = `Root ${Date.now()}`;
    const reply = `Reply ${Date.now()}`;

    await page.getByPlaceholder(COMPOSER).first().fill(root);
    await page.getByRole('button', { name: /^comment$/i }).click();
    await expect(page.getByText(root, { exact: true })).toHaveCount(1, { timeout: 30_000 });

    await page
      .getByRole('button', { name: /^reply to /i })
      .first()
      .click();
    await page.getByPlaceholder(/write a reply/i).fill(reply);
    await page
      .getByRole('button', { name: /^comment$/i })
      .first()
      .click();
    await expect(page.getByText(reply, { exact: true })).toHaveCount(1, { timeout: 30_000 });

    // A reply whose parent is still the stand-in is a reply nothing renders — it is filed
    // under a parent id that no longer exists. Reloading proves the thread as the server
    // holds it, not as this session happened to leave it in memory.
    await page.reload();
    await page.getByPlaceholder(COMPOSER).first().waitFor();
    await expect(page.getByText(root, { exact: true })).toHaveCount(1, { timeout: 30_000 });
    await expect(page.getByText(reply, { exact: true })).toHaveCount(1, { timeout: 30_000 });

    // Under it, not beside it: the reply lives inside the thread its parent opened.
    const thread = page.locator('li').filter({ hasText: root }).first();
    await expect(thread.getByText(reply, { exact: true })).toHaveCount(1);
  });
});
