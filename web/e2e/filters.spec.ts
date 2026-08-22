/**
 * The two promises the filter grammar makes to the address bar.
 *
 * Both are browser facts and neither is provable below one, which is why they are here
 * rather than in a vitest. A filter is only "in the URL" if it survives the round trip
 * through a real address bar, and it is only a *shareable* link if what comes back out is
 * still the grammar somebody can read — `label.in(<id>)`, not `label.in%28…%29`.
 *
 * Each of these pinned a bug that shipped. A Title clause is seeded with the empty string,
 * which encodes to nothing, and reading `title.contains()` back as zero values turned the
 * user's own filter into "this link carried a filter this build could not read" the moment
 * it reached the URL. And opening a saved view went through react-router's own serialiser,
 * which escapes the parentheses and commas the grammar is built from — so the readable-link
 * promise held for a filter typed into the bar and for nothing else, which is the half of
 * the product where links are actually made.
 */

import { expect, signIn, test } from './fixtures';

test('a text filter typed into the bar survives its own URL', async ({ page, workspace }) => {
  await createIssue(workspace, 'Findable haystack');
  await createIssue(workspace, 'Something else');

  await signIn(page, workspace.account);
  await page.goto(`/team/${workspace.teamKey}`);
  await page.getByRole('listbox', { name: /issues/i }).waitFor();

  await page.getByRole('button', { name: 'Add filter' }).click();
  await page.getByRole('menuitem', { name: /^Title$/ }).click();

  // An untouched Title clause holds the empty string, which matches everything. It must not
  // read back as an unreadable filter.
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByLabel('Value').fill('haystack');
  await expect(
    page.getByRole('button', { name: 'Title contains "haystack"', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();

  await page.reload();
  await page.getByRole('listbox', { name: /issues/i }).waitFor();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Title contains "haystack"', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('option', { name: /Findable haystack/ })).toBeVisible();
  await expect(page.getByRole('option', { name: /Something else/ })).toHaveCount(0);
});

test('opening a saved view leaves a filter a person can read in the URL', async ({
  page,
  workspace,
}) => {
  await createIssue(workspace, 'Urgent one', 1);
  await createIssue(workspace, 'Quiet one', 4);

  await signIn(page, workspace.account);
  await page.goto(`/team/${workspace.teamKey}`);
  await page.getByRole('listbox', { name: /issues/i }).waitFor();

  await page.getByRole('button', { name: 'Add filter' }).click();
  await page.getByRole('menuitem', { name: /^Priority$/ }).click();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page).toHaveURL(/filter=priority\.eq\(1\)/);

  await page.keyboard.press('Alt+v');
  const dialog = page.getByRole('dialog', { name: /save view/i });
  await dialog.getByLabel('Name').fill('Urgent work');
  await dialog.getByRole('button', { name: 'Save view' }).click();
  await expect(page).toHaveURL(/\/view\/[0-9a-f-]+/);
  const bare = page.url().split('?')[0]!;

  // Arriving at the bare view URL spells the saved filter out — in the grammar, not in
  // percent escapes. This is the link the view's own "Copy link" hands somebody.
  await page.goto(bare);
  await expect(page).toHaveURL(/filter=priority\.eq\(1\)/);
  await expect(page.getByRole('button', { name: 'Priority is Urgent', exact: true })).toBeVisible();
  await expect(page.getByRole('option', { name: /Urgent one/ })).toBeVisible();
  await expect(page.getByRole('option', { name: /Quiet one/ })).toHaveCount(0);
});

const API = process.env.POLARIS_E2E_API ?? 'http://localhost:8088';

/** An issue with a priority, which `createIssueViaApi` does not offer. */
async function createIssue(
  workspace: { account: { accessToken: string }; workspaceId: string; teamId: string },
  title: string,
  priority?: number,
): Promise<void> {
  const res = await fetch(`${API}/graphql`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${workspace.account.accessToken}`,
      'X-Polaris-Workspace': workspace.workspaceId,
    },
    body: JSON.stringify({
      query: 'mutation($i: CreateIssueInput!){ createIssue(input:$i){ issue { id } } }',
      variables: { i: { teamId: workspace.teamId, title, priority } },
    }),
  });
  const body = (await res.json()) as { errors?: { message: string }[] };
  if (body.errors?.length) throw new Error(body.errors.map((e) => e.message).join('; '));
}
