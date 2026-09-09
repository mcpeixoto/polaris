/**
 * The project header after it stopped being three rows of chrome in one.
 *
 * The header row says where you are and how the project is going; the row beneath it holds
 * the sections and the rail's toggle. Status and target used to ride in the header as pills,
 * which meant every property of the project was on screen twice — once at the top and once
 * in the rail — and the copies were edited in different ways.
 *
 * The rail is the reader's, and it is remembered: folding it away on one project and finding
 * it open on the next is the software forgetting something it was told.
 */

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

function mount() {
  const store = new Store(WORKSPACE);
  store.applyChanges([upsert(1, 'projectStatus', status), upsert(2, 'project', project)]);
  const engine = { store, mutate: vi.fn().mockResolvedValue({}) } as unknown as SyncEngine;
  const view = render(
    <MemoryRouter initialEntries={[`/project/${PROJECT}`]}>
      <KeymapProvider>
        <EngineProvider engine={engine} status={READY}>
          <Routes>
            <Route path="/project/:projectId" element={<ProjectShell />} />
          </Routes>
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );
  return { user: userEvent.setup(), view };
}

beforeEach(() => {
  window.localStorage.clear();
});

describe('the project header', () => {
  it('carries the trail, the health and the actions, and no property pills', () => {
    mount();

    const header = screen.getByRole('banner');
    expect(within(header).getByRole('navigation', { name: 'Breadcrumb' })).toBeTruthy();
    expect(within(header).getByRole('button', { name: 'Add to favourites' })).toBeTruthy();
    expect(within(header).getByRole('button', { name: 'More actions' })).toBeTruthy();
    // The status and the target are the page's and the rail's; the header does not repeat
    // them. Both pills named their property through an `aria-describedby` span.
    expect(within(header).queryByText('Status')).toBeNull();
    expect(within(header).queryByText('Target date')).toBeNull();
  });

  /**
   * Overview, then Activity, then Issues — the two sections about the project as a whole
   * before the one about the work inside it. Attached views draw themselves after Issues,
   * because a saved view is a view of those issues.
   */
  it('draws the sections in one row, the project before the work in it', () => {
    mount();

    const tabs = screen.getByRole('navigation', { name: 'Project sections' });
    expect(
      within(tabs)
        .getAllByRole('link')
        .map((tab) => tab.textContent),
    ).toEqual(['Overview', 'Activity', 'Issues']);
  });

  it('folds the rail away from the tab row, and remembers that it is folded', async () => {
    const { user, view } = mount();

    const toggle = screen.getByRole('button', { name: 'Toggle properties' });
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('complementary', { name: 'Project properties' })).toBeTruthy();

    await user.click(toggle);

    expect(screen.queryByRole('complementary', { name: 'Project properties' })).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Toggle properties' }).getAttribute('aria-pressed'),
    ).toBe('false');

    // A second project, or the same one after a reload: the fold is a preference and not a
    // fact about this render.
    view.unmount();
    mount();
    expect(screen.queryByRole('complementary', { name: 'Project properties' })).toBeNull();
  });
});
