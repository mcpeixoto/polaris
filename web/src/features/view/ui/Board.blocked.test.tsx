/**
 * The blocked flag on a card.
 *
 * A sibling file because it needs a second issue and a relation between the two, which the
 * shared card seed deliberately does not carry. The rule being held is the one that keeps the
 * mark honest: a blocker that has been finished is not in the way, and a card that kept
 * flagging it would teach people to ignore the flag.
 */

import { render, screen, within } from '@testing-library/react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { DEFAULT_DISPLAY } from '~/filter';
import { Store, type Change, type Entity } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { Board } from './Board';
import type { ViewGroup } from './useView';

vi.mock('~/hooks/useViewer', () => ({ useViewerId: () => 'user-ada' }));

const WORKSPACE = 'workspace-1';
const TEAM = 'team-1';
const AT = '2026-01-01T00:00:00Z';

function seeded(blockerState: string): Store {
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
      } as unknown as Entity,
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
      } as unknown as Entity,
    ],
    [
      'workflowState',
      {
        id: 's-done',
        workspaceId: WORKSPACE,
        teamId: TEAM,
        name: 'Done',
        color: '#4cb782',
        category: 'completed',
        position: 'W',
        isDefault: false,
        isSystem: false,
        createdAt: AT,
        updatedAt: AT,
      } as unknown as Entity,
    ],
    [
      'issue',
      {
        id: 'issue-1',
        workspaceId: WORKSPACE,
        teamId: TEAM,
        number: 1,
        identifier: 'ENG-1',
        title: 'Ship the importer',
        description: '',
        dueDateSource: 'manual',
        stateId: 's-todo',
        priority: 0,
        sortOrder: 'V',
        createdAt: AT,
        updatedAt: AT,
      } as unknown as Entity,
    ],
    [
      'issue',
      {
        id: 'issue-2',
        workspaceId: WORKSPACE,
        teamId: TEAM,
        number: 2,
        identifier: 'ENG-2',
        title: 'Land the migration',
        description: '',
        dueDateSource: 'manual',
        stateId: blockerState,
        priority: 0,
        sortOrder: 'W',
        createdAt: AT,
        updatedAt: AT,
      } as unknown as Entity,
    ],
    [
      'issueRelation',
      {
        id: 'rel-1',
        workspaceId: WORKSPACE,
        // ENG-2 blocks ENG-1: only `blocks` is stored, so this is what "ENG-1 is blocked by
        // ENG-2" looks like in the replica.
        issueId: 'issue-2',
        relatedIssueId: 'issue-1',
        type: 'blocks',
        teamId: TEAM,
        relatedTeamId: TEAM,
        createdAt: AT,
      } as unknown as Entity,
    ],
  ];
  store.applyChanges(
    entities.map(([type, entity], index) => ({
      v: index + 1,
      type,
      id: (entity as { id: string }).id,
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

function renderBoard(blockerState: string) {
  const engine = { store: seeded(blockerState), mutate: vi.fn() } as unknown as SyncEngine;
  render(
    <KeymapProvider>
      <EngineProvider engine={engine} status={{ phase: 'idle' }}>
        <Board
          groups={GROUPS}
          display={{ ...DEFAULT_DISPLAY, layout: 'board' }}
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

describe('a blocked card', () => {
  it('names its blocker in words as well as in colour', () => {
    renderBoard('s-todo');

    const card = screen.getByRole('option', { name: /Ship the importer/ });
    // The word, not only the flag: colour is never the only carrier of meaning, and a red
    // glyph beside an identifier says nothing to a reader who cannot see it.
    expect(within(card).getByText('Blocked by ENG-2')).toBeTruthy();
  });

  it('stops flagging once the blocker is finished', () => {
    renderBoard('s-done');

    const card = screen.getByRole('option', { name: /Ship the importer/ });
    expect(within(card).queryByText(/^Blocked by/)).toBeNull();
  });
});
