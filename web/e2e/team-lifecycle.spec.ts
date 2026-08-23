/**
 * Team settings and the team lifecycle, driven the way a person drives them.
 *
 * Three things here were doors onto walls, and each is asserted on twice: once that the
 * screen offers the right thing, and once that the offer survives the round trip.
 *
 * 1. Changing a team's key moves the screen. The route is keyed by the key, the patch is
 *    optimistic, and without a redirect the save replaced itself with "No such team".
 * 2. A retired team's settings say they are read-only. The parent-team section sat outside
 *    the fieldset that enforced it, so "Save parent" was live and the refusal arrived from
 *    the server as the sentence the server tells itself.
 * 3. A retired team's home offered "New issue". The composer drops retired teams, so the
 *    press filed into a different team than the page it was pressed on.
 */

import { expect, signIn, test, type SeededWorkspace } from './fixtures';
import type { Page } from '@playwright/test';

const API = process.env.POLARIS_E2E_API ?? 'http://localhost:8088';

async function gql<T>(
  ws: SeededWorkspace,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(`${API}/graphql`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${ws.account.accessToken}`,
      'X-Polaris-Workspace': ws.workspaceId,
    },
    body: JSON.stringify({ query, variables }),
  });
  const body = (await res.json()) as { data?: T; errors?: { message: string }[] };
  if (body.errors?.length) throw new Error(body.errors[0]!.message);
  return body.data as T;
}

/** A second team, so the one under test is never the only team in the workspace. */
async function createTeam(ws: SeededWorkspace, key: string, name: string): Promise<void> {
  await gql(ws, `mutation ($i: CreateTeamInput!) { createTeam(input: $i) { team { id } } }`, {
    i: { key, name },
  });
}

async function createIssue(ws: SeededWorkspace, title: string): Promise<void> {
  await gql(ws, `mutation ($i: CreateIssueInput!) { createIssue(input: $i) { issue { id } } }`, {
    i: { teamId: ws.teamId, title },
  });
}

/** The "Team" form, scoped so the per-status Name fields below it do not also match. */
function teamForm(page: Page) {
  return page.locator('form').filter({ has: page.getByRole('heading', { name: 'Team' }) });
}

async function retire(page: Page, teamKey: string): Promise<void> {
  await page.goto(`/team/${teamKey}/settings`);
  await page.getByRole('button', { name: 'Retire team' }).first().click();
  await page.getByRole('button', { name: 'Retire team' }).last().click();
  await expect(page.getByText(/This team is retired/)).toBeVisible();
}

test('changing a team key moves the settings screen with it', async ({ page, workspace }) => {
  await createTeam(workspace, 'OPS', 'Operations');
  await createIssue(workspace, 'Identifier follows the key');
  await signIn(page, workspace.account);

  await page.goto('/team/ENG');
  await expect(page.getByText('ENG-1')).toBeVisible();

  await page.goto('/team/ENG/settings');
  await teamForm(page).getByLabel('Key').fill('PLAT');
  await teamForm(page).getByRole('button', { name: 'Save team' }).click();

  // The screen follows the key rather than telling the user their team has vanished.
  await expect(page).toHaveURL(/\/team\/PLAT\/settings$/);
  await expect(page.getByText('No such team')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Engineering' })).toBeVisible();

  // And the URL it landed on is one a reload can serve.
  await page.reload();
  await expect(teamForm(page).getByLabel('Key')).toHaveValue('PLAT');

  await page.goto('/team/PLAT');
  await expect(page.getByText('PLAT-1')).toBeVisible();
});

test('a refused key change puts the screen back where it was', async ({ page, workspace }) => {
  await createTeam(workspace, 'OPS', 'Operations');
  await signIn(page, workspace.account);

  await page.goto('/team/ENG/settings');
  await teamForm(page).getByLabel('Key').fill('OPS');
  await teamForm(page).getByRole('button', { name: 'Save team' }).click();

  await expect(page.getByRole('alert')).toContainText(/already used by another team/);
  await expect(page).toHaveURL(/\/team\/ENG\/settings$/);
  await expect(page.getByText('No such team')).toHaveCount(0);
});

test('a retired team does not offer to be moved under a parent', async ({ page, workspace }) => {
  await createTeam(workspace, 'OPS', 'Operations');
  await signIn(page, workspace.account);
  await retire(page, 'ENG');

  await expect(page.getByLabel('Move under')).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Save parent' })).toBeDisabled();
  await expect(page.getByText('A retired team cannot be moved')).toBeVisible();

  // Restoring hands the control back.
  await page.getByRole('button', { name: 'Restore team' }).click();
  await expect(page.getByText(/This team is retired/)).toHaveCount(0);
  await expect(page.getByLabel('Move under')).toBeEnabled();
});

test('a retired team home says so and does not offer a new issue', async ({ page, workspace }) => {
  await createTeam(workspace, 'OPS', 'Operations');
  await signIn(page, workspace.account);

  await page.goto('/team/ENG/home');
  await expect(page.getByRole('button', { name: 'New issue' })).toBeVisible();

  await retire(page, 'ENG');

  await page.goto('/team/ENG/home');
  await expect(page.getByText(/This team is retired/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'New issue' })).toHaveCount(0);
});

test('turning on email intake does not make a team look retired', async ({ page, workspace }) => {
  await signIn(page, workspace.account);
  await page.goto('/team/ENG/settings');
  await expect(page.getByRole('heading', { name: 'Engineering' })).toBeVisible();

  // Two ordinary settings, in the order a team sets them up. The email-intake reply is the
  // one GraphQL row the client merges straight back into the replica, and GraphQL spells an
  // unset optional `null` where the delta stream omits it — so this wrote `retiredAt: null`
  // over the team, froze the whole screen, and dropped the team out of the sidebar.
  await page.getByLabel('Run cycles').check();
  await expect(page.getByLabel('Duration')).toBeVisible();
  await page.getByRole('checkbox', { name: 'Create issues by email' }).check();
  await expect(page.getByLabel('Intake address')).not.toHaveValue('');

  await expect(page.getByText(/This team is retired/)).toHaveCount(0);
  await expect(page.getByLabel('Duration')).toBeEnabled();
  await expect(
    page.getByRole('navigation', { name: /workspace/i }).getByText('Engineering'),
  ).toBeVisible();

  // And it is not the kind of wrong a reload washes out: the bad row was persisted.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Engineering' })).toBeVisible();
  await expect(page.getByText(/This team is retired/)).toHaveCount(0);
  await expect(page.getByLabel('Intake address')).not.toHaveValue('');

  // Turning it back off takes the address with it.
  await page.getByRole('checkbox', { name: 'Create issues by email' }).uncheck();
  await expect(page.getByLabel('Intake address')).toHaveCount(0);
});

test('restoring into a key another team has taken says which way out', async ({
  page,
  workspace,
}) => {
  await createTeam(workspace, 'OPS', 'Operations');
  await signIn(page, workspace.account);

  await page.goto('/team/ENG/settings');
  await page.getByRole('button', { name: 'Delete team' }).first().click();
  await page.getByRole('button', { name: 'Delete team' }).last().click();
  await expect(page).not.toHaveURL(/\/team\/ENG\/settings$/);

  // The uniqueness index on a team key skips deleted rows, so the key is free the moment
  // the team holding it goes — and thirty days is long enough for somebody to spend it.
  await createTeam(workspace, 'ENG', 'Engineering II');

  await page.goto('/settings/deleted-teams');
  await expect(page.getByRole('cell', { name: 'Engineering' }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Restore' }).first().click();

  await expect(page.getByRole('alert')).toContainText(/another team has taken this team's key/);
  await expect(page.getByRole('alert')).not.toContainText(/internal error/);
  // The row stays, because the team is still there to be restored once the key is free.
  await expect(page.getByRole('cell', { name: 'Engineering' }).first()).toBeVisible();
});

test('a deleted team is restorable from recently deleted teams', async ({ page, workspace }) => {
  await createTeam(workspace, 'OPS', 'Operations');
  await createIssue(workspace, 'Goes down with the team');
  await signIn(page, workspace.account);

  await page.goto('/team/ENG/settings');
  await page.getByRole('button', { name: 'Delete team' }).first().click();
  await page.getByRole('button', { name: 'Delete team' }).last().click();

  // The danger zone leaves the deleted team's settings once the server has answered, and
  // "Recently deleted teams" is a single network read taken on mount — so navigating there
  // before that redirect races the delete and reads an empty list.
  await expect(page).not.toHaveURL(/\/team\/ENG\/settings$/);

  await page.goto('/settings/deleted-teams');
  await expect(page.getByRole('cell', { name: 'Engineering' })).toBeVisible();
  await page.getByRole('button', { name: 'Restore' }).click();
  await expect(page.getByText(/ENG is back as Engineering/)).toBeVisible();

  // The team's issues come back with it.
  await page.goto('/team/ENG');
  await expect(page.getByText('ENG-1')).toBeVisible();
});
