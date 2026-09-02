/**
 * The project's view tabs shipped the only two `window.prompt` / `window.confirm` calls in
 * the client: rename asked in a browser chrome box, and delete asked "Delete “X”?" with no
 * word about what was lost. Both are the product's own dialogs now.
 *
 * The other half is louder: every write here was `void fn()` with no catch, so a rejected
 * rename, reorder or delete left the tab bar exactly as it was and said nothing.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { EMPTY_FILTER } from '~/filter';
import { Store, type Change, type Entity } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { ProjectViewTabs } from './attachedViews';

const { deleteView, updateView } = vi.hoisted(() => ({
  deleteView: vi.fn(),
  updateView: vi.fn(),
}));

vi.mock('~/features/view/mutations', () => ({
  createView: vi.fn().mockResolvedValue(''),
  deleteView,
  updateView,
  isFavorite: () => false,
  toggleFavorite: vi.fn().mockResolvedValue(undefined),
}));

const WORKSPACE = 'w1';
const PROJECT = 'p1';
const VIEW = 'v1';
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

function seeded(): Store {
  const store = new Store(WORKSPACE);
  store.applyChanges([
    upsert(1, 'view', {
      id: VIEW,
      workspaceId: WORKSPACE,
      projectId: PROJECT,
      name: 'Bugs',
      filter: EMPTY_FILTER,
      display: {},
      position: 'a',
      createdAt: AT,
      updatedAt: AT,
    }),
  ]);
  return store;
}

function renderTabs() {
  const engine = { store: seeded(), mutate: vi.fn() } as unknown as SyncEngine;
  render(
    <MemoryRouter>
      <KeymapProvider>
        <EngineProvider engine={engine} status={{ phase: 'idle' }}>
          <ProjectViewTabs projectId={PROJECT} base={`/project/${PROJECT}`} />
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );
  return { user: userEvent.setup() };
}

/** Opens the tab's context menu and picks one of its items. */
async function chooseFromTabMenu(user: ReturnType<typeof userEvent.setup>, item: string) {
  await user.pointer({ keys: '[MouseRight]', target: screen.getByText('Bugs') });
  await user.click(await screen.findByRole('menuitem', { name: item }));
}

describe('project view tabs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renames through a dialog rather than window.prompt', async () => {
    const prompt = vi.spyOn(window, 'prompt');
    updateView.mockResolvedValue(undefined);
    const { user } = renderTabs();

    await chooseFromTabMenu(user, 'Rename');
    expect(prompt).not.toHaveBeenCalled();

    const field = await screen.findByLabelText('View name');
    await user.clear(field);
    await user.type(field, 'Regressions');
    await user.click(screen.getByRole('button', { name: 'Rename view' }));

    await waitFor(() => expect(updateView).toHaveBeenCalled());
    expect(updateView.mock.calls[0]?.[2]).toEqual({ name: 'Regressions' });
  });

  it('deletes behind a confirmation that names what goes away', async () => {
    const confirm = vi.spyOn(window, 'confirm');
    deleteView.mockResolvedValue(undefined);
    const { user } = renderTabs();

    await chooseFromTabMenu(user, 'Delete');
    expect(confirm).not.toHaveBeenCalled();

    expect(await screen.findByText(/The tab goes away for everyone/)).toBeTruthy();
    expect(deleteView).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Delete view' }));
    await waitFor(() => expect(deleteView).toHaveBeenCalledWith(expect.anything(), VIEW));
  });

  it('says so when a rename is refused instead of leaving the tab unchanged', async () => {
    updateView.mockRejectedValue(new Error('nope'));
    const { user } = renderTabs();

    await chooseFromTabMenu(user, 'Rename');
    const field = await screen.findByLabelText('View name');
    await user.clear(field);
    await user.type(field, 'Regressions');
    await user.click(screen.getByRole('button', { name: 'Rename view' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('That view could not be renamed.');
  });

  it('keeps the delete dialog open and says why when the delete is refused', async () => {
    deleteView.mockRejectedValue(new Error('nope'));
    const { user } = renderTabs();

    await chooseFromTabMenu(user, 'Delete');
    await user.click(await screen.findByRole('button', { name: 'Delete view' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('That view could not be deleted.');
    // Still open, so the reader can retry rather than wondering whether it worked.
    expect(screen.getByRole('button', { name: 'Delete view' })).toBeTruthy();
  });
});
