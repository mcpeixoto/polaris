/**
 * The inbox, driven by two people in one workspace.
 *
 * Written as a browser test rather than a unit test because both bugs it covers were only
 * visible in a browser and invisible everywhere else.
 *
 * The first is the reason there is a file here at all. The inbox registered its shortcuts —
 * including `Escape` for clearing the find box — in the `global` keyboard context, where the
 * shell already holds an unguarded `Escape` for dismiss. The registry refuses two bindings
 * on one key in one context when either is unguarded, so the effect that mounts them threw,
 * the throw took `AppShell` down with it, and `/inbox` rendered as a blank white page for
 * every user of the product. Nothing below the browser noticed: the components render fine
 * in isolation, the store is correct, the fan-out is correct, and the keymap's own unit
 * tests pass — the collision only exists once the real screen mounts inside the real shell.
 * So the assertion that matters most here is the humblest one: the page has a heading.
 *
 * The second is that the unread count reached no surface. `unreadCount` and `setBadgeCount`
 * both existed and neither had a caller, so the tab title said `Polaris` however much was
 * waiting — while the notification settings screen promised the opposite in as many words.
 *
 * Everything else is the journey those two make possible: A acts, B watches, and nothing in
 * between is reloaded, because a notification that needs a refresh is not a notification.
 */

import type { Browser, Page } from '@playwright/test';

import {
  expect,
  inviteToWorkspace,
  openTeamList,
  signIn,
  test,
  uniqueEmail,
  type SeededWorkspace,
} from './fixtures';

const PASSWORD = 'e2e-placeholder-password';
const API = process.env.POLARIS_E2E_API ?? 'http://localhost:8088';

/**
 * Everything the browser shouted about, so a flow that passes while throwing still fails.
 *
 * Nothing is excluded. This used to exempt "anything containing 401", because a cold boot
 * asked `/auth/refresh` before it could know there was nothing to refresh — an exemption
 * wide enough to swallow a genuine sign-out mid-flow. `Boot` no longer asks a question it
 * has no reason to ask (see `boot-console.spec.ts`), so the filter can go.
 */
function watchConsole(page: Page, sink: string[], who: string): void {
  page.on('console', (message) => {
    if (message.type() === 'error') sink.push(`[${who}] console.error: ${message.text()}`);
  });
  page.on('pageerror', (error) => sink.push(`[${who}] pageerror: ${error.message}`));
}

/** A second real person: invited, registered through the form, named. */
async function invitedMember(
  browser: Browser,
  workspace: SeededWorkspace,
  name: string,
): Promise<{ context: import('@playwright/test').BrowserContext; page: Page }> {
  const email = uniqueEmail('inbox-member');
  const { token } = await inviteToWorkspace(workspace, email);
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`/invite/${token}`);
  await page.getByLabel(/^email$/i).fill(email);
  await page.getByLabel(/^password$/i).fill(PASSWORD);
  await page.getByLabel(/your name/i).fill(name);
  await page.getByRole('button', { name: /create account and join/i }).click();
  await page.getByRole('navigation', { name: /workspace/i }).waitFor({ timeout: 30_000 });
  return { context, page };
}

/** Creates an issue with `C` and leaves the browser on its detail page. */
async function createIssue(page: Page, teamKey: string, title: string): Promise<string> {
  await openTeamList(page, teamKey);
  await page.keyboard.press('c');
  const dialog = page.getByRole('dialog', { name: /new issue/i });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel(/title/i).fill(title);
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(dialog).toBeHidden();

  const row = page.getByRole('option').filter({ hasText: title }).first();
  await expect(row).toBeVisible({ timeout: 15_000 });
  const identifier = /([A-Z]+-\d+)/.exec(await row.innerText())?.[1];
  if (identifier === undefined) throw new Error(`no identifier on the row for "${title}"`);

  await page.goto(`/issue/${identifier}`);
  await expect(page.getByRole('heading', { name: title })).toBeVisible({ timeout: 15_000 });
  return identifier;
}

/**
 * The subscriber rows as the server holds them.
 *
 * Read over the API rather than from the screen because there is nothing on the screen to
 * read: subscribing is `Shift+S` and the issue renders no indicator of the result, so a test
 * that waited for a visible change would wait forever.
 */
