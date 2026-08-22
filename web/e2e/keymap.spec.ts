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

/** Every screen that registers a keymap of its own, and a route that mounts it. */
const SCREENS: [name: string, path: string][] = [
  ['team list', '/team/ENG'],
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
  await createIssueViaApi(workspace, 'Keymap probe');

  const dead: string[] = [];
  for (const [name, path] of SCREENS) {
    await page.goto(path.replace('/ENG', `/${workspace.teamKey}`));
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
  await createIssueViaApi(workspace, 'Help overlay probe');
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

  await page.keyboard.press('Escape');
  await expect(help).toBeHidden();
});
