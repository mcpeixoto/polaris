/**
 * "Start cycle today" begins at 12:00 AM in the team's zone, per the spec — not at the
 * browser's midnight, which made the same command start two different days depending on
 * where the person pressing it happened to be sitting.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { Store } from '~/store/store';
import type { Change, Cycle, Entity, Team } from '~/store/types';
import type { SyncEngine } from '~/sync/engine';

import { startCycleToday } from './mutations';

const AT = '2026-01-01T00:00:00.000Z';
const ACTOR = { type: 'user', id: 'u1' } as const;

function upsert(v: number, type: Change['type'], entity: Entity): Change {
  return { v, type, id: entity.id, op: 'upsert', actor: ACTOR, payload: entity };
}

function team(timezone: string): Team {
  return {
    id: 't1',
    workspaceId: 'w',
    key: 'ENG',
    name: 'Engineering',
    timezone,
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

function cycle(): Cycle {
  return {
    id: 'cy1',
    workspaceId: 'w',
    teamId: 't1',
    number: 2,
    name: 'Cycle 2',
    startsAt: '2026-02-02T00:00:00.000Z',
    endsAt: '2026-02-15T23:59:59.999Z',
    createdAt: AT,
    updatedAt: AT,
  };
}

function engineFor(timezone: string) {
  const store = new Store('w');
  store.applyChanges([upsert(1, 'team', team(timezone)), upsert(2, 'cycle', cycle())]);
  const mutate = vi.fn().mockResolvedValue({});
  return { store, mutate, engine: { store, mutate } as unknown as SyncEngine };
}

function optimisticCycle(mutate: ReturnType<typeof vi.fn>): Cycle {
  const input = mutate.mock.calls[0]?.[0] as { optimistic?: { after: Cycle }[] };
  return input.optimistic![0]!.after;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('startCycleToday', () => {
  it('starts at the team’s midnight, not the reader’s', async () => {
    vi.useFakeTimers();
    // 09:30 on the 20th in Tokyo, still the 19th in UTC and in London.
    vi.setSystemTime(new Date('2026-01-20T00:30:00.000Z'));

    const { engine, mutate } = engineFor('Asia/Tokyo');
    await startCycleToday(engine, 'cy1');

    expect(optimisticCycle(mutate).startsAt).toBe('2026-01-19T15:00:00.000Z');
  });

  it('keeps the window’s length when it moves', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-20T12:00:00.000Z'));

    const { engine, mutate } = engineFor('America/Los_Angeles');
    const after = (await startCycleToday(engine, 'cy1'), optimisticCycle(mutate));

    expect(after.startsAt).toBe('2026-01-20T08:00:00.000Z');
    expect(Date.parse(after.endsAt) - Date.parse(after.startsAt)).toBe(
      Date.parse(cycle().endsAt) - Date.parse(cycle().startsAt),
    );
  });
});
