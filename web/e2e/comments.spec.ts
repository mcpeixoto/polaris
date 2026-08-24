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

import {
  createIssueViaApi,
  expect,
  inviteToWorkspace,
  signIn,
  test,
  uniqueEmail,
} from './fixtures';

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

    // Under the comment it answers, which is only possible if it named that comment by the
    // id the server chose rather than the one this client invented.
    const thread = page.locator('li').filter({ hasText: root }).first();
    await expect(thread.getByText(reply, { exact: true })).toHaveCount(1, { timeout: 30_000 });

    // What survives a reload is the sibling test's subject and it runs with the socket
    // alive. Asserting it here too would only be asserting how a replica converges with its
    // delta stream cut off, which is not a state any user is ever in.
    expect(problems).toEqual([]);
  });

  test('a reply hangs under the comment it answers, and survives a reload', async ({
    page,
    workspace,
  }) => {
    const issue = await createIssueViaApi(workspace, 'Threads, one level deep');

    const root = `Root ${Date.now()}`;
    const reply = `Reply ${Date.now()}`;

    // The sync socket delivering the root's own row is the moment the client stops holding
    // it under an id it invented. Waiting for that is what makes the reply below a reply to
    // a real comment: pressed a moment earlier it names a parent the server has never heard
    // of, and is refused with the text kept in the box — which is the previous test's
    // subject, correct behaviour, and not this one's. On a loaded runner the root takes long
    // enough to settle that this happened about once in thirty runs.
    let settled = false;
    page.on('websocket', (socket) => {
      socket.on('framereceived', (frame) => {
        if (typeof frame.payload === 'string' && frame.payload.includes(root)) settled = true;
      });
    });

    await signIn(page, workspace.account);
    await page.goto(`/issue/${issue.identifier}`);

    await page.getByPlaceholder(COMPOSER).first().fill(root);
    await page.getByRole('button', { name: /^comment$/i }).click();
    await expect(page.getByText(root, { exact: true })).toHaveCount(1, { timeout: 30_000 });
    await expect.poll(() => settled, { timeout: 60_000 }).toBe(true);

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

  /**
   * The duplicate that survives a reload because the *retirement* was the thing that was lost.
   *
   * Everything above pairs the stand-in with the server's row in memory, and the screen is
   * right the moment it happens. The replica is a beat behind: `applyOptimistic` writes memory
   * synchronously and only queues the IndexedDB delete, so for the length of one transaction
   * the disk still holds a stand-in that memory has already retired. Dropping the outbox
   * record in that window is what makes it permanent — the record was the last thing holding
   * the pairing, and once it is gone a reload brings the stand-in back with nothing left to
   * retire it against. Two rows, both ordinary, for one comment on the server.
   *
   * It reproduced roughly one run in ten of the test above, on a machine with six spinning
   * cores, and never on a quiet one — the disk queue has to be slow enough to still be running
   * when the reload lands, which is the same "loaded machine" that makes the delta beat the
   * response. Waiting for that is not a test, so this holds the queue open instead: a
   * long-lived readwrite transaction on `comment` blocks every write the replica issues
   * afterwards, for exactly as long as this test wants, using nothing but IndexedDB's own
   * ordering rules.
   *
   * A reply rather than a root comment only because that is where it was found; the mechanism
   * is the pairing's durability and knows nothing about parents.
   */
  test('a reply stays single when the reload beats the replica to disk', async ({
    page,
    workspace,
  }) => {
    const issue = await createIssueViaApi(workspace, 'A retirement that never reached disk');

    // No deltas until the reload. The socket normally delivers the server's row within
    // milliseconds and `adopt` retires the stand-in there and then — which would queue the
    // delete before this test has had a chance to hold the queue open. Cut it, and the
    // response is the only route left, which is the one this test can time exactly.
    let cut = true;
    await page.routeWebSocket('**/sync**', (socket) => {
      if (cut) return;
      socket.connectToServer();
    });

    await signIn(page, workspace.account);
    await page.goto(`/issue/${issue.identifier}`);
    await page.getByPlaceholder(COMPOSER).first().waitFor();

    const root = `Root ${Date.now()}`;
    const reply = `Reply ${Date.now()}`;

    /** What the replica holds on disk, read through a connection of this test's own. */
    const stored = async (): Promise<string[]> =>
      (await page.evaluate(`(async () => {
        const found = (await indexedDB.databases()).find((d) => (d.name ?? '').startsWith('polaris'));
        if (!found || !found.name) return [];
        const db = await new Promise((resolve, reject) => {
          const open = indexedDB.open(found.name);
          open.onsuccess = () => resolve(open.result);
          open.onerror = () => reject(open.error);
        });
        const rows = await new Promise((resolve) => {
          const all = db.transaction('comment').objectStore('comment').getAll();
          all.onsuccess = () => resolve(all.result);
        });
        db.close();
        return rows.map((row) => row.body);
      })()`)) as string[];

    // Only the reply's create is held, and only until this test releases it.
    let release = false;
    await page.route('**/graphql', async (route) => {
      const sent = route.request().postData() ?? '';
      if (!sent.includes('CreateComment') || !sent.includes(reply)) {
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
    await page.getByRole('button', { name: /^comment$/i }).click();
    // The root's own stand-in has been retired *and* that delete has reached disk. Starting
    // from a replica of exactly one comment is what makes the count below unambiguous.
    await expect.poll(stored, { timeout: 30_000 }).toEqual([root]);

    await page
      .getByRole('button', { name: /^reply to /i })
      .first()
      .click();
    await page.getByPlaceholder(/write a reply/i).fill(reply);
    await page
      .getByRole('button', { name: /^comment$/i })
      .first()
      .click();

    // The reply's stand-in is on disk. It is meant to be: an optimistic write that vanished
    // on refresh would be the worse bug, and it is the reason the delete has to be durable.
    await expect.poll(stored, { timeout: 30_000 }).toEqual([root, reply]);

    // From here the replica cannot write. Every batch it issues queues behind this
    // transaction, which stays open as long as it keeps asking for something.
    await page.evaluate(`(async () => {
      const found = (await indexedDB.databases()).find((d) => (d.name ?? '').startsWith('polaris'));
      const db = await new Promise((resolve, reject) => {
        const open = indexedDB.open(found.name);
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => reject(open.error);
      });
      const shelf = db.transaction('comment', 'readwrite').objectStore('comment');
      const spin = () => {
        const again = shelf.get('00000000-0000-0000-0000-000000000000');
        again.onsuccess = spin;
        again.onerror = spin;
      };
      spin();
    })()`);

    // The response lands and the pairing is made — in memory, where it is immediately right.
    release = true;
    await expect(page.getByText(reply, { exact: true })).toHaveCount(1, { timeout: 60_000 });
    await page.waitForTimeout(1_000);
    await expect(page.getByText(reply, { exact: true })).toHaveCount(1);

    // And the tab goes, taking the unwritten delete with it. What is left on disk is a
    // stand-in; what comes back from the server is the row it stood for.
    cut = false;
    await page.reload();
    await page.getByPlaceholder(COMPOSER).first().waitFor();

    // Two comments were posted, so two are on the screen — polled, because the replica
    // hydrates before the server's rows arrive and passes through "one" on its way to the
    // truth either way. What is being waited for is where it *stops*.
    await expect.poll(async () => page.getByRole('article').count(), { timeout: 30_000 }).toBe(2);
    await page.waitForTimeout(1_500);
    await expect(page.getByRole('article')).toHaveCount(2);
    await expect(page.getByText(root, { exact: true })).toHaveCount(1);
    await expect(page.getByText(reply, { exact: true })).toHaveCount(1);

    const thread = page.locator('li').filter({ hasText: root }).first();
    await expect(thread.getByText(reply, { exact: true })).toHaveCount(1);
  });
});

/**
 * Correcting and taking back what you said.
 *
 * Both mutations have been on the client since M0 and neither had a caller: `editComment`
 * was written, exported and never used, `DELETE_COMMENT` was defined and never imported, and
 * the detail screen rendered an "edited" marker for a state nothing could produce. So this
 * is about the affordance existing at all, and about the two things that make it honest —
 * that the edit survives a reload with its marker, and that the buttons are drawn only for
 * somebody the server would actually let through.
 *
 * The asymmetry in the last test is the server's and not a slip: editing is the author's
 * alone, deletion is the author's or an admin's, because a comment is visible to the whole
 * team and somebody has to be able to take an abusive one down without being able to put
 * different words under another person's name. See `authz.CanEditOwnContent`.
 */
test.describe('comment edit and delete', () => {
  test('an author corrects a comment and a reply, and both survive a reload', async ({
    page,
    workspace,
  }) => {
    const issue = await createIssueViaApi(workspace, 'Corrections');
    await signIn(page, workspace.account);
    await page.goto(`/issue/${issue.identifier}`);

    await page.getByPlaceholder(COMPOSER).first().fill('frist post');
    await page.getByRole('button', { name: /^comment$/i }).click();
    await expect(page.getByText('frist post', { exact: true })).toHaveCount(1, { timeout: 30_000 });

    await page
      .getByRole('button', { name: /^reply to /i })
      .first()
      .click();
    await page.getByPlaceholder(/write a reply/i).fill('teh reply');
    await page
      .getByRole('button', { name: /^comment$/i })
      .first()
      .click();
    await expect(page.getByText('teh reply', { exact: true })).toHaveCount(1, { timeout: 30_000 });

    // Root first. The pencil stands down while its own editor is open, so the count below
    // is also the assertion that the row swapped rather than doubling.
    await page
      .getByRole('button', { name: /^edit comment from/i })
      .first()
      .click();
    await page.getByLabel('Edit comment', { exact: true }).fill('first post');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByRole('button', { name: 'Save changes' })).toHaveCount(0);
    await expect(page.getByText('first post', { exact: true })).toHaveCount(1);
    await expect(page.getByText('frist post', { exact: true })).toHaveCount(0);

    // Then the reply, saved from the keyboard. ⌘⏎ is bound globally to "Post comment", so a
    // chord that escapes the editor sends whatever is in the composer at the foot of the
    // page instead of saving the line being corrected.
    await page
      .getByRole('button', { name: /^edit comment from/i })
      .last()
      .click();
    await page.getByLabel('Edit comment', { exact: true }).fill('the reply');
    await page.keyboard.press('ControlOrMeta+Enter');
    await expect(page.getByRole('button', { name: 'Save changes' })).toHaveCount(0);
    await expect(page.getByText('the reply', { exact: true })).toHaveCount(1);
    await expect(page.getByRole('article')).toHaveCount(2);

    // The marker the screen has always drawn, now reachable — and true on both rows.
    await expect(page.getByText('edited', { exact: true })).toHaveCount(2);

    await page.reload();
    await page.getByPlaceholder(COMPOSER).first().waitFor();
    await expect(page.getByText('first post', { exact: true })).toHaveCount(1, { timeout: 30_000 });
    await expect(page.getByText('the reply', { exact: true })).toHaveCount(1);
    await expect(page.getByText('edited', { exact: true })).toHaveCount(2);
    await expect(page.getByText('frist post', { exact: true })).toHaveCount(0);
  });

  test('a comment taken back is gone after a reload, and the reply to it stays', async ({
    page,
    workspace,
  }) => {
    const issue = await createIssueViaApi(workspace, 'Taken back');
    await signIn(page, workspace.account);
    await page.goto(`/issue/${issue.identifier}`);

    await page.getByPlaceholder(COMPOSER).first().fill('said too soon');
    await page.getByRole('button', { name: /^comment$/i }).click();
    await expect(page.getByText('said too soon', { exact: true })).toHaveCount(1, {
      timeout: 30_000,
    });

    await page
      .getByRole('button', { name: /^reply to /i })
      .first()
      .click();
    await page.getByPlaceholder(/write a reply/i).fill('answering that');
    await page
      .getByRole('button', { name: /^comment$/i })
      .first()
      .click();
    await expect(page.getByText('answering that', { exact: true })).toHaveCount(1, {
      timeout: 30_000,
    });

    await page
      .getByRole('button', { name: /^delete comment from/i })
      .first()
      .click();
    // The dialogue says what goes and what stays before anything is destroyed.
    await expect(page.getByText(/the reply to it stays?/i)).toBeVisible();
    await page.getByRole('button', { name: 'Delete comment', exact: true }).click();

    await expect(page.getByText('said too soon', { exact: true })).toHaveCount(0);

    // The screen's own memory of the delete is not the point; the server's is. A comment
    // that comes back on reload is the failure this test exists for — the detail query's
    // answer is merged in beside the replica, and it was fetched before the delete.
    await page.reload();
    await page.getByPlaceholder(COMPOSER).first().waitFor();
    await expect(page.getByText('answering that', { exact: true })).toHaveCount(1, {
      timeout: 30_000,
    });
    await expect(page.getByText('said too soon', { exact: true })).toHaveCount(0);
  });

  test("a member gets no affordance on somebody else's comment, an admin gets the bin", async ({
    browser,
    page,
    workspace,
  }) => {
    const issue = await createIssueViaApi(workspace, 'Not yours to edit');

    // The member joins first and says something, so the owner has somebody else's comment
    // to look at.
    const email = uniqueEmail('cm-member');
    const { token } = await inviteToWorkspace(workspace, email);
    const second = await browser.newContext();
    const member = await second.newPage();
    await member.goto(`/invite/${token}`);
    await member.getByLabel(/^email$/i).fill(email);
    await member.getByLabel(/^password$/i).fill('e2e-placeholder-password');
    await member.getByLabel(/your name/i).fill('Grace Hopper');
    await member.getByRole('button', { name: /create account and join/i }).click();
    await member.getByRole('navigation', { name: /workspace/i }).waitFor({ timeout: 30_000 });

    await member.goto(`/issue/${issue.identifier}`);
    await member.getByPlaceholder(COMPOSER).first().fill('a member speaks');
    await member.getByRole('button', { name: /^comment$/i }).click();
    await expect(member.getByText('a member speaks', { exact: true })).toHaveCount(1, {
      timeout: 30_000,
    });

    // The owner replies, so each of them has one comment of their own and one of the
    // other's on the same screen.
    await signIn(page, workspace.account);
    await page.goto(`/issue/${issue.identifier}`);
    await expect(page.getByText('a member speaks', { exact: true })).toHaveCount(1, {
      timeout: 30_000,
    });
    await page.getByPlaceholder(COMPOSER).first().fill('the owner speaks');
    await page.getByRole('button', { name: /^comment$/i }).click();
    await expect(page.getByText('the owner speaks', { exact: true })).toHaveCount(1, {
      timeout: 30_000,
    });

    // An admin may remove either comment but may only rewrite their own.
    await expect(page.getByRole('button', { name: /^delete comment from/i })).toHaveCount(2);
    await expect(page.getByRole('button', { name: /^edit comment from/i })).toHaveCount(1);
    await expect(
      page.getByRole('button', { name: /^edit comment from Grace Hopper/i }),
    ).toHaveCount(0);

    // The member is offered nothing on the owner's comment, in either direction — the
    // server refuses both, and a button whose only outcome is a refusal is worse than none.
    await member.reload();
    await expect(member.getByText('the owner speaks', { exact: true })).toHaveCount(1, {
      timeout: 30_000,
    });
    await expect(member.getByRole('button', { name: /^edit comment from/i })).toHaveCount(1);
    await expect(member.getByRole('button', { name: /^delete comment from/i })).toHaveCount(1);
    await expect(member.getByRole('button', { name: /^edit comment from E2E/i })).toHaveCount(0);
    await expect(member.getByRole('button', { name: /^delete comment from E2E/i })).toHaveCount(0);

    await second.close();
  });
});
