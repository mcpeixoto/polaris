/**
 * Linking a project to an initiative, with the two halves of its arrival pulled apart.
 *
 * The link row's id is the server's, so the client draws a stand-in under an id it invented
 * and has to retire it when the real row turns up. That row turns up by two routes — the
 * mutation's response and the sync socket, which is pushed the moment the mutation commits —
 * and nothing makes the response the winner. On a machine busy enough the delta lands first,
 * and until the response arrives the replica holds the stand-in *and* the server's row: one
 * project listed twice under one initiative.
 *
 * Worse than a flicker, because a stand-in is persisted on purpose. Nothing pairs it from the
 * delta stream, so the duplicate is still there after a reload, and after every reload.
 *
 * Waiting for the race to happen is not a test. This holds the response until the socket has
 * been seen delivering the row, which makes the window certain on any machine. See
 * `web/src/sync/reconcile.ts` and `web/e2e/comments.spec.ts`, which does the same for a
 * comment.
 */

import { expect, signIn, test, type SeededWorkspace } from './fixtures';

const API = process.env.POLARIS_E2E_API ?? 'http://localhost:8088';

async function graphql<T>(
  ws: SeededWorkspace,
  query: string,
  variables: Record<string, unknown>,
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
  return body.data!;
}

test('a project linked once is listed once, even when the socket beats the response', async ({
  page,
  workspace,
}) => {
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(message.text());
  });
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));

  const { createInitiative } = await graphql<{ createInitiative: { initiative: { id: string } } }>(
    workspace,
    `
      mutation ($i: CreateInitiativeInput!) {
        createInitiative(input: $i) {
          initiative {
            id
          }
        }
      }
    `,
    { i: { name: 'Two arrivals, one link' } },
  );
  const { createProject } = await graphql<{ createProject: { project: { id: string } } }>(
    workspace,
    `
      mutation ($i: CreateProjectInput!) {
        createProject(input: $i) {
          project {
            id
          }
        }
      }
    `,
    { i: { name: 'Aurora', teamIds: [workspace.teamId] } },
  );
  const initiativeId = createInitiative.initiative.id;
  const projectId = createProject.project.id;

  // Every frame the socket delivers, so the test can tell the server's row from the stand-in
  // — they are identical on screen, which is the whole point.
  let delivered = false;
  page.on('websocket', (socket) => {
    socket.on('framereceived', (frame) => {
      if (
        typeof frame.payload === 'string' &&
        frame.payload.includes(projectId) &&
        frame.payload.includes('initiativeProject')
      ) {
        delivered = true;
      }
    });
  });

  await signIn(page, workspace.account);
  await page.goto(`/initiative/${initiativeId}`);
  await page.getByRole('heading', { name: 'Two arrivals, one link', level: 1 }).waitFor();

  // The mutation runs for real; only its answer is held, and held until this test says so
  // rather than for a guessed number of milliseconds.
  let released = false;
  let release = false;
  await page.route('**/graphql', async (route) => {
    if (!(route.request().postData() ?? '').includes('AddInitiativeProject')) {
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

  await page.getByLabel('Project to add').selectOption({ label: 'Aurora' });
  await page.getByRole('button', { name: 'Add', exact: true }).click();

  const listed = page.getByRole('link', { name: 'Aurora' });

  // The window under test: the server's row is in the replica and the response is not back.
  await expect.poll(() => delivered, { timeout: 60_000 }).toBe(true);
  await expect.poll(async () => listed.count(), { timeout: 30_000 }).toBeGreaterThan(0);
  await page.waitForTimeout(1_000);

  expect(released, 'the response must still be held for this to be the race under test').toBe(
    false,
  );
  // Read once, not polled: a retrying assertion here would wait the duplicate out and report
  // the bug as fixed.
  expect(await listed.count(), 'one project was linked, so one is on the screen').toBe(1);

  // And it stays one once the response lands and the pairing is made the ordinary way.
  release = true;
  await expect.poll(() => released, { timeout: 60_000 }).toBe(true);
  await expect(listed).toHaveCount(1);

  // A stand-in is persisted on purpose, so a duplicate that survives here is one the user
  // could never clear.
  await page.unroute('**/graphql');
  await page.reload();
  await page.getByRole('heading', { name: 'Two arrivals, one link', level: 1 }).waitFor();
  await expect(listed).toHaveCount(1, { timeout: 30_000 });
  await page.waitForTimeout(1_000);
  await expect(listed).toHaveCount(1);

  expect(problems).toEqual([]);
});

test('an update posted once appears once, even when the socket beats the response', async ({
  page,
  workspace,
}) => {
  const { createInitiative } = await graphql<{ createInitiative: { initiative: { id: string } } }>(
    workspace,
    `
      mutation ($i: CreateInitiativeInput!) {
        createInitiative(input: $i) {
          initiative {
            id
          }
        }
      }
    `,
    { i: { name: 'One post, one row' } },
  );
  const initiativeId = createInitiative.initiative.id;
  const body = `The socket got here first ${Date.now()}`;

  let delivered = false;
  page.on('websocket', (socket) => {
    socket.on('framereceived', (frame) => {
      if (typeof frame.payload === 'string' && frame.payload.includes(body)) delivered = true;
    });
  });

  await signIn(page, workspace.account);
  await page.goto(`/initiative/${initiativeId}`);
  await page.getByRole('heading', { name: 'One post, one row', level: 1 }).waitFor();

  let released = false;
  let release = false;
  await page.route('**/graphql', async (route) => {
    if (!(route.request().postData() ?? '').includes('CreateInitiativeUpdate')) {
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

  await page.getByLabel('Update').fill(body);
  await page.getByRole('button', { name: 'Post update' }).click();

  await page.getByRole('link', { name: 'Activity' }).click();
  const posted = page.getByText(body, { exact: true });

  await expect.poll(() => delivered, { timeout: 60_000 }).toBe(true);
  await expect.poll(async () => posted.count(), { timeout: 30_000 }).toBeGreaterThan(0);
  await page.waitForTimeout(1_000);

  expect(released, 'the response must still be held for this to be the race under test').toBe(
    false,
  );
  expect(await posted.count(), 'one update was posted, so one is on the screen').toBe(1);

  release = true;
  await expect.poll(() => released, { timeout: 60_000 }).toBe(true);
  await expect(posted).toHaveCount(1);

  await page.unroute('**/graphql');
  await page.reload();
  await expect(posted).toHaveCount(1, { timeout: 30_000 });
  await page.waitForTimeout(1_000);
  await expect(posted).toHaveCount(1);
});

test('a label created once is listed once, even when the socket beats the response', async ({
  page,
  workspace,
}) => {
  const name = `Platform ${Date.now()}`;

  let delivered = false;
  page.on('websocket', (socket) => {
    socket.on('framereceived', (frame) => {
      if (typeof frame.payload === 'string' && frame.payload.includes(name)) delivered = true;
    });
  });

  await signIn(page, workspace.account);
  await page.goto('/settings/initiative-labels');
  await page.getByRole('heading', { name: 'Initiative labels', level: 1 }).waitFor();

  let released = false;
  let release = false;
  await page.route('**/graphql', async (route) => {
    if (!(route.request().postData() ?? '').includes('CreateInitiativeLabel')) {
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

  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByRole('button', { name: 'Add', exact: true }).click();

  const row = page.getByLabel(`Name of ${name}`);

  await expect.poll(() => delivered, { timeout: 60_000 }).toBe(true);
  await expect.poll(async () => row.count(), { timeout: 30_000 }).toBeGreaterThan(0);
  await page.waitForTimeout(1_000);

  expect(released, 'the response must still be held for this to be the race under test').toBe(
    false,
  );
  expect(await row.count(), 'one label was created, so one is on the screen').toBe(1);

  release = true;
  await expect.poll(() => released, { timeout: 60_000 }).toBe(true);
  await expect(row).toHaveCount(1);

  await page.unroute('**/graphql');
  await page.reload();
  await page.getByRole('heading', { name: 'Initiative labels', level: 1 }).waitFor();
  await expect(row).toHaveCount(1, { timeout: 30_000 });
  await page.waitForTimeout(1_000);
  await expect(row).toHaveCount(1);
});
