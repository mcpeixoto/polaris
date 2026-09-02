/**
 * The cycle picker's order, which is the only thing about it a person notices.
 *
 * Previous counts back from now and Upcoming counts forward, so sorting both ascending —
 * which is what it did — filed last week's sprint underneath every cycle the team had ever
 * run. And the phase is `phaseOf`'s, so a cycle closed early stops being offered as the
 * current one.
 */

import { useRef } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { Store, type Change, type Entity } from '~/store';
import type { Cycle, Team } from '~/store/types';
import type { SyncEngine } from '~/sync/engine';

import { CyclePicker } from './CyclePicker';

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

function cycle(
  id: string,
  name: string,
  from: number,
  to: number,
  over: Partial<Cycle> = {},
): Cycle {
  return {
    id,
    workspaceId: WORKSPACE,
    teamId: TEAM,
    number: Number(id.replace(/\D/g, '')),
    name,
    startsAt: new Date(from).toISOString(),
    endsAt: new Date(to).toISOString(),
    createdAt: AT,
    updatedAt: AT,
    ...over,
  };
}

function Host({ store }: { store: Store }) {
  const trigger = useRef<HTMLButtonElement>(null);
  const engine = { store, mutate: vi.fn() } as unknown as SyncEngine;
  return (
    <KeymapProvider>
      <EngineProvider engine={engine} status={{ phase: 'idle' }}>
        <button ref={trigger}>Set cycle</button>
        <CyclePicker
          open
          onClose={() => {}}
          trigger={trigger}
          teamId={TEAM}
          value={null}
          onSelect={() => {}}
        />
      </EngineProvider>
    </KeymapProvider>
  );
}

function names(): string[] {
  return screen
    .getAllByRole('menuitem')
    .map((item) => item.textContent ?? '')
    .filter((text) => text.startsWith('Cycle'))
    .map((text) => text.slice(0, 'Cycle 0'.length));
}

afterEach(cleanup);

describe('CyclePicker order', () => {
  it('puts the most recent previous cycle first, not the oldest', () => {
    const now = Date.now();
    const store = new Store(WORKSPACE);
    store.applyChanges([
      upsert(1, 'team', team()),
      upsert(2, 'cycle', cycle('cy1', 'Cycle 1', now - 60 * DAY, now - 46 * DAY)),
      upsert(3, 'cycle', cycle('cy2', 'Cycle 2', now - 40 * DAY, now - 26 * DAY)),
      upsert(4, 'cycle', cycle('cy3', 'Cycle 3', now - 5 * DAY, now + 9 * DAY)),
      upsert(5, 'cycle', cycle('cy4', 'Cycle 4', now + 12 * DAY, now + 26 * DAY)),
    ]);

    render(<Host store={store} />);

    expect(names()).toEqual(['Cycle 3', 'Cycle 4', 'Cycle 2', 'Cycle 1']);
  });

  it('files a cycle that was closed early under previous, not current', () => {
    const now = Date.now();
    const store = new Store(WORKSPACE);
    store.applyChanges([
      upsert(1, 'team', team()),
      upsert(
        2,
        'cycle',
        cycle('cy1', 'Cycle 1', now - 5 * DAY, now + 9 * DAY, {
          completedAt: new Date(now - DAY).toISOString(),
        }),
      ),
    ]);

    render(<Host store={store} />);

    const headings = screen
      .getAllByRole('presentation', { hidden: true })
      .map((node) => node.textContent);
    expect(headings.join(' ')).toContain('Previous');
    expect(headings.join(' ')).not.toContain('Current');
  });
});
