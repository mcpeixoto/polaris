/**
 * When the triage inbox's answer expires on its own.
 *
 * A snoozed issue wakes when `snoozedUntil` passes, and nothing is written when it does.
 * The inbox already solved this with a timer armed for the next expiry rather than a
 * poll; the same clock drives this view so a queue left open actually empties and refills.
 */

import { useWakingQuery } from '~/features/inbox/inbox';
import type { Store, UUID } from '~/store';

export function isSnoozed(snoozedUntil: string | undefined, now: number): boolean {
  if (snoozedUntil === undefined) return false;
  const until = Date.parse(snoozedUntil);
  return !Number.isNaN(until) && until > now;
}

export function nextTriageWake(store: Store, teamId: UUID, now: number): number | null {
  let wakeAt: number | null = null;
  for (const id of store.index.byTeam(teamId)) {
    const issue = store.issues.get(id);
    if (issue === undefined || issue.snoozedUntil === undefined) continue;
    const until = Date.parse(issue.snoozedUntil);
    if (Number.isNaN(until) || until <= now) continue;
    if (wakeAt === null || until < wakeAt) wakeAt = until;
  }
  return wakeAt;
}

/**
 * A clock that jumps when the next snooze in this team's triage expires.
 *
 * Always called — hooks cannot be conditional — and inert when `enabled` is false, so a
 * team's ordinary list does not arm a timer for work it is not showing.
 */
export function useTriageClock(teamId: UUID | undefined, enabled: boolean): number {
  return useWakingQuery(
    (store, now) => ({
      now,
      wakeAt: enabled && teamId !== undefined ? nextTriageWake(store, teamId, now) : null,
    }),
    ['issue'],
  ).now;
}
