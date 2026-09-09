/**
 * The initiatives table after the Linear pass: which columns it names and in what order,
 * what a health cell says, and the one control on a row that is not the row.
 *
 * The column order is asserted as an order rather than as a set, because the set was already
 * right and the order was the whole change: health beside the name is what makes the table
 * scannable for the question it is usually opened with.
 */

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useParams } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { Store, type Change, type Entity } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { Initiatives } from './Initiatives';

const WORKSPACE = 'w1';
const AT = '2026-01-01T00:00:00.000Z';
const TWO_WEEKS_AGO = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

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

function initiative(id: string, name: string, extra: Record<string, unknown> = {}): Entity {
  return {
    id,
    workspaceId: WORKSPACE,
    name,
    description: '',
    status: 'active',
    priority: 0,
    sortOrder: id,
    createdAt: AT,
    updatedAt: AT,
    ...extra,
  } as Entity;
}

function renderList() {
  const store = new Store(WORKSPACE);
  store.applyChanges([
    upsert(1, 'initiative', initiative('a', 'Company goals', { icon: 'icon:cube' })),
    upsert(2, 'initiative', initiative('b', 'Someday')),
    upsert(3, 'initiativeUpdate', {
      id: 'iu1',
      workspaceId: WORKSPACE,
      initiativeId: 'a',
      health: 'on_track',
      body: '',
      authorId: 'u1',
      createdAt: TWO_WEEKS_AGO,
      updatedAt: TWO_WEEKS_AGO,
    }),
  ]);
  const mutate = vi.fn().mockResolvedValue({});
  const engine = { store, mutate } as unknown as SyncEngine;
  render(
    <MemoryRouter initialEntries={['/initiatives']}>
      <KeymapProvider>
        <EngineProvider engine={engine} status={{ phase: 'idle' }}>
          <Routes>
            <Route path="/initiatives" element={<Initiatives />} />
            <Route path="/initiative/:initiativeId" element={<Opened />} />
          </Routes>
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );
  return { mutate, user: userEvent.setup() };
}

/** Stands in for the initiative screen, so "did the click navigate" is a visible fact. */
function Opened() {
  const { initiativeId } = useParams<{ initiativeId: string }>();
  return <p>opened {initiativeId}</p>;
}

/** The row a link sits in. */
function rowOf(name: RegExp): HTMLElement {
  const row = screen.getByRole('link', { name }).closest('li');
  if (row === null) throw new Error('row not found');
  return row;
}

describe('Initiatives table columns', () => {
  it('leads with the name and the health, and keeps the six Linear columns in order', () => {
    renderList();
    const listbox = screen.getByRole('listbox', { name: 'Initiatives' });
    const header = within(listbox).getByText('Name').parentElement;
    if (header === null) throw new Error('the column header is not in the document');

    expect([...header.children].map((cell) => cell.textContent)).toEqual([
      'Name',
      'Health',
      'Status',
      'Labels',
      'Owner',
      'Target date',
      'Projects',
      'Progress',
    ]);
  });

  it('says the health as a word and how old it is', () => {
    renderList();
    const cell = rowOf(/Company goals/);
    expect(within(cell).getByText('On track')).toBeTruthy();
    expect(within(cell).getByText('· 2w')).toBeTruthy();
  });

  it('says so rather than showing nothing when no update has been posted', () => {
    renderList();
    expect(within(rowOf(/Someday/)).getByText('No updates')).toBeTruthy();
  });
});

describe('Initiatives table status tabs', () => {
  it('offers the two everyday scopes before everything', () => {
    renderList();
    const pills = screen.getByRole('group', { name: 'Status' });
    expect(
      within(pills)
        .getAllByRole('button')
        .map((pill) => pill.textContent),
    ).toEqual(['Active', 'Planned', 'All initiatives', 'Proposed', 'Completed', 'Canceled']);
  });
});

describe('the icon on an initiative row', () => {
  it('opens the picker instead of opening the initiative', async () => {
    const { user } = renderList();
    const mark = within(rowOf(/Company goals/)).getByRole('button', {
      name: 'Change initiative icon',
    });

    await user.click(mark);

    expect(screen.getByRole('dialog', { name: 'Initiative icon' })).toBeTruthy();
    expect(screen.queryByText('opened a')).toBeNull();
    expect(screen.getByRole('link', { name: /Company goals/ })).toBeTruthy();
  });
});
