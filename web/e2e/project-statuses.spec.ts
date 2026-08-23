/**
 * Settings → Project statuses.
 *
 * Two rules here live in the database and nowhere the browser can see, so they are only
 * provable end to end: the workspace default may only be a Backlog or Planned status
 * (`project_status_default_category_check`), and a status a project is sitting in may not
 * be retired. Both used to reach the user as an opaque "internal error" or as silent loss —
 * `status_id` is NOT NULL and archiving is soft, so retiring a status in use left every
 * project pointing at a row no client can see, rendering as "No status" with nothing on
 * screen to say why and no way back.
 */

import { expect, test, signIn } from './fixtures';

test('the default may only be a Backlog or Planned status', async ({ page, workspace }) => {
  await signIn(page, workspace.account);
  await page.goto('/settings/project-statuses');
  await page.getByRole('heading', { name: 'Project statuses' }).waitFor();

  // The seeded set, and the seeded default.
  for (const name of ['Backlog', 'Planned', 'In Progress', 'Completed', 'Canceled']) {
    await expect(page.getByRole('group', { name: `${name} status` })).toBeVisible();
  }
  await expect(page.getByRole('group', { name: 'Backlog status' })).toContainText('Default');

  // Categories the constraint forbids are not offered the promotion at all.
  for (const name of ['In Progress', 'Completed', 'Canceled']) {
    await expect(
      page.getByRole('group', { name: `${name} status` }).getByRole('button', {
        name: 'Make default',
      }),
    ).toHaveCount(0);
  }

  // One that is allowed works, and the demotion of the old default is real, not just drawn.
  await page
    .getByRole('group', { name: 'Planned status' })
    .getByRole('button', { name: 'Make default' })
    .click();
  await expect(page.getByRole('group', { name: 'Planned status' })).toContainText('Default');
  await page.reload();
  await page.getByRole('heading', { name: 'Project statuses' }).waitFor();
  await expect(page.getByRole('group', { name: 'Planned status' })).toContainText('Default');
  await expect(page.getByRole('group', { name: 'Backlog status' })).toContainText('Make default');
});

test('a status projects are using cannot be retired', async ({ page, workspace }) => {
  await signIn(page, workspace.account);

  await page.goto('/projects');
  await page.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel(/^Name/).fill('Status probe');
  await page.getByRole('button', { name: /^Create/ }).click();
  await page.waitForURL(/\/project\//);

  // A new project lands in the workspace default.
  await page.goto('/projects');
  await expect(page.getByRole('link', { name: /Status probe/ }).first()).toContainText('Backlog');

  await page.goto('/settings/project-statuses');
  await page.getByRole('heading', { name: 'Project statuses' }).waitFor();

  // Promote another one first: the default is refused for its own reason, and this test is
  // about the projects sitting in the status rather than about the default.
  //
  // Waiting for the reply rather than for the badge, because the badge is the optimistic
  // patch and appears before the server has committed anything. Retiring Backlog on the
  // strength of it races the promotion, and the server — still holding Backlog as the
  // default — answers the other refusal entirely.
  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().includes('/graphql') &&
        (response.request().postData() ?? '').includes('UpdateProjectStatus'),
    ),
    page
      .getByRole('group', { name: 'Planned status' })
      .getByRole('button', { name: 'Make default' })
      .click(),
  ]);
  await expect(page.getByRole('group', { name: 'Planned status' })).toContainText('Default');

  await page
    .getByRole('group', { name: 'Backlog status' })
    .getByRole('button', { name: 'Retire Backlog' })
    .click();
  await expect(page.getByRole('alert')).toContainText(/1 projects? still use this status/i);
  await expect(page.getByRole('group', { name: 'Backlog status' })).toBeVisible();

  // The project kept its status.
  await page.goto('/projects');
  await expect(page.getByRole('link', { name: /Status probe/ }).first()).toContainText('Backlog');

  // An empty status still retires.
  await page.goto('/settings/project-statuses');
  await page
    .getByRole('group', { name: 'Canceled status' })
    .getByRole('button', { name: 'Retire Canceled' })
    .click();
  await expect(page.getByRole('group', { name: 'Canceled status' })).toHaveCount(0);
  await page.reload();
  await page.getByRole('heading', { name: 'Project statuses' }).waitFor();
  await expect(page.getByRole('group', { name: 'Canceled status' })).toHaveCount(0);
});
