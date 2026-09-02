/**
 * Archiving an issue, and the way back.
 *
 * The milestone's own done criterion is a loop: an issue leaves the team, `G X` lists it, and
 * `#` brings it back. It is asserted here rather than in a unit test because every step of it
 * crosses a boundary a unit test stubs — the keymap, the optimistic delete, a page that
 * deliberately reads from the server instead of the replica, and a restore that has to wait
 * for the delta because there is no `before` to hold.
 *
 * The second test is the case that had no route at all. Archiving drops the row from the
 * replica, so a link to an archived issue — a bookmark, a link in a comment, or just the Back
 * button after pressing `E` on the issue's own page — resolved to nothing, and the page said
 * the issue may have been deleted or may belong to a team you are not in. Neither had
 * happened, and the one place that does hold it went unnamed.
 */

import { createIssueViaApi, expect, openTeamList, signIn, test } from './fixtures';

test('E archives an issue, G X finds it, and # brings it back', async ({ page, workspace }) => {
  const gone = await createIssueViaApi(workspace, 'Archived and restored');
  const stays = await createIssueViaApi(workspace, 'Left alone');

  await signIn(page, workspace.account);
  await openTeamList(page, workspace.teamKey);
  await expect(page.getByText('Archived and restored')).toBeVisible();

  // `E` acts on the row under the cursor, which starts on the first row. Read the order
  // rather than assume it — the assertion has to name the row that was actually acted on.
  const rows = await page.getByRole('option').allInnerTexts();
  const first = rows[0]?.includes(gone.identifier) === true ? gone : stays;
  const firstTitle = first === gone ? 'Archived and restored' : 'Left alone';
  const otherTitle = first === gone ? 'Left alone' : 'Archived and restored';

  // Archive is a button on the selection bar now, and it asks first — 02-issues.md:106.
  await page.getByText(firstTitle).click({ modifiers: ['Shift'] });
  await page.getByRole('button', { name: 'Archive', exact: true }).click();
  await page
    .getByRole('dialog', { name: `Archive ${first.identifier}?` })
    .getByRole('button', { name: `Archive ${first.identifier}` })
    .click();

  // Optimistically gone, because the server's change for an archive is a delete and the
  // client matches it.
  await expect(page.getByText(firstTitle)).toBeHidden();
  await expect(page.getByText(otherTitle)).toBeVisible();

  // And really gone: a reload rebuilds the replica from the server.
  await page.reload();
  await page.getByRole('listbox', { name: /issues/i }).waitFor();
  await expect(page.getByText(otherTitle)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(firstTitle)).toBeHidden();

  await page.keyboard.press('g');
  await page.keyboard.press('x');
  await expect(page).toHaveURL(new RegExp(`/team/${workspace.teamKey}/archives$`));

  const row = page.getByRole('rowheader', { name: new RegExp(first.identifier) });
  await expect(row).toBeVisible({ timeout: 20_000 });

  await row.click();
  await page.keyboard.press('#');
  await expect(page.getByText('No archived issues')).toBeVisible({ timeout: 20_000 });

  await openTeamList(page, workspace.teamKey);
  await expect(page.getByText(firstTitle)).toBeVisible({ timeout: 20_000 });
});

test("an archived issue's link points at the archives rather than nowhere", async ({
  page,
  workspace,
}) => {
  const issue = await createIssueViaApi(workspace, 'Reachable after archiving');
  await signIn(page, workspace.account);

  await openTeamList(page, workspace.teamKey);
  await page.getByText('Reachable after archiving').click({ modifiers: ['Shift'] });
  await page.getByRole('button', { name: 'Archive', exact: true }).click();
  await page
    .getByRole('dialog', { name: `Archive ${issue.identifier}?` })
    .getByRole('button', { name: `Archive ${issue.identifier}` })
    .click();
  await expect(page.getByText('Reachable after archiving')).toBeHidden();

  // The link somebody else already has.
  await page.goto(`/issue/${issue.identifier}`);
  await expect(page.getByText('No such issue')).toBeVisible({ timeout: 20_000 });
  await expect(
    page.getByText(new RegExp(`${workspace.teamKey}'s archives is where both end up`)),
  ).toBeVisible();

  await page.getByRole('button', { name: `Open ${workspace.teamKey} archives` }).click();
  await expect(page).toHaveURL(new RegExp(`/team/${workspace.teamKey}/archives$`));
  await expect(page.getByRole('rowheader', { name: new RegExp(issue.identifier) })).toBeVisible({
    timeout: 20_000,
  });
});
