/**
 * The cycle header and its rail: which window this is, how far through it is, the way to
 * the one either side of it — by pointer and by key — and the properties it carries.
 *
 * The switcher's chords are pinned against the tooltips that teach them. They disagreed
 * once: the buttons advertised `[` and `]` while the actions were bound to `alt+Arrow`, so
 * the product taught a chord that did nothing to anybody who read it.
 */

import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider, useKeymap } from '~/app/keymap';
import { Store, type Change, type Entity } from '~/store';
import type { Cycle, Issue, Team, WorkflowState } from '~/store/types';
import type { SyncEngine } from '~/sync/engine';

import { CycleDetail } from './CycleDetail';

const WORKSPACE = 'w1';
const TEAM = 't1';
const AT = '2026-01-01T00:00:00.000Z';
const DAY = 24 * 60 * 60 * 1000;

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

function team(): Team {
  return {
    id: TEAM,
    workspaceId: WORKSPACE,
    key: 'ENG',
    name: 'Engineering',
    timezone: 'Europe/Lisbon',
    private: false,
    estimateScale: 'none',
    estimateAllowZero: false,
    estimateExtended: false,
    cyclesEnabled: true,
    cycleDurationWeeks: 2,
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
  };
}

function cycle(id: string, name: string, startsAt: number, endsAt: number): Cycle {
  return {
    id,
    workspaceId: WORKSPACE,
    teamId: TEAM,
    number: Number(id.replace(/\D/g, '')),
    name,
    startsAt: new Date(startsAt).toISOString(),
    endsAt: new Date(endsAt).toISOString(),
    createdAt: AT,
    updatedAt: AT,
  };
}

function state(id: string, category: WorkflowState['category']): WorkflowState {
  return {
    id,
    workspaceId: WORKSPACE,
    teamId: TEAM,
    name: category,
    color: '#888',
    category,
    position: id,
    isDefault: category === 'unstarted',
    isSystem: category === 'completed',
    createdAt: AT,
    updatedAt: AT,
  };
}

function issue(id: string, cycleId: string, stateId: string, createdAt: number): Issue {
  return {
    id,
    workspaceId: WORKSPACE,
    teamId: TEAM,
    number: 1,
    identifier: `ENG-${id}`,
    title: id,
    description: '',
    stateId,
    priority: 3,
    sortOrder: id,
    dueDateSource: 'manual',
    cycleId,
    createdAt: new Date(createdAt).toISOString(),
    updatedAt: AT,
  };
}

/**
 * Reads the registry out of the provider the screen is mounted in, which is the only way to
 * ask what a component registered and in which context.
 */
function probe(): { registry: ReturnType<typeof useKeymap>['registry'] | null } {
  const seen: { registry: ReturnType<typeof useKeymap>['registry'] | null } = { registry: null };
  Probe = () => {
    seen.registry = useKeymap().registry;
    return null;
  };
  return seen;
}

let Probe: (() => null) | null = null;

function seeded(): Store {
  const now = Date.now();
  const store = new Store(WORKSPACE);
  store.applyChanges([
    upsert(1, 'team', team()),
    upsert(2, 'workflowState', state('s-todo', 'unstarted')),
    upsert(3, 'cycle', cycle('cy1', 'Cycle 1', now - 20 * DAY, now - 7 * DAY)),
    upsert(4, 'cycle', cycle('cy2', 'Cycle 2', now - 5 * DAY, now + 5 * DAY)),
    upsert(5, 'cycle', cycle('cy3', 'Cycle 3', now + 8 * DAY, now + 21 * DAY)),
    // Filed two days into the running window, so the window grew after it opened.
    upsert(6, 'issue', issue('i1', 'cy2', 's-todo', now - 3 * DAY)),
  ]);
  return store;
}

function mount(store: Store, cycleId = 'cy2', phase: 'idle' | 'hydrating' = 'idle') {
  const mutate = vi.fn().mockResolvedValue({});
  const engine = { store, mutate } as unknown as SyncEngine;
  render(
    <MemoryRouter initialEntries={[`/cycle/${cycleId}`]}>
      <KeymapProvider>
        <EngineProvider engine={engine} status={{ phase }}>
          <Routes>
            <Route path="/cycle/:cycleId" element={<CycleDetail />} />
          </Routes>
          {Probe === null ? null : <Probe />}
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );
  return { user: userEvent.setup(), mutate };
}

afterEach(() => {
  Probe = null;
  cleanup();
});

