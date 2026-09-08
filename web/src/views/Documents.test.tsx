/**
 * The documents list: what it says while the snapshot is still arriving, how it files rows
 * into groups, and whether the keyboard and the right-click reach the same document.
 *
 * The screen used to be a bare `<ul>` of links on two routes nothing linked to. These are
 * the behaviours that replaced it — the scope column, the grouping, `j`/`k`/Enter and the
 * row menu — plus the one assertion that survived unchanged: an empty list is not an answer
 * until the replica has settled.
 */

import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { Store, type Change, type Entity } from '~/store';
import type { EngineStatus, SyncEngine } from '~/sync/engine';

import { Documents } from './Documents';

const WORKSPACE = 'w1';
const VIEWER = 'u1';
const ENG = 't1';
const DESIGN = 't2';
const PROJECT = 'p1';
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

function team(id: string, key: string, name: string): Entity {
  return {
    id,
    workspaceId: WORKSPACE,
    key,
    name,
    private: false,
    createdAt: AT,
    updatedAt: AT,
  } as unknown as Entity;
}

function doc(id: string, title: string, teamId: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    workspaceId: WORKSPACE,
    teamId,
    title,
    body: '',
    sortOrder: 'a',
    createdAt: AT,
    updatedAt: AT,
    ...extra,
  } as unknown as Entity;
}

/** Two teams, a project on one of them, and a document in each of the three places. */
function seeded(): Store {
  const store = new Store(WORKSPACE);
  store.applyChanges([
    upsert(1, 'team', team(ENG, 'ENG', 'Engineering')),
    upsert(2, 'team', team(DESIGN, 'DES', 'Design')),
    upsert(3, 'project', {
      id: PROJECT,
      workspaceId: WORKSPACE,
      name: 'Apollo',
      statusId: 's1',
      sortOrder: 'a',
      createdAt: AT,
      updatedAt: AT,
    } as unknown as Entity),
    upsert(4, 'document', doc('d1', 'Runbook', ENG, { updatedAt: '2026-02-03T00:00:00.000Z' })),
    upsert(5, 'document', doc('d2', 'Onboarding', ENG, { updatedAt: '2026-02-02T00:00:00.000Z' })),
    upsert(
      6,
      'document',
      doc('d3', 'Type scale', DESIGN, { updatedAt: '2026-02-01T00:00:00.000Z' }),
    ),
    upsert(
      7,
      'document',
      doc('d4', 'Apollo spec', ENG, {
        projectId: PROJECT,
        updatedAt: '2026-01-30T00:00:00.000Z',
      }),
    ),
  ]);
  return store;
}

afterEach(cleanup);

function mount(
  store: Store,
  mutate: ReturnType<typeof vi.fn>,
  status: EngineStatus,
  at = '/documents',
) {
  render(
    <MemoryRouter initialEntries={[at]}>
      <KeymapProvider>
        <EngineProvider engine={{ store, mutate } as unknown as SyncEngine} status={status}>
          <Routes>
            <Route path="/documents" element={<Documents />} />
            <Route path="/team/:teamKey/documents" element={<Documents />} />
            <Route path="/document/:documentId" element={<div>Document screen</div>} />
          </Routes>
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );
  return { user: userEvent.setup() };
}

describe('Documents', () => {
  it('does not claim a team has no documents while the snapshot is still arriving', () => {
    mount(new Store(WORKSPACE), vi.fn(), { phase: 'bootstrapping', received: 2 }, '/documents');

    expect(screen.getByRole('status').textContent).toBe('Loading documents…');
    expect(screen.queryByText('No documents yet')).toBeNull();
  });

  it('groups the workspace list by the team or project each document was filed under', () => {
    mount(seeded(), vi.fn(), { phase: 'idle' });

    // One group per place, named for it, with its own count beside the name.
    const groups = screen
      .getAllByRole('button', { expanded: true })
      .map((button) => button.textContent);
    expect(groups).toEqual(['Engineering2', 'Design1', 'Engineering › Apollo1']);
    // And the scope column says where a row lives without opening it.
    expect(screen.getAllByText('Engineering').length).toBeGreaterThan(0);
    expect(screen.getByText('Apollo')).toBeTruthy();
  });

  it('narrows to the team’s own documents on the team route', () => {
    mount(seeded(), vi.fn(), { phase: 'idle' }, '/team/ENG/documents');

    expect(screen.getByText('Runbook')).toBeTruthy();
    // Another team's, and this team's project documents, are out of scope here.
    expect(screen.queryByText('Type scale')).toBeNull();
    expect(screen.queryByText('Apollo spec')).toBeNull();
  });

  it('filters by title as the search is typed', async () => {
    const { user } = mount(seeded(), vi.fn(), { phase: 'idle' });

    await user.type(screen.getByLabelText('Search documents'), 'onboard');

    expect(screen.getByText('Onboarding')).toBeTruthy();
    expect(screen.queryByText('Runbook')).toBeNull();
  });

  it('moves the cursor with j and k, and opens with Enter', async () => {
    const { user } = mount(seeded(), vi.fn(), { phase: 'idle' });

    const list = screen.getByRole('listbox', { name: 'Documents' });
    list.focus();
    // The list is sorted by last update, so the cursor starts on Runbook.
    expect(list.getAttribute('aria-activedescendant')).toBe('documentList-row-d1');

    await user.keyboard('j');
    expect(list.getAttribute('aria-activedescendant')).toBe('documentList-row-d2');
    await user.keyboard('k');
    expect(list.getAttribute('aria-activedescendant')).toBe('documentList-row-d1');

    await user.keyboard('{Enter}');
    expect(screen.getByText('Document screen')).toBeTruthy();
  });

  it('offers the row menu on a right-click, on the row that was clicked', async () => {
    const { user } = mount(seeded(), vi.fn(), { phase: 'idle' });

    await user.pointer({
      keys: '[MouseRight]',
      target: screen.getByText('Onboarding'),
    });

    const menu = screen.getByRole('menu', { name: 'Options for Onboarding' });
    for (const label of [
      'Open document',
      'Copy link',
      'Add to favourites',
      'Archive document',
      'Delete document',
    ]) {
      expect(within(menu).getByRole('menuitem', { name: label })).toBeTruthy();
    }
  });

  it('asks before deleting from the row menu, and names what goes', async () => {
    const mutate = vi.fn();
    const { user } = mount(seeded(), mutate, { phase: 'idle' });

    await user.pointer({ keys: '[MouseRight]', target: screen.getByText('Onboarding') });
    await user.click(screen.getByRole('menuitem', { name: 'Delete document' }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/Onboarding/)).toBeTruthy();
    // The click opened a question, not a deletion.
    expect(mutate).not.toHaveBeenCalled();
  });
});
