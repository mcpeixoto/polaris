/**
 * Peek is the issue screen in one column: the identifier, the title, the description, then
 * a "Properties" rail whose rows read the way the screen's do — including the words an
 * unset property uses, so what a person learns on one surface holds on the other.
 */

import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { Store, type Change, type Entity } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { Peek } from './Peek';

afterEach(cleanup);

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
        timezone: 'UTC',
        private: false,
        estimateScale: 'none',
        estimateAllowZero: false,
        estimateExtended: false,
        createdAt: AT,
        updatedAt: AT,
      } as unknown as Entity,
    ],
    [
      'workflowState',
      {
        id: TODO,
        workspaceId: WORKSPACE,
        teamId: TEAM,
        name: 'Todo',
        category: 'unstarted',
        position: 'a',
        isSystem: false,
        createdAt: AT,
        updatedAt: AT,
      } as unknown as Entity,
    ],
    [
      'issue',
      {
        id: ISSUE,
        workspaceId: WORKSPACE,
        teamId: TEAM,
        number: 7,
        title: 'Ship the importer',
        description: '',
        priority: 0,
        stateId: TODO,
        dueDateSource: 'manual',
        sortOrder: 'a',
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

describe('Peek, laid out as the issue screen', () => {
  it('draws a properties rail under the description with the screen’s words for what is unset', () => {
    const engine = { store: seeded(), mutate: vi.fn() } as unknown as SyncEngine;
    render(
      <MemoryRouter>
        {/* Peek's rail draws the chord that does the same thing from the keyboard, and a
          key cap has to be able to ask the registry how to spell itself on this platform. */}
        <KeymapProvider>
          <EngineProvider engine={engine} status={{ phase: 'idle' }}>
            <Peek open issueId={ISSUE} />
          </EngineProvider>
        </KeymapProvider>
      </MemoryRouter>,
    );

    expect(screen.getByText('ENG-7')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Ship the importer' })).toBeTruthy();
    expect(screen.getByText('No description.')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Properties' })).toBeTruthy();

    // Every row keeps its label for the accessibility tree even though only the glyph and
    // the value are drawn.
    for (const label of [
      'Status',
      'Priority',
      'Assignee',
      'Due date',
      'Cycle',
      'Project',
      'Labels',
    ]) {
      expect(screen.getByText(label, { selector: 'dt' })).toBeTruthy();
    }
    expect(screen.getByText('Todo')).toBeTruthy();
    expect(screen.getByText('Unassigned')).toBeTruthy();
    expect(screen.getByText('No due date')).toBeTruthy();
    expect(screen.getByText('No cycle')).toBeTruthy();
    expect(screen.getByText('No project')).toBeTruthy();
    expect(screen.getByText('No labels')).toBeTruthy();
  });
});
