/**
 * The initiatives table's status pills, and the columns above the rows.
 */

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { Store, type Change, type Entity } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { Initiatives, resolveInitiativeStatusFilter } from './Initiatives';

const WORKSPACE = 'w1';
const AT = '2026-01-01T00:00:00.000Z';

function upsert(v: number, type: Change['type'], entity: Entity): Change {
  return {
    v,
    type,
    id: entity.id,
    op: 'upsert',
    actor: { type: 'user', id: 'u1' },
    payload: entity,
  };
}

function initiative(id: string, name: string, status: string): Entity {
  return {
    id,
    workspaceId: WORKSPACE,
    name,
    description: '',
    status,
    priority: 0,
    sortOrder: id,
    createdAt: AT,
    updatedAt: AT,
  } as Entity;
}

function renderList(url = '/initiatives') {
  const store = new Store(WORKSPACE);
  store.applyChanges([
    upsert(1, 'initiative', initiative('a', 'Company goals', 'active')),
    upsert(2, 'initiative', initiative('b', 'Someday', 'planned')),
  ]);
  const engine = { store, mutate: async () => ({}) } as unknown as SyncEngine;
  render(
    <MemoryRouter initialEntries={[url]}>
      <KeymapProvider>
        <EngineProvider engine={engine} status={{ phase: 'idle' }}>
          <Initiatives />
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );
}

describe('Initiatives table', () => {
  it('names its columns above the rows', () => {
    renderList();
    for (const label of ['Name', 'Health', 'Owner', 'Target date', 'Progress']) {
      expect(screen.getByText(label)).toBeTruthy();
    }
  });

  it('reads the status filter out of the URL and shows only that status', () => {
    renderList('/initiatives?status=active');
    expect(screen.getByText('Company goals')).toBeTruthy();
    expect(screen.queryByText('Someday')).toBeNull();
  });

  it('switches the filter from the pills', async () => {
    const user = userEvent.setup();
    renderList();
    const pills = screen.getByRole('group', { name: 'Status' });
    await user.click(within(pills).getByRole('button', { name: 'Planned' }));
    expect(screen.queryByText('Company goals')).toBeNull();
    expect(screen.getByText('Someday')).toBeTruthy();
  });

  it('distinguishes an empty result from an empty workspace', async () => {
    const user = userEvent.setup();
    renderList('/initiatives?status=canceled');
    expect(screen.getByText('Nothing matches this filter')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Show all initiatives' }));
    expect(screen.getByText('Company goals')).toBeTruthy();
  });
});

describe('resolveInitiativeStatusFilter', () => {
  it('falls back to all for anything that is not a status', () => {
    expect(resolveInitiativeStatusFilter(new URLSearchParams('status=bogus'))).toBe('all');
    expect(resolveInitiativeStatusFilter(new URLSearchParams('status=active'))).toBe('active');
  });
});
