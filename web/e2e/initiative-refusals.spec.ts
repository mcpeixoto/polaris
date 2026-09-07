/**
 * What an initiative overview does when the server says no.
 *
 * The Sub-initiatives and Projects sections drive a domain with rules the client does not
 * model — a nest may not close a cycle, and a parent→child chain may not exceed five
 * initiatives. Both are enforced in `domain/initiative_relations.go` and both come back as
 * validation errors with a sentence explaining themselves.
 *
 * Here rather than in a component test because the failure being guarded is what an
 * un-awaited promise does in a browser: `void onNestExisting()` on a handler with no `catch`
 * turns a refusal into an unhandled rejection. The component renders, the mutation is
 * correct, every unit test of either passes — and the person watching sees a control that
 * does nothing at all, with the explanation sitting in a console they never open.
 */

import { test, expect, signIn, type SeededWorkspace } from './fixtures';

const API = process.env.POLARIS_E2E_API ?? 'http://localhost:8088';

async function createInitiative(
  ws: SeededWorkspace,
  name: string,
  parentInitiativeId?: string,
): Promise<string> {
  const res = await fetch(`${API}/graphql`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${ws.account.accessToken}`,
      'X-Polaris-Workspace': ws.workspaceId,
    },
    body: JSON.stringify({
      query: `mutation ($i: CreateInitiativeInput!) {
        createInitiative(input: $i) { initiative { id } }
      }`,
      variables: {
        i: { name, ...(parentInitiativeId === undefined ? {} : { parentInitiativeId }) },
      },
    }),
  });
  const body = (await res.json()) as {
    data?: { createInitiative: { initiative: { id: string } } };
    errors?: { message: string }[];
  };
  if (body.errors?.length) throw new Error(body.errors[0]!.message);
  return body.data!.createInitiative.initiative.id;
}

test('a sixth level of nesting is refused in words, not in the console', async ({
  page,
  workspace,
}) => {
  const rejections: string[] = [];
  page.on('pageerror', (error) => rejections.push(error.message));

  // Five deep already, which is the whole allowance.
  let parent = await createInitiative(workspace, 'Depth 1');
  for (const level of [2, 3, 4, 5]) {
    parent = await createInitiative(workspace, `Depth ${level}`, parent);
  }

  await signIn(page, workspace.account);
  await page.goto(`/initiative/${parent}`);
  await page.getByRole('heading', { name: 'Depth 5', level: 1 }).waitFor();

  await page.getByLabel('New sub-initiative').fill('Depth 6');
  await page.getByRole('button', { name: 'Create nested' }).click();

  await expect(page.getByRole('alert')).toContainText('five levels');
  // And it really was refused, rather than reported and written anyway.
  await expect(page.getByRole('link', { name: 'Depth 6' })).toBeHidden();
  expect(rejections, rejections.join('\n')).toEqual([]);
});

test('a nest that would close a cycle is refused in words', async ({ page, workspace }) => {
  const rejections: string[] = [];
  page.on('pageerror', (error) => rejections.push(error.message));

  const above = await createInitiative(workspace, 'Alpha objective');
  const below = await createInitiative(workspace, 'Beta objective', above);

  await signIn(page, workspace.account);
  await page.goto(`/initiative/${below}`);
  await page.getByRole('heading', { name: 'Beta objective', level: 1 }).waitFor();

  // Nesting the parent under its own child closes the loop.
  await page.getByRole('button', { name: 'Nest an existing initiative' }).click();
  await page.getByRole('menuitem', { name: /Alpha objective/ }).click();

  await expect(page.getByRole('alert')).toContainText('cycle');
  expect(rejections, rejections.join('\n')).toEqual([]);
});

test('a refusal clears once something works', async ({ page, workspace }) => {
  const above = await createInitiative(workspace, 'Alpha objective');
  const below = await createInitiative(workspace, 'Beta objective', above);
  await createInitiative(workspace, 'Spare objective');

  await signIn(page, workspace.account);
  await page.goto(`/initiative/${below}`);
  await page.getByRole('heading', { name: 'Beta objective', level: 1 }).waitFor();

  await page.getByRole('button', { name: 'Nest an existing initiative' }).click();
  await page.getByRole('menuitem', { name: /Alpha objective/ }).click();
  await expect(page.getByRole('alert')).toBeVisible();

  // A nest that is allowed both works and takes the complaint with it.
  await page.getByRole('button', { name: 'Nest an existing initiative' }).click();
  await page.getByRole('menuitem', { name: /Spare objective/ }).click();
  await expect(page.getByRole('link', { name: 'Spare objective' })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

/**
 * The pickers on the same page had the mirror-image fault: they cleared themselves *after*
 * the round trip, so a second choice made while the first add was still in flight was wiped
 * and the button next to it greyed out again. Nothing errors, nothing is logged — the
 * selection simply is not there any more.
 *
 * The `<select>` and its Nest button are one searchable picker now, so the second choice is
 * made by opening the picker again rather than by leaving a selection sitting in a box. The
 * rule under test has not moved: an add made before the previous one has come back has to
 * land, and both have to survive a reload.
 */
test('a nest made while the previous one is in flight still lands', async ({ page, workspace }) => {
  const initiative = await createInitiative(workspace, 'Curated objective');
  await createInitiative(workspace, 'First spare');
  await createInitiative(workspace, 'Second spare');

  await signIn(page, workspace.account);
  await page.goto(`/initiative/${initiative}`);
  await page.getByRole('heading', { name: 'Curated objective', level: 1 }).waitFor();

  const open = () => page.getByRole('button', { name: 'Nest an existing initiative' }).click();

  await open();
  await page.getByRole('menuitem', { name: /First spare/ }).click();
  // Straight on to the next one, without waiting for the first to come back.
  await open();
  await page.getByRole('menuitem', { name: /Second spare/ }).click();

  await expect(page.getByRole('link', { name: 'First spare' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Second spare' })).toBeVisible();

  await page.reload();
  await expect(page.getByRole('link', { name: 'First spare' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Second spare' })).toBeVisible();
});
