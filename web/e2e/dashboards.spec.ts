/**
 * Dashboards: a page of Insights tiles over the replica.
 *
 * The interesting part is not that a tile renders — a vitest covers the arithmetic — but
 * that a tile's three displays agree with each other over the same live data. They did
 * not: a burn-up whose header read "3 completed issues" and whose table listed the month
 * drew "nothing to chart", because a series with one period was treated as no series at
 * all, and a workspace younger than two months only ever has one.
 */

import { expect, test, signIn, type SeededWorkspace } from './fixtures';
import type { Page } from '@playwright/test';

const API = process.env.POLARIS_E2E_API ?? 'http://localhost:8088';

async function gql<T>(
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
  return body.data as T;
}

const NEW_ISSUE = `mutation ($i: CreateIssueInput!) { createIssue(input: $i) { issue { id } } }`;
const SET_STATE = `mutation ($i: UpdateIssueInput!) { updateIssue(input: $i) { issue { id } } }`;

/** Creates a dashboard through the real dialogue and waits for its two seeded tiles. */
async function createDashboard(page: Page, name: string): Promise<void> {
  await page.goto('/dashboards');
  await page.getByRole('heading', { name: 'Dashboards' }).waitFor();
  await page.getByRole('button', { name: 'New dashboard' }).last().click();
  await page.getByLabel('Name').fill(name);
  await page.getByRole('button', { name: 'Create dashboard' }).click();
  await expect(page.getByRole('article')).toHaveCount(2, { timeout: 20_000 });
}

test('New dashboard opens while the replica is still catching up', async ({ page, workspace }) => {
  await signIn(page, workspace.account);

  // Hold the replica's traffic back, the way a slow connection or a busy machine does on
  // its own. The page renders its create button long before the viewer arrives, and the
  // button reaches the modal through the keymap — so an action registered only once the
  // viewer is known makes the click land on nothing and stay landed on nothing.
  await page.route('**/graphql', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    await route.continue();
  });

  await page.goto('/dashboards');
  const button = page.getByRole('button', { name: 'New dashboard' }).last();
  await button.waitFor();
  await button.click();
  await expect(page.getByLabel('Name')).toBeVisible({ timeout: 20_000 });
});

test('a burn-up tile charts a single period', async ({ page, workspace }) => {
  const ids: string[] = [];
  for (let i = 0; i < 3; i += 1) {
    const created = await gql<{ createIssue: { issue: { id: string } } }>(workspace, NEW_ISSUE, {
      i: { teamId: workspace.teamId, title: `Burn ${i}` },
    });
    ids.push(created.createIssue.issue.id);
  }
  for (const id of ids) {
    await gql(workspace, SET_STATE, { i: { id, stateId: workspace.states.completed!.id } });
  }

  await signIn(page, workspace.account);
  await createDashboard(page, 'Burn-up');

  const tile = page.getByRole('article').first();
  await tile.getByLabel('Measure').selectOption('burn_up');
  await expect(tile.getByLabel('Measure')).toHaveValue('burn_up');
  // Burn-up is a series over time, so it has no slice to pick.
  await expect(tile.getByLabel('Slice')).toHaveCount(0);

  // All three displays are views of the same number, and it is named in the unit the team
  // actually estimates in. This team has no estimate scale, so a burn-up sums 1 per issue
  // and "3 completed" alone would leave the reader to guess whether that meant points.
  await expect(tile.locator('h2 + span')).toHaveText('3 completed issues');

  await tile.getByLabel('Display').selectOption('metric');
  await expect(tile.getByLabel('Display')).toHaveValue('metric');
  await expect(tile.locator('p')).toHaveText('3 completed issues');

  await tile.getByLabel('Display').selectOption('table');
  await expect(tile.getByLabel('Display')).toHaveValue('table');
  await expect(tile.locator('tbody tr')).toHaveCount(1);
  await expect(tile.locator('tbody tr td').nth(1)).toHaveText('3');

  await tile.getByLabel('Display').selectOption('chart');
  await expect(tile.getByLabel('Display')).toHaveValue('chart');
  await expect(tile).not.toContainText('Nothing in this view to chart yet');
  // One filled area, rising from nothing to the month's total.
  await expect(tile.getByRole('img', { name: 'Burn-up by Assignee' }).locator('path')).toHaveCount(
    1,
  );
});

test('a table tile with nothing eligible says so', async ({ page, workspace }) => {
  await gql(workspace, NEW_ISSUE, { i: { teamId: workspace.teamId, title: 'Never finished' } });

  await signIn(page, workspace.account);
  await createDashboard(page, 'Empty');

  const tile = page.getByRole('article').first();
  // Cycle time counts only issues that completed, and nothing here has.
  await tile.getByLabel('Measure').selectOption('cycle_time');
  await expect(tile.getByLabel('Measure')).toHaveValue('cycle_time');
  await tile.getByLabel('Display').selectOption('table');
  await expect(tile.getByLabel('Display')).toHaveValue('table');
  await expect(tile.locator('table')).toHaveCount(0);
  await expect(tile).toContainText('Nothing in this view to list yet');

  // And a burn-up with nothing completed does not render bare headings either.
  await tile.getByLabel('Measure').selectOption('burn_up');
  await expect(tile.getByLabel('Measure')).toHaveValue('burn_up');
  await expect(tile.locator('table')).toHaveCount(0);
  await expect(tile).toContainText('Nothing in this view to list yet');
});

test('tiles count the issues they are given, and follow them', async ({ page, workspace }) => {
  for (let i = 0; i < 3; i += 1) {
    await gql(workspace, NEW_ISSUE, { i: { teamId: workspace.teamId, title: `Counted ${i}` } });
  }

  await signIn(page, workspace.account);
  await createDashboard(page, 'Counts');

  const tile = page.getByRole('article', { name: 'Issues by assignee' });
  await expect(tile.locator('h2 + span')).toHaveText('3 issues');
  await tile.getByLabel('Display').selectOption('table');
  await expect(tile.locator('tbody tr')).toHaveCount(1);
  await expect(tile.locator('tbody tr td').nth(0)).toHaveText('Unassigned');
  await expect(tile.locator('tbody tr td').nth(1)).toHaveText('3');

  // A fourth issue filed elsewhere reaches the open dashboard.
  await gql(workspace, NEW_ISSUE, { i: { teamId: workspace.teamId, title: 'Counted 4' } });
  await expect(tile.locator('tbody tr td').nth(1)).toHaveText('4');
  await expect(tile.locator('h2 + span')).toHaveText('4 issues');

  // And survives a reload.
  await page.reload();
  const reloaded = page.getByRole('article', { name: 'Issues by assignee' });
  await expect(reloaded.locator('h2 + span')).toHaveText('4 issues', { timeout: 20_000 });
  await expect(reloaded.getByLabel('Display')).toHaveValue('table');
});
