/**
 * The keymap registry, from the browser.
 *
 * Every conflict this file guards against is a *registration* error, which is why it is an
 * e2e test and not a unit one: the registry already proves in vitest that it refuses two
 * actions on one key, and the screens already prove in vitest that they register what they
 * mean to. What neither can see is the combination — the shell's keymap and a screen's
 * keymap alive in one registry at one moment — and that is the only place the failure lives.
 *
 * It is also the failure with the worst shape. `registerAll` rolls a feature back when any of
 * it is refused, and the throw escapes a passive effect, so React tears the tree down: the
 * screen renders as a blank white page, and reloading it — or arriving from a bookmark, or
 * from a link — blanks it again. Three screens have shipped in that state (the board, the
 * inbox, Pulse), each because a screen-level action was registered into `global` or claimed a
 * key an outer context already held. Nothing below the browser could see any of them.
 *
 * So this file walks the screens that register a keymap and asks each one the cheapest
 * possible question: does the shell still answer ⌘K, and did anything throw.
 */

import { test, expect, signIn, createIssueViaApi } from './fixtures';
import type { Page } from '@playwright/test';

/**
 * Every screen that registers a keymap of its own, and a route that mounts it.
 *
 * `ISSUE` is substituted for the identifier of an issue the test creates, the same way
 * `/ENG` is substituted for the team key: the detail screen is the densest keymap in the
 * product — the shell's, the screen's own, and one from each of the three panels that own an
 * inline form — so it is exactly where a collision would land, and it was not covered here.
 */
const SCREENS: [name: string, path: string][] = [
  ['team list', '/team/ENG'],
  ['issue detail', '/issue/ISSUE'],
  ['inbox', '/inbox'],
  ['pulse', '/pulse'],
  ['my issues', '/my-issues'],
  ['drafts', '/drafts'],
  ['search', '/search'],
  ['projects', '/projects'],
];

function collectPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

/**
 * ⌘K is the shell's keymap in one keystroke: if it answers, `registerAll` survived.
 *
 * `ControlOrMeta` rather than `Meta`, because `Mod` in a key spec resolves to ⌘ only on
 * Apple hardware and to Ctrl everywhere else — see matcher.ts. Pressing `Meta+k` on Linux
 * therefore answers nothing at all, and this test read that as every screen being dead.
 */
async function commandMenuOpens(page: Page): Promise<boolean> {
  const menu = page.getByRole('dialog', { name: /command menu/i });
  await page.keyboard.press('ControlOrMeta+k');
  try {
    await expect(menu).toBeVisible({ timeout: 3000 });
  } catch {
    return false;
  }
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  return true;
}

