/**
 * The project peek's rail is where a project's properties are changed, not only read.
 *
 * Two claims per property, which are the two halves of the same trade. Pressing the value
 * opens the thing that changes it and leaves the panel where it is — a peek that closed
 * itself on the way to a picker would send the reader back to the list to start again. And
 * whatever is chosen writes the *peeked* project: this panel draws one, the list beside it
 * may have six rows selected, and a write that touched those six while showing one would say
 * so nowhere.
 *
 * Health is the odd one and is pinned separately. It is not a field on the project but the
 * newest update's word, so what the row opens is the composer, and posting files an update
 * against the project the panel is showing.
 */

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { Store, type Change, type Entity } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { ProjectPeek } from './ProjectPeek';

const WORKSPACE = '01900000-0000-7000-8000-000000000001';
const STARTED = '01900000-0000-7000-8000-000000000002';
const DONE = '01900000-0000-7000-8000-000000000003';
const ADA = '01900000-0000-7000-8000-000000000004';
const GRACE = '01900000-0000-7000-8000-000000000005';
const PEEKED = '01900000-0000-7000-8000-000000000006';
const OTHER = '01900000-0000-7000-8000-000000000007';
const AT = '2026-01-01T00:00:00.000Z';

vi.mock('~/hooks/useViewer', () => ({
  useViewerId: () => ADA,
  useViewer: () => ({ id: ADA, workspaceId: WORKSPACE, role: 'admin', displayName: 'Ada' }),
  useViewerRole: () => 'admin',
}));

function status(id: string, name: string, category: string, position: string): Entity {
  return {
    id,
    workspaceId: WORKSPACE,
    name,
    color: '#5e6ad2',
    category,
    position,
    isDefault: category === 'started',
    createdAt: AT,
    updatedAt: AT,
  } as unknown as Entity;
}

function user(id: string, displayName: string, email: string): Entity {
  return {
    id,
    workspaceId: WORKSPACE,
    email,
    displayName,
    role: 'member',
    status: 'active',
    kind: 'human',
    createdAt: AT,
    updatedAt: AT,
  } as unknown as Entity;
}

function project(id: string, name: string, extra: Record<string, unknown> = {}): Entity {
  return {
    id,
    workspaceId: WORKSPACE,
    name,
    summary: `About ${name}.`,
    description: '',
    color: '#5e6ad2',
    statusId: STARTED,
    priority: 1,
    sortOrder: id,
    // Never, so the health cell settles on one wording whatever the wall clock says.
    updateSchedule: 'never',
    createdAt: AT,
    updatedAt: AT,
    ...extra,
  } as unknown as Entity;
}

