/**
 * Seeding a saved view's filter — and, above all, not doing it twice.
 *
 * The rule these prove is the one the URL cannot express: arriving at a view with a bare
 * address bar and clearing the filter bar on a view you are already looking at leave the
 * *same* search params behind, and only one of them should be answered with the saved
 * filter. A guard that reads the params alone cannot tell them apart, and under it the last
 * chip somebody removed came straight back.
 */

import { render, screen } from '@testing-library/react';
import { act } from 'react';
import { MemoryRouter, Route, Routes, useLocation, useSearchParams } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { FILTER_PARAM } from '~/filter';
import { Store, type Change, type View } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { useSavedFilter } from './useSavedFilter';

const WORKSPACE = 'workspace-1';
const PROJECT = 'project-1';
const AT = '2026-01-01T00:00:00Z';

function view(id: string, overrides: Partial<View> = {}): View {
  return {
    id,
    workspaceId: WORKSPACE,
    name: id,
    filter: { field: 'priority', op: 'eq', values: ['1'] },
    display: {},
    position: 'V',
    createdAt: AT,
    updatedAt: AT,
    ...overrides,
  };
}

function storeWith(...views: View[]): Store {
  const store = new Store(WORKSPACE);
  store.applyChanges(
    views.map((row, index): Change => ({
      v: index + 1,
      type: 'view',
      id: row.id,
      op: 'upsert',
      actor: { type: 'system' },
      payload: row,
    })),
  );
  return store;
}

/** The screen, reduced to the two things these tests are about: the hook and the URL. */
function Screen({ viewId, projectId }: { viewId: string; projectId?: string }) {
  useSavedFilter(viewId, projectId);
  const location = useLocation();
  const [, setParams] = useSearchParams();
  return (
    <>
      <span data-testid="search">{location.search}</span>
      {/* What the filter bar's last `Remove filter` does: hand back a tree matching
          everything, which `useView` writes as the absence of the parameter. */}
      <button type="button" onClick={() => setParams(new URLSearchParams(), { replace: true })}>
        Clear
      </button>
    </>
  );
}

function renderScreen(store: Store, path: string, projectId?: string) {
  const engine = { store, mutate: vi.fn() } as unknown as SyncEngine;
  render(
    <MemoryRouter initialEntries={[path]}>
      <EngineProvider engine={engine} status={{ phase: 'idle' }}>
        <Routes>
          <Route
            path="/view/:viewId"
            element={<Screen viewId="v-1" {...(projectId === undefined ? {} : { projectId })} />}
          />
        </Routes>
      </EngineProvider>
    </MemoryRouter>,
  );
  return { store };
}

function search(): string {
  return screen.getByTestId('search').textContent ?? '';
}

describe('useSavedFilter', () => {
  it('writes the saved filter into a bare URL', () => {
    renderScreen(storeWith(view('v-1')), '/view/v-1');
    expect(search()).toBe('?filter=priority.eq(1)');
  });

  it('leaves a filter the link already carried alone', () => {
    renderScreen(storeWith(view('v-1')), '/view/v-1?filter=priority.eq(4)');
    expect(search()).toBe('?filter=priority.eq(4)');
  });

  it('does not put the saved filter back when the bar is cleared', async () => {
    renderScreen(storeWith(view('v-1')), '/view/v-1');
    expect(search()).toContain(FILTER_PARAM);

    await act(async () => {
      screen.getByRole('button', { name: 'Clear' }).click();
    });

    expect(search()).toBe('');
  });

  it('does not put it back when the link carried its own filter either', async () => {
    renderScreen(storeWith(view('v-1')), '/view/v-1?filter=priority.eq(4)');

    await act(async () => {
      screen.getByRole('button', { name: 'Clear' }).click();
    });

    expect(search()).toBe('');
  });

  it('seeds once the row arrives, not before', async () => {
    const store = new Store(WORKSPACE);
    renderScreen(store, '/view/v-1');
    expect(search()).toBe('');

    await act(async () => {
      store.applyChanges([
        {
          v: 1,
          type: 'view',
          id: 'v-1',
          op: 'upsert',
          actor: { type: 'system' },
          payload: view('v-1'),
        } as Change,
      ]);
    });

    expect(search()).toBe('?filter=priority.eq(1)');
  });

  it('says nothing for a view whose saved filter matches everything', () => {
    renderScreen(storeWith(view('v-1', { filter: { conj: 'and', nodes: [] } })), '/view/v-1');
    expect(search()).toBe('');
  });

  it('ignores a row attached to a different project', () => {
    renderScreen(storeWith(view('v-1', { projectId: 'project-2' })), '/view/v-1', PROJECT);
    expect(search()).toBe('');
  });

  it('seeds a row attached to this project', () => {
    renderScreen(storeWith(view('v-1', { projectId: PROJECT })), '/view/v-1', PROJECT);
    expect(search()).toBe('?filter=priority.eq(1)');
  });
});
