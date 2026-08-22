/**
 * Display options, end to end.
 *
 * Here rather than in a component test because the thing being asserted is precisely the
 * part no component can see: the grouping somebody chose is written to the *server*, so it
 * follows them to another machine, and it comes back through a real bootstrap. A vitest
 * harness that stubbed the store would prove the hook reads a row, which was never in doubt
 * — the bug this covers was that nothing ever wrote one.
 *
 * The precedence is the other half, and it is a product rule rather than an implementation
 * detail: a link somebody pastes into a chat has to open as what the sender was looking at,
 * so anything the URL says outranks anything either party has remembered.
 */

import { test, expect, openTeamList, signIn, createIssueViaApi } from './fixtures';

test('display options are remembered per screen, and a link outranks them', async ({
  page,
  workspace,
}) => {
  await createIssueViaApi(workspace, 'Alpha');
  await createIssueViaApi(workspace, 'Beta');

  await signIn(page, workspace.account);
  await openTeamList(page, workspace.teamKey);

  // `Shift+V` is the documented chord for this menu.
  await page.keyboard.press('Shift+V');
  const panel = page.getByRole('dialog', { name: 'Display options' });
  await expect(panel).toBeVisible();

  await panel.getByLabel('Grouping').selectOption('priority');
  await expect(page).toHaveURL(/group=priority/);
  await page.keyboard.press('Escape');

  // Away and back: the choice is still there, and the address bar says so rather than
  // showing one thing while claiming another.
  await page.goto('/my-issues');
  await page.getByRole('heading', { name: /my issues/i }).waitFor();
  await openTeamList(page, workspace.teamKey);
  await expect(page).toHaveURL(/group=priority/);

  // A different screen is a different decision. My Issues does not inherit it.
  await page.goto('/my-issues');
  await page.getByRole('heading', { name: /my issues/i }).waitFor();
  await expect(page).not.toHaveURL(/group=/);

  // A link that says how it should look wins, whatever the reader has remembered.
  await page.goto(`/team/${workspace.teamKey}?group=assignee`);
  await page.getByRole('listbox', { name: /issues/i }).waitFor();
  await page.keyboard.press('Shift+V');
  await expect(panel.getByLabel('Grouping')).toHaveValue('assignee');
  await page.keyboard.press('Escape');

  // `Cmd/Ctrl+B` toggles the layout, and toggles it back.
  await page.goto(`/team/${workspace.teamKey}`);
  await page.getByRole('listbox', { name: /issues/i }).waitFor();
  await page.keyboard.press('ControlOrMeta+B');
  await expect(page).toHaveURL(/layout=board/);
  await page.keyboard.press('ControlOrMeta+B');
  await expect(page).not.toHaveURL(/layout=board/);

  // Reset forgets the row as well as clearing the URL, or the escape hatch is not one.
  await page.keyboard.press('Shift+V');
  await panel.getByRole('button', { name: 'Reset to default' }).click();
  await page.keyboard.press('Escape');
  await page.goto('/my-issues');
  await page.getByRole('heading', { name: /my issues/i }).waitFor();
  await page.goto(`/team/${workspace.teamKey}`);
  await page.getByRole('listbox', { name: /issues/i }).waitFor();
  await expect(page).not.toHaveURL(/group=/);
});

test('a saved view carries a shared default, and a personal choice outranks it', async ({
  page,
  workspace,
}) => {
  await createIssueViaApi(workspace, 'Gamma');
  await signIn(page, workspace.account);
  await openTeamList(page, workspace.teamKey);

  const panel = page.getByRole('dialog', { name: 'Display options' });

  // A team's issue list has nowhere shared to put a default, so it does not offer one.
  await page.keyboard.press('Shift+V');
  await expect(panel.getByRole('button', { name: 'Set as default' })).toHaveCount(0);
  await page.keyboard.press('Escape');

  await page.goto(`/team/${workspace.teamKey}?filter=priority.in(1,2)`);
  await page.getByRole('listbox', { name: /issues/i }).waitFor();
  await page.getByRole('button', { name: 'Save view' }).click();
  const save = page.getByRole('dialog', { name: /save view/i });
  await save.getByLabel(/name/i).fill('Shared view');
  await save.getByRole('button', { name: /save/i }).click();
  await page.waitForURL(/\/view\//);
  await page.getByRole('heading', { name: 'Shared view' }).waitFor();
  const viewPath = new URL(page.url()).pathname;

  await page.keyboard.press('Shift+V');
  const setDefault = panel.getByRole('button', { name: 'Set as default' });
  await expect(setDefault).toBeDisabled();
  await panel.getByLabel('Grouping').selectOption('assignee');
  await expect(setDefault).toBeEnabled();
  await setDefault.click();
  await expect(setDefault).toBeDisabled();
  await page.keyboard.press('Escape');

  // Opening the bare view starts from what was saved on it.
  await page.goto(viewPath);
  await page.getByRole('heading', { name: 'Shared view' }).waitFor();
  await expect(page).toHaveURL(/group=assignee/);

  // A personal choice on the same view beats the shared default — that is the only thing
  // the word personal can mean.
  await page.keyboard.press('Shift+V');
  await panel.getByLabel('Grouping').selectOption('priority');
  await page.keyboard.press('Escape');
  await page.goto(viewPath);
  await page.getByRole('heading', { name: 'Shared view' }).waitFor();
  await expect(page).toHaveURL(/group=priority/);

  // …including the product's own default, which encodes to nothing and so is the one a
  // naive implementation cannot express.
  await page.keyboard.press('Shift+V');
  await panel.getByLabel('Grouping').selectOption('state');
  await page.keyboard.press('Escape');
  await page.goto(viewPath);
  await page.getByRole('heading', { name: 'Shared view' }).waitFor();
  await expect(page).not.toHaveURL(/group=/);
  await page.keyboard.press('Shift+V');
  await expect(panel.getByLabel('Grouping')).toHaveValue('state');
});

test('every display property can be turned off, and stays off', async ({ page, workspace }) => {
  await createIssueViaApi(workspace, 'Delta');
  await signIn(page, workspace.account);
  await openTeamList(page, workspace.teamKey);

  const panel = page.getByRole('dialog', { name: 'Display options' });
  const properties = ['Priority', 'Assignee', 'Labels', 'Estimate', 'Due date'];

  await page.keyboard.press('Shift+V');
  for (const name of properties) {
    const box = panel.getByLabel(name, { exact: true });
    await box.click();
    await expect(box).not.toBeChecked();
  }

  // The last one is the interesting one: an empty set encodes to `show=`, and reading that
  // back as "nothing was said" put all five properties on again.
  await page.reload();
  await page.getByRole('listbox', { name: /issues/i }).waitFor();
  await page.keyboard.press('Shift+V');
  for (const name of properties) {
    await expect(panel.getByLabel(name, { exact: true })).not.toBeChecked();
  }
});