function seeded(): Store {
  const store = new Store(WORKSPACE);
  const rows: [string, Entity][] = [
    ['projectStatus', status(STARTED, 'In progress', 'started', 'a')],
    ['projectStatus', status(DONE, 'Shipped', 'completed', 'b')],
    ['user', user(ADA, 'Ada Lovelace', 'ada@example.com')],
    ['user', user(GRACE, 'Grace Hopper', 'grace@example.com')],
    [
      'project',
      project(PEEKED, 'Orbital launch', {
        leadId: ADA,
        targetDate: '2026-06-30',
        targetDateGranularity: 'quarter',
      }),
    ],
    ['project', project(OTHER, 'Ground control', { priority: 0 })],
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

/** What the project mutations put on the wire, as far as this file reads them. */
interface Written {
  variables: {
    input: {
      id?: string;
      projectId?: string;
      statusId?: string;
      leadId?: string;
      priority?: number;
      targetDate?: string;
      health?: string;
      body?: string;
    };
  };
  optimistic: readonly {
    type: string;
    id: string;
    after: { targetDateGranularity?: string; leadId?: string };
  }[];
}

function mount() {
  const mutate = vi
    .fn()
    .mockResolvedValue({ createProjectUpdate: { projectUpdate: { id: 'pu-1' } } });
  const onClose = vi.fn();
  const engine = { store: seeded(), mutate } as unknown as SyncEngine;
  render(
    <KeymapProvider>
      <EngineProvider engine={engine} status={{ phase: 'idle' }}>
        <ProjectPeek open projectId={PEEKED} onClose={onClose} />
      </EngineProvider>
    </KeymapProvider>,
  );
  return { mutate, onClose, user: userEvent.setup() };
}

function firstWrite(mutate: ReturnType<typeof vi.fn>): Written {
  return mutate.mock.calls[0]?.[0] as Written;
}

afterEach(cleanup);

describe('ProjectPeek rail', () => {
  it('opens the status picker from the eyebrow without closing the panel', async () => {
    const { onClose, user } = mount();

    await user.click(screen.getByRole('button', { name: 'In progress' }));

    expect(await screen.findByRole('menu', { name: 'Project status' })).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('complementary', { name: 'Peek Orbital launch' })).toBeTruthy();
  });

  it('writes the chosen status to the peeked project', async () => {
    const { mutate, user } = mount();

    await user.click(screen.getByRole('button', { name: 'In progress' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Shipped' }));

    await waitFor(() => expect(mutate).toHaveBeenCalled());
    expect(firstWrite(mutate).variables.input.id).toBe(PEEKED);
    expect(firstWrite(mutate).variables.input.statusId).toBe(DONE);
  });

  it('writes the chosen priority to the peeked project', async () => {
    const { mutate, user } = mount();

    await user.click(screen.getByRole('button', { name: 'Urgent' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Low' }));

    await waitFor(() => expect(mutate).toHaveBeenCalled());
    expect(firstWrite(mutate).variables.input.id).toBe(PEEKED);
    expect(firstWrite(mutate).variables.input.priority).toBe(4);
  });

  it('writes the chosen lead to the peeked project', async () => {
    const { mutate, user } = mount();

    await user.click(screen.getByRole('button', { name: 'Ada Lovelace' }));
    expect(await screen.findByRole('menu', { name: 'Lead' })).toBeTruthy();
    await user.click(screen.getByRole('menuitem', { name: 'Grace Hopper' }));

    await waitFor(() => expect(mutate).toHaveBeenCalled());
    const written = firstWrite(mutate);
    expect(written.variables.input.id).toBe(PEEKED);
    expect(written.variables.input.leadId).toBe(GRACE);
    expect(written.optimistic[0]?.id).toBe(PEEKED);
    expect(written.optimistic[0]?.after.leadId).toBe(GRACE);
  });

  it('opens the target date panel and keeps the grain the project already claims', async () => {
    const { mutate, user } = mount();

    await user.click(screen.getByRole('button', { name: 'Q2 2026' }));
    expect(await screen.findByRole('dialog', { name: 'Target date' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /Today/ }));

    await waitFor(() => expect(mutate).toHaveBeenCalled());
    const written = firstWrite(mutate);
    expect(written.variables.input.id).toBe(PEEKED);
    expect(written.variables.input.targetDate).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
    // Quarter, not the 'day' a picker handing back one day might have implied.
    expect(written.optimistic[0]?.after.targetDateGranularity).toBe('quarter');
  });

  it('opens the update composer from Health rather than a picker, and files the update', async () => {
    const { mutate, user } = mount();

    await user.click(screen.getByRole('button', { name: 'No update' }));

    // A composer, not a list of healths: a colour with no reason behind it is the thing this
    // row deliberately cannot produce.
    expect(await screen.findByRole('dialog', { name: 'Project update' })).toBeTruthy();
    expect(screen.queryByRole('menu', { name: 'Health' })).toBeNull();

    await user.type(screen.getByRole('textbox', { name: 'Update' }), 'Second stage is stacked.');
    await user.click(screen.getByRole('button', { name: 'Post update' }));

    await waitFor(() => expect(mutate).toHaveBeenCalled());
    const written = firstWrite(mutate);
    expect(written.variables.input.projectId).toBe(PEEKED);
    expect(written.variables.input.body).toBe('Second stage is stacked.');
  });
});
