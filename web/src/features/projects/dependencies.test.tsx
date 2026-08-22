/**
 * A project's overview mounts this panel twice at once — the properties sidebar renders the
 * compact copy, the overview body renders the full one — and both of them used to register
 * `projectDetail.addBlockedBy`. The registry refuses a duplicate id by throwing, deliberately,
 * so the second mount threw during render and React unwound the whole tree: `/project/:id`
 * went blank, and every keystroke on it did nothing.
 *
 * The test is written as the composition rather than as the component, because the component
 * on its own was never wrong.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { Store, type Change, type Entity, type Project, type ProjectDependency } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { ProjectDependencies } from './dependencies';

const WORKSPACE = 'workspace-1';
const PROJECT = '01900000-0000-7000-8000-000000000001';
const OTHER = '01900000-0000-7000-8000-000000000002';
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

function project(id: string, name: string): Project {
  return {
    id,
    workspaceId: WORKSPACE,
    name,
    description: '',
    color: '#5e6ad2',
    statusId: 'ps-backlog',
    priority: 0,
    sortOrder: 'a',
    updateSchedule: 'default',
    createdAt: AT,
    updatedAt: AT,
  };
}

function dependency(id: string, blockingId: string, blockedId: string): ProjectDependency {
  return {
    id,
    workspaceId: WORKSPACE,
    blockingProjectId: blockingId,
    blockedProjectId: blockedId,
    createdAt: AT,
  };
}

function renderWith(store: Store, both = true) {
  const mutate = vi.fn().mockResolvedValue({});
  const engine = { store, mutate } as unknown as SyncEngine;
  render(
    <MemoryRouter>
      <KeymapProvider>
        <EngineProvider engine={engine} status={{ phase: 'idle' }}>
          <ProjectDependencies projectId={PROJECT} />
          {both ? <ProjectDependencies projectId={PROJECT} compact /> : null}
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );
  return { mutate };
}

describe('ProjectDependencies', () => {
  it('can be mounted twice for one project, as the overview does', () => {
    expect(() => renderWith(new Store(WORKSPACE))).not.toThrow();
    // Both copies are really there: the guard is that ids are claimed once, not that one of
    // the two panels stopped rendering.
    expect(screen.getAllByRole('heading', { name: 'Blocked by' })).toHaveLength(2);
    // And only the copy with visible add controls shows them.
    expect(screen.getAllByRole('button', { name: 'Add blocker…' })).toHaveLength(1);
  });

  /**
   * The panel drops a choice that is already linked rather than sending a write the server is
   * bound to refuse. Which project is already linked is a live query, and it used to answer
   * with a `Set` — which the store compares structurally, and a `Set` has no own enumerable
   * properties, so every `Set` compares equal to every other one. The query therefore answered
   * once, at mount, and never learned about a link made while the page was open: picking the
   * same blocker twice reached the API, came back "these projects are already linked that way",
   * and surfaced as an unhandled rejection in the console.
   */
  it('drops a choice that has been linked since the panel mounted', async () => {
    const user = userEvent.setup();
    const store = new Store(WORKSPACE);
    store.applyChanges([
      upsert(1, 'project', project(PROJECT, 'This project')),
      upsert(2, 'project', project(OTHER, 'The blocker')),
    ]);
    const { mutate } = renderWith(store, false);

    // The link arrives the way any link does once the panel is on screen — over the sync
    // stream, from this client's own write or from somebody else's.
    store.applyChanges([upsert(3, 'projectDependency', dependency('d1', OTHER, PROJECT))]);

    await user.click(screen.getByRole('button', { name: 'Add blocker…' }));
    await user.click(screen.getByRole('menuitem', { name: /The blocker/ }));

    expect(mutate).not.toHaveBeenCalled();
  });
});
