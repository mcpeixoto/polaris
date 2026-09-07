/**
 * The create dialogs the shell mounts, and what they cost while they are shut.
 *
 * Every one of them is now mounted for the life of the shell and told whether it is open,
 * so that it can animate its own exit. That trade is only safe if a closed dialog is inert:
 * a `useKeyContext('modal')` that runs on mount would seal the keyboard over the whole
 * application from the moment the shell rendered, and a ⌘⏎ registered on mount would be
 * five dialogs deep in duplicate bindings. So the assertions here are about the keymap
 * rather than about pixels — the context stack the shell is left on, and whether the
 * dialog's own action is registered.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router';

import { CreateProjectModal } from '~/features/projects/CreateProjectModal';
import { Store, type Change, type Entity } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { AppShell } from './AppShell';
import { EngineProvider } from './context';
import { KeymapProvider, useKeymap } from './keymap';

const WORKSPACE = '01900000-0000-7000-8000-000000000001';
const VIEWER = '01900000-0000-7000-8000-000000000002';
const TEAM = '01900000-0000-7000-8000-000000000004';
const AT = '2026-01-01T00:00:00.000Z';

vi.mock('./Boot', () => ({
  useWorkspaceSession: () => ({
    workspaces: [
      {
        id: WORKSPACE,
        name: 'Polaris',
        urlKey: 'polaris',
        plan: 'free',
        createdAt: AT,
        updatedAt: AT,
      },
    ],
    currentId: WORKSPACE,
    switchTo: vi.fn(),
  }),
}));

vi.mock('~/hooks/useViewer', () => ({
  useViewerId: () => VIEWER,
  useViewer: () => null,
  useViewerRole: () => 'admin',
}));

const stored = new Map<string, string>();

beforeEach(() => {
  stored.clear();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => void stored.set(key, value),
      removeItem: (key: string) => void stored.delete(key),
      clear: () => stored.clear(),
    },
  });
});

function seeded(): Store {
  const store = new Store(WORKSPACE);
  const rows: [string, Entity][] = [
    [
      'workspace',
      {
        id: WORKSPACE,
        name: 'Polaris',
        urlKey: 'polaris',
        plan: 'free',
        pulseEnabled: true,
        customerRequestsEnabled: true,
        customerRevenueUnit: '',
        customerTiers: [],
        pulseDigestCadence: 'daily',
        projectUpdateReminderIntervalDays: 7,
        projectUpdateReminderWeekday: 5,
        projectUpdateReminderHour: 9,
        createdAt: AT,
        updatedAt: AT,
      } as unknown as Entity,
    ],
    [
      'team',
      {
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
      } as unknown as Entity,
    ],
  ];
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
  return store;
}

/** Reports what the keymap looks like from inside the shell, one render behind nothing. */
let probe: { context: string; has: (id: string) => boolean } = {
  context: 'global',
  has: () => false,
};

function KeymapProbe() {
  const { registry, context } = useKeymap();
  probe = { context, has: (id) => registry.get(id) !== undefined };
  return null;
}

function renderShell() {
  const engine = { store: seeded(), mutate: vi.fn(), start: vi.fn().mockResolvedValue(undefined) };
  render(
    <MemoryRouter initialEntries={['/']}>
      <KeymapProvider>
        <EngineProvider engine={engine as unknown as SyncEngine} status={{ phase: 'idle' }}>
          <AppShell
            renderCreateProject={({ open, onClose }) => (
              <CreateProjectModal open={open} onClose={onClose} />
            )}
          >
            <KeymapProbe />
            <Routes>
              <Route path="*" element={<div />} />
            </Routes>
          </AppShell>
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );
}

describe('a create dialog the shell keeps mounted', () => {
  it('claims no key context and registers no chord while it is closed', () => {
    renderShell();

    expect(screen.queryByRole('dialog', { name: 'New project' })).toBeNull();
    expect(probe.context).toBe('global');
    expect(probe.has('project.create.submit')).toBe(false);
  });

  it('takes the modal context and its chord when it opens, and gives both back', async () => {
    const user = userEvent.setup();
    renderShell();

    await user.click(screen.getByRole('button', { name: 'Start a project' }));
    expect(screen.getByRole('dialog', { name: 'New project' })).toBeTruthy();
    expect(probe.context).toBe('modal');
    expect(probe.has('project.create.submit')).toBe(true);

    await user.keyboard('{Escape}');
    expect(probe.context).toBe('global');
    expect(probe.has('project.create.submit')).toBe(false);
  });
});
