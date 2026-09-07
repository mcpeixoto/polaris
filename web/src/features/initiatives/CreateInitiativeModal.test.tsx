/**
 * The composer's promise: everything the dialog offers reaches the create.
 *
 * The dialog used to be a name and a parent `<select>`, so there was nothing to test and no
 * test. Now it sets seven properties, and the failure that matters is silent — a pill that
 * looks set, a value dropped between the state and the mutation, and an initiative filed
 * without the target date somebody chose. So these cases assert the argument
 * `createInitiative` was actually called with, rather than what the row says.
 *
 * The rest is the shape every create dialog in the product shares, and each of them is a
 * regression that has happened somewhere before: two ⌘⏎ in one tick filing twice, "Create
 * more" clearing a property along with the words, Escape throwing away a paragraph without
 * asking, and a refusal closing the dialog on top of the only copy of what was typed.
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { priorityLabel } from '~/components';
import { addInitiativeLabel } from '~/features/initiative-labels/mutations';
import { ApiError } from '~/sync/api';
import { Store, type Change, type Entity } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { CreateInitiativeModal } from './CreateInitiativeModal';
import { createInitiative } from './mutations';

vi.mock('./mutations', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./mutations')>();
  return { ...actual, createInitiative: vi.fn(() => Promise.resolve('initiative-1')) };
});

vi.mock('~/features/initiative-labels/mutations', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/features/initiative-labels/mutations')>();
  return { ...actual, addInitiativeLabel: vi.fn(() => Promise.resolve()) };
});

const created = vi.mocked(createInitiative);
const labelled = vi.mocked(addInitiativeLabel);

const WORKSPACE = '01900000-0000-7000-8000-000000000001';
const TEAM = '01900000-0000-7000-8000-000000000002';
const USER = '01900000-0000-7000-8000-000000000003';
const PARENT = '01900000-0000-7000-8000-000000000004';
const LABEL = '01900000-0000-7000-8000-000000000005';

const AT = '2026-01-01T00:00:00.000Z';

function seeded(): Store {
  const store = new Store(WORKSPACE);
  const rows: [string, Entity][] = [
    [
      'team',
      {
        id: TEAM,
        workspaceId: WORKSPACE,
        key: 'ENG',
        name: 'Engineering',
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
      } as Entity,
    ],
    [
      'user',
      {
        id: USER,
        workspaceId: WORKSPACE,
        email: 'ada@example.com',
        displayName: 'Ada Lovelace',
        role: 'member',
        status: 'active',
        createdAt: AT,
        updatedAt: AT,
      } as Entity,
    ],
    [
      'initiative',
      {
        id: PARENT,
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
      'initiativeLabel',
      {
        id: LABEL,
        workspaceId: WORKSPACE,
        name: 'Company goal',
        color: '#ff0000',
        isGroup: false,
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

function renderDialog() {
  const onClose = vi.fn();
  const store = seeded();
  const engine = { store, mutate: vi.fn() } as unknown as SyncEngine;
  render(
    <MemoryRouter>
      <KeymapProvider>
        <EngineProvider engine={engine} status={{ phase: 'idle' }}>
          <CreateInitiativeModal onClose={onClose} />
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );
  return { user: userEvent.setup(), onClose };
}

beforeEach(() => {
  created.mockClear();
  created.mockImplementation(() => Promise.resolve('initiative-1'));
  labelled.mockClear();
  labelled.mockImplementation(() => Promise.resolve());
});

afterEach(cleanup);

describe('CreateInitiativeModal', () => {
  it('carries every property the pills hold into the create', async () => {
    const { user } = renderDialog();

    await user.click(screen.getByRole('button', { name: 'Planned' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Active' }));

    await user.click(screen.getByRole('button', { name: 'No priority' }));
    await user.click(await screen.findByRole('menuitem', { name: priorityLabel(1) }));

    await user.click(screen.getByRole('button', { name: 'No owner' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Ada Lovelace' }));

    await user.click(screen.getByRole('button', { name: 'No target date' }));
    fireEvent.change(await screen.findByLabelText('Or a date'), {
      target: { value: '2026-12-24' },
    });
    await user.click(screen.getByRole('button', { name: 'Set' }));

    await user.click(screen.getByRole('button', { name: 'No parent' }));
    await user.click(await screen.findByRole('menuitem', { name: /Reliability/ }));

    await user.click(screen.getByRole('button', { name: 'No lead team' }));
    await user.click(await screen.findByRole('menuitem', { name: /Engineering/ }));

    await user.click(screen.getByRole('button', { name: 'No labels' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Company goal' }));

    await user.type(screen.getByLabelText('Name'), 'Cut p95 latency');
    await user.type(screen.getByLabelText('Description'), 'Two quarters of work.');
    await user.click(screen.getByRole('button', { name: 'Create initiative' }));

    await waitFor(() => expect(created).toHaveBeenCalledTimes(1));
    expect(created.mock.calls[0]?.[1]).toMatchObject({
      name: 'Cut p95 latency',
      description: 'Two quarters of work.',
      status: 'active',
      priority: 1,
      ownerId: USER,
      targetDate: '2026-12-24',
      parentInitiativeId: PARENT,
      leadTeamId: TEAM,
    });

    // Labels are link rows, so they are applied after the id resolves rather than on the input.
    await waitFor(() =>
      expect(labelled).toHaveBeenCalledWith(expect.anything(), 'initiative-1', LABEL),
    );
  });

  /**
   * A label that will not attach must not take the initiative down with it: by the time the
   * link is attempted the objective exists, and throwing would put the dialog back up holding
   * a copy of something already filed.
   */
  it('keeps the initiative when a label fails to attach', async () => {
    labelled.mockRejectedValueOnce(new ApiError('INTERNAL', 'Label refused'));
    const { user, onClose } = renderDialog();

    await user.click(screen.getByRole('button', { name: 'No labels' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Company goal' }));
    await user.type(screen.getByLabelText('Name'), 'Still created');
    await user.click(screen.getByRole('button', { name: 'Create initiative' }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(created).toHaveBeenCalledTimes(1);
  });

  /**
   * The guard has to read a ref rather than `saving`, which is state and a frame late — two
   * ⌘⏎ in one tick would otherwise both pass it and file two initiatives with two ids, and
   * the create is optimistic, so both land in the list.
   *
   * `fireEvent` rather than `userEvent` because the point is two presses inside one tick,
   * which is what `userEvent`'s awaited, act-wrapped presses cannot produce.
   */
  it('files once when ⌘⏎ is pressed twice in one tick', async () => {
    let settle: (id: string) => void = () => {};
    created.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          settle = resolve;
        }),
    );
    const { user } = renderDialog();

    await user.type(screen.getByLabelText('Name'), 'Only once');
    fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true });
    fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true });

    expect(created).toHaveBeenCalledTimes(1);
    settle('initiative-1');
    await waitFor(() => expect(created).toHaveBeenCalledTimes(1));
  });

  it('keeps the properties and clears the words on "Create more"', async () => {
    const { user, onClose } = renderDialog();

    await user.click(screen.getByRole('button', { name: 'Planned' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Active' }));
    await user.click(screen.getByRole('button', { name: 'No priority' }));
    await user.click(await screen.findByRole('menuitem', { name: priorityLabel(2) }));

    await user.click(screen.getByRole('switch', { name: 'Create more' }));
    await user.type(screen.getByLabelText('Name'), 'First');
    await user.click(screen.getByRole('button', { name: 'Create initiative' }));

    await waitFor(() => expect(created).toHaveBeenCalledTimes(1));
    expect(created.mock.calls[0]?.[1]).toMatchObject({
      name: 'First',
      status: 'active',
      priority: 2,
    });
    expect(onClose).not.toHaveBeenCalled();
    await waitFor(() => expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe(''));

    await user.type(screen.getByLabelText('Name'), 'Second');
    await user.click(screen.getByRole('button', { name: 'Create initiative' }));

    await waitFor(() => expect(created).toHaveBeenCalledTimes(2));
    expect(created.mock.calls[1]?.[1]).toMatchObject({
      name: 'Second',
      status: 'active',
      priority: 2,
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('asks before discarding a dialog somebody has typed in', async () => {
    const { user, onClose } = renderDialog();

    await user.type(screen.getByLabelText('Name'), 'Half a thought');
    await user.click(screen.getByRole('button', { name: 'Close' }));

    expect(await screen.findByRole('dialog', { name: 'Discard this initiative?' })).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Discard' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('closes without a question when nothing has been typed', async () => {
    const { user, onClose } = renderDialog();

    await user.click(screen.getByRole('button', { name: 'Close' }));

    expect(screen.queryByRole('dialog', { name: 'Discard this initiative?' })).toBeNull();
    expect(onClose).toHaveBeenCalled();
  });

  it('stays open on a refusal, holding the only copy of what was typed', async () => {
    created.mockRejectedValueOnce(new ApiError('CONFLICT', 'An initiative by that name exists'));
    const { user, onClose } = renderDialog();

    await user.type(screen.getByLabelText('Name'), 'Taken');
    await user.click(screen.getByRole('button', { name: 'Create initiative' }));

    expect(await screen.findByText('An initiative by that name exists')).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Taken');
  });

  it('refuses an empty name without creating anything or closing', async () => {
    const { user, onClose } = renderDialog();

    await user.click(screen.getByRole('button', { name: 'Create initiative' }));

    expect(await screen.findByText('An initiative needs a name')).toBeTruthy();
    expect(created).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  /**
   * The shell mounts the dialog whether or not it is open, so it can play its exit. A shut
   * one must render nothing and claim none of the chords — which is what would otherwise
   * collide with the next modal to ask for ⌘⏎ in the `modal` context.
   */
  it('renders nothing while it is shut', () => {
    const store = seeded();
    const engine = { store, mutate: vi.fn() } as unknown as SyncEngine;
    render(
      <MemoryRouter>
        <KeymapProvider>
          <EngineProvider engine={engine} status={{ phase: 'idle' }}>
            <CreateInitiativeModal open={false} onClose={vi.fn()} />
          </EngineProvider>
        </KeymapProvider>
      </MemoryRouter>,
    );

    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
