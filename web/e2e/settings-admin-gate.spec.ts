/**
 * Settings is three audiences, and the sidebar has to say which one you are.
 *
 * `AppShell` had one flag, `showAdminSettings`, whose comment described the administration
 * half of Settings and whose value was `notGuest`. So a plain member — not a guest, not an
 * admin — was named every workspace administration page and could open all of them. Driven
 * as a member against a stack built from `main`, `/settings/oauth-apps` gave a page shell, a
 * working-looking "New OAuth app" button, and the alert:
 *
 *     OAuth applications could not be fetched. Only admins can read them.
 *
 * and `/settings/github` gave "GitHub settings could not be fetched." — its query selects a
 * webhook secret behind `ActionGitHubManage`, so a member cannot even reach the screen's own
 * "Ask an admin to enable GitHub" state.
 *
 * Which screens those are is a question for the server and not for the sidebar's layout.
 * `MEMBER_SETTINGS` below is every screen carrying something a non-admin may actually do —
 * `ActionAPIKeyManage` is `!IsGuest`, `exportCap` gives a member 250 issues, restoring from
 * Trash is `CanInTeam(ActionIssueDelete)` i.e. membership, Labels and Templates each have a
 * team scope whose action is membership, and the Members roster is deliberately readable
 * with its admin controls withheld (#108). `ADMIN_SETTINGS` is the rest, where every read
 * and every control answers to `Role.IsAdmin()`.
 *
 * Three real accounts in three real browsers, because that is the only thing that can tell
 * these apart. The unit tests mock `useViewerRole` and will happily hand it a role no real
 * session produces; two fixes to this area were shipped from careful reading and each left
 * a hole behind it.
 */

import type { Page } from '@playwright/test';

import { expect, inviteToWorkspace, signIn, test, uniqueEmail } from './fixtures';

/** Their own account. Every role keeps all of it. */
const OWN_SETTINGS = [
  '/settings/profile',
  '/settings/preferences',
  '/settings/notifications',
  '/settings/sessions',
  '/settings/authorised-apps',
];

/** Settings a member uses, because the server lets them. */
const MEMBER_SETTINGS = [
  '/settings/members',
  '/settings/labels',
  '/settings/templates',
  '/settings/api-keys',
  '/settings/mcp',
  '/settings/asks',
  '/settings/integrations',
  '/settings/export',
  '/settings/trash',
  '/settings/deleted-teams',
];

/** Settings where a non-admin may do nothing and see nothing. */
const ADMIN_SETTINGS = [
  '/settings/workspace',
  '/settings/project-labels',
  '/settings/initiative-labels',
  '/settings/project-statuses',
  '/settings/project-updates',
  '/settings/pulse',
  '/settings/customers',
  '/settings/slas',
  '/settings/oauth-apps',
  '/settings/webhooks',
  '/settings/github',
  '/settings/gitlab',
  '/settings/sentry',
  '/settings/slack',
];

async function join(page: Page, email: string, token: string, name: string): Promise<void> {
  await page.goto(`/invite/${token}`);
  await page.getByLabel(/^email$/i).fill(email);
  await page.getByLabel(/^password$/i).fill('e2e-placeholder-password');
  await page.getByLabel(/your name/i).fill(name);
  await page.getByRole('button', { name: /create account and join/i }).click();
  await expect(page.getByRole('navigation', { name: /workspace/i })).toBeVisible({
    timeout: 30_000,
  });
}

async function expectNav(page: Page, paths: readonly string[], count: 0 | 1): Promise<void> {
  for (const path of paths) {
    await expect(
      page.locator(`nav a[href="${path}"]`),
      count === 0 ? `the sidebar offered ${path}` : `the sidebar withheld ${path}`,
    ).toHaveCount(count);
  }
}

