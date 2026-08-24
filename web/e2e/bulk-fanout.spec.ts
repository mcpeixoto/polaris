/**
 * M1 acceptance test 8, driven through the product rather than through the service.
 *
 *   The notification fan-out for a bulk update of 200 issues completes in < 2 s and
 *   produces one row per affected subscriber, not per issue per subscriber.
 *
 * The server has proven this since the milestone opened — `bulkUpdateIssues` emits one
 * version block, `notify.GroupKey` collapses it, and two tests in `internal/domain` assert
 * both halves. All of that stayed true while the criterion was not met, because the client
 * never called the mutation: `updateIssues` looped `updateIssue`, one version block per
 * issue, and a watcher of a bulk edit got one inbox row per issue with no count on any of
 * them. Every proof the milestone named was on the wrong side of the gap.
 *
 * So this one starts at the keyboard. Somebody selects rows in the list and presses `S`;
 * somebody else opens their inbox and finds one row that says "and 2 others". Nothing here
 * knows the name of a mutation, which is exactly why it would have failed before and passes
 * now.
 *
 * Three issues rather than two hundred: the count in the criterion is about the fan-out's
 * cost, which `TestFanOut_BulkEditGivesEachSubscriberExactlyOneRow` times against a real
 * two hundred. What a browser can prove that no service test can is that the product sends
 * the batch at all, and three is the smallest selection where "one row with a tail" and
 * "one row per issue" are different screens.
 */

import type { Browser, Page } from '@playwright/test';

import {
  createIssueViaApi,
  expect,
  inviteToWorkspace,
  signIn,
  test,
  uniqueEmail,
  type SeededWorkspace,
} from './fixtures';

const PASSWORD = 'e2e-placeholder-password';

