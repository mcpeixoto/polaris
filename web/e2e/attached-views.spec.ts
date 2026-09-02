/**
 * Project-attached views, end to end.
 *
 * Here rather than in a component test because the whole feature is the browser: the tabs
 * are a route, the order is a fractional key the server allocates, and the filter is the
 * address bar. A harness that stubbed the store would prove the components render, which was
 * never in doubt.
 *
 * The second test is the regression this file was opened for. A saved view seeds its filter
 * into the URL on arrival, and the guard for "should I seed" used to be "does the URL
 * mention a filter" — which is also true the instant somebody clears the filter bar. So the
 * last chip removed came straight back, and `Remove filter` and `Clear the filter` were
 * controls that undid themselves. It only showed on the *last* clause, because removing one
 * of two leaves the parameter in place, which is what made it look like a rendering glitch
 * rather than a rule.
 */

import type { Locator, Page } from '@playwright/test';

import { test, expect, signIn, type SeededWorkspace } from './fixtures';

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
  if (!body.data) throw new Error('no data');
  return body.data;
}

async function createProject(ws: SeededWorkspace, name: string): Promise<string> {
  const data = await gql<{ createProject: { project: { id: string } } }>(
    ws,
    `mutation ($i: CreateProjectInput!) { createProject(input: $i) { project { id } } }`,
    { i: { name, teamIds: [ws.teamId] } },
  );
  return data.createProject.project.id;
}

/**
 * A tab whose row carries a real saved filter.
 *
 * Over the API rather than through the `+`, which creates a view filtered to everything —
 * the filter of an attached tab is the reader's, held in the URL. This is the other way a
 * row gets one: a colleague's client, an integration, a template.
 */
async function createAttachedView(
  ws: SeededWorkspace,
  projectId: string,
  name: string,
  filter: unknown,
): Promise<string> {
  const data = await gql<{ createView: { view: { id: string } } }>(
    ws,
    `mutation ($i: CreateViewInput!) { createView(input: $i) { view { id } } }`,
    { i: { name, projectId, filter } },
  );
  return data.createView.view.id;
}

async function createIssue(ws: SeededWorkspace, input: Record<string, unknown>): Promise<void> {
  await gql(ws, `mutation ($i: CreateIssueInput!) { createIssue(input: $i) { issue { id } } }`, {
    i: { teamId: ws.teamId, ...input },
  });
}

/**
 * Right-clicks a tab and waits for its menu to settle.
 *
 * Settling matters: a delta landing on the tab strip re-renders the trigger, and a click
 * dispatched into the frame that happens in lands on a node already detached. Waiting for
 * the menu to be visible first is the difference between a test that describes the product
 * and one that describes this machine's load.
 */
async function openTabMenu(page: Page, tabs: Locator, name: string): Promise<void> {
  await tabs.getByRole('link', { name, exact: true }).click({ button: 'right' });
  await expect(page.getByRole('menu', { name: 'View options' })).toBeVisible();
}