test('no screen takes the global keymap down with it', async ({ page, workspace }) => {
  const errors = collectPageErrors(page);
  await signIn(page, workspace.account);
  const probe = await createIssueViaApi(workspace, 'Keymap probe');

  const dead: string[] = [];
  for (const [name, path] of SCREENS) {
    await page.goto(
      path.replace('/ENG', `/${workspace.teamKey}`).replace('ISSUE', probe.identifier),
    );
    await page.getByRole('navigation', { name: /workspace/i }).waitFor();
    // The route's own effects have to have run before the shortcut is asked for; the shell
    // re-registers on navigation and the screen registers on mount, and it is precisely that
    // pair that used to collide.
    await expect
      .poll(() => page.evaluate(() => document.readyState), { timeout: 10_000 })
      .toBe('complete');
    if (!(await commandMenuOpens(page))) dead.push(name);
  }

  expect(dead, `the command menu stopped answering on: ${dead.join(', ')}`).toEqual([]);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('G chords still navigate from the inbox and from pulse', async ({ page, workspace }) => {
  const errors = collectPageErrors(page);
  await signIn(page, workspace.account);

  for (const from of ['/inbox', '/pulse']) {
    await page.goto(from);
    await page.getByRole('navigation', { name: /workspace/i }).waitFor();
    await page.keyboard.press('g');
    await page.keyboard.press('m');
    await expect(page, `g m from ${from}`).toHaveURL(/\/my-issues$/, { timeout: 5000 });
  }

  expect(errors, errors.join('\n')).toEqual([]);
});

test('the help overlay lists the shortcuts that are hidden from the command menu', async ({
  page,
  workspace,
}) => {
  await signIn(page, workspace.account);
  const issue = await createIssueViaApi(workspace, 'Help overlay probe');
  await page.goto(`/team/${workspace.teamKey}`);
  await page.getByRole('listbox', { name: /issues/i }).waitFor();

  await page.keyboard.press('?');
  const help = page.getByRole('dialog', { name: /keyboard shortcuts/i });
  await expect(help).toBeVisible();

  // `hidden` is about the command menu's search results, not about keeping a key secret, so
  // the reference sheet has to show the ones people most need looked up.
  await expect(help.getByText('Move down', { exact: true })).toBeVisible();
  await expect(help.getByText('Move up', { exact: true })).toBeVisible();
  await expect(help.getByText('Dismiss', { exact: true })).toBeVisible();

  // The other half of that bargain: everything registered is listed, so nothing may be
  // registered that cannot run. A new team does not estimate, so `⇧E` is not bound on either
  // screen — and this sheet is the only place a permanently-disabled binding is visible.
  await expect(help.getByText('Set estimate', { exact: true })).toHaveCount(0);

  await page.keyboard.press('Escape');
  await expect(help).toBeHidden();

  await page.goto(`/issue/${issue.identifier}`);
  await page.getByRole('heading', { name: new RegExp(issue.identifier) }).waitFor();
  await page.keyboard.press('?');
  await expect(help).toBeVisible();
  await expect(help.getByText('Set estimate', { exact: true })).toHaveCount(0);
});

/**
 * The relation and sub-issue chords the documentation promises.
 *
 * `M`+`R`/`B`/`X` and `Cmd/Ctrl+Shift+O` are in 03-issue-properties.md:98, 02-issues.md:18
 * and the shortcut reference in 19-clients-sync-preferences.md:96, and every one of them was
 * bound to nothing: linking two issues, or breaking one down, could only be done by finding a
 * button with a mouse. This is here rather than in vitest for the reason at the top of the
 * file — the question is whether these bindings survive alongside the shell's and the
 * screen's in one live registry, which is a thing only a browser can answer.
 */
test('the relation and sub-issue chords open their forms', async ({ page, workspace }) => {
  const errors = collectPageErrors(page);
  await signIn(page, workspace.account);

  const issue = await createIssueViaApi(workspace, 'Keyboard relations probe');
  const other = await createIssueViaApi(workspace, 'Keyboard relations target');

  await page.goto(`/issue/${issue.identifier}`);
  const subs = page.getByRole('region', { name: 'Sub-issues' });
  const links = page.getByRole('region', { name: 'Linked issues' });
  await subs.waitFor();
  await expect.poll(() => page.evaluate(() => document.readyState)).toBe('complete');

  await page.keyboard.press('ControlOrMeta+Shift+o');
  await expect(subs.getByPlaceholder('Sub-issue title…')).toBeFocused();
  await page.keyboard.type('Child from the keyboard');
  await page.keyboard.press('Enter');
  await expect(subs.getByText('Child from the keyboard', { exact: true })).toBeVisible();

  // The sub-issue form stays open for the next child with the caret still in it, so leave the
  // text field before pressing a bare letter — that is the keymap's rule for every one-letter
  // action in the product, not something special to this panel.
  await subs.getByRole('button', { name: 'Cancel' }).click();

  for (const [chord, value] of [
    ['b', 'blockedBy'],
    ['x', 'blocking'],
    ['r', 'related'],
  ] as const) {
    await page.keyboard.press('m');
    await page.keyboard.press(chord);
    await expect(links.getByLabel('Link type')).toHaveValue(value);
    await expect(links.getByLabel('Search issues')).toBeFocused();
    if (chord !== 'r') await links.getByRole('button', { name: 'Cancel' }).click();
  }

  // Related is still selected: finish the link and check the row lands under that heading.
  await page.keyboard.type('target');
  await links
    .getByRole('button', { name: new RegExp(other.identifier) })
    .first()
    .click();
  await expect(links.getByRole('heading', { name: 'Related', exact: true })).toBeVisible();

  // All four addable kinds are in the command menu too, including the duplicate one, which
  // has no chord: the documented `MM` is a triage gesture, not a detail-screen one.
  await page.keyboard.press('ControlOrMeta+k');
  const menu = page.getByRole('dialog', { name: /command menu/i });
  await menu.getByLabel('Search commands').fill('> mark as');
  for (const label of [
    'Mark as blocked by…',
    'Mark as blocking…',
    'Mark as related to…',
    'Mark as duplicate of…',
  ]) {
    await expect(menu.getByRole('option', { name: new RegExp(label) })).toBeVisible();
  }
  await page.keyboard.press('Escape');

  expect(errors, errors.join('\n')).toEqual([]);
});
