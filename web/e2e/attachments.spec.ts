/**
 * Link cards, across a reload the server's answer does not survive.
 *
 * An attachment's id is minted by the API, so the panel shows a stand-in under an id the
 * client invented and swaps it for the real row when the response names it. The swap is the
 * part that needs a browser to test: the stand-in is persisted like every other optimistic
 * write, so the interesting case is the one where the caller waiting for the response is no
 * longer there — the user opened something else, or the request went to the outbox. Nothing
 * below the browser can stage that, because nothing below the browser has a page to leave.
 *
 * Get it wrong and the stand-in outlives the reload, the delta stream delivers the real row
 * beside it, and one link is two cards for good.
 */

import { test, expect, signIn, createIssueViaApi } from './fixtures';
import type { Page } from '@playwright/test';

const links = (page: Page) => page.getByRole('region', { name: 'Links', exact: true });

/**
 * How long a freshly loaded page may take to pair a stand-in with the server's row.
 *
 * Longer than the suite's default, because the pairing after a reload is not a render: the
 * socket has to connect, the outbox has to replay the op, and the server has to answer it.
 * On a loaded CI box running two workers that is comfortably more than ten seconds, and a
 * short wait would report a slow reconnect as a duplicated card.
 */
const SETTLE = 25_000;

/**
 * One card, whatever else is on the way.
 *
 * `toHaveText` over the whole list rather than a count and then a name: a stand-in and the
 * row the delta stream carries overlap for a frame while a response is in the air, and two
 * assertions would sample two different frames of that.
 */
function oneCard(page: Page, title: RegExp) {
  return expect(links(page).getByRole('link')).toHaveText([title], { timeout: SETTLE });
}

async function addLink(page: Page, url: string, title: string): Promise<void> {
  await links(page).getByLabel('URL', { exact: true }).fill(url);
  await links(page).getByLabel('Title', { exact: true }).fill(title);
  await links(page).getByRole('button', { name: 'Add', exact: true }).click();
}

/**
 * Lets the server take one mutation, and drops its answer on the floor.
 *
 * `route.fetch` first, so the write really happens and the delta really goes out; the wait
 * sits in front of `fulfill`, which is the part the page has to miss. Sleeping before
 * `fetch` instead would abort the request along with the navigation and stage nothing.
 *
 * Only the first one. The point is a single answer that arrives after the page that asked
 * for it is gone — after that the outbox replays the op, and its reply has to be allowed
 * through, because settling from the replay is the behaviour under test.
 */
async function loseOneAnswer(page: Page, operation: string, delayMs: number): Promise<void> {
  let dropped = false;
  await page.route('**/graphql', async (route) => {
    if (dropped || !(route.request().postData() ?? '').includes(operation)) {
      return route.fallback();
    }
    dropped = true;
    const response = await route.fetch();
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    await route.fulfill({ response }).catch(() => {
      // The page is gone. That is the whole point of this route.
    });
  });
}

test('a link whose answer came back to nobody is one card, not two', async ({
  page,
  workspace,
}) => {
  await signIn(page, workspace.account);
  const issue = await createIssueViaApi(workspace, 'Link across a reload');
  await loseOneAnswer(page, 'createAttachment', 5_000);

  await page.goto(`/issue/${issue.identifier}`);
  await links(page).waitFor();
  await addLink(page, 'https://example.com/pr/41', 'PR 41');
  // The card is on screen the moment it is optimistic, which is when a person moves on.
  // `.first()`: the stand-in and the server's row may already overlap here, which is the
  // frame this test arranges rather than the one it asserts on.
  await expect(links(page).getByRole('link', { name: /PR 41/ }).first()).toBeVisible();

  // Gone before the answer lands. Everything left behind is on disk: the stand-in, and the
  // op still sitting in the outbox.
  await page.goto(`/issue/${issue.identifier}`);
  await links(page).waitFor();

  // The replay pairs them. Two cards here means the stand-in was never claimed by anything.
  await oneCard(page, /PR 41/);
  await expect(links(page).getByRole('link').first()).toHaveAttribute(
    'href',
    'https://example.com/pr/41',
  );
});

test('the same URL twice is one card, on this issue and on another', async ({
  page,
  workspace,
}) => {
  await signIn(page, workspace.account);
  const first = await createIssueViaApi(workspace, 'Idempotent link');
  const second = await createIssueViaApi(workspace, 'Same link elsewhere');
  const url = 'https://example.com/incident/7?tab=timeline#event-3';

  await page.goto(`/issue/${first.identifier}`);
  await links(page).waitFor();
  await addLink(page, url, 'Incident');
  await oneCard(page, /Incident/);

  // Posting the same URL again updates the card rather than minting a second one — the rule
  // an integration relies on to stay stateless. Query string and fragment are part of it.
  await addLink(page, url, 'Incident, renamed');
  await oneCard(page, /Incident, renamed/);

  // Idempotent per issue, not per workspace: another issue may carry the same URL.
  await page.goto(`/issue/${second.identifier}`);
  await links(page).waitFor();
  await addLink(page, url, 'Same incident');
  await oneCard(page, /Same incident/);

  // And back, on a page built from the replica on disk rather than from the frame that
  // wrote it.
  await page.goto(`/issue/${first.identifier}`);
  await links(page).waitFor();
  await oneCard(page, /Incident, renamed/);
  await expect(links(page).getByRole('link').first()).toHaveAttribute('href', url);
});