describe('CycleDetail header', () => {
  it('says which window this is, what phase it is in and how long is left', () => {
    mount(seeded());

    const header = screen.getByRole('banner', { name: 'Cycle' });
    expect(within(header).getByRole('heading', { name: 'Cycle 2' })).toBeTruthy();
    expect(header.textContent).toContain('Current');
    expect(header.textContent).toMatch(/days left|Ends today/);
  });

  it('steps to the cycle before and after this one', async () => {
    const { user } = mount(seeded());

    await user.click(screen.getByRole('button', { name: 'Previous cycle' }));
    await waitFor(() =>
      expect(screen.getByRole('banner', { name: 'Cycle' }).textContent).toContain('Cycle 1'),
    );
  });

  it('has nowhere to step back to from the first cycle', () => {
    mount(seeded(), 'cy1');
    // IconButton stays focusable and says why rather than going inert, so the fact lives on
    // aria-disabled.
    expect(
      screen.getByRole('button', { name: 'Previous cycle' }).getAttribute('aria-disabled'),
    ).toBe('true');
  });

  it('steps forward on the chord its tooltip advertises', async () => {
    const { user } = mount(seeded());

    await user.hover(screen.getByRole('button', { name: 'Next cycle' }));
    const tip = await screen.findByRole('tooltip');
    expect(tip.textContent).toContain(']');

    await user.keyboard('[BracketRight]');
    await waitFor(() =>
      expect(screen.getByRole('banner', { name: 'Cycle' }).textContent).toContain('Cycle 3'),
    );
  });

  it('steps back on the chord its tooltip advertises', async () => {
    const { user } = mount(seeded());

    await user.hover(screen.getByRole('button', { name: 'Previous cycle' }));
    const tip = await screen.findByRole('tooltip');
    expect(tip.textContent).toContain('[');

    await user.keyboard('[BracketLeft]');
    await waitFor(() =>
      expect(screen.getByRole('banner', { name: 'Cycle' }).textContent).toContain('Cycle 1'),
    );
  });

  it('keeps its chords in the detail context rather than everywhere in the workspace', () => {
    const seen = probe();
    mount(seeded());

    const detail = seen.registry!.listForContext('detail').map((action) => action.id);
    const global = seen.registry!.listForContext('global').map((action) => action.id);
    expect(detail).toContain('cycle.next');
    expect(detail).toContain('cycle.previous');
    expect(detail).toContain('cycle.toggleMembers');
    expect(global).not.toContain('cycle.next');
    expect(global).not.toContain('cycle.previous');
    expect(global).not.toContain('cycle.toggleMembers');
  });

  it('carries a trail back to the team’s cycles', () => {
    mount(seeded());

    // Scoped to the cycle's own header: the issue list below draws a trail of its own.
    const header = screen.getByRole('banner', { name: 'Cycle' });
    const trail = within(header).getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(trail).getByRole('link', { name: 'Engineering' }).getAttribute('href')).toBe(
      '/team/ENG',
    );
    expect(within(trail).getByRole('link', { name: 'Cycles' }).getAttribute('href')).toBe(
      '/team/ENG/cycles',
    );
  });
});

describe('CycleDetail rail', () => {
  it('shows the window’s dates without opening the edit dialog', () => {
    mount(seeded());

    const rail = screen.getByRole('complementary', { name: 'Properties' });
    expect(within(rail).getByRole('button', { name: /Start date/ })).toBeTruthy();
    expect(within(rail).getByRole('button', { name: /End date/ })).toBeTruthy();
  });

  it('saves the description when the field is left', async () => {
    const { user, mutate } = mount(seeded());

    const rail = screen.getByRole('complementary', { name: 'Properties' });
    const field = within(rail).getByLabelText('Description');
    await user.click(field);
    await user.keyboard('Ship the importer');
    await user.tab();

    await waitFor(() => expect(mutate).toHaveBeenCalled());
    expect(mutate.mock.calls[0]?.[0]).toMatchObject({
      variables: { input: { id: 'cy2', description: 'Ship the importer' } },
    });
  });

  it('reports the scope the window picked up after it opened', () => {
    mount(seeded());

    const rail = screen.getByRole('complementary', { name: 'Properties' });
    expect(within(rail).getByText(/scope|change/i)).toBeTruthy();
  });

  it('gives the members panel a control rather than only a chord', async () => {
    const { user } = mount(seeded());

    expect(screen.getByRole('complementary', { name: 'Cycle members' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Hide cycle members' }));
    expect(screen.queryByRole('complementary', { name: 'Cycle members' })).toBeNull();
  });
});

describe('CycleDetail while the replica is still filling', () => {
  it('waits rather than saying the cycle does not exist', () => {
    mount(new Store(WORKSPACE), 'cy2', 'hydrating');

    expect(screen.queryByText('No such cycle')).toBeNull();
    expect(screen.getByRole('status').textContent).toContain('Loading cycle');
  });

  it('says so once the store has settled and it really is not there', () => {
    mount(new Store(WORKSPACE), 'cy2');
    expect(screen.getByText('No such cycle')).toBeTruthy();
  });
});
