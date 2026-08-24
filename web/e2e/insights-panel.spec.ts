/**
 * The Insights panel on a team's issue list.
 *
 * The panel lives inside the list's keyboard context, so every control it renders competes
 * with the list's own single-key shortcuts. That competition is the thing under test here:
 * a bar or a table row that filters on click has to filter on Enter too, and must not also
 * run the list's Enter-to-open and throw the user onto an unrelated issue.
 */

import { expect, openTeamList, signIn, test, type SeededWorkspace } from './fixtures';
import type { Page } from '@playwright/test';

const API = process.env.POLARIS_E2E_API ?? 'http://localhost:8088';

async function graphql<T>(
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

/** Rows of the issue list, and nothing else — `<option>` in a `<select>` shares the role. */
function rows(page: Page) {
  return page.getByRole('listbox', { name: /issues/i }).getByRole('option');
}

function panelOf(page: Page) {
  return page.getByRole('region', { name: 'Insights' });
}

async function openInsights(page: Page) {
  await page.getByRole('button', { name: 'Insights', exact: true }).click();
  await panelOf(page).waitFor();
}

test('a bar filters the view by click, by Enter and by Space', async ({ page, workspace }) => {
  const me = (
    await graphql<{ viewer: { user: { id: string } } }>(
      workspace,
      `
        query {
          viewer {
            user {
              id
            }
          }
        }
      `,
      {},
    )
  ).viewer.user.id;
  for (const title of ['Mine one', 'Mine two', 'Nobody']) {
    await graphql(
      workspace,
      `
        mutation ($i: CreateIssueInput!) {
          createIssue(input: $i) {
            issue {
              id
            }
          }
        }
      `,
      {
        i: {
          teamId: workspace.teamId,
          title,
          ...(title.startsWith('Mine') ? { assigneeId: me } : {}),
        },
      },
    );
  }

  await signIn(page, workspace.account);
  await openTeamList(page, workspace.teamKey);
  await expect(rows(page)).toHaveCount(3);
  await openInsights(page);
  const panel = panelOf(page);

  // Two assignees, counted the way the list can be counted by hand.
  await expect(panel).toContainText('3 issues');
  await expect(panel.locator('tbody tr')).toHaveCount(2);

  await panel.getByRole('button', { name: 'Filter by E2E' }).click();
  await expect(rows(page)).toHaveCount(2);

  // Enter on a focused bar. It must filter, and it must not run the list's Enter-to-open:
  // landing on an issue detail would discard the filter the same keystroke just applied.
  await openTeamList(page, workspace.teamKey);
  await expect(rows(page)).toHaveCount(3);
  await openInsights(page);
  const bar = panel.getByRole('button', { name: 'Filter by E2E' });
  await bar.focus();
  await expect(bar).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(rows(page)).toHaveCount(2);
  expect(page.url()).toContain('/team/');

  // Space, on the bucket for issues with no assignee at all.
  await openTeamList(page, workspace.teamKey);
  await expect(rows(page)).toHaveCount(3);
  await openInsights(page);
  await panel.getByRole('button', { name: 'Filter by Unassigned' }).focus();
  await page.keyboard.press(' ');
  await expect(rows(page)).toHaveCount(1);
  expect(page.url()).toContain('/team/');

  // The table under the chart offers the same filter, and Enter has to reach it too.
  await openTeamList(page, workspace.teamKey);
  await expect(rows(page)).toHaveCount(3);
  await openInsights(page);
  await panel.locator('tbody button', { hasText: 'E2E' }).first().focus();
  await page.keyboard.press('Enter');
  await expect(rows(page)).toHaveCount(2);
  expect(page.url()).toContain('/team/');
});

/**
 * What the panel says about work it cannot see, and about a unit the team has never used.
 *
 * Both are claims rather than layout, which is why they are asserted on text and on control
 * counts. Archiving emits a delete to the replica, so an archived issue is not in the store
 * this panel computes over — a "show archived" switch here could only ever measure the same
 * issues twice, and the honest version of that is no switch. And a team's estimate scale
 * defaults to `none`, where every issue is worth exactly 1: the effort total is then an issue
 * count, and the cycle graph and capacity dial already call that `issues`.
 */
test('offers no archived switch, and reports effort in the team’s own unit', async ({
  page,
  workspace,
}) => {
  const made: string[] = [];
  for (const title of ['Live one', 'Live two', 'Archived one']) {
    const data = await graphql<{ createIssue: { issue: { id: string } } }>(
      workspace,
      `
        mutation ($i: CreateIssueInput!) {
          createIssue(input: $i) {
            issue {
              id
            }
          }
        }
      `,
      { i: { teamId: workspace.teamId, title } },
    );
    made.push(data.createIssue.issue.id);
  }
  await graphql(
    workspace,
    `
      mutation ($id: UUID!, $clientId: UUID!, $opId: UUID!) {
        archiveIssue(id: $id, archived: true, clientId: $clientId, opId: $opId) {
          id
        }
      }
    `,
    { id: made[2]!, clientId: crypto.randomUUID(), opId: crypto.randomUUID() },
  );

  await signIn(page, workspace.account);
  await openTeamList(page, workspace.teamKey);
  await expect(rows(page)).toHaveCount(2);
  await openInsights(page);
  const panel = panelOf(page);

  // No control claiming to widen the corpus, by any spelling.
  await expect(panel.getByRole('checkbox')).toHaveCount(0);
  await expect(panel.getByText(/archived/i)).toHaveCount(0);
  // And the number matches the list it sits above, which is the whole promise.
  await expect(panel).toContainText('2 issues');

  // The team has no estimate scale, so this is a count and must not claim to be points.
  await panel.getByLabel('Measure').selectOption('effort');
  await expect(panel).toContainText('2 issues');
  await expect(panel).not.toContainText('points');
  await expect(panel.locator('thead th').nth(1)).toHaveText('issues');
});