test('an admin keeps the whole of settings', async ({ page, workspace }) => {
  // The account that creates a workspace is its owner, so this is the admin case — the test
  // this replaces called it "a member" and asserted exactly the bug.
  await signIn(page, workspace.account);
  await page.goto('/my-issues');
  await expectNav(page, [...OWN_SETTINGS, ...MEMBER_SETTINGS, ...ADMIN_SETTINGS], 1);

  await page.goto('/settings/webhooks');
  await expect(page.getByRole('heading', { name: 'Webhooks', level: 1 })).toBeVisible();
  await page.goto('/settings/oauth-apps');
  await expect(page.getByRole('heading', { name: 'OAuth apps', level: 1 })).toBeVisible();
  await expect(page.locator('[role="alert"]')).toHaveCount(0);
});

test('a member gets their own settings and none of the administration', async ({
  page,
  browser,
  workspace,
}) => {
  await signIn(page, workspace.account);
  const email = uniqueEmail('admin-gate-member');
  const { token } = await inviteToWorkspace(workspace, email, 'MEMBER');

  const context = await browser.newContext();
  const member = await context.newPage();
  const errors: string[] = [];
  member.on('pageerror', (error) => errors.push(error.message));
  await join(member, email, token, 'Mia Member');

  await expectNav(member, ADMIN_SETTINGS, 0);
  await expectNav(member, [...OWN_SETTINGS, ...MEMBER_SETTINGS], 1);
  // Initiatives are workspace-wide but not administration: a member keeps them.
  await expect(member.locator('nav a[href="/initiatives"]')).toHaveCount(1);

  // Typed in by hand, which is how somebody who saw the entry in a screen share gets here.
  // Each one is answered rather than left rendering a shell over a refused query. Polled,
  // because the guard answers only once the session query has, which is a round trip.
  for (const path of ['/settings/oauth-apps', '/settings/webhooks', '/settings/workspace']) {
    await member.goto(path);
    await expect(
      member.getByText('Only admins can open this'),
      `${path} did not say why it was refused`,
    ).toBeVisible();
    await expect(member.locator('[role="alert"]'), `${path} still ran its query`).toHaveCount(0);
    expect(new URL(member.url()).pathname, `${path} redirected instead of answering`).toBe(path);
  }

  // And the pages a member does own still work, rather than being swept up with the above.
  await member.goto('/settings/api-keys');
  await expect(member.getByRole('button', { name: /new key/i })).toBeVisible();
  await member.goto('/settings/export');
  await expect(member.getByRole('button', { name: /download issues csv/i })).toBeVisible();
  // The roster #108 deliberately left readable, with no controls on it.
  await member.goto('/settings/members');
  await expect(member.getByRole('heading', { name: 'Members', level: 1 })).toBeVisible();
  await expect(member.getByRole('button', { name: /invite people/i })).toHaveCount(0);

  expect(errors, errors.join('\n')).toEqual([]);
  await context.close();
});

test('a guest is sent home from an administration page rather than told about it', async ({
  page,
  browser,
  workspace,
}) => {
  await signIn(page, workspace.account);
  const email = uniqueEmail('admin-gate-guest');
  const { token } = await inviteToWorkspace(workspace, email, 'GUEST');

  const context = await browser.newContext();
  const guest = await context.newPage();
  await join(guest, email, token, 'Grace Guest');

  await expectNav(guest, [...MEMBER_SETTINGS, ...ADMIN_SETTINGS], 0);
  await expectNav(guest, OWN_SETTINGS, 1);

  // A guest has no business knowing the page exists, so they are bounced rather than given
  // the member's explanation — the same refusal every other guest gate here makes.
  for (const path of ['/settings/webhooks', '/settings/workspace']) {
    await guest.goto(path);
    await expect
      .poll(() => new URL(guest.url()).pathname, { message: `a guest was left on ${path}` })
      .not.toBe(path);
    await expect(guest.getByText('Only admins can open this')).toHaveCount(0);
  }

  await context.close();
});
