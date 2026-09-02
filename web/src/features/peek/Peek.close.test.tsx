/**
 * The panel's close control.
 *
 * Peek's only exit used to be Escape and the line of text saying so, which is a keyboard
 * affordance offered to somebody who may well have opened it with a pointer from the command
 * menu. The button is rendered only when the list supplies an `onClose`, so this asserts both
 * halves: absent without one, and wired to it when it is there.
 *
 * Rendering rather than unit-testing the reader, because what regressed here is a control on
 * a header and not a value in an object.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { Store, type Change, type Entity } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { Peek } from './Peek';

const WORKSPACE = '01900000-0000-7000-8000-000000000001';
const TEAM = '01900000-0000-7000-8000-000000000002';
const TODO = '01900000-0000-7000-8000-000000000003';
const ISSUE = '01900000-0000-7000-8000-000000000004';

const AT = '2026-01-01T00:00:00.000Z';

function seeded(): Store {
  const store = new Store(WORKSPACE);
  const rows: [string, Entity][] = [
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
      } as Entity,
    ],
    [
      'workflowState',
      {
        id: TODO,
        workspaceId: WORKSPACE,
        teamId: TEAM,
        name: 'Todo',
        category: 'unstarted',
        position: 'V',
        isDefault: true,
        isSystem: false,
        createdAt: AT,
        updatedAt: AT,
      } as Entity,
    ],
    [
      'issue',
      {
        id: ISSUE,
        workspaceId: WORKSPACE,
        teamId: TEAM,
        number: 7,
        title: 'The login flakes',
        description: '',
        stateId: TODO,
        priority: 0,
        dueDateSource: 'none',
        position: 'V',
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

function renderPeek(onClose?: () => void) {
  const engine = { store: seeded(), mutate: vi.fn() } as unknown as SyncEngine;
  render(
    <MemoryRouter>
      <EngineProvider engine={engine} status={{ phase: 'idle' }}>
        <Peek open issueId={ISSUE} onClose={onClose} />
      </EngineProvider>
    </MemoryRouter>,
  );
  return userEvent.setup();
}

describe('Peek', () => {
  it('offers a close control when the list supplies one', async () => {
    const onClose = vi.fn();
    const user = renderPeek(onClose);

    await user.click(screen.getByRole('button', { name: 'Close peek' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows no close control when nothing is listening for it', () => {
    renderPeek();

    expect(screen.queryByRole('button', { name: 'Close peek' })).toBeNull();
  });
});
