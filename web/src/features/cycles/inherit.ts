/**
 * Whether a team is locked to its parent's cycle cadence.
 *
 * Sub-teams do not configure cycles while the parent runs them. The replica already has
 * the copied flags on the child row; this is only the lock, derived from the parent so a
 * stale child flag cannot unlock the form.
 */

import type { Team } from '~/store';

export function inheritsCycleSchedule(
  team: Pick<Team, 'parentTeamId'>,
  parent: Pick<Team, 'cyclesEnabled'> | null | undefined,
): boolean {
  return team.parentTeamId !== undefined && parent?.cyclesEnabled === true;
}
