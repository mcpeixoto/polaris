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
import type { SyncEngine } from '~/sync/engine';

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

function renderScreen(rows: readonly [string, Entity][]) {
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
        <EngineProvider engine={engine} status={{ phase: 'idle' }}>
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
    expect(within(workspace).getByRole('button', { name: 'Edit Anything' })).toBeTruthy();
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

  it('says a scope has nothing yet inside its own card', () => {
    renderScreen([['team', team()]]);

    const engineering = screen.getByRole('region', { name: 'Engineering' });
    expect(within(engineering).getByText('No templates yet')).toBeTruthy();
  });
});
