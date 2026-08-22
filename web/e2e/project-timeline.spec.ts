/**
 * The projects timeline, end to end.
 *
 * Here rather than in a component test because both things asserted are geometry the
 * component cannot see. The timeline is a label column and a date canvas side by side, and
 * only the canvas scrolls sideways — so they are two scroll containers, and their vertical
 * offsets were independent. Nothing about the drawing was wrong; the reader was simply told
 * the wrong name for a bar, which is the failure mode a screenshot review sails past and a
 * layout assertion catches. jsdom has no scrolling and no layout, so it cannot see it at all.
 *
 * The second half is the Display panel's Escape. The issue list's panel closes on it (see
 * display-options.spec.ts) and this one, with the same role and the same name, did not.
 */

import { test, expect, signIn, type SeededWorkspace } from './fixtures';
import type { Page } from '@playwright/test';

const API = process.env.POLARIS_E2E_API ?? 'http://localhost:8088';

/** Enough rows that the canvas has somewhere to scroll to. */
const ROWS = 24;
const SCROLL_BY = 200;

async function createProject(
  ws: SeededWorkspace,
  input: Record<string, unknown>,
): Promise<{ id: string }> {
  const res = await fetch(`${API}/graphql`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${ws.account.accessToken}`,
      'X-Polaris-Workspace': ws.workspaceId,
    },
    body: JSON.stringify({
      query: `mutation ($i: CreateProjectInput!) { createProject(input: $i) { project { id } } }`,
      variables: { i: { teamIds: [ws.teamId], ...input } },
    }),
  });
  const body = (await res.json()) as {
    data?: { createProject: { project: { id: string } } };
    errors?: { message: string }[];
  };
  if (body.errors?.length) throw new Error(body.errors[0]!.message);
  return body.data!.createProject.project;
}

const DAY_MS = 86_400_000;
const TODAY = new Date().toISOString().slice(0, 10);
function addDays(day: string, n: number): string {
  return new Date(Math.floor(new Date(`${day}T00:00:00.000Z`).getTime() / DAY_MS + n) * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

/**
 * The top of every label and the top of the row its bar sits in, paired by position.
 *
 * Read from the live boxes rather than from the inline styles, because the bug is that the
 * two panes are offset from one another — the styles were right the whole time.
 */
async function rowTops(page: Page) {
  return page.evaluate(() => {
    const root = document.querySelector('[aria-label="Projects timeline"]') as HTMLElement;
    const body = root.children[0] as HTMLElement;
    const sidebar = body.children[0] as HTMLElement;
    const canvas = body.children[1] as HTMLElement;
    const grid = canvas.children[0] as HTMLElement;

    const labels = [...sidebar.children]
      .filter((n): n is HTMLElement => n.tagName === 'A')
      .map((n) => ({
        name: n.innerText.split('\n')[0]!.trim(),
        top: n.getBoundingClientRect().top,
      }));
    const rows = [...grid.children]
      .filter(
        (n): n is HTMLElement =>
          n.tagName === 'DIV' && n.querySelector(':scope > [title]') !== null,
      )
      .map((n) => ({
        name: (n.children[0] as HTMLElement).getAttribute('title')!.split(':')[0]!,
        top: n.getBoundingClientRect().top,
      }));

    return {
      labels,
      rows,
      canvasScrollTop: canvas.scrollTop,
      sidebarScrollTop: sidebar.scrollTop,
      canvasScrollHeight: canvas.scrollHeight,
      canvasClientHeight: canvas.clientHeight,
      sidebarScrollHeight: sidebar.scrollHeight,
    };
  });
}

async function scrollPane(page: Page, pane: 'sidebar' | 'canvas', top: number) {
  await page.evaluate(
    ({ pane, top }) => {
      const root = document.querySelector('[aria-label="Projects timeline"]') as HTMLElement;
      const body = root.children[0] as HTMLElement;
      const el = body.children[pane === 'sidebar' ? 0 : 1] as HTMLElement;
      el.scrollTop = top;
    },
    { pane, top },
  );
}

test('the timeline label column scrolls with the bars it names', async ({ page, workspace }) => {
  for (let i = 0; i < ROWS; i++) {
    await createProject(workspace, {
      name: `Row ${String(i).padStart(2, '0')}`,
      startDate: addDays(TODAY, i),
      targetDate: addDays(TODAY, i + 10),
    });
  }
  // One with no dates, so the "Unscheduled" heading is in the label column and the two
  // panes have to agree on a height that counts it as a heading rather than as a row.
  await createProject(workspace, { name: 'Row zz unscheduled' });

  await signIn(page, workspace.account);
  await page.goto('/projects?layout=timeline');
  await page.locator('[aria-label="Projects timeline"]').waitFor();
  await expect.poll(async () => (await rowTops(page)).rows.length).toBe(ROWS);

  const initial = await rowTops(page);
  expect(
    initial.canvasScrollHeight,
    'the canvas has to overflow, or this test proves nothing',
  ).toBeGreaterThan(initial.canvasClientHeight);
  expect(initial.sidebarScrollHeight, 'both panes are the same height').toBe(
    initial.canvasScrollHeight,
  );

  // Scrolling the canvas — the two-finger swipe over the bars — takes the names with it.
  await scrollPane(page, 'canvas', SCROLL_BY);
  await expect.poll(async () => (await rowTops(page)).sidebarScrollTop).toBe(SCROLL_BY);

  const scrolled = await rowTops(page);
  for (const [i, row] of scrolled.rows.entries()) {
    const label = scrolled.labels[i]!;
    expect(label.name, `row ${i} is labelled with its own project`).toBe(row.name);
    expect(
      Math.abs(label.top - row.top),
      `"${row.name}" sits beside its own label after scrolling`,
    ).toBeLessThanOrEqual(1);
  }

  // And the other way: a wheel over the label column moves the bars.
  await scrollPane(page, 'sidebar', 0);
  await expect.poll(async () => (await rowTops(page)).canvasScrollTop).toBe(0);
  const back = await rowTops(page);
  expect(Math.abs(back.labels[0]!.top - back.rows[0]!.top)).toBeLessThanOrEqual(1);
});

test('Escape closes the projects Display panel', async ({ page, workspace }) => {
  await createProject(workspace, {
    name: 'Escapable',
    startDate: TODAY,
    targetDate: addDays(TODAY, 5),
  });
  await signIn(page, workspace.account);
  await page.goto('/projects');
  await page
    .getByRole('heading', { name: /projects/i })
    .first()
    .waitFor();

  const panel = page.getByRole('dialog', { name: 'Display options' });
  const trigger = page.getByRole('button', { name: /^Display/ });

  await trigger.click();
  await expect(panel).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  // Focus goes back to what opened it, or the keyboard user is left nowhere.
  await expect(trigger).toBeFocused();

  // Still true once the panel has grown its timeline controls.
  await trigger.click();
  await panel.getByRole('button', { name: 'Timeline', exact: true }).click();
  await expect(panel.getByLabel('Zoom')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await expect(page).toHaveURL(/layout=timeline/);
});
