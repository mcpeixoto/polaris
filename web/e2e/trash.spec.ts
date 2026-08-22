/**
 * Deleting an issue, and the two ways back.
 *
 * The trash screen shipped with a thirty-day retention notice, a Restore button and no
 * producer: `deleteIssues` had no call site anywhere in the client, so nothing a user could
 * do put an issue in it. That is the shape of hole a unit test cannot find — every piece
 * worked, and no screen joined them — so it is asserted here, from the outside, as the loop a
 * person actually makes.
 *
 * Both recovery routes are covered because they are different code paths: the toast holds a
 * closure over `restoreIssue` and has to outlive the navigation away from the deleted issue's
 * own page, while the trash screen re-reads the deleted list from the server.
 *
 * The bulk case is here for the same reason as the single one: `deleteIssues` has always taken
 * a list, docs/01-features/02-issues.md has always said delete is a bulk action reachable from
 * a list by `Cmd/Ctrl+Delete`, and until this test there was no call site that passed it more
 * than one id — so "deleted three, undid three" was a path nothing had ever run.
 */

import { createIssueViaApi, expect, openTeamList, signIn, test } from './fixtures';

test.describe('deleting an issue', () => {
  test('the undo toast puts it straight back', async ({ page, workspace }) => {
    const issue = await createIssueViaApi(workspace, 'Deleted then undone');
    await signIn(page, workspace.account);

    await page.goto(`/issue/${issue.identifier}`);
    await page.getByRole('button', { name: 'Delete', exact: true }).click();

    const confirm = page.getByRole('dialog', { name: `Delete ${issue.identifier}?` });
    await expect(confirm).toBeVisible();
    // The consequence is the reason this dialogue exists: "are you sure" is a question
    // nobody can answer.
    await expect(confirm).toContainText('restored from Trash for the next 30 days');
    await confirm.getByRole('button', { name: `Delete ${issue.identifier}` }).click();

    // Off the issue's own page, because the row has left the replica and staying would show
    // a "no such issue" page the user caused.
    await expect(page).toHaveURL(new RegExp(`/team/${workspace.teamKey}$`));
    await expect(page.getByText('Deleted then undone')).toBeHidden();

    await page.getByRole('button', { name: 'Undo', exact: true }).click();

    await expect(page.getByText('Deleted then undone')).toBeVisible({ timeout: 15_000 });
    // And really back, not only back on this screen: a reload rebuilds from the server.
    await page.reload();
    await expect(page.getByText('Deleted then undone')).toBeVisible({ timeout: 20_000 });
  });

  test('the trash lists it and restores it', async ({ page, workspace }) => {
    const issue = await createIssueViaApi(workspace, 'Deleted then restored');
    await signIn(page, workspace.account);

    await page.goto(`/issue/${issue.identifier}`);
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: `Delete ${issue.identifier}` })
      .click();
    await expect(page).toHaveURL(new RegExp(`/team/${workspace.teamKey}$`));

    // Through the sidebar rather than `page.goto`, because that is what a person does and
    // because a hard navigation here would be testing something else. `SyncEngine.mutate`
    // persists the op to IndexedDB *asynchronously* after the optimistic patch, so a document
    // teardown inside that window takes the intent with it — see the note in the report; a
    // `goto` issued in the same tick as the click loses the delete outright.
    await page.getByRole('link', { name: 'Trash', exact: true }).click();
    await expect(page.getByRole('rowheader', { name: /Deleted then restored/ })).toBeVisible({
      timeout: 20_000,
    });

    await page.getByRole('button', { name: `Restore ${issue.identifier}` }).click();
    await expect(page.getByText('Nothing has been deleted')).toBeVisible({ timeout: 20_000 });

    await openTeamList(page, workspace.teamKey);
    await expect(page.getByText('Deleted then restored')).toBeVisible({ timeout: 20_000 });
  });
});

test.describe('deleting from a list', () => {
  test('a selection goes together and comes back together', async ({ page, workspace }) => {
    for (const title of ['Bulk alpha', 'Bulk beta', 'Bulk gamma']) {
      await createIssueViaApi(workspace, title);
    }
    await signIn(page, workspace.account);
    await openTeamList(page, workspace.teamKey);

    // Shift-click selects the row it lands on and puts the cursor there; `X` extends.
    await page.getByText('Bulk alpha').click({ modifiers: ['Shift'] });
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('x');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('x');
    await expect(page.getByText('3 selected')).toBeVisible();

    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    const confirm = page.getByRole('dialog', { name: 'Delete 3 issues?' });
    await expect(confirm).toBeVisible();
    // The count is the thing worth checking before pressing the button, so it is in the
    // question, in the consequence and on the button.
    await expect(confirm).toContainText('restored from Trash for the next 30 days');
    await confirm.getByRole('button', { name: 'Delete 3 issues' }).click();

    await expect(page.getByText('Bulk alpha')).toBeHidden();
    await expect(page.getByText('Bulk gamma')).toBeHidden();
    await expect(page.getByRole('status').getByText('Deleted 3 issues')).toBeVisible();

    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    for (const title of ['Bulk alpha', 'Bulk beta', 'Bulk gamma']) {
      await expect(page.getByText(title)).toBeVisible({ timeout: 20_000 });
    }

    // And really back: a reload rebuilds from the server rather than from this replica.
    await page.reload();
    await expect(page.getByText('Bulk alpha')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('Bulk gamma')).toBeVisible();
  });

  test('the documented chord opens the dialogue, and the trash says who and when', async ({
    page,
    workspace,
  }) => {
    const issue = await createIssueViaApi(workspace, 'Chord deleted');
    await signIn(page, workspace.account);
    await openTeamList(page, workspace.teamKey);

    await page.getByText('Chord deleted').click({ modifiers: ['Shift'] });
    // `Cmd/Ctrl+Delete` in docs/01-features/02-issues.md; the key labelled Delete on an Apple
    // keyboard reports as Backspace, which is what a Mac CI runner and a Linux one disagree
    // about if only one of the two is bound.
    await page.keyboard.press('ControlOrMeta+Backspace');
    const confirm = page.getByRole('dialog', { name: `Delete ${issue.identifier}?` });
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: `Delete ${issue.identifier}` }).click();
    await expect(page.getByText('Chord deleted')).toBeHidden();

    await page.getByRole('link', { name: 'Trash', exact: true }).click();
    const row = page.getByRole('row').filter({ hasText: 'Chord deleted' });
    await expect(row).toBeVisible({ timeout: 20_000 });
    // Who put it here and when, both of which the screen used to say it could not know.
    await expect(page.getByRole('columnheader', { name: 'Deleted by' })).toBeVisible();
    await expect(row).toContainText(/Deleted /);
  });
});
