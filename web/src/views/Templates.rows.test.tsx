/**
 * The templates screen on the settings frame: one h1 with the kind tabs beside it, a named
 * card per scope, and the editor opening inside the scope it was asked for.
 *
 * A sibling of `Templates.test.tsx` rather than more cases in it. That file is about what a
 * template may say; this one is about where the pieces sit once every scope is a card —
 * which is the part a layout rewrite can lose without any write going wrong.
 */

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { Store, type Change, type Entity } from '~/store';
import type { EngineStatus, SyncEngine } from '~/sync/engine';

import { Templates } from './Templates';

const WORKSPACE = 'workspace-1';
const ENG = 'team-eng';
const AT = '2026-01-01T00:00:00Z';

function team(): Entity {
  return {
    id: ENG,
    workspaceId: WORKSPACE,
    key: 'ENG',
    name: 'Engineering',
    timezone: 'Europe/Lisbon',
    private: false,
    estimateScale: 'none',
    estimateAllowZero: false,
    estimateExtended: false,
    cyclesEnabled: false,
    cycleDurationWeeks: 1,
    cycleCooldownWeeks: 0,
    cycleStartDay: 'monday',
    cycleUpcomingCount: 2,
    cycleAutoAddStarted: false,
    cycleAutoAddCompleted: false,
    triageEnabled: false,
    triageRequirePriority: false,
    autoCloseDays: 0,
    autoArchiveDays: 0,
    autoCloseParent: false,
    autoCloseChildren: false,
    createdAt: AT,
    updatedAt: AT,
  } as unknown as Entity;
}

function template(id: string, name: string, teamId?: string): Entity {
  return {
    id,
    workspaceId: WORKSPACE,
    ...(teamId === undefined ? null : { teamId }),
    name,
    title: '',
    body: '',
    properties: {},
    subIssues: [],
    position: 'V',
    createdAt: AT,
    updatedAt: AT,
  } as unknown as Entity;
}

function renderScreen(rows: readonly [string, Entity][], status: EngineStatus = { phase: 'idle' }) {
  const store = new Store(WORKSPACE);
  store.applyChanges(
    rows.map(([type, payload], index) => ({
      v: index + 1,
      type,
      id: (payload as { id: string }).id,
      op: 'upsert' as const,
      actor: { type: 'system' as const },
      payload,
    })) as Change[],
  );
  const engine = { store, mutate: vi.fn().mockResolvedValue({}) } as unknown as SyncEngine;

  render(
    <MemoryRouter initialEntries={['/settings/templates']}>
      <KeymapProvider>
        <EngineProvider engine={engine} status={status}>
          <Templates />
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );
  return userEvent.setup();
}

describe('Templates on the settings frame', () => {
  it('has one h1, the kind tabs beside it, and a named card per scope', () => {
    renderScreen([
      ['team', team()],
      ['issueTemplate', template('t-any', 'Anything')],
    ]);

    expect(screen.getByRole('heading', { level: 1, name: 'Templates' })).toBeTruthy();
    expect(
      within(screen.getByRole('tablist', { name: 'Template kind' }))
        .getAllByRole('tab')
        .map((tab) => tab.textContent),
    ).toEqual(['Standard', 'Form', 'Project']);

    // Every scope is a landmark named by its heading, so a reader can move between them.
    for (const name of ['Workspace', 'Engineering', 'Archived']) {
      expect(screen.getByRole('region', { name })).toBeTruthy();
    }
    // The badge left the heading for the section's action slot; the section still says it.
    const workspace = screen.getByRole('region', { name: 'Workspace' });
    expect(within(workspace).getByRole('heading', { level: 2 }).textContent).toBe('Workspace');
    expect(within(workspace).getByText('Every team')).toBeTruthy();
    expect(
      within(workspace).getByRole('button', { name: 'New template for Workspace' }),
    ).toBeTruthy();
    // The row's four always-visible controls are one ⋯ menu now; Edit is inside it.
    expect(within(workspace).getByRole('button', { name: 'Options for Anything' })).toBeTruthy();
  });

  it('offers a row its actions through its own menu', async () => {
    const user = renderScreen([
      ['team', team()],
      ['issueTemplate', template('t-any', 'Anything')],
    ]);

    await user.click(screen.getByRole('button', { name: 'Options for Anything' }));
    const menu = await screen.findByRole('menu', { name: 'Options for Anything' });

    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent),
      // A workspace template names no team, so it cannot be put on a cadence.
    ).toEqual(['Edit', 'Copy create URL', 'Archive']);
  });

  it('opens the editor inside the scope it was asked for, and takes that scope’s button away', async () => {
    const user = renderScreen([['team', team()]]);

    await user.click(screen.getByRole('button', { name: 'New template for Engineering' }));

    const engineering = screen.getByRole('region', { name: 'Engineering' });
    expect(
      within(engineering).getByRole('form', { name: 'New template for Engineering' }),
    ).toBeTruthy();
    // One editor at a time, and the button that opened it is not offered again beside it.
    expect(
      within(engineering).queryByRole('button', { name: 'New template for Engineering' }),
    ).toBeNull();
    expect(screen.getByRole('button', { name: 'New template for Workspace' })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(
      within(engineering).getByRole('button', { name: 'New template for Engineering' }),
    ).toBeTruthy();
  });

  it('waits for the replica rather than claiming a scope has no templates', () => {
    renderScreen([['team', team()]], { phase: 'hydrating' });

    // "No templates yet" is an answer, and a hydrating replica has not given one.
    expect(screen.queryByText('No templates yet')).toBeNull();
    expect(screen.getAllByRole('status')[0]?.textContent).toContain('Loading templates');
  });

  it('narrows the rows to what the search box matches', async () => {
    const user = renderScreen([
      ['team', team()],
      ['issueTemplate', template('t-any', 'Anything')],
      ['issueTemplate', template('t-bug', 'Bug report')],
    ]);

    await user.type(screen.getByRole('searchbox', { name: 'Search templates' }), 'bug');

    expect(screen.queryByRole('button', { name: 'Options for Anything' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Options for Bug report' })).toBeTruthy();
    // Not "no templates yet": there are templates, and this is what the search left.
    expect(screen.getAllByText('Nothing matches').length).toBeGreaterThan(0);
  });

  it('moves a cursor with j and k and opens the row under it', async () => {
    const user = renderScreen([
      ['team', team()],
      ['issueTemplate', template('t-any', 'Anything')],
      ['issueTemplate', template('t-bug', 'Bug report')],
    ]);

    await user.keyboard('j');
    await user.keyboard('k');
    await user.keyboard('{Enter}');

    // Enter on a template opens its editor: there is no page for one to open.
    expect(await screen.findByRole('form', { name: /^Editing / })).toBeTruthy();
  });

  it('says a scope has nothing yet inside its own card', () => {
    renderScreen([['team', team()]]);

    const engineering = screen.getByRole('region', { name: 'Engineering' });
    expect(within(engineering).getByText('No templates yet')).toBeTruthy();
  });
});
