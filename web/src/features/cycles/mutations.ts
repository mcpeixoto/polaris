/**
 * Cycle writes: cadence on the team, and per-window edits on individual cycles.
 */

import { UPDATE_TEAM_CYCLES } from '~/gql/operations';
import type { Cycle, Team, UUID } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { START_CYCLE_TODAY, UPDATE_CYCLE } from './operations';
import { dayIn, startOfDayInstant } from './zone';

export interface CycleCadence {
  readonly enabled?: boolean | undefined;
  readonly durationWeeks?: number | undefined;
  readonly cooldownWeeks?: number | undefined;
  readonly startDay?: string | undefined;
  readonly upcomingCount?: number | undefined;
  readonly autoAddStarted?: boolean | undefined;
  readonly autoAddCompleted?: boolean | undefined;
}

export async function updateTeamCycles(
  engine: SyncEngine,
  teamId: UUID,
  cadence: CycleCadence,
): Promise<void> {
  const before = engine.store.get('team', teamId);
  if (before === undefined) return;

  const after: Team = {
    ...before,
    ...(cadence.enabled === undefined ? null : { cyclesEnabled: cadence.enabled }),
    ...(cadence.durationWeeks === undefined ? null : { cycleDurationWeeks: cadence.durationWeeks }),
    ...(cadence.cooldownWeeks === undefined ? null : { cycleCooldownWeeks: cadence.cooldownWeeks }),
    ...(cadence.startDay === undefined ? null : { cycleStartDay: cadence.startDay }),
    ...(cadence.upcomingCount === undefined ? null : { cycleUpcomingCount: cadence.upcomingCount }),
    ...(cadence.autoAddStarted === undefined
      ? null
      : { cycleAutoAddStarted: cadence.autoAddStarted }),
    ...(cadence.autoAddCompleted === undefined
      ? null
      : { cycleAutoAddCompleted: cadence.autoAddCompleted }),
    updatedAt: new Date().toISOString(),
  };

  await engine.mutate({
    mutation: UPDATE_TEAM_CYCLES,
    variables: {
      input: {
        teamId,
        ...(cadence.enabled === undefined ? null : { enabled: cadence.enabled }),
        ...(cadence.durationWeeks === undefined ? null : { durationWeeks: cadence.durationWeeks }),
        ...(cadence.cooldownWeeks === undefined ? null : { cooldownWeeks: cadence.cooldownWeeks }),
        ...(cadence.startDay === undefined ? null : { startDay: cadence.startDay }),
        ...(cadence.upcomingCount === undefined ? null : { upcomingCount: cadence.upcomingCount }),
        ...(cadence.autoAddStarted === undefined
          ? null
          : { autoAddStarted: cadence.autoAddStarted }),
        ...(cadence.autoAddCompleted === undefined
          ? null
          : { autoAddCompleted: cadence.autoAddCompleted }),
      },
    },
    optimistic: [{ type: 'team', id: teamId, before, after }],
  });
}

export interface CycleEdit {
  readonly name?: string;
  readonly description?: string | null;
  readonly clearDescription?: boolean;
  readonly startsAt?: string;
  readonly endsAt?: string;
}

export async function updateCycle(
  engine: SyncEngine,
  cycleId: UUID,
  edit: CycleEdit,
): Promise<void> {
  const before = engine.store.get('cycle', cycleId);
  if (before === undefined) return;

  const after: Cycle = {
    ...before,
    ...(edit.name === undefined ? null : { name: edit.name }),
    ...(edit.description === undefined && edit.clearDescription !== true
      ? null
      : { description: edit.clearDescription ? undefined : (edit.description ?? undefined) }),
    ...(edit.startsAt === undefined ? null : { startsAt: edit.startsAt }),
    ...(edit.endsAt === undefined ? null : { endsAt: edit.endsAt }),
    updatedAt: new Date().toISOString(),
  };

  await engine.mutate({
    mutation: UPDATE_CYCLE,
    variables: {
      input: {
        id: cycleId,
        ...(edit.name === undefined ? null : { name: edit.name }),
        ...(edit.description === undefined ? null : { description: edit.description }),
        ...(edit.clearDescription === true ? { clearDescription: true } : null),
        ...(edit.startsAt === undefined ? null : { startsAt: edit.startsAt }),
        ...(edit.endsAt === undefined ? null : { endsAt: edit.endsAt }),
      },
    },
    optimistic: [{ type: 'cycle', id: cycleId, before, after }],
  });
}

export async function startCycleToday(engine: SyncEngine, cycleId: UUID): Promise<void> {
  const before = engine.store.get('cycle', cycleId);
  if (before === undefined) return;

  const now = new Date();
  // 12:00 AM in the *team's* zone, per the spec. Browser-local midnight was a third
  // reckoning of the same day in one feature — the graph's, the input's and this one — so a
  // cycle started from Lisbon and a cycle started from São Paulo began on different days.
  const zone = engine.store.get('team', before.teamId)?.timezone ?? 'UTC';
  const todayStart = new Date(startOfDayInstant(dayIn(now.getTime(), zone), zone)).toISOString();
  const durationMs = Date.parse(before.endsAt) - Date.parse(before.startsAt);
  const after: Cycle = {
    ...before,
    startsAt: todayStart,
    endsAt: new Date(Date.parse(todayStart) + durationMs).toISOString(),
    updatedAt: now.toISOString(),
  };

  await engine.mutate({
    mutation: START_CYCLE_TODAY,
    variables: { id: cycleId },
    optimistic: [{ type: 'cycle', id: cycleId, before, after }],
  });
}