test('a project carries saved views as tabs, created, reordered and deleted in place', async ({
  page,
  workspace,
}) => {
  const projectId = await createProject(workspace, 'Rollout');
  await createIssue(workspace, { title: 'In the project', projectId });
  await createIssue(workspace, { title: 'Somewhere else' });

  await signIn(page, workspace.account);
  await page.goto(`/project/${projectId}`);
  await page.getByRole('heading', { name: 'Rollout' }).waitFor();

  const tabs = page.getByRole('navigation', { name: 'Project sections' });

  // The `+` beside Issues names a view and lands on it.
  for (const name of ['Alpha', 'Beta']) {
    await page.getByRole('button', { name: 'New view' }).click();
    const dialog = page.getByRole('dialog', { name: 'New view' });
    await dialog.getByPlaceholder('View name').fill(name);
    await dialog.getByRole('button', { name: 'Create' }).click();
    await page.waitForURL(new RegExp(`/project/${projectId}/view/`));
    await expect(tabs.getByRole('link', { name, exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await page.goto(`/project/${projectId}`);
    await page.getByRole('heading', { name: 'Rollout' }).waitFor();
  }

  // The corpus is the project's issues and nothing else.
  await tabs.getByRole('link', { name: 'Alpha', exact: true }).click();
  await page.getByRole('listbox', { name: /issues/i }).waitFor();
  await expect(page.getByRole('option', { name: /In the project/ })).toBeVisible();
  await expect(page.getByRole('option', { name: /Somewhere else/ })).toHaveCount(0);

  // Dragging a tab onto another puts it after it, and the order is the server's rather than
  // this tab's — so a reload that rebuilds the replica still shows it.
  await tabs
    .getByRole('link', { name: 'Alpha', exact: true })
    .dragTo(tabs.getByRole('link', { name: 'Beta', exact: true }));
  await expect(tabs.getByRole('link')).toHaveText([
    'Overview',
    'Issues',
    'Beta',
    'Alpha',
    'Activity',
  ]);
  await page.reload();
  await expect(tabs.getByRole('link')).toHaveText([
    'Overview',
    'Issues',
    'Beta',
    'Alpha',
    'Activity',
  ]);

  // Renaming moves the tab, and the new name is the server's rather than this tab's.
  await openTabMenu(page, tabs, 'Beta');
  await page.getByRole('menuitem', { name: 'Rename' }).click();
  const rename = page.getByRole('dialog', { name: 'Rename view' });
  await rename.getByLabel('View name').fill('Bravo');
  await rename.getByRole('button', { name: 'Rename view' }).click();
  await expect(tabs.getByRole('link', { name: 'Bravo', exact: true })).toBeVisible();
  await page.reload();
  await expect(tabs.getByRole('link', { name: 'Bravo', exact: true })).toBeVisible();

  // Deleting returns to the Issues tab rather than leaving a route with no row behind it.
  await openTabMenu(page, tabs, 'Alpha');
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await page
    .getByRole('dialog', { name: 'Delete Alpha?' })
    .getByRole('button', { name: 'Delete view' })
    .click();
  await expect(page).toHaveURL(new RegExp(`/project/${projectId}/issues`));
  await page.reload();
  await expect(tabs.getByRole('link')).toHaveText(['Overview', 'Issues', 'Bravo', 'Activity']);
});

test('a saved view seeds its filter once, so the bar can still be cleared', async ({
  page,
  workspace,
}) => {
  const projectId = await createProject(workspace, 'Triage board');
  await createIssue(workspace, { title: 'Urgent thing', projectId, priority: 1 });
  await createIssue(workspace, { title: 'Low thing', projectId, priority: 4 });

  const viewId = await createAttachedView(workspace, projectId, 'Urgent', {
    field: 'priority',
    op: 'eq',
    values: ['1'],
  });

  await signIn(page, workspace.account);
  await page.goto(`/project/${projectId}/view/${viewId}`);
  await page.getByRole('listbox', { name: /issues/i }).waitFor();

  // Arriving with a bare URL spells the saved filter out, so the link is shareable.
  await expect(page).toHaveURL(/filter=priority\.eq\(1\)/);
  await expect(page.getByRole('option', { name: /Low thing/ })).toHaveCount(0);

  // Taking the last chip off widens the view and stays that way.
  await page.getByRole('button', { name: /^Remove filter:/ }).click();
  await expect(page.getByRole('option', { name: /Low thing/ })).toBeVisible();
  await expect(page).not.toHaveURL(/filter=/);

  // A reload is a fresh arrival, and starts from the saved filter again.
  await page.reload();
  await page.getByRole('listbox', { name: /issues/i }).waitFor();
  await expect(page).toHaveURL(/filter=priority\.eq\(1\)/);

  // Two things write to the address bar on arrival — this seeding, and `useView` putting
  // the reader's remembered display options there — and neither may land on top of the
  // other. A cold arrival has to end up carrying both.
  await page.keyboard.press('Shift+V');
  const panel = page.getByRole('dialog', { name: 'Display options' });
  await panel.getByLabel('Grouping').selectOption('priority');
  await page.keyboard.press('Escape');

  await page.goto(`/project/${projectId}/view/${viewId}`);
  await page.getByRole('listbox', { name: /issues/i }).waitFor();
  await expect(page).toHaveURL(/filter=priority\.eq\(1\)/);
  await expect(page).toHaveURL(/group=priority/);
});
