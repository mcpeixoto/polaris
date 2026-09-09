/**
 * The overview read top to bottom.
 *
 * Summary, the properties as a row of pills, the resources, the standing answer to "how is
 * it going", the description, the milestones. The properties are the half worth pinning: the
 * rail can be folded away, and before this the only place a reader could see the lead or the
 * target was a column of the screen that may not be on it.
 *
 * A project with no updates says what to do about that. It used to say "No updates yet. The
 * first one sets the health", which is a statement where an instruction belongs.
 */

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { Store, type Change, type Entity } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { ProjectOverview } from './ProjectOverview';

const WORKSPACE = '01900000-0000-7000-8000-000000000001';
const PROJECT = '01900000-0000-7000-8000-000000000002';
const STATUS = '01900000-0000-7000-8000-000000000003';
const VIEWER = '01900000-0000-7000-8000-000000000004';
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

function mount() {
  const store = new Store(WORKSPACE);
  store.applyChanges([
    upsert(1, 'projectStatus', {
      id: STATUS,
      workspaceId: WORKSPACE,
      name: 'In progress',
      color: '#5e6ad2',
      category: 'started',
      position: 'a',
      isDefault: true,
      createdAt: AT,
      updatedAt: AT,
    } as Entity),
    upsert(2, 'user', {
      id: VIEWER,
      workspaceId: WORKSPACE,
      email: 'ada@example.com',
      displayName: 'Ada Lovelace',
      role: 'member',
      status: 'active',
      createdAt: AT,
      updatedAt: AT,
    } as Entity),
    upsert(3, 'project', {
      id: PROJECT,
      workspaceId: WORKSPACE,
      name: 'Launch',
      summary: 'Ship it',
      description: '',
      color: '',
      statusId: STATUS,
      leadId: VIEWER,
      priority: 2,
      sortOrder: 'a',
      targetDate: '2026-06-30',
      targetDateGranularity: 'quarter',
      updateSchedule: 'default',
      createdAt: AT,
      updatedAt: AT,
    } as Entity),
  ]);
  const mutate = vi.fn().mockResolvedValue({});
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
  return { user: userEvent.setup(), mutate };
}

describe('the project overview', () => {
  it('reads as a document: mark, name, summary, properties, resources, update, description', () => {
    mount();

    expect(screen.getByRole('button', { name: 'Change project icon' })).toBeTruthy();
    expect((screen.getByLabelText('Project name') as HTMLTextAreaElement).value).toBe('Launch');
    expect((screen.getByLabelText('Summary') as HTMLInputElement).value).toBe('Ship it');
    expect(screen.getByText('Properties')).toBeTruthy();
    expect(screen.getByText('Resources')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add document' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Description' })).toBeTruthy();
    expect(screen.getByLabelText('Description')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Milestones' })).toBeTruthy();
  });

  it("states the project's properties where the reader is, each with its value", () => {
    mount();

    const pills = screen.getByText('Properties').parentElement as HTMLElement;
    expect(within(pills).getByText('In progress')).toBeTruthy();
    expect(within(pills).getByText('High')).toBeTruthy();
    expect(within(pills).getByText('Ada Lovelace')).toBeTruthy();
    expect(within(pills).getByText('Q2 2026')).toBeTruthy();
  });

  it('opens the status picker from the property row', async () => {
    const { user } = mount();

    await user.click(screen.getByRole('button', { name: /In progress/ }));

    expect(await screen.findByRole('menu', { name: 'Project status' })).toBeTruthy();
  });

  /**
   * The mark is the control that changes it, here as well as in the trail and in the list.
   * A project's icon was settable in the create dialog and nowhere a reader was actually
   * looking, which is the whole reason it is a button in five places now.
   */
  it('opens the icon picker from the mark at the top of the document', async () => {
    const { user } = mount();

    await user.click(screen.getByRole('button', { name: 'Change project icon' }));

    expect(await screen.findByRole('dialog', { name: 'Project icon' })).toBeTruthy();
  });

  /**
   * Renaming from the document rather than only from the trail. It saves on blur, the way
   * every other unboxed field on this screen does — a mutation per keystroke would put a
   * hundred entries in the activity feed for one rename.
   */
  it('renames the project from the title, saving what was typed', async () => {
    const { user, mutate } = mount();

    const field = screen.getByLabelText('Project name');
    await user.click(field);
    await user.type(field, ' day one');
    await user.tab();

    await waitFor(() => expect(mutate).toHaveBeenCalled());
    const call = mutate.mock.calls.find((entry) => entry[0]?.optimistic?.[0]?.type === 'project');
    expect(call?.[0].variables.input.name).toBe('Launch day one');
  });

  it('asks for the first update rather than reporting that there is none', () => {
    mount();

    expect(screen.getByRole('heading', { name: 'Write first project update' })).toBeTruthy();
    // The composer is there to be typed in, not behind the prompt: an empty project is
    // exactly where writing the first update should cost one click, and that click is Post.
    expect(screen.getByLabelText('Update')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Post update' })).toBeTruthy();
  });
});
