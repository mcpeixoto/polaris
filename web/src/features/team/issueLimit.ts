/**
 * The 60,000 live-issue cap on a team.
 *
 * Archived issues do not count; completed ones still do until they are archived. The
 * server refuses creates at the cap. The client warns at 90% so the people who work on
 * the team can archive or move work before the API starts saying no.
 *
 * Dismissing the banner is per team and per crossing: it stays away until the live count
 * drops back below the warning line, then shows again the next time the team re-hits it.
 */

import type { Store, UUID } from '~/store';

export const TEAM_ISSUE_LIMIT = 60_000;
export const TEAM_ISSUE_WARN_AT = 54_000;

const DISMISS_KEY_PREFIX = 'polaris.teamIssueLimit.dismissed:';

export function liveIssueCountForTeam(store: Store, teamId: UUID): number {
  const live = store.index.active();
  let n = 0;
  for (const id of store.index.byTeam(teamId)) {
    if (live.has(id)) n += 1;
  }
  return n;
}

export function isMemberOfTeam(store: Store, teamId: UUID, userId: UUID): boolean {
  for (const id of store.membershipIdsForUser(userId)) {
    const membership = store.teamMemberships.get(id);
    if (membership?.teamId === teamId) return true;
  }
  return false;
}

export function teamIssueLimitNotice(
  count: number,
  dismissed: boolean,
  limit: number = TEAM_ISSUE_LIMIT,
  warnAt: number = TEAM_ISSUE_WARN_AT,
): 'warn' | 'limit' | null {
  if (dismissed || count < warnAt) return null;
  return count >= limit ? 'limit' : 'warn';
}

function dismissKey(teamId: UUID): string {
  return DISMISS_KEY_PREFIX + teamId;
}

export function isTeamIssueLimitDismissed(teamId: UUID): boolean {
  try {
    return sessionStorage.getItem(dismissKey(teamId)) === '1';
  } catch {
    return false;
  }
}

export function dismissTeamIssueLimit(teamId: UUID): void {
  try {
    sessionStorage.setItem(dismissKey(teamId), '1');
  } catch {
    /* Safari private mode and sandboxed iframes throw. */
  }
}

/** Forget a dismiss once the team is back under the warning line, so a re-hit can warn. */
export function clearTeamIssueLimitDismissed(teamId: UUID): void {
  try {
    sessionStorage.removeItem(dismissKey(teamId));
  } catch {
    /* same private-mode bargain as dismiss */
  }
}
