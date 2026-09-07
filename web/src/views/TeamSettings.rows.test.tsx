/**
 * The team screen on the settings frame: one h1, a named section per decision, and each
 * control keeping the accessible name it had when the label was drawn beside it.
 *
 * A sibling of `TeamSettings.members.test.tsx` rather than more cases in it: that file is
 * about membership, and what is asserted here is the layout every section shares — which
 * is exactly the thing a row-by-row rewrite can silently lose. A `SettingsRow` draws its
 * label but does not wire it, so a checkbox whose visible label moved into the row would be
 * announced as "checkbox" and nothing else unless the control carried the name itself.
 */

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { Store, type Change, type Entity } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { TeamSettings } from './TeamSettings';

vi.mock('~/features/admin/entitlements', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/features/admin/entitlements')>();
  return {
    ...actual,
    useEntitlements: () => ({
      facts: { plan: 'free', seatLimit: null, seatsUsed: 1, teamLimit: null, lapsed: false },
      features: null,
      confirmed: false,
      reload: () => {},
    }),
  };
});

const WORKSPACE = 'workspace-1';
const TEAM = 'team-eng';
const AT = '2026-01-01T00:00:00Z';

function team(over: Record<string, unknown> = {}): Entity {
  return {
    id: TEAM,
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
    ...over,
  } as unknown as Entity;
}

function state(id: string, name: string, category: string): Entity {
  return {
    id,
    workspaceId: WORKSPACE,
    teamId: TEAM,
    name,
    color: '#5e6ad2',
    category,
    position: 'V',
    isDefault: category === 'backlog',
    isSystem: false,
    createdAt: AT,
    updatedAt: AT,
  } as unknown as Entity;
}

let mutate: ReturnType<typeof vi.fn>;

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

  mutate = vi.fn().mockResolvedValue({});
  const engine = { store, mutate } as unknown as SyncEngine;

  render(
    <MemoryRouter initialEntries={['/team/ENG/settings']}>
      <KeymapProvider>
        <EngineProvider engine={engine} status={{ phase: 'idle' }}>
          <Routes>
            <Route path="/team/:teamKey/settings" element={<TeamSettings />} />
          </Routes>
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );
  return userEvent.setup();
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('TeamSettings on the settings frame', () => {
  it('names the page after the team and each section after its decision', async () => {
    renderScreen([['team', team()]]);

    expect(await screen.findByRole('heading', { level: 1, name: 'Engineering' })).toBeTruthy();
    for (const name of [
      'Team',
      'Visibility',
      'Members',
      'Cycles',
      'Triage',
      'Create issues by email',
      'Auto-close and archive',
      'Default templates',
      'Recurring issues',
      'Workflow statuses',
      'Parent team',
    ]) {
      expect(screen.getByRole('region', { name })).toBeTruthy();
    }
    expect(screen.getByRole('heading', { level: 2, name: 'Danger zone' })).toBeTruthy();
  });

  // The row draws the label; the control has to carry the name itself, or it has none.
  it('keeps every control’s accessible name once its label is drawn by the row', async () => {
    renderScreen([['team', team({ cyclesEnabled: true, triageEnabled: true })]]);

    const form = await screen.findByRole('region', { name: 'Team' });
    expect(within(form).getByRole('textbox', { name: 'Name' })).toBeTruthy();
    expect(within(form).getByRole('textbox', { name: 'Key' })).toBeTruthy();
    expect(within(form).getByRole('combobox', { name: 'Timezone' })).toBeTruthy();
    expect(within(form).getByRole('button', { name: 'Save team' })).toBeTruthy();

    expect(screen.getByRole('checkbox', { name: 'Private team' })).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: 'Run cycles' })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Duration' })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Starts on' })).toBeTruthy();
    expect(
      screen.getByRole('checkbox', { name: 'Add started issues to the current cycle' }),
    ).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: 'Run triage' })).toBeTruthy();
    expect(
      screen.getByRole('checkbox', { name: 'Require a priority before an issue can leave triage' }),
    ).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Auto-close after' })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'For members' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'New schedule' })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Move under' })).toBeTruthy();
  });

  it('lists the statuses under their category inside the workflow card', async () => {
    renderScreen([
      ['team', team()],
      ['workflowState', state('s-todo', 'Todo', 'unstarted')],
      ['workflowState', state('s-doing', 'In Progress', 'started')],
    ]);

    const workflow = await screen.findByRole('region', { name: 'Workflow statuses' });
    expect(within(workflow).getByRole('group', { name: 'Todo status' })).toBeTruthy();
    expect(within(workflow).getByRole('group', { name: 'In Progress status' })).toBeTruthy();
    expect(within(workflow).getByRole('textbox', { name: 'New status' })).toBeTruthy();
    expect(within(workflow).getByRole('button', { name: 'Add status' })).toBeTruthy();
  });

  // The danger zone's rows open a dialog; nothing is sent until the dialog is answered.
  it('asks before retiring, and sends nothing until it is answered', async () => {
    const user = renderScreen([['team', team()]]);

    await user.click(await screen.findByRole('button', { name: 'Retire team' }));
    const dialog = await screen.findByRole('dialog', { name: 'Retire Engineering?' });
    expect(mutate).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('button', { name: 'Retire team' }));
    await waitFor(() => {
      expect(mutate).toHaveBeenCalledTimes(1);
    });
  });

  it('offers Restore rather than Retire on a retired team, and says the rest is read-only', async () => {
    renderScreen([['team', team({ retiredAt: AT })]]);

    expect(await screen.findByRole('button', { name: 'Restore team' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Retire team' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Delete team' })).toBeTruthy();
    // Announced, not just printed: the banner is a status region among the others on the page.
    expect(
      screen
        .getAllByRole('status')
        .some((node) => node.textContent?.includes('This team is retired') === true),
    ).toBe(true);
  });

  /**
   * The team's mark reaches the sidebar, the issue list and every breadcrumb that names a
   * team — and `updateTeam` did not carry it, so a team wore whatever was picked in the
   * create dialog for the rest of its life.
   */
  it('changes the team icon and sends it with the rest of the form', async () => {
    const user = renderScreen([['team', team()]]);

    await user.click(await screen.findByRole('button', { name: 'Set team icon' }));
    await user.click(screen.getByRole('button', { name: '\u{1F680}' }));
    await user.click(screen.getByRole('button', { name: 'Save team' }));

    await waitFor(() => expect(mutate).toHaveBeenCalled());
    expect(mutate.mock.calls[0]![0].variables.input).toMatchObject({
      id: TEAM,
      icon: '\u{1F680}',
    });
  });

  it('leaves Save team disabled until something actually changed', async () => {
    renderScreen([['team', team({ icon: '\u{1F680}' })]]);

    const save = await screen.findByRole('button', { name: 'Save team' });
    expect((save as HTMLButtonElement).disabled).toBe(true);
  });
});
