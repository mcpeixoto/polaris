/**
 * Triage writes: accepting, declining, merging and snoozing, plus the team switch that
 * creates the reserved statuses.
 *
 * The inbox is a status category, not a saved view, so leaving it is a status change — to
 * the team's default, to canceled, or to the system Duplicate status. Snooze is the one
 * action that does not leave: it hides the row until a time or until the next edit.
 */

import {
  ACCEPT_TRIAGE_ISSUE,
  DECLINE_TRIAGE_ISSUE,
  MARK_ISSUE_DUPLICATE,
  SNOOZE_ISSUE,
  UPDATE_TEAM_TRIAGE,
} from '~/gql/operations';
import { uuidv7, type Issue, type IssueRelation, type Team, type UUID } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { stateInCategory, teamDefaultState } from './states';

export async function updateTeamTriage(
  engine: SyncEngine,
  teamId: UUID,
  patch: { enabled?: boolean | undefined; requirePriority?: boolean | undefined },
): Promise<void> {
  const before = engine.store.get('team', teamId);
  if (before === undefined) return;

  const after: Team = {
    ...before,
    ...(patch.enabled === undefined ? null : { triageEnabled: patch.enabled }),
    ...(patch.requirePriority === undefined
      ? null
      : { triageRequirePriority: patch.requirePriority }),
    updatedAt: new Date().toISOString(),
  };

  await engine.mutate({
    mutation: UPDATE_TEAM_TRIAGE,
    variables: {
      input: {
        teamId,
        ...(patch.enabled === undefined ? null : { enabled: patch.enabled }),
        ...(patch.requirePriority === undefined
          ? null
          : { requirePriority: patch.requirePriority }),
      },
    },
    optimistic: [{ type: 'team', id: teamId, before, after }],
  });
}

export function acceptTriageIssues(engine: SyncEngine, ids: readonly UUID[]): Promise<void> {
  return all(ids.map((id) => acceptTriageIssue(engine, id)));
}

export async function acceptTriageIssue(engine: SyncEngine, id: UUID): Promise<void> {
  const before = engine.store.get('issue', id);
  if (before === undefined) return;
  const dest = teamDefaultState(engine.store, before.teamId);
  if (dest === undefined) return;
  await leave(engine, before, dest.id, ACCEPT_TRIAGE_ISSUE, { id });
}

export function declineTriageIssues(engine: SyncEngine, ids: readonly UUID[]): Promise<void> {
  return all(ids.map((id) => declineTriageIssue(engine, id)));
}

export async function declineTriageIssue(engine: SyncEngine, id: UUID): Promise<void> {
  const before = engine.store.get('issue', id);
  if (before === undefined) return;
  const dest = stateInCategory(engine.store, before.teamId, 'canceled');
  if (dest === undefined) return;
  await leave(engine, before, dest.id, DECLINE_TRIAGE_ISSUE, { id });
}

export function markIssuesDuplicate(
  engine: SyncEngine,
  ids: readonly UUID[],
  canonicalId: UUID,
): Promise<void> {
  return all(
    ids.filter((id) => id !== canonicalId).map((id) => markIssueDuplicate(engine, id, canonicalId)),
  );
}

export async function markIssueDuplicate(
  engine: SyncEngine,
  id: UUID,
  canonicalId: UUID,
): Promise<void> {
  if (id === canonicalId) return;
  const before = engine.store.get('issue', id);
  const canonical = engine.store.get('issue', canonicalId);
  if (before === undefined || canonical === undefined) return;
  const dest = stateInCategory(engine.store, before.teamId, 'duplicate');
  if (dest === undefined) return;

  const now = new Date().toISOString();
  const after = unsnooze({ ...before, stateId: dest.id, canceledAt: now, updatedAt: now });
  const relation: IssueRelation = {
    id: uuidv7(),
    workspaceId: engine.store.workspaceId,
    issueId: id,
    relatedIssueId: canonicalId,
    type: 'duplicate',
    teamId: before.teamId,
    relatedTeamId: canonical.teamId,
    createdAt: now,
  };

  await engine.mutate({
    mutation: MARK_ISSUE_DUPLICATE,
    variables: { id, canonicalId },
    optimistic: [
      { type: 'issue', id, before, after },
      { type: 'issueRelation', id: relation.id, before: null, after: relation },
    ],
  });
}

export function snoozeIssues(engine: SyncEngine, ids: readonly UUID[], until: Date): Promise<void> {
  return all(ids.map((id) => snoozeIssue(engine, id, until)));
}

export async function snoozeIssue(engine: SyncEngine, id: UUID, until: Date): Promise<void> {
  const before = engine.store.get('issue', id);
  if (before === undefined) return;
  const after: Issue = {
    ...before,
    snoozedUntil: until.toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await engine.mutate({
    mutation: SNOOZE_ISSUE,
    variables: { id, until: after.snoozedUntil },
    optimistic: [{ type: 'issue', id, before, after }],
  });
}

/**
 * Whether leaving triage would be refused for want of a priority.
 *
 * The server enforces it; the client agrees so `1` / `2` / `3` open the priority picker
 * instead of flashing a revert.
 */
export function requiresPriorityToLeave(engine: SyncEngine, ids: readonly UUID[]): boolean {
  for (const id of ids) {
    const issue = engine.store.get('issue', id);
    if (issue === undefined || issue.priority !== 0) continue;
    const team = engine.store.get('team', issue.teamId);
    if (team?.triageRequirePriority === true) return true;
  }
  return false;
}

async function leave(
  engine: SyncEngine,
  before: Issue,
  stateId: UUID,
  mutation: string,
  variables: Record<string, unknown>,
): Promise<void> {
  const now = new Date().toISOString();
  const after = unsnooze({ ...before, stateId, updatedAt: now });
  await engine.mutate({
    mutation,
    variables,
    optimistic: [{ type: 'issue', id: before.id, before, after }],
  });
}

/** Drops a snooze the way an edit on the server does. */
export function unsnooze(issue: Issue): Issue {
  if (issue.snoozedUntil === undefined) return issue;
  const { snoozedUntil: _cleared, ...rest } = issue;
  return rest;
}

function all(writes: readonly Promise<void>[]): Promise<void> {
  return Promise.all(writes).then(() => undefined);
}
