/**
 * Team and template email-intake writes.
 *
 * Enabling mints an address the settings screen copies. The optimistic patch flips the
 * flag immediately; the address itself arrives from the server, because the token is
 * minted there and a client that invented one would disagree with every other replica.
 *
 * These are the only two writes in the product that take their answer from *GraphQL* and
 * put it into the replica, and that is why they copy named fields rather than spreading
 * the row. A GraphQL team is not a replica team: they are two different spellings of the
 * same record, and every difference between them is a bug waiting for a screen to read it.
 *
 * Two differences, both found the hard way. An unset optional comes back as an explicit
 * `null` where the delta stream omits the key, so spreading the response wrote
 * `retiredAt: null` over a `retiredAt` that should have stayed missing — and
 * `retiredAt !== undefined` is how the whole client asks whether a team is retired, so
 * turning on create-issues-by-email froze team settings read-only and dropped the team out
 * of the sidebar. And a GraphQL enum is SCREAMING_CASE where the replica stores the
 * lower-case value: `estimateScale` came back `FIBONACCI`, no ladder is keyed under that,
 * and the first screen to ask for the team's estimate options — the create-issue dialog,
 * mounted in the shell — crashed the application. Both stuck, because nothing else was
 * ever going to rewrite that row.
 *
 * The address is the one thing here that has to come from the server, because the token is
 * minted there. So that, the flag and the timestamp are what is taken, and the rest of the
 * reply is dropped on the floor where it belongs.
 */

import { UPDATE_TEAM_EMAIL_INTAKE } from '~/gql/operations';
import { UPDATE_ISSUE_TEMPLATE_EMAIL_INTAKE } from '~/features/templates/operations';
import type { IssueTemplate, Team, UUID } from '~/store';
import type { SyncEngine } from '~/sync/engine';

/**
 * The three fields an email-intake reply is allowed to change, spelled for the replica.
 *
 * `emailIntakeAddress` is the reason any of the reply is read at all. `null` and `''` both
 * mean "no address" on the wire and both have to become `undefined`, which is the only
 * absence the replica has.
 */
function intakeFields(row: {
  emailIntakeEnabled?: boolean | null;
  emailIntakeAddress?: string | null;
  updatedAt?: string | null;
}): { emailIntakeEnabled: boolean; emailIntakeAddress?: string; updatedAt?: string } {
  const address = row.emailIntakeAddress;
  return {
    emailIntakeEnabled: row.emailIntakeEnabled === true,
    emailIntakeAddress:
      address === null || address === undefined || address === '' ? undefined : address,
    ...(row.updatedAt === null || row.updatedAt === undefined
      ? null
      : { updatedAt: row.updatedAt }),
  };
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
      after: { ...current, ...intakeFields(real), id: teamId },
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
      after: { ...current, ...intakeFields(real), id: templateId },
    },
  ]);
}
