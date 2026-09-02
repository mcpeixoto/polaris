/**
 * The acceptance tests that can only be asserted in a browser.
 *
 * Everything provable below the browser is already a Go or Vitest test and is not repeated
 * here. What is left is the behaviour of the replica itself: that losing it is survivable,
 * that a schema bump discards it, and that two real browser contexts converge.
 *
 * Selectors are roles and accessible names throughout. That is not only good practice —
 * in a keyboard-first product an element without an accessible name is a bug, so a test
 * that cannot find something by role has found one.
 */

import {
  clearLocalReplica,
  createIssueViaApi,
  expect,
  openTeamList,
  signIn,
  test,
} from './fixtures';

test.describe('sync engine', () => {
  // Acceptance test 1.
  test('a write in one browser reaches another without a refresh', async ({
    browser,
    workspace,
  }) => {
    const alice = await browser.newContext();
    const bob = await browser.newContext();
    const alicePage = await alice.newPage();
    const bobPage = await bob.newPage();

    await signIn(alicePage, workspace.account);
    await signIn(bobPage, workspace.account);

    await openTeamList(alicePage, workspace.teamKey);
    await openTeamList(bobPage, workspace.teamKey);

    const title = `Written by Alice ${Date.now()}`;

    // Opened with the keyboard, not a button. There is no "new issue" button on the list
    // and deliberately so — creating is `C`, which also means this asserts the keymap
    // registry is wired, not just that a click handler exists.
    await alicePage.keyboard.press('c');
    const dialog = alicePage.getByRole('dialog', { name: /new issue/i });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel(/title/i).fill(title);
    await alicePage.keyboard.press('ControlOrMeta+Enter');
    await expect(dialog).toBeHidden();

    // No reload, no refetch. If this needs either, the sync engine is not doing its job.
    await expect(bobPage.getByText(title)).toBeVisible({ timeout: 5_000 });

    await alice.close();
    await bob.close();
  });

  // Acceptance test 4.
  test('losing the local replica rebuilds an identical one', async ({ browser, workspace }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    await createIssueViaApi(workspace, 'Survives eviction');
    await signIn(page, workspace.account);
    await openTeamList(page, workspace.teamKey);
    await expect(page.getByText('Survives eviction')).toBeVisible();

    const before = await page.getByRole('listitem').allInnerTexts();

    // A browser evicting IndexedDB under storage pressure is a real event, not a
    // hypothetical, and a client that cannot recover from it loses the user's view of
    // their own workspace.
    await clearLocalReplica(context);
    await page.reload();

    await expect(page.getByText('Survives eviction')).toBeVisible({ timeout: 15_000 });
    const after = await page.getByRole('listitem').allInnerTexts();
    expect(after).toEqual(before);

    await context.close();
  });

  // Acceptance test 5.
  test('a client schema bump discards the store and re-bootstraps', async ({
    browser,
    workspace,
  }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    await createIssueViaApi(workspace, 'Across a schema bump');
    await signIn(page, workspace.account);
    await openTeamList(page, workspace.teamKey);
    await expect(page.getByText('Across a schema bump')).toBeVisible();

    // Rewrite the stored meta to claim an older schema, which is what a client that had
    // not reloaded since the previous release would hold. Applying today's deltas onto
    // yesterday's row shapes corrupts the replica in ways that surface days later, so the
    // client must throw the whole database away rather than try to migrate it.
    await page.evaluate(async (workspaceId) => {
      const dbs = await indexedDB.databases();
      const target = dbs.find((d) => d.name?.includes(workspaceId));
      if (!target?.name) throw new Error('no replica found to tamper with');

      await new Promise<void>((resolve, reject) => {
        const open = indexedDB.open(target.name!);
        open.onerror = () => reject(new Error('could not open the replica'));
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction('meta', 'readwrite');
          const store = tx.objectStore('meta');
          // `replica`, which is `META_KEY` in web/src/store/db.ts, and not `meta` — that
          // is the store's name, not the row's. Reading the wrong key returns undefined
          // rather than an error, so the guard below quietly skipped the rewrite and the
          // test went on to assert that a replica nobody had touched still worked. It
          // passed for as long as it existed and never once exercised the schema bump.
          const read = store.get('replica');
          read.onsuccess = () => {
            const meta = read.result as { clientSchema: number } | undefined;
            if (!meta) {
              reject(new Error('the replica has no meta row to tamper with'));
              return;
            }
            meta.clientSchema = 0;
            store.put(meta, 'replica');
          };
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(new Error('could not rewrite meta'));
        };
      });
    }, workspace.workspaceId);

    await page.reload();

    // The recovery must be automatic. A dialog asking the user to clear their browser
    // data is not a recovery path, it is a support ticket.
    await expect(page.getByText('Across a schema bump')).toBeVisible({ timeout: 15_000 });

    await context.close();
  });

  test('an edit made offline is sent when the connection returns', async ({
    browser,
    workspace,
  }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    const issue = await createIssueViaApi(workspace, 'Edited on a train');
    await signIn(page, workspace.account);
    await page.goto(`/issue/${issue.identifier}`);
    // The title is inline-editable, so it is the value of a textbox rather than a text
    // node — getByText cannot see it.
    await expect(page.getByRole('textbox', { name: /issue title/i })).toHaveValue(
      'Edited on a train',
    );

    await context.setOffline(true);

    // Located by the aria-describedby relationship rather than by the button's name,
    // because the name IS the current value — it reads "No priority" before the change and
    // "Urgent" after, so a name-based locator stops matching exactly when the assertion
    // needs it.
    const priorityControl = page.locator('[aria-describedby$="-priority-label"]');

    // The edit must land on screen immediately. Waiting for a server that is not there is
    // the behaviour the whole local-first architecture exists to avoid.
    await priorityControl.click();
    await page.getByRole('menuitem', { name: /urgent/i }).click();
    await expect(priorityControl).toContainText(/urgent/i);

    // Targeted by role AND name, not by text: the workspace name in this very test contains
    // the word "offline", so a text match would find both — and `role=status` alone matches
    // two regions, because the undo toast is mounted empty and permanently so that an
    // announcement put into it is actually announced. The indicator carries a fixed
    // `aria-label` for exactly this reason: its own text is the value, and reads
    // "Syncing 1" or "Reconnecting" depending on which of the two the network took away
    // first. Being a live region at all is what puts "did my work save?" within reach of a
    // screen-reader user.
    const syncStatus = page.getByRole('status', { name: 'Sync status' });
    await expect(syncStatus).toBeVisible();

    await context.setOffline(false);

    // Drained from the outbox, with the original opId, so the server applies it once.
    await expect(syncStatus).toBeHidden({ timeout: 20_000 });

    const verifier = await browser.newContext();
    const verifierPage = await verifier.newPage();
    await signIn(verifierPage, workspace.account);
    await verifierPage.goto(`/issue/${issue.identifier}`);
    await expect(verifierPage.locator('[aria-describedby$="-priority-label"]')).toContainText(
      /urgent/i,
      { timeout: 10_000 },
    );

    await verifier.close();
    await context.close();
  });

  /**
   * A reload taken between an optimistic write and its response must not leave two rows.
   *
   * This is only reproducible in a browser, which is why it belongs here. A comment's id is
   * the server's, so posting one renders a stand-in under an id the client invented and
   * swaps it for the real row when the response arrives — and the stand-in is *persisted*,
   * because an optimistic write that vanished on refresh would be the worse bug. Reload
   * before the response and the swap has nobody left to make it: the outbox replays the op,
   * the server's idempotency table answers with the original comment, and that comment lands
   * in the replica beside the stand-in. Both are real rows by then, so the issue shows one
   * comment twice and no further reload clears it.
   *
   * The response is stranded rather than the request blocked, because the failure needs the
   * server to have *taken* the write. That is a closing lid or a tunnel, not an outage.
   */
  test('a reload while a comment is in flight leaves one comment', async ({ page, workspace }) => {
    const issue = await createIssueViaApi(workspace, 'Reload mid-flight');
    await signIn(page, workspace.account);
    await page.goto(`/issue/${issue.identifier}`);
    await page.getByRole('complementary', { name: /properties/i }).waitFor();

    let stranded = false;
    await page.route('**/graphql', async (route) => {
      if (stranded || !(route.request().postData() ?? '').includes('CreateComment')) {
        await route.continue();
        return;
      }
      stranded = true;
      const response = await route.fetch();
      await new Promise((resolve) => setTimeout(resolve, 5_000));
      // By now the page is gone and there is nobody to answer, which is the point. The
      // rejection is this test's own plumbing, not the product's.
      await route.fulfill({ response }).catch(() => {});
    });

    const comments = page.getByRole('region', { name: 'Comments' });
    await comments.getByRole('textbox', { name: /leave a comment/i }).fill('Said once');
    await comments.getByRole('button', { name: /^comment$/i }).click();
    await expect(comments.getByText('Said once')).toHaveCount(1);

    await page.waitForTimeout(1_000);
    await page.unroute('**/graphql');
    await page.reload();
    await page.getByRole('complementary', { name: /properties/i }).waitFor();

    await expect(page.getByRole('region', { name: 'Comments' }).getByText('Said once')).toHaveCount(
      1,
      { timeout: 15_000 },
    );
  });
});

test.describe('keyboard model', () => {
  test('the command menu and help overlay are generated from the registry', async ({
    page,
    workspace,
  }) => {
    await signIn(page, workspace.account);

    await page.keyboard.press('ControlOrMeta+k');
    const menu = page.getByRole('dialog', { name: /command menu/i });
    await expect(menu).toBeVisible();

    // Subsequence matching: "cri" should find "Create issue". If this fails the ranking
    // has regressed to substring matching, which is not how people type into these.
    await page.getByRole('combobox').fill('cri');
    await expect(page.getByRole('option', { name: /create issue/i }).first()).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();

    await page.keyboard.press('?');
    const help = page.getByRole('dialog', { name: /keyboard shortcuts/i });
    await expect(help).toBeVisible();
    // The overlay is generated, so a binding that exists must appear in it — a
    // hand-maintained sheet is wrong within a fortnight and teaches people keys that do
    // nothing.
    await expect(help.getByText('Open command menu')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(help).toBeHidden();
  });
});
