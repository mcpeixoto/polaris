/**
 * Team and template email-intake writes.
 *
 * Enabling mints an address the settings screen copies. The optimistic patch flips the
 * flag immediately; the address itself arrives from the server, because the token is
 * minted there and a client that invented one would disagree with every other replica.
 */

import { UPDATE_TEAM_EMAIL_INTAKE } from '~/gql/operations';
import { UPDATE_ISSUE_TEMPLATE_EMAIL_INTAKE } from '~/features/templates/operations';
import type { IssueTemplate, Team, UUID } from '~/store';
import type { SyncEngine } from '~/sync/engine';

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
  engine.store.applyOptimistic([
    {
      type: 'team',
      id: teamId,
      before: engine.store.get('team', teamId) ?? null,
      after: { ...before, ...real, id: teamId },
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
  engine.store.applyOptimistic([
    {
      type: 'issueTemplate',
      id: templateId,
      before: engine.store.get('issueTemplate', templateId) ?? null,
      after: { ...before, ...real, id: templateId },
    },
  ]);
}
