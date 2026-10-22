/**
 * Escape, over the rename-view dialog.
 *
 * The box opens holding the view's current name, which makes the first case the one that
 * matters: a rename somebody opened from the context menu and thought better of must close
 * on Escape without a question. "Non-empty" as the test for dirty would ask every time, and
 * a question asked every time is a question nobody reads.
 */

import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { EMPTY_FILTER } from '~/filter';
import { Store, type Change, type Entity } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { ProjectViewTabs } from './attachedViews';

const { updateView } = vi.hoisted(() => ({ updateView: vi.fn() }));

vi.mock('~/features/view/mutations', () => ({
  createView: vi.fn().mockResolvedValue(''),
  deleteView: vi.fn(),
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

function renderTabs() {
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
  const engine = { store, mutate: vi.fn() } as unknown as SyncEngine;
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

async function openRename() {
  const { user } = renderTabs();
  await user.pointer({ keys: '[MouseRight]', target: screen.getByText('Bugs') });
  await user.click(await screen.findByRole('menuitem', { name: 'Rename' }));
  await screen.findByRole('dialog', { name: 'Rename view' });
  return { user };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(cleanup);

describe('discarding a view rename', () => {
  it('closes on Escape when the name is untouched', async () => {
    const { user } = await openRename();

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog', { name: 'Discard these changes?' })).toBeNull();
    expect(screen.queryByRole('dialog', { name: 'Rename view' })).toBeNull();
    expect(updateView).not.toHaveBeenCalled();
  });

  it('asks once the name has been changed', async () => {
    const { user } = await openRename();

    await user.type(screen.getByLabelText('View name'), 'ness');
    await user.keyboard('{Escape}');

    expect(await screen.findByRole('dialog', { name: 'Discard these changes?' })).toBeTruthy();
    expect(screen.getByRole('dialog', { name: 'Rename view' })).toBeTruthy();
  });

  it('closes on discard, and renames nothing', async () => {
    const { user } = await openRename();

    await user.type(screen.getByLabelText('View name'), 'ness');
    await user.keyboard('{Escape}');
    const question = await screen.findByRole('dialog', { name: 'Discard these changes?' });
    await user.click(within(question).getByRole('button', { name: 'Discard' }));

    expect(screen.queryByRole('dialog', { name: 'Rename view' })).toBeNull();
    expect(updateView).not.toHaveBeenCalled();
  });

  it('keeps the dialog, and the typed name, on keep editing', async () => {
    const { user } = await openRename();

    await user.type(screen.getByLabelText('View name'), 'ness');
    await user.keyboard('{Escape}');
    const question = await screen.findByRole('dialog', { name: 'Discard these changes?' });
    await user.click(within(question).getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('dialog', { name: 'Discard these changes?' })).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Rename view' })).toBeTruthy();
    expect((screen.getByLabelText('View name') as HTMLInputElement).value).toBe('Bugsness');
  });
});
