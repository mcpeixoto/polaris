/**
 * Nested initiatives list: children indent under live parents.
 */

import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { Store, type Change, type Entity } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { Initiatives } from './Initiatives';

const WORKSPACE = 'w1';
const VIEWER = 'u1';
const AT = '2026-01-01T00:00:00.000Z';

function upsert(v: number, type: Change['type'], entity: Entity): Change {
  return {
    v,
    type,
    id: entity.id,
    op: 'upsert',
    actor: { type: 'user', id: VIEWER },
    payload: entity,
  };
}

function initiative(id: string, name: string, sortOrder: string): Entity {
  return {
    id,
    workspaceId: WORKSPACE,
    name,
    description: '',
    status: 'planned',
    priority: 0,
    sortOrder,
    createdAt: AT,
    updatedAt: AT,
  };
}

describe('Initiatives list nesting', () => {
  it('indents a child under its parent and shows the label chip', () => {
    const store = new Store(WORKSPACE);
    store.applyChanges([
      upsert(1, 'initiative', initiative('parent', 'Company goals', 'a')),
      upsert(2, 'initiative', initiative('child', 'Platform reliability', 'b')),
      upsert(3, 'initiativeLabel', {
        id: 'il1',
        workspaceId: WORKSPACE,
        name: 'Platform',
        color: '#5e6ad2',
        isGroup: false,
        position: 'a0',
        createdAt: AT,
        updatedAt: AT,
      }),
      upsert(4, 'initiativeLabelLink', {
        id: 'ill1',
        workspaceId: WORKSPACE,
        initiativeId: 'child',
        labelId: 'il1',
        createdAt: AT,
      }),
      upsert(5, 'initiativeRelation', {
        id: 'ir1',
        workspaceId: WORKSPACE,
        parentInitiativeId: 'parent',
        childInitiativeId: 'child',
        sortOrder: 'a',
        createdAt: AT,
      }),
    ]);
    const engine = { store, mutate: async () => ({}) } as unknown as SyncEngine;
    render(
      <MemoryRouter>
        <KeymapProvider>
          <EngineProvider engine={engine} status={{ phase: 'idle' }}>
            <Initiatives />
          </EngineProvider>
        </KeymapProvider>
      </MemoryRouter>,
    );

    const parent = screen.getByRole('link', { name: /Company goals/ });
    const child = screen.getByRole('link', { name: /Platform reliability/ });
    expect(parent.compareDocumentPosition(child) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(child.style.paddingInlineStart).toContain('1');
    expect(screen.getByText('Platform')).toBeTruthy();
  });
});
