/**
 * A guest is team-scoped, and the sidebar has to say so.
 *
 * `docs/01-features/17-admin-security-permissions.md` is explicit: a guest sees no
 * workspace-wide surfaces and reaches no settings beyond their own account. What was on
 * screen was the whole of both — Initiatives, and every Administration tab down to
 * Members, API keys, OAuth apps, Webhooks, Export and Trash — because those entries had no
 * role gate at all, while the three that did (Pulse, Customers, Dashboards) asked the
 * wrong oracle and were fixed one at a time.
 *
 * The oracle is the point. `useViewer()` reads the profile out of the replica and a
 * guest's replica carries no `user` rows — the directory is workspace-scoped and `sync.go`
 * does not hand it to guests — so for exactly the person a role check exists to exclude,
 * the profile is permanently null. `useViewerRole()` answers from the session query, which
 * answers for everybody. Only a real guest in a real browser can tell the two apart: the
 * unit tests mock the hook and can hand it a guest profile that no real guest has.
 */

import type { Page } from '@playwright/test';

import { expect, inviteToWorkspace, signIn, test, uniqueEmail } from './fixtures';

/** Settings a guest must not be offered, and must not reach by typing the address. */
const ADMIN_SETTINGS = [
  '/settings/workspace',
  '/settings/members',
  '/settings/labels',
  '/settings/project-labels',
  '/settings/initiative-labels',
  '/settings/project-statuses',
  '/settings/project-updates',
  '/settings/pulse',
  '/settings/customers',
  '/settings/slas',
  '/settings/templates',
  '/settings/api-keys',
  '/settings/mcp',
  '/settings/asks',
  '/settings/oauth-apps',
  '/settings/integrations',
  '/settings/webhooks',
  '/settings/github',
  '/settings/gitlab',
  '/settings/sentry',
  '/settings/slack',
  '/settings/export',
  '/settings/trash',
  '/settings/deleted-teams',
];

/** Their own account, which they keep. */
const OWN_SETTINGS = [
  '/settings/profile',
  '/settings/preferences',
  '/settings/notifications',
  '/settings/sessions',
  '/settings/authorised-apps',
];

async function joinAsGuest(page: Page, email: string, token: string): Promise<void> {
  await page.goto(`/invite/${token}`);
  await page.getByLabel(/^email$/i).fill(email);
  await page.getByLabel(/^password$/i).fill('e2e-placeholder-password');
  await page.getByLabel(/your name/i).fill('Grace Guest');
  await page.getByRole('button', { name: /create account and join/i }).click();
  await expect(page.getByRole('navigation', { name: /workspace/i })).toBeVisible({
    timeout: 30_000,
  });
}

test('a guest gets neither the administration nav nor the pages behind it', async ({
  page,
  browser,
  workspace,
}) => {
  await signIn(page, workspace.account);

  const email = uniqueEmail('settings-guest');
  const { token } = await inviteToWorkspace(workspace, email, 'GUEST');
  const guestContext = await browser.newContext();
  const guest = await guestContext.newPage();
  const errors: string[] = [];
  guest.on('pageerror', (error) => errors.push(error.message));
  await joinAsGuest(guest, email, token);

  for (const path of ADMIN_SETTINGS) {
    await expect(
      guest.locator(`nav a[href="${path}"]`),
      `the sidebar offered a guest ${path}`,
    ).toHaveCount(0);
  }
  await expect(
    guest.locator('nav a[href="/initiatives"]'),
    'the sidebar offered a guest Initiatives',
  ).toHaveCount(0);

  // Their own account survives — a guest who cannot reach their own profile is locked out
  // of changing their name or signing another device out.
  for (const path of OWN_SETTINGS) {
    await expect(
      guest.locator(`nav a[href="${path}"]`),
      `the sidebar withheld a guest's own ${path}`,
    ).toHaveCount(1);
  }

  // Two of the addresses typed in by hand, which is how somebody shown a link once gets
  // back. Polled rather than read once: the guard sends the guest away only after the
  // session query answers, which is a round trip and wider on a loaded CI runner.
  for (const path of ['/settings/members', '/settings/webhooks', '/initiatives']) {
    await guest.goto(path);
    await expect
      .poll(() => new URL(guest.url()).pathname, { message: `a guest was left on ${path}` })
      .not.toBe(path);
  }

  // And their own page still renders rather than bouncing them home.
  //
  // It rendered nothing at all: ProfileSettings returns `null` while `useViewer()` is
  // null, and for a guest that is the whole session — so the one settings page the docs
  // guarantee them was a blank screen, and with it the only way out of a workspace, since
  // `leaveWorkspace()` has exactly this one call site. `useViewer` now falls back to the
  // profile the session query already carries.
  await guest.goto('/settings/profile');
  await expect(guest.getByRole('heading', { name: 'Profile', level: 1 })).toBeVisible();
  await expect(
    guest.getByRole('button', { name: /^leave /i }),
    'a guest had no way out of the workspace',
  ).toBeVisible();
  await expect(guest.getByLabel(/display name/i)).toHaveValue('Grace Guest');

  expect(errors, errors.join('\n')).toEqual([]);
  await guestContext.close();
});

/**
 * The other half of the same gate: what a guest loses, an admin keeps.
 *
 * This was called "a member still gets the whole of settings" and signed in as
 * `workspace.account` — the account that created the workspace, and therefore its owner. It
 * was asserting the bug: `showAdminSettings` was `notGuest`, so a real member did get the
 * whole of settings, and nothing here would have noticed. What a member gets and does not is
 * now `settings-admin-gate.spec.ts`, driven as an actual invited member.
 */
test('an admin still gets the whole of settings', async ({ page, workspace }) => {
  await signIn(page, workspace.account);
  await page.goto('/my-issues');
  for (const path of [...ADMIN_SETTINGS, ...OWN_SETTINGS]) {
    await expect(page.locator(`nav a[href="${path}"]`), `${path} went missing`).toHaveCount(1);
  }
  await expect(page.locator('nav a[href="/initiatives"]')).toHaveCount(1);

  await page.goto('/settings/webhooks');
  await expect(page.getByRole('heading', { name: 'Webhooks', level: 1 })).toBeVisible();
  await page.goto('/settings/export');
  await expect(page.getByRole('button', { name: /download issues csv/i })).toBeVisible();
});

/**
 * The export page read `useViewer()?.role ?? 'member'` and returned a loading state while
 * the profile was null — which for a guest is forever. The screen sat on "Loading export"
 * for the whole session instead of ever saying why there was nothing to press.
 */
test('a guest reaching export by URL is told why, not left loading', async ({
  page,
  browser,
  workspace,
}) => {
  await signIn(page, workspace.account);
  const email = uniqueEmail('export-guest');
  const { token } = await inviteToWorkspace(workspace, email, 'GUEST');
  const guestContext = await browser.newContext();
  const guest = await guestContext.newPage();
  await joinAsGuest(guest, email, token);

  await guest.goto('/settings/export');
  await expect
    .poll(() => new URL(guest.url()).pathname, { message: 'a guest was left on the export page' })
    .not.toBe('/settings/export');
  await expect(guest.getByText('Loading export')).toHaveCount(0);
  await guestContext.close();
});
