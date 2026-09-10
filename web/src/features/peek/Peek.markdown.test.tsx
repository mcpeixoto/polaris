/**
 * Peek used to dump the description source into a `<p>`, so markdown tokens were visible
 * rather than rendered. The inbox pane already rendered with Markdown; Peek follows that.
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

function seeded(description: string): Store {
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
        description,
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

describe('Peek description markdown', () => {
  it('renders emphasis instead of showing the markdown tokens', () => {
    const engine = {
      store: seeded('Fix the **login** path.'),
      mutate: vi.fn(),
    } as unknown as SyncEngine;

    render(
      <MemoryRouter>
        <KeymapProvider>
          <EngineProvider engine={engine} status={{ phase: 'idle' }}>
            <Peek open issueId={ISSUE} />
          </EngineProvider>
        </KeymapProvider>
      </MemoryRouter>,
    );

    expect(screen.getByText('login').tagName).toBe('STRONG');
    expect(screen.queryByText(/\*\*login\*\*/)).toBeNull();
  });
});
