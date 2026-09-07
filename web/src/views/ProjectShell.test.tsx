/**
 * The project header: what it says, and what it lets you do from there.
 *
 * "No such project" is a claim, and the shell used to make it before it could know.
 *
 * `useLiveQuery` answers `null` both for a project that is not there and for one still on
 * the wire, and the shell mounts before the first snapshot finishes on purpose — so every
 * deep link on a cold start rendered a full-page "It may have been deleted" over a row that
 * was about to arrive, with a Go back button offering a way off a page that was about to
 * work.
 */

import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import {
  Store,
  type Change,
  type Entity,
  type Favorite,
  type Project,
  type ProjectStatus,
} from '~/store';
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
  const mutate = vi.fn().mockResolvedValue({});
  const engine = { store, mutate } as unknown as SyncEngine;
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
  return { mutate };
}

function seeded(): Store {
  const store = new Store(WORKSPACE);
  store.applyChanges([upsert(1, 'projectStatus', status), upsert(2, 'project', project)]);
  return store;
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
    renderShell(seeded(), READY);

    // The name is the field you rename it in, and it is the last crumb of the trail.
    expect((screen.getByLabelText('Project name') as HTMLTextAreaElement).value).toBe('Launch');
    // Twice on purpose: the header pill states it, the rail lets you change it.
    expect(screen.getAllByText('In progress').length).toBeGreaterThan(0);
    // A quarter target is a real day in the database and a three-month window on screen.
    expect(screen.getAllByText(/Q2 2026/).length).toBeGreaterThan(0);
  });

  it('names the project in a heading, for somebody navigating by them', () => {
    renderShell(seeded(), READY);

    // The visible name is a textarea in the last crumb, which is no heading at all — so
    // the screen carries a hidden `<h1>` beside it rather than leaving a reader arriving
    // by heading with nothing saying which project this is.
    expect(screen.getByRole('heading', { level: 1, name: 'Launch' })).not.toBeNull();
  });

  it('says where you are: Projects, then this project', () => {
    renderShell(seeded(), READY);

    const trail = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(trail.textContent).toContain('Projects');
    expect(trail.querySelector('a')?.getAttribute('href')).toBe('/projects');
  });

  it('favourites the project, and the star says which way it is', async () => {
    const user = userEvent.setup();
    const { mutate } = renderShell(seeded(), READY);

    const star = screen.getByRole('button', { name: 'Add to favourites' });
    expect(star.getAttribute('aria-pressed')).toBe('false');

    await user.click(star);

    // A favourite is a row of its own, so the write carries one rather than patching the
    // project — which is what makes it the viewer's and not the workspace's.
    const patch = mutate.mock.calls[0]![0].optimistic[0];
    expect(patch.type).toBe('favorite');
    expect(patch.after.kind).toBe('project');
    expect(patch.after.targetId).toBe(PROJECT);
  });

  it('draws the star as on when the viewer already has one', () => {
    const store = seeded();
    const favorite: Favorite = {
      id: '01900000-0000-7000-8000-00000000000f',
      workspaceId: WORKSPACE,
      userId: VIEWER,
      kind: 'project',
      targetId: PROJECT,
      position: 'a',
      createdAt: AT,
      updatedAt: AT,
    };
    store.applyChanges([upsert(3, 'favorite', favorite)]);

    renderShell(store, READY);

    expect(
      screen.getByRole('button', { name: 'Remove from favourites' }).getAttribute('aria-pressed'),
    ).toBe('true');
  });

  it('renames on blur, and keeps what you are typing when the name changes underneath', async () => {
    const user = userEvent.setup();
    const store = seeded();
    const { mutate } = renderShell(store, READY);

    const field = screen.getByLabelText('Project name');
    await user.click(field);
    await user.type(field, ' day one');

    // Somebody else renames it while the caret is still in the field. The draft is the
    // reader's and survives; a keyed field would have thrown the sentence away.
    await act(async () => {
      store.applyChanges([upsert(4, 'project', { ...project, name: 'Renamed elsewhere' })]);
    });
    expect((field as HTMLTextAreaElement).value).toBe('Launch day one');

    await user.tab();

    const call = mutate.mock.calls.find((entry) => entry[0].optimistic?.[0]?.type === 'project');
    expect(call?.[0].variables.input.name).toBe('Launch day one');
  });

  it('opens the status picker on S', async () => {
    const user = userEvent.setup();
    renderShell(seeded(), READY);

    await user.click(screen.getByRole('navigation', { name: 'Breadcrumb' }));
    await user.keyboard('s');

    expect(screen.getByRole('menu', { name: 'Project status' })).not.toBeNull();
  });
});
