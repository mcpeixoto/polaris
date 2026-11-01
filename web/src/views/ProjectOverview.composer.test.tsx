/**
 * The overview's way into the update dialog, and the latest update drawn as markdown.
 */

import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { Store, type Change, type Entity } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { ProjectActivity } from './ProjectActivity';
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

function mount(screenUnderTest: 'overview' | 'activity' = 'overview') {
  const store = new Store(WORKSPACE);
  store.applyChanges([
    upsert(1, 'project', {
      id: PROJECT,
      workspaceId: WORKSPACE,
      name: 'Launch',
      summary: '',
      description: '',
      color: '',
      statusId: 'ps-backlog',
      priority: 0,
      sortOrder: 'a',
      updateSchedule: 'default',
      createdAt: AT,
      updatedAt: AT,
    } as Entity),
    upsert(2, 'projectUpdate', {
      id: 'pu1',
      workspaceId: WORKSPACE,
      projectId: PROJECT,
      health: 'at_risk',
      body: 'Not **done** yet',
      authorId: VIEWER,
      createdAt: AT,
      updatedAt: AT,
    } as Entity),
  ]);
  const mutate = vi.fn().mockResolvedValue({
    createProjectUpdate: {
      projectUpdate: {
        id: 'pu2',
        workspaceId: WORKSPACE,
        projectId: PROJECT,
        health: 'AT_RISK',
        body: 'Better now',
        authorId: VIEWER,
        createdAt: AT,
        updatedAt: AT,
      },
    },
  });
  const engine = { store, mutate } as unknown as SyncEngine;
  render(
    <MemoryRouter initialEntries={[`/project/${PROJECT}`]}>
      <KeymapProvider>
        <EngineProvider
          engine={engine}
          status={{ phase: 'ready', connection: 'ready', pending: 0 }}
        >
          <Routes>
            <Route
              path="/project/:projectId"
              element={screenUnderTest === 'overview' ? <ProjectOverview /> : <ProjectActivity />}
            />
          </Routes>
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );
  return { mutate, user: userEvent.setup() };
}

afterEach(cleanup);

describe('Write update', () => {
  it('opens the dialog, on the health the project already claims', async () => {
    const { user } = mount();

    // The form is behind the button now, not on the page beside it.
    expect(screen.queryByRole('textbox', { name: 'Update' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Write update' }));

    const dialog = await screen.findByRole('dialog', { name: 'Project update' });
    expect(within(dialog).getByRole('textbox', { name: 'Update' })).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Health' }).textContent).toContain('At risk');
  });

  it('stands down while the latest update is being edited', async () => {
    const { user } = mount();

    await user.click(screen.getByRole('button', { name: 'Edit update' }));

    expect(screen.queryByRole('button', { name: 'Write update' })).toBeNull();
    // The editor writes markdown too, so it has to be the field that understands it.
    expect(screen.getByRole('textbox', { name: 'Edit update' })).toBeTruthy();
  });

  it('closes after posting and hands focus back to the button', async () => {
    const { user } = mount();

    const button = screen.getByRole('button', { name: 'Write update' });
    await user.click(button);
    await user.type(screen.getByRole('textbox', { name: 'Update' }), 'Better now');
    await user.click(screen.getByRole('button', { name: 'Post update' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(button);
  });
});

describe('an update body', () => {
  it('reads as markdown on the overview', () => {
    mount();

    expect(screen.getByText('done').tagName).toBe('STRONG');
    expect(screen.queryByText(/\*\*/)).toBeNull();
  });

  it('reads as markdown on the activity tab', () => {
    mount('activity');

    expect(screen.getByText('done').tagName).toBe('STRONG');
    expect(screen.queryByText(/\*\*/)).toBeNull();
  });
});
