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
