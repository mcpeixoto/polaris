/**
 * Cycle writes: the cadence lives on the team, so this is one mutation rather than a
 * create-cycle form. Enabling creates the current window and the upcoming ones; the worker
 * keeps them rolling.
 */

import { UPDATE_TEAM_CYCLES } from '~/gql/operations';
import type { Team, UUID } from '~/store';
import type { SyncEngine } from '~/sync/engine';

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
    ...(cadence.autoAddStarted === undefined ? null : { cycleAutoAddStarted: cadence.autoAddStarted }),
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
        ...(cadence.autoAddStarted === undefined ? null : { autoAddStarted: cadence.autoAddStarted }),
        ...(cadence.autoAddCompleted === undefined
          ? null
          : { autoAddCompleted: cadence.autoAddCompleted }),
      },
    },
    optimistic: [{ type: 'team', id: teamId, before, after }],
  });
}
