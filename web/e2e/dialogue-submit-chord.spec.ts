/**
 * `Cmd/Ctrl+Enter` in every dialogue that claims it, with something typed first.
 *
 * Here rather than in a component test because the thing under test only exists in the
 * running application. The keymap registry stores the action object it is handed at mount
 * and dispatches through it for the life of the screen, so a `run` written inline captures
 * the render that wrote it — and the chord goes on submitting the form as it stood when the
 * dialogue opened. Nothing below the browser sees it: the component renders correctly, the
 * mutation is correct, and every unit test of either passes.
 *
 * Its two faces, both represented below. A dialogue with a required field answers "X needs
 * a name" with the name plainly in the field. A dialogue without one saves — and writes the
 * empty first render, which is the same fault losing data instead of announcing itself.
 *
 * `project.create.submit` has its own spec (project-create.spec.ts); this covers the rest.
 */

import { test, expect, signIn, openTeamList, createIssueViaApi } from './fixtures';

test('every create dialogue submits the chord with what was typed', async ({ page, workspace }) => {
  const issue = await createIssueViaApi(workspace, 'Chord target');
  await signIn(page, workspace.account);

  await page.goto('/initiatives');
  await page.getByRole('button', { name: 'New initiative' }).first().click();
  const initiative = page.getByRole('dialog', { name: 'New initiative' });
  await expect(initiative).toBeVisible();
  await initiative.getByLabel('Name').fill('Aurora');
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(initiative).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Aurora', level: 1 })).toBeVisible();

  await page.goto('/customers');
  await page.getByRole('button', { name: 'New customer' }).first().click();
  const customer = page.getByRole('dialog', { name: 'New customer' });
  await expect(customer).toBeVisible();
  await customer.getByLabel('Name').fill('Northwind');
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(customer).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Northwind', level: 1 })).toBeVisible();

  await page.goto('/dashboards');
  await page.getByRole('button', { name: 'New dashboard' }).first().click();
  const dashboard = page.getByRole('dialog', { name: 'New dashboard' });
  await expect(dashboard).toBeVisible();
  await dashboard.getByLabel('Name').fill('Weekly');
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(dashboard).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Weekly', level: 1 })).toBeVisible();

  // The silent half: this dialogue has no required field, so a stale first render saves an
  // empty request rather than complaining. Asserting on the body is what catches it.
  await page.goto(`/issue/${issue.identifier}`);
  await page.getByRole('heading', { name: 'Chord target' }).first().waitFor();
  await page.getByRole('button', { name: 'Add request' }).first().click();
  const request = page.getByRole('dialog', { name: 'New customer request' });
  await expect(request).toBeVisible();
  await request.getByLabel('Request').fill('They want dark mode');
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(request).toBeHidden();
  await expect(
    page.getByRole('region', { name: 'Customers' }).getByText('They want dark mode'),
  ).toBeVisible();

  await openTeamList(page, workspace.teamKey);
  await page.keyboard.press('Alt+v');
  const saveView = page.getByRole('dialog', { name: /save view/i });
  await expect(saveView).toBeVisible();
  await saveView.getByLabel('Name').fill('My bugs');
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(saveView).toBeHidden();
  await expect(page).toHaveURL(/\/view\/[0-9a-f-]{36}$/);

  // And the required field is still required — the chord must not have loosened that.
  await page.goto('/initiatives');
  await page.getByRole('button', { name: 'New initiative' }).first().click();
  await expect(initiative).toBeVisible();
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(initiative.getByText('An initiative needs a name')).toBeVisible();
  await expect(initiative).toBeVisible();
});
