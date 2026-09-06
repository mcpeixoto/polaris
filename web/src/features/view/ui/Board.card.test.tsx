/**
 * What a card draws, beyond the wiring `Board.test.tsx` proves.
 *
 * A sibling file because these cases need entities the shared seed does not carry — a
 * project, a deadline — and adding them there would change what its drop cases are about.
 */

import { render, screen } from '@testing-library/react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { DEFAULT_DISPLAY, type DisplayProperty } from '~/filter';
import { Store, type Change, type Entity } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { Board } from './Board';
import type { ViewGroup } from './useView';

vi.mock('~/hooks/useViewer', () => ({ useViewerId: () => 'user-ada' }));

const WORKSPACE = 'workspace-1';
const TEAM = 'team-1';
const AT = '2026-01-01T00:00:00Z';

function seeded(): Store {
  const store = new Store(WORKSPACE);
  const entities: [string, Entity][] = [
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
      },
    ],
    [
      'workflowState',
      {
        id: 's-todo',
        workspaceId: WORKSPACE,
        teamId: TEAM,
        name: 'Todo',
        color: '#5e6ad2',
        category: 'unstarted',
        position: 'V',
        isDefault: true,
        isSystem: false,
        createdAt: AT,
        updatedAt: AT,
      },
    ],
    [
      'project',
      {
        id: 'project-1',
        workspaceId: WORKSPACE,
        name: 'Onboarding',
        icon: '🚀',
        description: '',
        color: '#5e6ad2',
        statusId: 'ps-1',
        priority: 0,
        sortOrder: 'V',
        updateSchedule: 'default',
        createdAt: AT,
        updatedAt: AT,
      },
    ],
    [
      'issue',
      {
        id: 'issue-1',
        workspaceId: WORKSPACE,
        teamId: TEAM,
        number: 1,
        identifier: 'ENG-1',
        title: 'Fix the flake',
        description: '',
        dueDateSource: 'manual',
        stateId: 's-todo',
        priority: 0,
        sortOrder: 'V',
        projectId: 'project-1',
        dueDate: '2020-01-03',
        createdAt: AT,
        updatedAt: AT,
      },
    ],
  ];
  store.applyChanges(
    entities.map(([type, entity], index) => ({
      v: index + 1,
      type,
      id: entity.id,
      op: 'upsert' as const,
      actor: { type: 'system' as const },
      payload: entity,
    })) as Change[],
  );
  return store;
}

const GROUPS: readonly ViewGroup[] = [
  { key: 's-todo', label: 'Todo', stateId: 's-todo', ids: ['issue-1'] },
];

function renderBoard(properties: readonly DisplayProperty[]) {
  const engine = { store: seeded(), mutate: vi.fn() } as unknown as SyncEngine;
  render(
    <KeymapProvider>
      <EngineProvider engine={engine} status={{ phase: 'idle' }}>
        <Board
          groups={GROUPS}
          display={{ ...DEFAULT_DISPLAY, layout: 'board', properties }}
          selected={new Set()}
          cursorId={null}
          label="Engineering"
          onOpen={vi.fn()}
          onFocus={vi.fn()}
          onToggle={vi.fn()}
          onExtend={vi.fn()}
        />
      </EngineProvider>
    </KeymapProvider>,
  );
}

// jsdom lays nothing out; see Board.test.tsx for why a height is enough.
const VIEWPORT = { offsetWidth: 900, offsetHeight: 600 };

beforeAll(() => {
  for (const [property, value] of Object.entries(VIEWPORT)) {
    Object.defineProperty(HTMLElement.prototype, property, {
      configurable: true,
      get: () => value,
    });
  }
});

afterAll(() => {
  for (const property of Object.keys(VIEWPORT)) {
    delete (HTMLElement.prototype as unknown as Record<string, unknown>)[property];
  }
});

describe('a card', () => {
  it('draws the project as a pill when the display asks for it', () => {
    renderBoard(['project']);

    expect(screen.getByText('Onboarding')).toBeTruthy();
    expect(screen.getByText('🚀')).toBeTruthy();
  });

  it('leaves the project off when the display does not', () => {
    renderBoard(['priority']);

    expect(screen.queryByText('Onboarding')).toBeNull();
  });

  it('says overdue in words, not only in colour', () => {
    renderBoard(['dueDate']);

    expect(screen.getByText('overdue', { exact: false })).toBeTruthy();
  });
});
