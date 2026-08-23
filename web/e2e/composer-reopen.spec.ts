/**
 * `C` while the previous issue is still being filed.
 *
 * The composer does not close when its button is clicked — it closes when the create
 * resolves — and somebody filing a run of issues presses `C` inside that window constantly.
 * It is tens of milliseconds against a server on the same machine and several hundred
 * against one over a network, so this only ever looked like "the shortcut works about half
 * the time", which is the hardest kind of report to act on.
 *
 * Two shells of one bug, and the reason this is here rather than in a component test: it is
 * about the order two asynchronous things reach React, so nothing below the browser can see
 * it. The chord reached the shell's `issue.create`, which set the flag that already said the
 * composer was open, and the pending close then landed on top of it — a keystroke that
 * matched, ran, and left no trace. Fixed only at that end, the reverse order takes over: the
 * open arrives after the close and before its commit, and the filer is left looking at the
 * dialog they just submitted, title and all.
 *
 * Ten rounds rather than one, because a single round passes on a fast machine by luck.
 */

import { test, expect, signIn, openTeamList } from './fixtures';

test('C files the next issue while the last one is still in flight', async ({
  page,
  workspace,
}) => {
  await signIn(page, workspace.account);
  await openTeamList(page, workspace.teamKey);

  const composer = page.getByRole('dialog', { name: /new issue/i });
  const title = composer.getByLabel('Title');

  await page.keyboard.press('c');
  await expect(composer).toBeVisible();

  for (let round = 0; round < 10; round++) {
    await title.fill(`Filed ${round}`);
    await composer.getByRole('button', { name: 'Create issue' }).click();
    // No wait between the two: this is the whole point.
    await page.keyboard.press('c');

    // Whichever way the two land, the filer ends up in front of an empty composer — not a
    // closed one, and not the one still holding the title they just submitted.
    await expect(composer).toBeVisible();
    await expect(title).toHaveValue('');
  }

  await page.keyboard.press('Escape');
  await expect(composer).toBeHidden();

  // Every round is a real issue, not a chord that quietly filed nothing.
  await openTeamList(page, workspace.teamKey);
  for (const round of [0, 4, 9]) {
    await expect(page.getByRole('option', { name: new RegExp(`Filed ${round}\\b`) })).toBeVisible();
  }
});

/**
 * The other half of the same rule, and the reason the shell drops a redundant open rather
 * than restarting on every one: a composer that is up already has the floor. Asking for
 * another while half an issue is written must not be answered by throwing that issue away.
 */
test('C in a composer that is already up leaves the draft alone', async ({ page, workspace }) => {
  await signIn(page, workspace.account);
  await openTeamList(page, workspace.teamKey);

  await page.keyboard.press('c');
  const composer = page.getByRole('dialog', { name: /new issue/i });
  await expect(composer).toBeVisible();
  await composer.getByLabel('Title').fill('Half written');

  // Off the text field, or the chord is a letter being typed rather than a shortcut.
  await composer.getByLabel('Priority').focus();
  await page.keyboard.press('c');

  await expect(composer).toBeVisible();
  await expect(composer.getByLabel('Title')).toHaveValue('Half written');
});
