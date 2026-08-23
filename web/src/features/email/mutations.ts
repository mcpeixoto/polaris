/**
 * Team and template email-intake writes.
 *
 * Enabling mints an address the settings screen copies. The optimistic patch flips the
 * flag immediately; the address itself arrives from the server, because the token is
 * minted there and a client that invented one would disagree with every other replica.
 *
 * These are the only two writes in the product that merge a *GraphQL* row back into the
 * replica, and that is the whole reason `fromWire` exists. Every other row reaches the
 * store down the delta stream, where Go's `omitempty` means an unset optional is simply
 * absent from the JSON. GraphQL does not work that way: a selected field that is unset
 * comes back as an explicit `null`, so spreading the response wrote `retiredAt: null`
 * over a `retiredAt` that should have stayed missing — and `retiredAt !== undefined` is
 * how the whole client asks whether a team is retired. Turning on create-issues-by-email
 * therefore froze team settings as read-only and dropped the team out of the sidebar,
 * and it stuck, because nothing else was going to write that row again.
 */

import { UPDATE_TEAM_EMAIL_INTAKE } from '~/gql/operations';
import { UPDATE_ISSUE_TEMPLATE_EMAIL_INTAKE } from '~/features/templates/operations';
import type { IssueTemplate, Team, UUID } from '~/store';
import type { SyncEngine } from '~/sync/engine';

/** A GraphQL row as the replica spells it: an unset optional is absent, never `null`. */
function fromWire<T extends object>(row: T): T {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (value !== null) out[key] = value;
  }
  return out as T;
}

export async function updateTeamEmailIntake(
  engine: SyncEngine,
  teamId: UUID,
  enabled: boolean,
): Promise<void> {
  const before = engine.store.get('team', teamId);
  if (before === undefined) return;

  const after: Team = {
    ...before,
    emailIntakeEnabled: enabled,
    ...(enabled ? null : { emailIntakeAddress: undefined }),
    updatedAt: new Date().toISOString(),
  };

  const data = await engine.mutate<{
    updateTeamEmailIntake: { team: Team };
  }>({
    mutation: UPDATE_TEAM_EMAIL_INTAKE,
    variables: { input: { teamId, enabled } },
    optimistic: [{ type: 'team', id: teamId, before, after }],
  });

  const real = data.updateTeamEmailIntake?.team;
  if (real === undefined) return;
  // Merged onto the row as it stands rather than onto `before`, which is a snapshot from
  // before the round trip: a delta that landed while the mutation was in the air is the
  // truth, and re-writing a stale copy of the team over it would undo it.
  const current = engine.store.get('team', teamId) ?? before;
  engine.store.applyOptimistic([
    {
      type: 'team',
      id: teamId,
      before: current,
      after: { ...current, ...fromWire(real), id: teamId },
    },
  ]);
}

export async function updateIssueTemplateEmailIntake(
  engine: SyncEngine,
  templateId: UUID,
  enabled: boolean,
): Promise<void> {
  const before = engine.store.get('issueTemplate', templateId);
  if (before === undefined) return;

  const after: IssueTemplate = {
    ...before,
    emailIntakeEnabled: enabled,
    ...(enabled ? null : { emailIntakeAddress: undefined }),
    updatedAt: new Date().toISOString(),
  };

  const data = await engine.mutate<{
    updateIssueTemplateEmailIntake: { template: IssueTemplate };
  }>({
    mutation: UPDATE_ISSUE_TEMPLATE_EMAIL_INTAKE,
    variables: { input: { templateId, enabled } },
    optimistic: [{ type: 'issueTemplate', id: templateId, before, after }],
  });

  const real = data.updateIssueTemplateEmailIntake?.template;
  if (real === undefined) return;
  const current = engine.store.get('issueTemplate', templateId) ?? before;
  engine.store.applyOptimistic([
    {
      type: 'issueTemplate',
      id: templateId,
      before: current,
      after: { ...current, ...fromWire(real), id: templateId },
    },
  ]);
}
