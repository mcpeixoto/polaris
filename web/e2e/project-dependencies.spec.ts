/**
 * Linking two projects, with the reload that used to leave the link on screen twice.
 *
 * A dependency's id is the server's, so the client draws a stand-in under an id it invented
 * and swaps it for the real row when that row arrives. The swap used to be written in the
 * `await` that sent the mutation, and that works for exactly as long as the closure does. A
 * reload taken while the request is out throws it away — and the stand-in is *persisted*, on
 * purpose, because an optimistic write that vanished on refresh would be worse — so the
 * outbox replays the op, the server's idempotency table answers with the original row, and
 * that row lands in the replica beside a stand-in nothing is left holding. Both dependency
 * panels then show one blocker twice, and no amount of reloading clears it: both rows are
 * real rows in IndexedDB now.
 *
 * The pairing lives on the outbox record instead (`web/src/sync/reconcile.ts`), which is
 * reached from the replay as well as from the response. This holds the response rather than
 * waiting for a slow moment to produce the same window by luck.
 */

import { expect, signIn, test, type SeededWorkspace } from './fixtures';

const API = process.env.POLARIS_E2E_API ?? 'http://localhost:8088';

async function createProject(ws: SeededWorkspace, name: string): Promise<{ id: string }> {
  const res = await fetch(`${API}/graphql`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${ws.account.accessToken}`,
      'X-Polaris-Workspace': ws.workspaceId,
    },
    body: JSON.stringify({
      query: `mutation ($i: CreateProjectInput!) { createProject(input: $i) { project { id } } }`,
      variables: { i: { name, teamIds: [ws.teamId] } },
    }),
  });
  const body = (await res.json()) as {
    data?: { createProject: { project: { id: string } } };
    errors?: { message: string }[];
  };
  if (body.errors?.length) throw new Error(body.errors[0]!.message);
  return body.data!.createProject.project;
}

test.describe('project dependencies', () => {
  test('a blocker added once is listed once, even across a reload mid-write', async ({
    page,
    workspace,
  }) => {
    const problems: string[] = [];
    page.on('console', (message) => {
      // Two errors this test causes rather than finds: the anonymous boot posts /auth/refresh
      // with no session and is told 401, and the write below has its answer cut off on
      // purpose. Everything else is the bug this file is about.
      const text = message.text();
      const induced = text.includes('401') || text.includes('ERR_CONNECTION_FAILED');
      if (message.type() === 'error' && !induced) problems.push(text);
    });
    page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));

    const blocked = await createProject(workspace, 'Mobile relaunch');
    await createProject(workspace, 'Platform work');

    await signIn(page, workspace.account);
    await page.goto(`/project/${blocked.id}`);
    // A single panel, in the properties sidebar.
    await expect(page.getByRole('heading', { name: 'Blocked by' })).toHaveCount(1);

    // The mutation is really sent and the server really commits it; only the answer is kept
    // from the client, which is the state a reload finds when the network is slow.
    let sent = false;
    await page.route('**/graphql', async (route) => {
      if (!(route.request().postData() ?? '').includes('AddProjectDependency')) {
        await route.continue();
        return;
      }
      // Really sent, so the server really commits the row and its idempotency table
      // remembers the op — then the answer is dropped on the floor, which is what a client
      // that loses the connection mid-write sees. The op stays in the outbox with its
      // stand-in on screen, and the reload below is taken from there.
      await route.fetch();
      sent = true;
      await route.abort('connectionfailed');
    });

    await page.getByRole('button', { name: 'Add blocker…' }).click();
    await page
      .getByRole('menu', { name: 'Project' })
      .getByRole('menuitem', { name: 'Platform work' })
      .click();

    // The stand-in is on screen and the op is in the outbox, waiting for an answer that is
    // not coming. This is the window under test.
    await expect(page.getByRole('link', { name: 'Platform work' })).toHaveCount(1);
    await expect.poll(() => sent, { timeout: 30_000 }).toBe(true);

    await page.unroute('**/graphql');
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Blocked by' })).toHaveCount(1);

    // The replay has to have happened for this to be the assertion it looks like, so wait for
    // the row to be the server's rather than reading the moment the page paints.
    await expect(page.getByRole('link', { name: 'Platform work' })).toHaveCount(1, {
      timeout: 30_000,
    });
    await page.waitForTimeout(1_000);
    // Read once, not polled: a retrying assertion would wait out the duplicate and report the
    // bug as fixed. One link, because the single panel lists the one blocker.
    expect(
      await page.getByRole('link', { name: 'Platform work' }).count(),
      'one blocker was added, so the panel lists it once',
    ).toBe(1);

    // And a stand-in that survived into the replica would still be there on the next boot.
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Blocked by' })).toHaveCount(1);
    await page.waitForTimeout(1_000);
    expect(await page.getByRole('link', { name: 'Platform work' }).count()).toBe(1);

    // The far end agrees, and lists it once as well.
    await page.getByRole('link', { name: 'Platform work' }).first().click();
    await expect(page.getByRole('heading', { name: 'Blocking' })).toHaveCount(1);
    await expect(page.getByRole('link', { name: 'Mobile relaunch' })).toHaveCount(1);

    expect(problems).toEqual([]);
  });
});
