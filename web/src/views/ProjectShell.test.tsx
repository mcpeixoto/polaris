/**
 * "No such project" is a claim, and the shell used to make it before it could know.
 *
 * `useLiveQuery` answers `null` both for a project that is not there and for one still on
 * the wire, and the shell mounts before the first snapshot finishes on purpose — so every
 * deep link on a cold start rendered a full-page "It may have been deleted" over a row that
 * was about to arrive, with a Go back button offering a way off a page that was about to
 * work.
 */

import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { Store, type Change, type Entity, type Project, type ProjectStatus } from '~/store';
import type { EngineStatus, SyncEngine } from '~/sync/engine';

import { ProjectShell } from './ProjectShell';

const WORKSPACE = '01900000-0000-7000-8000-000000000001';
const PROJECT = '01900000-0000-7000-8000-000000000002';
const STATUS = '01900000-0000-7000-8000-000000000003';
const VIEWER = '01900000-0000-7000-8000-000000000004';
const AT = '2026-01-01T00:00:00.000Z';
const READY: EngineStatus = { phase: 'ready', connection: 'ready', pending: 0 };

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

const status: ProjectStatus = {
  id: STATUS,
  workspaceId: WORKSPACE,
  name: 'In progress',
  color: '#5e6ad2',
  category: 'started',
  position: 'a',
  isDefault: true,
  createdAt: AT,
  updatedAt: AT,
};

const project: Project = {
  id: PROJECT,
  workspaceId: WORKSPACE,
  name: 'Launch',
  description: '',
  color: '',
  statusId: STATUS,
  priority: 0,
  sortOrder: 'a',
  targetDate: '2026-06-30',
  targetDateGranularity: 'quarter',
  updateSchedule: 'default',
  createdAt: AT,
  updatedAt: AT,
};

function renderShell(store: Store, status: EngineStatus) {
  const engine = { store, mutate: vi.fn().mockResolvedValue({}) } as unknown as SyncEngine;
  render(
    <MemoryRouter initialEntries={[`/project/${PROJECT}`]}>
      <KeymapProvider>
        <EngineProvider engine={engine} status={status}>
          <Routes>
            <Route path="/project/:projectId" element={<ProjectShell />} />
          </Routes>
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );
}

describe('ProjectShell', () => {
  it('waits rather than claiming the project is gone while the replica is filling', () => {
    renderShell(new Store(WORKSPACE), { phase: 'bootstrapping', received: 0 });

    expect(screen.queryByText('No such project')).toBeNull();
    expect(screen.getByRole('status').textContent).toContain('Loading project…');
  });

  it('says so once the store has settled and the project really is not there', () => {
    renderShell(new Store(WORKSPACE), READY);

    expect(screen.getByText('No such project')).not.toBeNull();
  });

  it('states the project it opened: name, status and the target date at its granularity', () => {
    const store = new Store(WORKSPACE);
    store.applyChanges([upsert(1, 'projectStatus', status), upsert(2, 'project', project)]);

    renderShell(store, READY);

    expect(screen.getByRole('heading', { name: 'Launch' })).not.toBeNull();
    // Twice on purpose: the header states it, the rail lets you change it.
    expect(screen.getAllByText('In progress').length).toBeGreaterThan(0);
    // A quarter target is a real day in the database and a three-month window on screen.
    expect(screen.getByText(/Q2 2026/)).not.toBeNull();
  });
});
