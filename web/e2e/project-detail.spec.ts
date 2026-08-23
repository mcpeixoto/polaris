/**
 * The project screen: its status, and the graph that reads it.
 *
 * Two things that only a browser can answer.
 *
 * A project's status is what the rest of the product reads — the graph only draws for a
 * started or completed one — and until it could be set from the sidebar the only way to
 * reach that half of the product was the API. So the first test drives the control the way
 * a person does and then reloads, because a property that is right until you refresh is the
 * failure this suite exists to catch.
 *
 * The second pins the difference between the two empty states the graph has. "No graph yet"
 * asks for an action; "not enough history" says come back tomorrow. Telling a person who
 * has just started a project and filed an issue to start the project and file an issue is
 * the bug.
 */

import { expect, test, signIn } from './fixtures';
import type { Page } from '@playwright/test';

const sidebar = (page: Page) => page.getByRole('complementary', { name: 'Project properties' });

async function createProject(page: Page, name: string): Promise<string> {
  await page.goto('/projects');
  await page.locator('header').getByRole('button', { name: 'New project' }).click();
  await page.getByLabel(/name/i).first().fill(name);
  await page.getByRole('button', { name: /^create/i }).click();
  await expect(page).toHaveURL(/\/project\/[0-9a-f-]{36}$/);
  return page.url().split('/project/')[1]!;
}

test('a project takes a status from the sidebar, and keeps it', async ({ page, workspace }) => {
  await signIn(page, workspace.account);
  const projectId = await createProject(page, 'Status from the sidebar');
  const control = sidebar(page).getByRole('button', { name: 'Set status' });

  await expect(control).toContainText('Backlog');

  await control.click();
  await page.getByRole('menuitem', { name: 'In Progress' }).click();
  await expect(control).toContainText('In Progress');

  await page.reload();
  await expect(sidebar(page).getByRole('button', { name: 'Set status' })).toContainText(
    'In Progress',
  );

  // The sidebar is on every tab of the project, so the property is too.
  await page.goto(`/project/${projectId}/issues`);
  await expect(sidebar(page).getByRole('button', { name: 'Set status' })).toContainText(
    'In Progress',
  );

  // And `S` reaches the same picker, the way `P` and `L` reach priority and labels.
  await page.goto(`/project/${projectId}`);
  await page.getByRole('heading', { name: 'Progress' }).click();
  await page.keyboard.press('s');
  await page.getByRole('menuitem', { name: 'Completed' }).click();
  await expect(sidebar(page).getByRole('button', { name: 'Set status' })).toContainText(
    'Completed',
  );
});

test('a started project with an issue is short of history, not short of a project', async ({
  page,
  workspace,
}) => {
  await signIn(page, workspace.account);
  const projectId = await createProject(page, 'Fresh burnup');

  const noGraph = page.getByText(
    'The graph appears once a project is in progress and has issues filed to it.',
  );
  // Backlog and empty: both of the things that message asks for are genuinely undone.
  await expect(noGraph).toBeVisible();

  await sidebar(page).getByRole('button', { name: 'Set status' }).click();
  await page.getByRole('menuitem', { name: 'In Progress' }).click();
  // Started but still empty — the message is still the honest one.
  await expect(noGraph).toBeVisible();

  await page.goto(`/project/${projectId}/issues`);
  await page.getByText('No issues in this project yet').waitFor();
  await page.keyboard.press('c');
  await page.getByRole('dialog').getByLabel('Title').fill('The first one');
  await page.getByRole('dialog').getByRole('button', { name: 'Create issue' }).click();
  await expect(page.getByRole('option', { name: /The first one/ })).toBeVisible();

  await page.goto(`/project/${projectId}`);
  await expect(noGraph).toHaveCount(0);
  await expect(page.getByText('Not enough history to chart this project yet.')).toBeVisible();
});
