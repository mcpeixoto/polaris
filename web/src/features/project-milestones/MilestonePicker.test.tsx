/**
 * The milestone picker, driven the way the pickers beside it are: a real Store, a stub
 * engine that only carries it, and the keyboard and pointer a person would use.
 *
 * Two of these are about what the menu must NOT contain. An archived checkpoint is finished
 * business and offering it would put issues back into a milestone the project screen has
 * stopped drawing. And an issue in no project must be offered nothing at all — the store
 * holds every project's milestones, so a picker that forgot to scope itself would happily
 * list another project's checkpoints and the server would refuse each one of them.
 */

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

import { EngineProvider } from '~/app/context';
import { useMenuTrigger } from '~/hooks/useMenuTrigger';
import { Store, type Change, type Entity, type ProjectMilestone } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { MilestonePicker } from './MilestonePicker';

afterEach(cleanup);

const WORKSPACE = '01900000-0000-7000-8000-000000000001';
const PROJECT = '01900000-0000-7000-8000-000000000002';
const OTHER_PROJECT = '01900000-0000-7000-8000-000000000003';
const ALPHA = '01900000-0000-7000-8000-000000000004';
const BETA = '01900000-0000-7000-8000-000000000005';
const LAUNCH = '01900000-0000-7000-8000-000000000006';
const GONE = '01900000-0000-7000-8000-000000000007';
const ELSEWHERE = '01900000-0000-7000-8000-000000000008';
const AT = '2026-01-01T00:00:00.000Z';

function milestone(
  id: string,
  name: string,
  sortOrder: string,
  over: Partial<ProjectMilestone> = {},
): ProjectMilestone {
  return {
    id,
    workspaceId: WORKSPACE,
    projectId: PROJECT,
    name,
    sortOrder,
    createdAt: AT,
    updatedAt: AT,
    ...over,
  };
}

/** Deliberately out of sort order, so a list that happens to be in insertion order fails. */
const MILESTONES = [
  milestone(LAUNCH, 'Launch', 'c'),
  milestone(ALPHA, 'Alpha', 'a'),
  milestone(BETA, 'Beta', 'b'),
  milestone(GONE, 'Spike', 'd', { archivedAt: AT }),
  milestone(ELSEWHERE, 'Another project’s checkpoint', 'a', { projectId: OTHER_PROJECT }),
];

function storeWith(milestones: readonly ProjectMilestone[]): Store {
  const store = new Store(WORKSPACE);
  store.applyChanges(
    milestones.map((entity, index) => ({
      v: index + 1,
      type: 'projectMilestone',
      id: entity.id,
      op: 'upsert' as const,
      actor: { type: 'system' as const },
      payload: entity as Entity,
    })) as Change[],
  );
  return store;
}

function Harness({
  projectId,
  value,
  onSelect,
  store,
}: {
  projectId: string | null;
  value: string | null | undefined;
  onSelect: (id: string | null) => void;
  store: Store;
}) {
  const trigger = useMenuTrigger();
  const engine = { store } as unknown as SyncEngine;
  return (
    <EngineProvider engine={engine} status={{ phase: 'idle' }}>
      <button {...trigger.props}>Open</button>
      <MilestonePicker
        open={trigger.open}
        onClose={trigger.hide}
        trigger={trigger.ref}
        projectId={projectId}
        value={value}
        onSelect={onSelect}
      />
    </EngineProvider>
  );
}

async function mount(
  projectId: string | null,
  value: string | null | undefined,
  milestones: readonly ProjectMilestone[] = MILESTONES,
): Promise<{ user: ReturnType<typeof userEvent.setup>; onSelect: ReturnType<typeof vi.fn> }> {
  const user = userEvent.setup();
  const onSelect = vi.fn();
  const node: ReactNode = (
    <Harness
      projectId={projectId}
      value={value}
      onSelect={onSelect}
      store={storeWith(milestones)}
    />
  );
  render(node);
  await user.click(screen.getByRole('button', { name: 'Open' }));
  return { user, onSelect };
}

function rowNames(): (string | null)[] {
  return screen.getAllByRole('menuitem').map((item) => item.textContent);
}

describe('MilestonePicker', () => {
  it("lists the project's milestones in the project screen's order, none first", async () => {
    await mount(PROJECT, null);

    expect(rowNames()).toEqual(['No milestone', 'Alpha', 'Beta', 'Launch']);
  });

  it('ticks the milestone the issue is on', async () => {
    await mount(PROJECT, BETA);

    expect(screen.getByRole('menuitem', { name: 'Beta' }).getAttribute('aria-current')).toBe(
      'true',
    );
    expect(
      screen.getByRole('menuitem', { name: 'No milestone' }).getAttribute('aria-current'),
    ).not.toBe('true');
  });

  it('ticks nothing when the issues it is acting on disagree', async () => {
    await mount(PROJECT, undefined);

    for (const item of screen.getAllByRole('menuitem')) {
      expect(item.getAttribute('aria-current'), item.textContent ?? '').not.toBe('true');
    }
  });

  it('reports the chosen milestone by id', async () => {
    const { user, onSelect } = await mount(PROJECT, null);

    await user.click(screen.getByRole('menuitem', { name: 'Launch' }));

    expect(onSelect).toHaveBeenCalledWith(LAUNCH);
  });

  it('reports null from the none row, which is how a milestone comes off', async () => {
    const { user, onSelect } = await mount(PROJECT, BETA);

    await user.click(screen.getByRole('menuitem', { name: 'No milestone' }));

    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it('never offers an archived milestone', async () => {
    await mount(PROJECT, null);

    expect(screen.queryByRole('menuitem', { name: 'Spike' })).toBeNull();
  });

  it('says the issue is in no project, and offers nothing at all', async () => {
    await mount(null, null);

    // Not one row: the store holds another project's checkpoint, and a picker that leaked it
    // would offer a milestone the server refuses on the way in.
    expect(screen.queryAllByRole('menuitem')).toHaveLength(0);
    expect(screen.getByText('This issue is not in a project')).toBeTruthy();
  });

  it('says the project has no milestones yet, which is a different problem', async () => {
    await mount(PROJECT, null, []);

    expect(screen.queryAllByRole('menuitem')).toHaveLength(0);
    expect(screen.getByText('This project has no milestones yet')).toBeTruthy();
  });
});
