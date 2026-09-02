/**
 * Public Asks intake.
 *
 * The only unauthenticated write path in the product, and the only screen that has to work
 * in a browser with no session, no replica and no workspace — so it is also the only one
 * whose acceptance criteria cannot be asserted below the browser. What is proved here is
 * that a stranger holding a link can file an issue into the right team, that the page tells
 * them nothing else about the workspace, and that a link which has stopped working says so.
 */

import type { Browser, Page } from '@playwright/test';

import { expect, signIn, test, type SeededWorkspace } from './fixtures';

const API = process.env.POLARIS_E2E_API ?? 'http://localhost:8088';

async function gql<T>(
  ws: SeededWorkspace,
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  const res = await fetch(`${API}/graphql`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${ws.account.accessToken}`,
      'X-Polaris-Workspace': ws.workspaceId,
    },
    body: JSON.stringify({ query, variables }),
  });
  const body = (await res.json()) as { data?: T; errors?: { message: string }[] };
  if (body.errors?.length) throw new Error(body.errors[0]!.message);
  return body.data as T;
}

/** Creates a form on the settings screen and returns the token out of its public link. */
async function createForm(page: Page, name: string, description: string): Promise<string> {
  await page.goto('/settings/asks');
  await page.getByRole('heading', { name: 'Asks', exact: true }).waitFor();
  await page.getByLabel('Name').fill(name);
  await page.getByLabel('Description').fill(description);
  await page.getByRole('button', { name: 'Create form' }).click();

  const row = page.locator('li', { hasText: name }).first();
  await expect(row).toContainText(/\/ask\//);
  const match = /\/ask\/([0-9a-f]+)/.exec(await row.innerText());
  expect(match, 'the settings row has to show the public link').not.toBeNull();
  return match![1]!;
}

/** A context that has never seen this origin: no cookie, no token, no IndexedDB. */
async function stranger(browser: Browser) {
  const context = await browser.newContext();
  return { context, page: await context.newPage() };
}

test('a stranger with the link files an issue into the team', async ({
  page,
  browser,
  workspace,
}) => {
  await signIn(page, workspace.account);
  const token = await createForm(page, 'Report a bug', 'Tell us what broke.');

  const { context, page: pub } = await stranger(browser);
  // The public page must not be pulling a workspace snapshot or opening the sync socket:
  // it renders before, and entirely without, the replica.
  const apiCalls: string[] = [];
  pub.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (path === '/graphql' || path === '/sync' || path === '/sync/bootstrap') {
      apiCalls.push(`${request.method()} ${path}`);
    }
  });

  await pub.goto(`/ask/${token}`);
  await expect(pub.getByRole('heading', { name: 'Report a bug' })).toBeVisible();
  await expect(pub.getByText('Tell us what broke.')).toBeVisible();
  // The form names its team, and nothing else about the workspace.
  const shown = await pub.locator('body').innerText();
  expect(shown).not.toContain(workspace.account.email);
  expect(shown).not.toContain(workspace.workspaceId);

  const title = `The printer is on fire ${Date.now()}`;
  await pub.getByLabel('Your name').fill('Dana Outsider');
  await pub.getByLabel('Your email').fill('dana@example.test');
  await pub.getByLabel('Title', { exact: true }).fill(title);
  await pub.getByLabel('Details').fill('Third floor, by the window.');
  await pub.getByRole('button', { name: 'Submit' }).click();
  await expect(pub.getByRole('heading', { name: 'Request sent' })).toBeVisible();
  expect(apiCalls, `the public page called ${apiCalls.join(', ')}`).toEqual([]);

  const { issues } = await gql<{ issues: { title: string; description: string }[] }>(
    workspace,
    `query ($t: UUID!) { issues(teamId: $t) { title description } }`,
    { t: workspace.teamId },
  );
  const filed = issues.find((issue) => issue.title === title);
  expect(
    filed,
    `filed nothing; team has ${JSON.stringify(issues.map((i) => i.title))}`,
  ).toBeTruthy();
  // Who asked has to survive into the issue: the requester has no account to attribute it to.
  expect(filed!.description).toContain('Dana Outsider');
  expect(filed!.description).toContain('dana@example.test');
  expect(filed!.description).toContain('Third floor');

  await page.goto(`/team/${workspace.teamKey}`);
  await expect(page.getByText(title)).toBeVisible();
  await context.close();
});

test('a deleted form tells the requester the link is retired', async ({
  page,
  browser,
  workspace,
}) => {
  await signIn(page, workspace.account);
  const token = await createForm(page, 'Doomed form', '');

  await page
    .locator('li', { hasText: 'Doomed form' })
    .first()
    .getByRole('button', { name: 'Delete' })
    .click();
  await page.getByRole('button', { name: 'Delete this form' }).click();
  await expect(page.locator('li', { hasText: 'Doomed form' })).toHaveCount(0);

  // The row goes optimistically; the link dies when the mutation lands. Poll for that
  // rather than reading once, or this races the write on a loaded machine.
  await expect
    .poll(async () => (await fetch(`${API}/asks/${token}`)).status, { timeout: 15_000 })
    .toBe(404);

  const { context, page: pub } = await stranger(browser);
  await pub.goto(`/ask/${token}`);
  await expect(pub.getByRole('heading', { name: /no longer available/i })).toBeVisible();
  await context.close();
});