/** A second real person: invited, registered through the form, named. */
async function invitedMember(
  browser: Browser,
  workspace: SeededWorkspace,
  name: string,
): Promise<{ context: import('@playwright/test').BrowserContext; page: Page }> {
  const email = uniqueEmail('bulkfanout-member');
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

/**
 * Opens a team's list and selects every row, the way the product asks for it.
 *
 * Shift-click selects the row it lands on and puts the cursor there; `X` toggles the row
 * under the cursor. A plain click would open the issue instead, and `⌘A` needs the list to
 * already hold the keyboard — which it does not until something in it has been clicked.
 */
async function selectWholeList(page: Page, teamKey: string, titles: string[]): Promise<void> {
  await page.goto(`/team/${teamKey}`);
  const list = page.getByRole('listbox', { name: /issues/i });
  await list.waitFor({ timeout: 30_000 });
  await expect
    .poll(() => list.getByRole('option').count(), { timeout: 30_000 })
    .toBe(titles.length);

  await page.getByText(titles[0]!).click({ modifiers: ['Shift'] });
  for (let i = 1; i < titles.length; i++) {
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('x');
  }
  await expect(page.getByText(`${titles.length} selected`)).toBeVisible({ timeout: 15_000 });
}

test.describe('a bulk edit and the inbox', () => {
  test('gives a watcher one row with a tail, not one row per issue', async ({
    browser,
    workspace,
  }) => {
    // Two browsers, an invitation, a worker tick and a settle loop. The default sixty
    // seconds is not enough for the sequence even when nothing is wrong.
    test.setTimeout(240_000);

    const titles = ['Bulk one', 'Bulk two', 'Bulk three'];
    for (const title of titles) await createIssueViaApi(workspace, title);

    // Blake watches all three, chosen from the list with the product's own keys: select
    // everything, then subscribe to the selection.
    const blake = await invitedMember(browser, workspace, 'Blake Watcher');
    try {
      await selectWholeList(blake.page, workspace.teamKey, titles);
      await blake.page.keyboard.press('Shift+S');

      // Waited for on the server, not on the screen: subscribing renders no indicator, and
      // the bulk edit below must not happen before the subscriptions exist or there is
      // nobody to notify and the test passes by finding nothing.
      const owner = await ownerUserId(workspace);
      await expect
        .poll(() => watchedCount(workspace, owner), { timeout: 30_000 })
        .toBe(titles.length);

      // Now the edit, by the workspace's owner, as one action on a selection of three.
      const ownerContext = await browser.newContext();
      const ownerPage = await ownerContext.newPage();
      try {
        await signIn(ownerPage, workspace.account);
        await selectWholeList(ownerPage, workspace.teamKey, titles);
        await ownerPage.keyboard.press('s');
        await expect(ownerPage.getByRole('menu', { name: 'Status' })).toBeVisible();
        await ownerPage.getByRole('menuitem', { name: 'In Progress' }).click();

        // All three moved, in the frame the key was pressed in and then for real.
        await expect
          .poll(() => statusesOf(workspace), { timeout: 30_000 })
          .toEqual(['In Progress', 'In Progress', 'In Progress']);
      } finally {
        await ownerContext.close();
      }

      // The worker's fan-out runs on a five-second tick, so the inbox is polled rather than
      // read once — and polled for a count that has stopped moving, because "one row" is
      // true for a moment on the way to three.
      await blake.page.goto('/inbox');
      await expect(blake.page.getByRole('heading', { name: /inbox/i })).toBeVisible({
        timeout: 30_000,
      });
      const rows = blake.page.getByRole('listbox').getByRole('option');
      await expect.poll(() => rows.count(), { timeout: 60_000 }).toBeGreaterThan(0);

      // Settled: two identical reads a couple of seconds apart. A fan-out that emitted a row
      // per issue would arrive as a burst, and one read taken mid-burst says "1" for the
      // wrong reason.
      let previous = -1;
      for (let i = 0; i < 15; i++) {
        const current = await rows.count();
        if (current === previous) break;
        previous = current;
        await blake.page.waitForTimeout(2_000);
      }

      // The criterion, on screen. One row for this subscriber, carrying the other two.
      await expect(rows).toHaveCount(1);
      await expect(rows.first()).toContainText('and 2 others');
    } finally {
      await blake.context.close();
    }
  });
});

const API = process.env.POLARIS_E2E_API ?? 'http://localhost:8088';

async function query<T>(workspace: SeededWorkspace, document: string): Promise<T> {
  const response = await fetch(`${API}/graphql`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${workspace.account.accessToken}`,
      'X-Polaris-Workspace': workspace.workspaceId,
    },
    body: JSON.stringify({ query: document }),
  });
  const body = (await response.json()) as { data?: T; errors?: { message: string }[] };
  if (body.errors?.length) throw new Error(body.errors[0]!.message);
  if (!body.data) throw new Error('no data');
  return body.data;
}

interface IssuesPage {
  issues: {
    id: string;
    state: { name: string };
    subscribers: { userId: string; unsubscribed: boolean }[];
  }[];
}

/** The owner's *workspace user* id, which is not the account id the fixture hands back. */
async function ownerUserId(workspace: SeededWorkspace): Promise<string> {
  const data = await query<{ viewer: { user: { id: string } } }>(
    workspace,
    `query { viewer { user { id } } }`,
  );
  return data.viewer.user.id;
}

async function issuesOf(workspace: SeededWorkspace): Promise<IssuesPage['issues']> {
  const data = await query<IssuesPage>(
    workspace,
    `query { issues(teamId: "${workspace.teamId}") {
      id
      state { name }
      subscribers { userId unsubscribed }
    } }`,
  );
  return data.issues;
}

/** How many issues somebody other than the owner is actually watching. */
async function watchedCount(workspace: SeededWorkspace, owner: string): Promise<number> {
  const issues = await issuesOf(workspace);
  return issues.filter((issue) =>
    issue.subscribers.some((row) => !row.unsubscribed && row.userId !== owner),
  ).length;
}

/** The statuses the server holds, sorted, so the assertion does not depend on list order. */
async function statusesOf(workspace: SeededWorkspace): Promise<string[]> {
  const issues = await issuesOf(workspace);
  return issues.map((issue) => issue.state.name).sort();
}
