/**
 * Posting a project update, and the two ways it used to go wrong quietly.
 *
 * The composer's submit handler was `async` with a `try/finally` and no `catch`, handed
 * straight to `<form onSubmit>`. A refusal — offline, a server that said no — rejected into
 * nothing: the posting flag cleared in `finally` and the form looked exactly as it does
 * after a successful post, so an update that never left the machine read as one that had.
 * And an all-whitespace body was sent, which puts an empty entry in a feed that is read top
 * to bottom.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { Store, type Change, type Entity, type Project } from '~/store';
import { ApiError } from '~/sync/api';
import type { SyncEngine } from '~/sync/engine';

import { ProjectOverview } from './ProjectOverview';

const WORKSPACE = '01900000-0000-7000-8000-000000000001';
const PROJECT = '01900000-0000-7000-8000-000000000002';
const VIEWER = '01900000-0000-7000-8000-000000000003';
const AT = '2026-01-01T00:00:00.000Z';

vi.mock('~/hooks/useViewer', () => ({
  useViewerId: () => VIEWER,
  useViewer: () => null,
}));

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

const project: Project = {
  id: PROJECT,
  workspaceId: WORKSPACE,
  name: 'Launch',
  description: '',
  color: '',
  statusId: 'ps-backlog',
  priority: 0,
  sortOrder: 'a',
  updateSchedule: 'default',
  createdAt: AT,
  updatedAt: AT,
};

function renderOverview(mutate: ReturnType<typeof vi.fn>) {
  const store = new Store(WORKSPACE);
  store.applyChanges([upsert(1, 'project', project)]);
  const engine = { store, mutate } as unknown as SyncEngine;
  render(
    <MemoryRouter initialEntries={[`/project/${PROJECT}`]}>
      <KeymapProvider>
        <EngineProvider
          engine={engine}
          status={{ phase: 'ready', connection: 'ready', pending: 0 }}
        >
          <Routes>
            <Route path="/project/:projectId" element={<ProjectOverview />} />
          </Routes>
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );
  return store;
}

describe('ProjectOverview', () => {
  it('says so when the update was refused', async () => {
    const user = userEvent.setup();
    const mutate = vi
      .fn()
      .mockRejectedValue(new ApiError('VALIDATION', 'The server refused that update'));
    renderOverview(mutate);

    await user.type(screen.getByLabelText('Update'), 'Shipped the importer');
    await user.click(screen.getByRole('button', { name: 'Post update' }));

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('The server refused that update');
    });
  });

  it('refuses an all-whitespace body without reaching the API', async () => {
    const user = userEvent.setup();
    const mutate = vi.fn().mockResolvedValue({});
    renderOverview(mutate);

    await user.type(screen.getByLabelText('Update'), '   ');
    await user.click(screen.getByRole('button', { name: 'Post update' }));

    expect(mutate).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain('An update needs something to say');
  });

  /**
   * Dependencies were drawn twice on this screen — once here, once in the properties rail —
   * and the two copies disagreed about whether you could add to them. The rail keeps them.
   */
  it('does not draw a second copy of the dependency panels', () => {
    renderOverview(vi.fn().mockResolvedValue({}));

    expect(screen.queryByRole('heading', { name: 'Blocked by' })).toBeNull();
  });
});