async function subscribers(workspace: SeededWorkspace, identifier: string): Promise<string> {
  const response = await fetch(`${API}/graphql`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${workspace.account.accessToken}`,
      'X-Polaris-Workspace': workspace.workspaceId,
    },
    body: JSON.stringify({
      query: `query ($k: String!) {
        issueByIdentifier(identifier: $k) { subscribers { userId unsubscribed reason } }
      }`,
      variables: { k: identifier },
    }),
  });
  return JSON.stringify(await response.json());
}

/** The inbox's live region: "All read", or "N unread". */
function unreadLabel(page: Page) {
  return page.locator('header').getByRole('status');
}

async function comment(page: Page, body: string): Promise<void> {
  await page
    .getByPlaceholder(/leave a comment/i)
    .first()
    .fill(body);
  await page.getByRole('button', { name: /^comment$/i }).click();
  await expect(page.getByText(body)).toBeVisible({ timeout: 15_000 });
}

async function setStatus(page: Page, name: string): Promise<void> {
  await page.keyboard.press('s');
  await expect(page.getByRole('menu', { name: 'Status' })).toBeVisible();
  await page.getByRole('menuitem', { name }).click();
}

/**
 * The notification count once it has stopped moving.
 *
 * Two identical reads a second apart. Deliveries arrive in bursts on the worker's tick, so
 * one read proves nothing about whether the burst is over.
 */
async function settled(page: Page): Promise<number> {
  let previous = -1;
  for (let i = 0; i < 20; i++) {
    const current = await page.getByRole('option').count();
    if (current === previous) return current;
    previous = current;
    await page.waitForTimeout(1_000);
  }
  return previous;
}

/**
 * Waits until the browser's own replica agrees the subscription row says what the server
 * says, by reading it out of IndexedDB.
 *
 * The server confirming an unsubscribe is only half of it. `⇧S` is a *toggle*, and it
 * computes its direction from the local replica — so a press made before the delta lands
 * sends the same direction twice and looks like the key did nothing. Waiting on the
 * client, not just on the server, is what makes the next press mean what it says.
 */
async function replicaSaysUnsubscribed(page: Page, expected: boolean): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const [info] = await indexedDB.databases();
          if (!info?.name) return null;
          const db = await new Promise<IDBDatabase>((resolve, reject) => {
            const req = indexedDB.open(info.name!);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
          });
          if (!db.objectStoreNames.contains('issueSubscription')) return null;
          const rows = await new Promise<{ unsubscribed: boolean }[]>((resolve) => {
            const req = db
              .transaction('issueSubscription')
              .objectStore('issueSubscription')
              .getAll();
            req.onsuccess = () => resolve(req.result as { unsubscribed: boolean }[]);
            req.onerror = () => resolve([]);
          });
          db.close();
          return rows.some((row) => row.unsubscribed);
        }),
      { timeout: 20_000 },
    )
    .toBe(expected);
}

test.describe('inbox', () => {
  test('opens without throwing, even with nothing in it', async ({ browser, workspace }) => {
    const problems: string[] = [];
    const context = await browser.newContext();
    const page = await context.newPage();
    watchConsole(page, problems, 'viewer');

    await signIn(page, workspace.account);
    await page.goto('/inbox');

    // The shell survived, which is the whole of the regression: an inbox whose shortcuts
    // collide with the shell's takes the entire application down on mount.
    await expect(page.getByRole('heading', { name: 'Inbox' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: /workspace/i })).toBeVisible();
    await expect(unreadLabel(page)).toHaveText('All read');
    await expect(page.getByText('Nothing here')).toBeVisible();
    expect(problems).toEqual([]);

    await context.close();
  });

  test('one person acts and the other is told, without a reload', async ({
    browser,
    workspace,
  }) => {
    const problems: string[] = [];

    const actorContext = await browser.newContext();
    const actor = await actorContext.newPage();
    watchConsole(actor, problems, 'actor');
    await signIn(actor, workspace.account);

    const watcher = await invitedMember(browser, workspace, 'Bea Watcher');
    watchConsole(watcher.page, problems, 'watcher');

    const title = `Watch this ${Date.now()}`;
    const identifier = await createIssue(actor, workspace.teamKey, title);

    // The watcher parks on the inbox, and from here until the reload below never asks the
    // server for anything: every row that appears arrived over the socket.
    await watcher.page.goto('/inbox');
    await expect(unreadLabel(watcher.page)).toHaveText('All read');
    await expect(watcher.page).toHaveTitle('Polaris');

    // ---------------------------------------------------------------- assigned
    await actor.keyboard.press('a');
    await expect(actor.getByRole('menu', { name: 'Assignee' })).toBeVisible();
    await actor.getByRole('menuitem', { name: /Bea Watcher/ }).click();

    await expect(
      watcher.page.getByRole('option', { name: new RegExp(`assigned ${identifier} to you`) }),
    ).toBeVisible({ timeout: 20_000 });
    await expect(unreadLabel(watcher.page)).toHaveText('1 unread');
    // The badge, on the only surface a browser tab has.
    await expect(watcher.page).toHaveTitle('(1) Polaris');

    // ---------------------------------------------------------------- commented
    await comment(actor, 'A remark from the actor');
    await expect(
      watcher.page.getByRole('option', { name: new RegExp(`commented on ${identifier}`) }),
    ).toBeVisible({ timeout: 20_000 });
    await expect(unreadLabel(watcher.page)).toHaveText('2 unread');

    // ---------------------------------------------------------------- status moved
    await setStatus(actor, workspace.states.started!.name);
    const statusRow = watcher.page.getByRole('option', {
      name: new RegExp(`changed the status of ${identifier}`),
    });
    await expect(statusRow).toBeVisible({ timeout: 20_000 });
    await expect(unreadLabel(watcher.page)).toHaveText('3 unread');
    await expect(watcher.page).toHaveTitle('(3) Polaris');

    // ---------------------------------------------------------------- read, unread
    // Opening a row is how most rows are read, and it lands on the issue it is about.
    await statusRow.click();
    await expect(watcher.page).toHaveURL(new RegExp(`/issue/${identifier}`), { timeout: 15_000 });

    await watcher.page.goto('/inbox');
    await expect(unreadLabel(watcher.page)).toHaveText('2 unread', { timeout: 15_000 });

    // `U` toggles the row under the cursor, which starts on the newest.
    await watcher.page.getByRole('listbox', { name: /notifications/i }).waitFor();
    await watcher.page.keyboard.press('u');
    await expect(unreadLabel(watcher.page)).toHaveText('3 unread');
    await watcher.page.keyboard.press('u');
    await expect(unreadLabel(watcher.page)).toHaveText('2 unread');

    // And it is the server's answer, not this tab's opinion of it.
    await watcher.page.reload();
    await expect(unreadLabel(watcher.page)).toHaveText('2 unread', { timeout: 20_000 });

    // ---------------------------------------------------------------- mark all read
    await watcher.page.getByRole('button', { name: /mark all read/i }).click();
    await expect(unreadLabel(watcher.page)).toHaveText('All read', { timeout: 15_000 });
    await expect(watcher.page).toHaveTitle('Polaris');
    await watcher.page.reload();
    await expect(unreadLabel(watcher.page)).toHaveText('All read', { timeout: 20_000 });

    // ---------------------------------------------------------------- dismiss
    const rows = await watcher.page.getByRole('option').count();
    await watcher.page.getByRole('listbox', { name: /notifications/i }).waitFor();
    await watcher.page.keyboard.press('Backspace');
    await expect(watcher.page.getByRole('option')).toHaveCount(rows - 1, { timeout: 15_000 });
    await watcher.page.reload();
    await expect(watcher.page.getByRole('option')).toHaveCount(rows - 1, { timeout: 20_000 });

    expect(problems).toEqual([]);

    await actorContext.close();
    await watcher.context.close();
  });

  test('unsubscribing stops the notifications, and re-subscribing starts them', async ({
    browser,
    workspace,
  }) => {
    const problems: string[] = [];

    const actorContext = await browser.newContext();
    const actor = await actorContext.newPage();
    watchConsole(actor, problems, 'actor');
    await signIn(actor, workspace.account);

    const watcher = await invitedMember(browser, workspace, 'Quiet Bea');
    watchConsole(watcher.page, problems, 'watcher');

    const title = `Too noisy ${Date.now()}`;
    const identifier = await createIssue(actor, workspace.teamKey, title);
    await actor.keyboard.press('a');
    await expect(actor.getByRole('menu', { name: 'Assignee' })).toBeVisible();
    await actor.getByRole('menuitem', { name: /Quiet Bea/ }).click();

    await watcher.page.goto('/inbox');
    await expect(
      watcher.page.getByRole('option', { name: new RegExp(`assigned ${identifier} to you`) }),
    ).toBeVisible({ timeout: 20_000 });

    // Being handed the issue subscribed them, which is what there is to switch off.
    await watcher.page.goto(`/issue/${identifier}`);
    await expect(watcher.page.getByRole('heading', { name: title })).toBeVisible({
      timeout: 20_000,
    });
    // Polled, not read once: the subscription is written by the server in its own time,
    // and the browser is told about it over the socket. A bare read here asserts that the
    // round trip has already finished, which is true on a fast machine and a coin flip on
    // a loaded runner.
    await expect
      .poll(() => subscribers(workspace, identifier), { timeout: 20_000 })
      .toContain('"unsubscribed":false');
    await watcher.page.keyboard.press('Shift+S');
    await expect
      .poll(() => subscribers(workspace, identifier), { timeout: 20_000 })
      .toContain('"unsubscribed":true');
    await replicaSaysUnsubscribed(watcher.page, true);

    await watcher.page.goto('/inbox');
    await watcher.page.getByRole('listbox', { name: /notifications/i }).waitFor();
    // Settled, not merely present. This number is the baseline for "nothing new arrived",
    // and everything before it is asynchronous: the fan-out runs on the worker's tick and
    // reaches this page over the socket. Reading the count the moment the listbox exists
    // can catch it mid-delivery, and then an *earlier* notification landing during the
    // wait below reads as the unsubscribe having failed. That is a flake in the test, not
    // in the product, and it fails only under load — which is exactly when nobody trusts
    // the result.
    const quiet = await settled(watcher.page);

    // Two more events on the issue. An unsubscribe silences all of them, including the
    // status change — the button says "unsubscribe from this issue" and has to mean it.
    await comment(actor, 'Nobody should hear about this');
    await setStatus(actor, workspace.states.completed!.name);
    await watcher.page.waitForTimeout(6_000);
    expect(await watcher.page.getByRole('option').count()).toBe(quiet);

    // ---------------------------------------------------------------- back on
    await watcher.page.goto(`/issue/${identifier}`);
    await expect(watcher.page.getByRole('heading', { name: title })).toBeVisible({
      timeout: 20_000,
    });
    await replicaSaysUnsubscribed(watcher.page, true);
    await watcher.page.keyboard.press('Shift+S');
    await expect
      .poll(() => subscribers(workspace, identifier), { timeout: 20_000 })
      .not.toContain('"unsubscribed":true');

    await watcher.page.goto('/inbox');
    await watcher.page.getByRole('listbox', { name: /notifications/i }).waitFor();
    await comment(actor, 'And this one should arrive');
    await expect
      .poll(() => watcher.page.getByRole('option').count(), { timeout: 20_000 })
      .toBe(quiet + 1);

    expect(problems).toEqual([]);

    await actorContext.close();
    await watcher.context.close();
  });

  test('muting a type keeps it out of the inbox entirely', async ({ browser, workspace }) => {
    const problems: string[] = [];

    const actorContext = await browser.newContext();
    const actor = await actorContext.newPage();
    watchConsole(actor, problems, 'actor');
    await signIn(actor, workspace.account);

    const watcher = await invitedMember(browser, workspace, 'Muted Bea');
    watchConsole(watcher.page, problems, 'watcher');

    await watcher.page.goto('/settings/notifications');
    const comments = watcher.page.getByLabel('Comments', { exact: true });
    await expect(comments).toBeChecked({ timeout: 20_000 });
    await comments.uncheck();
    // Written, not merely ticked: the whole preferences bag goes over on every change.
    await watcher.page.reload();
    await expect(watcher.page.getByLabel('Comments', { exact: true })).not.toBeChecked({
      timeout: 20_000,
    });

    const title = `Quietly ${Date.now()}`;
    const identifier = await createIssue(actor, workspace.teamKey, title);
    await actor.keyboard.press('a');
    await expect(actor.getByRole('menu', { name: 'Assignee' })).toBeVisible();
    await actor.getByRole('menuitem', { name: /Muted Bea/ }).click();

    await watcher.page.goto('/inbox');
    await expect(
      watcher.page.getByRole('option', { name: new RegExp(`assigned ${identifier} to you`) }),
    ).toBeVisible({ timeout: 20_000 });
    const before = await watcher.page.getByRole('option').count();

    await comment(actor, 'This must not arrive');
    await watcher.page.waitForTimeout(6_000);
    expect(await watcher.page.getByRole('option').count()).toBe(before);

    expect(problems).toEqual([]);

    await actorContext.close();
    await watcher.context.close();
  });
});
