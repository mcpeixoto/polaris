/**
 * Creating a project, from the keyboard.
 *
 * Here rather than in a component test because the thing under test is the registry, and the
 * registry only exists in the running application: `Cmd/Ctrl+Enter` is claimed by an action
 * that the keymap captures **once**, when the dialogue mounts. An action whose `run` closes
 * over the form state rather than reading it through a ref therefore submits the form as it
 * was at that instant — empty — and the chord answers "a project needs a name" while the name
 * sits in the field. Nothing below the browser can see that: the component renders correctly,
 * the mutation is correct, and every unit test of either passes.
 */

import { test, expect, signIn } from './fixtures';

test('the create dialogue submits on Cmd/Ctrl+Enter, with what was typed', async ({
  page,
  workspace,
}) => {
  await signIn(page, workspace.account);

  await page.goto('/projects');
  await page.getByRole('heading', { name: 'Projects', level: 1 }).waitFor();
  await expect(page.getByText('No projects yet')).toBeVisible();

  await page.getByRole('button', { name: 'New project' }).first().click();
  const modal = page.getByRole('dialog', { name: 'New project' });
  await expect(modal).toBeVisible();
  await modal.getByLabel('Name').fill('Aurora launch');
  await modal.getByLabel('Summary').fill('Ship the thing');

  await page.keyboard.press('ControlOrMeta+Enter');

  // The dialogue closes onto the project it just created, rather than complaining about a
  // name that is plainly there.
  await expect(modal).toBeHidden();
  await expect(page).toHaveURL(/\/project\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { name: 'Aurora launch', level: 1 })).toBeVisible();

  // And it is a real write, not an optimistic row that a reload forgets.
  await page.goto('/projects');
  const row = page.getByRole('link', { name: /Aurora launch/ });
  await expect(row).toBeVisible();
  await expect(row).toContainText('Ship the thing');

  // The name is still required — the chord must not have loosened that.
  await page.getByRole('button', { name: 'New project' }).first().click();
  await expect(modal).toBeVisible();
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(modal.getByText('A project needs a name')).toBeVisible();
  await expect(modal).toBeVisible();
});
