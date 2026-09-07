/**
 * The create-project composer, as a composer.
 *
 * The dialog grew a pill row so that a project can be filed with what its author already
 * knows, and the thing that breaks silently about a pill row is a value that is on screen
 * and not on the wire: a lead shown in the row and dropped between the state and the
 * mutation looks exactly like a lead that saved. So the first case sets every pill and
 * asserts the whole argument `createProject` was called with.
 *
 * The rest are the four behaviours a create dialog is not finished without, each of which
 * was missing here before: one create per submit however fast the chord is pressed, a
 * "create more" run that keeps the properties and clears the words, a discard question over
 * typing that exists nowhere else, and a refusal that leaves the dialog standing with what
 * was typed still in it.
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { priorityLabel } from '~/components';
import { ApiError } from '~/sync/api';
import { Store, type Change, type Entity } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { CreateProjectModal } from './CreateProjectModal';
import { createProject } from './mutations';

vi.mock('./mutations', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./mutations')>();
  return { ...actual, createProject: vi.fn(() => Promise.resolve('project-1')) };
});

const filed = vi.mocked(createProject);

const WORKSPACE = '01900000-0000-7000-8000-000000000001';
const TEAM = '01900000-0000-7000-8000-000000000002';
const DESIGN = '01900000-0000-7000-8000-000000000003';
const BACKLOG = '01900000-0000-7000-8000-000000000004';
const STARTED = '01900000-0000-7000-8000-000000000005';
const ADA = '01900000-0000-7000-8000-000000000006';
const GRACE = '01900000-0000-7000-8000-000000000007';
const INITIATIVE = '01900000-0000-7000-8000-000000000008';
const LABEL = '01900000-0000-7000-8000-000000000009';

const AT = '2026-01-01T00:00:00.000Z';

function team(id: string, key: string, name: string): Entity {
  return {
    id,
    workspaceId: WORKSPACE,
    key,
    name,
    timezone: 'Europe/Lisbon',
    private: false,
    estimateScale: 'none',
    estimateAllowZero: false,
    estimateExtended: false,
    cyclesEnabled: false,
    cycleDurationWeeks: 1,
    cycleCooldownWeeks: 0,
    cycleStartDay: 'monday',
    cycleUpcomingCount: 2,
    cycleAutoAddStarted: false,
    cycleAutoAddCompleted: false,
    triageEnabled: false,
    triageRequirePriority: false,
    autoCloseDays: 0,
    autoArchiveDays: 0,
    autoCloseParent: false,
    autoCloseChildren: false,
    createdAt: AT,
    updatedAt: AT,
  } as Entity;
}

function status(id: string, name: string, isDefault: boolean): Entity {
  return {
    id,
    workspaceId: WORKSPACE,
    name,
    color: '#5e6ad2',
    category: isDefault ? 'backlog' : 'started',
    position: isDefault ? 'a' : 'b',
    isDefault,
    createdAt: AT,
    updatedAt: AT,
  } as Entity;
}

function person(id: string, displayName: string): Entity {
  return {
    id,
    workspaceId: WORKSPACE,
    name: displayName,
    displayName,
    timezone: 'UTC',
    role: 'member',
    status: 'active',
    kind: 'human',
    createdAt: AT,
    updatedAt: AT,
  } as Entity;
}

function seeded(): Store {
  const store = new Store(WORKSPACE);
  const rows: [string, Entity][] = [
    ['team', team(TEAM, 'ENG', 'Engineering')],
    ['team', team(DESIGN, 'DES', 'Design')],
    ['projectStatus', status(BACKLOG, 'Backlog', true)],
    ['projectStatus', status(STARTED, 'In progress', false)],
    ['user', person(ADA, 'Ada Lovelace')],
    ['user', person(GRACE, 'Grace Hopper')],
    [
      'initiative',
      {
        id: INITIATIVE,
        workspaceId: WORKSPACE,
        name: 'Reliability',
        description: '',
        status: 'active',
        priority: 0,
        sortOrder: 'a',
        createdAt: AT,
        updatedAt: AT,
      } as Entity,
    ],
    [
      'projectLabel',
      {
        id: LABEL,
        workspaceId: WORKSPACE,
        isGroup: false,
        name: 'Platform',
        color: '#ff0000',
        position: 'a',
        createdAt: AT,
        updatedAt: AT,
      } as Entity,
    ],
  ];
  store.applyChanges(
    rows.map(([type, payload], index) => ({
      v: index + 1,
      type,
      id: (payload as { id: string }).id,
      op: 'upsert' as const,
      actor: { type: 'system' as const },
      payload,
    })) as Change[],
  );
  return store;
}

function renderComposer() {
  const onClose = vi.fn();
  const store = seeded();
  const engine = { store, mutate: vi.fn() } as unknown as SyncEngine;
  render(
    <MemoryRouter>
      <KeymapProvider>
        <EngineProvider engine={engine} status={{ phase: 'idle' }}>
          <CreateProjectModal onClose={onClose} />
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );
  return { user: userEvent.setup(), onClose };
}

beforeEach(() => {
  filed.mockClear();
  filed.mockImplementation(() => Promise.resolve('project-1'));
});

afterEach(cleanup);

describe('CreateProjectModal', () => {
  it('sends every property the pill row was given', async () => {
    const { user } = renderComposer();

    await user.type(screen.getByLabelText('Name'), 'Aurora launch');
    await user.type(screen.getByLabelText('Summary'), 'Ship the thing');
    await user.type(screen.getByLabelText('Description'), 'The long version.');

    await user.click(screen.getByRole('button', { name: 'Backlog' }));
    await user.click(await screen.findByRole('menuitem', { name: 'In progress' }));

    await user.click(screen.getByRole('button', { name: priorityLabel(0) }));
    await user.click(await screen.findByRole('menuitem', { name: priorityLabel(1) }));

    await user.click(screen.getByRole('button', { name: 'No lead' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Ada Lovelace' }));

    await user.click(screen.getByRole('button', { name: 'No members' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Grace Hopper' }));
    await user.keyboard('{Escape}');

    // A project may span teams: the second team is added rather than replacing the first.
    await user.click(screen.getByRole('button', { name: 'DES' }));
    await user.click(await screen.findByRole('menuitem', { name: /^Engineering/ }));

    await user.click(screen.getByRole('button', { name: 'No initiative' }));
    await user.click(await screen.findByRole('menuitem', { name: /^Reliability/ }));

    await user.click(screen.getByRole('button', { name: 'No labels' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Platform' }));

    await user.click(screen.getByRole('button', { name: 'Create project' }));

    await waitFor(() => expect(filed).toHaveBeenCalledTimes(1));
    expect(filed.mock.calls[0]?.[1]).toMatchObject({
      name: 'Aurora launch',
      summary: 'Ship the thing',
      description: 'The long version.',
      teamIds: [DESIGN, TEAM],
      statusId: STARTED,
      priority: 1,
      leadId: ADA,
      memberIds: [GRACE],
      initiativeIds: [INITIATIVE],
      labelIds: [LABEL],
    });
  });

  /**
   * The two-⌘⏎ window. `saving` is state and state is a frame late, so a guard that read it
   * would let a second chord in the same tick through and file a second project with a
   * second id — and because the create is optimistic, both would land in the list.
   */
  it('files exactly once when the chord is pressed twice in one tick', async () => {
    const { user } = renderComposer();

    await user.type(screen.getByLabelText('Name'), 'Aurora launch');

    fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true });
    fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true });

    await waitFor(() => expect(filed).toHaveBeenCalledTimes(1));
    expect(filed).toHaveBeenCalledTimes(1);
  });

  it('keeps the properties and clears the words on "Create more"', async () => {
    const { user, onClose } = renderComposer();

    await user.click(screen.getByRole('button', { name: 'No lead' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Ada Lovelace' }));

    await user.click(screen.getByRole('switch', { name: 'Create more' }));
    await user.type(screen.getByLabelText('Name'), 'First');
    await user.click(screen.getByRole('button', { name: 'Create project' }));

    await waitFor(() => expect(filed).toHaveBeenCalledTimes(1));
    expect(filed.mock.calls[0]?.[1]).toMatchObject({ name: 'First', leadId: ADA });
    expect(onClose).not.toHaveBeenCalled();
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('');
    // The lead is still in the row, which is what the switch is for.
    expect(screen.getByRole('button', { name: 'Ada Lovelace' })).toBeTruthy();

    await user.type(screen.getByLabelText('Name'), 'Second');
    await user.click(screen.getByRole('button', { name: 'Create project' }));

    await waitFor(() => expect(filed).toHaveBeenCalledTimes(2));
    expect(filed.mock.calls[1]?.[1]).toMatchObject({ name: 'Second', leadId: ADA });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('asks before throwing away a dirty form, and closes only once discarded', async () => {
    const { user, onClose } = renderComposer();

    await user.type(screen.getByLabelText('Name'), 'Half a thought');
    await user.click(screen.getByRole('button', { name: 'Close' }));

    expect(await screen.findByRole('dialog', { name: 'Discard this project?' })).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Discard' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes without asking when nothing has been typed', async () => {
    const { user, onClose } = renderComposer();

    await user.click(screen.getByRole('button', { name: 'Close' }));

    expect(screen.queryByRole('dialog', { name: 'Discard this project?' })).toBeNull();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('refuses an empty name with the message the e2e spec reads', async () => {
    const { user, onClose } = renderComposer();

    await user.click(screen.getByRole('button', { name: 'Create project' }));

    expect(await screen.findByText('A project needs a name')).toBeTruthy();
    expect(filed).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('stays open holding what was typed when the create is refused', async () => {
    filed.mockImplementation(() =>
      Promise.reject(new ApiError('CONFLICT', 'That name is already taken')),
    );
    const { user, onClose } = renderComposer();

    await user.type(screen.getByLabelText('Name'), 'Aurora launch');
    await user.click(screen.getByRole('button', { name: 'Create project' }));

    expect(await screen.findByText('That name is already taken')).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Aurora launch');
  });
});
