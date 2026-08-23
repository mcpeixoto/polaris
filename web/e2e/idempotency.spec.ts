/**
 * A create replayed out of the offline outbox must file one row, not two.
 *
 * Only a browser can prove this, which is why it is here. `SyncEngine.mutate` appends the op
 * to a *durable* outbox before the request goes out and clears it only once a response has
 * been parsed; a reload taken in between throws the response away and leaves the op queued,
 * and `drainOutbox` re-sends it with the (clientId, opId) of the first attempt — deliberately,
 * so the server can recognise the retry. None of that is visible below the browser: the
 * durability is IndexedDB, the replay is triggered by a socket reconnect, and the window in
 * between is an ordinary reload, not an outage.
 *
 * The pair only means anything if the field carries `@idempotent` and its resolver hands it
 * to `idempotent(...)`. createRecurringIssue had neither and filed a second schedule and a
 * second issue every time (#107); an audit afterwards found twenty more creates in exactly
 * the same state, createIssueTemplate among them. Driven here it produced *three* templates
 * from one click — the first write, plus two drains — and no reload cleared them, because all
 * three are real rows by then.
 *
 * The count is taken from the server rather than the screen on purpose. The client's
 * reconciliation adopts an arriving row onto the stand-in it matches, so two server rows can
 * fold onto one local row and the screen shows a single template over a workspace that holds
 * three. What the user sees the next time their replica is rebuilt is the server's answer.
 *
 * The response is stranded rather than the request blocked, because the failure needs the
 * server to have *taken* the write. That is a closing lid or a tunnel, not an outage.
 */

import { expect, test, signIn } from './fixtures';

const API = process.env.POLARIS_E2E_API ?? 'http://localhost:8088';

const isCreate = (body: string | null): boolean => (body ?? '').includes('CreateIssueTemplate');

test('a create replayed from the outbox after a reload files one row', async ({
  page,
  workspace,
}) => {
  // Three round trips, a stranded response, a full reload and a bootstrap, and then a wait
  // for the drain the reconnect schedules. Comfortable on a laptop and close to the default
  // budget on a CI runner sharing itself with a second worker, so it is declared slow rather
  // than left to fail as a timeout that says nothing about the product.
  test.slow();

  await signIn(page, workspace.account);
  await page.goto('/settings/templates');
  await page.getByRole('heading', { name: 'Templates' }).first().waitFor();

  let stranded = false;
  await page.route('**/graphql', async (route) => {
    if (stranded || !isCreate(route.request().postData())) {
      await route.continue();
      return;
    }
    stranded = true;
    const response = await route.fetch();
    // By now the page is gone and there is nobody to answer, which is the point. The
    // rejection is this test's own plumbing, not the product's.
    await new Promise((resolve) => setTimeout(resolve, 5_000));
    await route.fulfill({ response }).catch(() => {});
  });

  await page
    .getByRole('button', { name: /^New template for / })
    .first()
    .click();
  const form = page.getByRole('form', { name: /^New template for / });
  await form.getByLabel('Name', { exact: true }).fill('Bug report');
  await form.getByLabel('Issue title', { exact: true }).fill('Something is broken');
  await page.getByRole('button', { name: 'Create template' }).click();

  await expect
    .poll(() => stranded, { message: 'the create never reached the route handler' })
    .toBe(true);
  // The optimistic row is the signal that `mutate` got past `outbox.append`, which is the
  // durable half. Reloading before that would test nothing: there would be no queued op.
  await expect(page.getByText('Bug report').first()).toBeVisible();

  await page.unroute('**/graphql');

  // Armed before the reload so the replay cannot be missed, and awaited afterwards so the
  // assertion below is never taken before the outbox has actually drained. A fixed wait here
  // would make this test pass on a slow runner by measuring nothing.
  const replayed = page.waitForResponse(
    (response) => response.url().includes('/graphql') && isCreate(response.request().postData()),
    { timeout: 30_000 },
  );
  await page.reload();
  await page.getByRole('heading', { name: 'Templates' }).first().waitFor();
  await replayed;

  await expect
    .poll(
      async () => {
        const res = await fetch(`${API}/graphql`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${workspace.account.accessToken}`,
            'X-Polaris-Workspace': workspace.workspaceId,
          },
          body: JSON.stringify({ query: '{ issueTemplates { id name } }' }),
        });
        const body = (await res.json()) as { data: { issueTemplates: { name: string }[] } };
        return body.data.issueTemplates.filter((t) => t.name === 'Bug report').length;
      },
      {
        message:
          'the workspace holds more than one template called "Bug report". The outbox ' +
          'replayed the create with the (clientId, opId) of the first attempt, which is what ' +
          'makes a replay safe — and it is only safe if createIssueTemplate carries ' +
          '@idempotent and its resolver reads the pair.',
        timeout: 15_000,
      },
    )
    .toBe(1);
});
