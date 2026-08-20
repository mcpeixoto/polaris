/**
 * Per-member distribution of a cycle: counts, estimates, and how much is already done.
 *
 * Cmd/Ctrl+I toggles the panel. Clicking a member filters the cycle list to their work,
 * which is the same URL grammar every other filter uses, so the result is a shareable link.
 */

import { effortOf } from '~/features/estimate';
import type { Store, UUID } from '~/store';
import { personName } from '~/features/prefs/prefs';

export interface CycleMemberShare {
  readonly userId: UUID | null;
  readonly name: string;
  readonly avatarUrl: string | null;
  readonly issueCount: number;
  readonly estimate: number;
  readonly completed: number;
}

export function cycleMemberShares(store: Store, cycleId: UUID): readonly CycleMemberShare[] {
  const cycle = store.cycles.get(cycleId);
  if (cycle === undefined) return [];
  const team = store.teams.get(cycle.teamId);

  const byUser = new Map<
    UUID | null,
    { issueCount: number; estimate: number; completed: number }
  >();
  const bump = (userId: UUID | null, estimate: number, done: boolean) => {
    const row = byUser.get(userId) ?? { issueCount: 0, estimate: 0, completed: 0 };
    row.issueCount += 1;
    row.estimate += estimate;
    if (done) row.completed += 1;
    byUser.set(userId, row);
  };

  for (const issueId of store.index.byCycle(cycleId)) {
    const issue = store.issues.get(issueId);
    if (issue === undefined || issue.archivedAt !== undefined) continue;
    const state = store.workflowStates.get(issue.stateId);
    const done = state?.category === 'completed' || state?.category === 'canceled';
    const points = team === undefined ? 1 : effortOf(issue, team);
    bump(issue.assigneeId ?? null, points, done === true);
  }

  const rows: CycleMemberShare[] = [];
  for (const [userId, stats] of byUser) {
    if (userId === null) {
      rows.push({
        userId: null,
        name: 'Unassigned',
        avatarUrl: null,
        ...stats,
      });
      continue;
    }
    const user = store.users.get(userId);
    if (user === undefined) continue;
    rows.push({
      userId,
      name: personName(user),
      avatarUrl: user.avatarUrl ?? null,
      ...stats,
    });
  }

  rows.sort((a, b) => {
    if (a.userId === null) return 1;
    if (b.userId === null) return -1;
    return b.issueCount - a.issueCount || a.name.localeCompare(b.name);
  });
  return rows;
}
