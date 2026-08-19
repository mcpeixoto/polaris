/**
 * Recurring schedules, and the team defaults that apply a template when createIssue names none.
 *
 * The writes are the same bargain as templates: compute the local row, hand it to
 * `engine.mutate`, return. A schedule is replicated, so the optimistic patch is a row the
 * stream will confirm rather than a guess about something nobody can see.
 *
 * The schedule's id is the server's. `CreateRecurringIssueInput` has no `id` field, so the
 * local row is a stand-in swapped for the real one when the reply lands — the same trade
 * `createTemplate` makes, and acceptable here for the same reason. A schedule is written
 * from a settings screen or a convert dialog, not queued behind an hour of tunnel.
 */

import { fromWire, toWire } from '~/gql/enums';
import { UPDATE_TEAM_TEMPLATES } from '~/gql/operations';
import {
  uuidv7,
  type EntityPatch,
  type Issue,
  type IssueTemplate,
  type RecurringCadence,
  type RecurringIssue,
  type Store,
  type Team,
  type TemplateProperties,
  type UUID,
} from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { ARCHIVE_RECURRING_ISSUE, CREATE_RECURRING_ISSUE } from './operations';

export const CADENCE_LABELS: Readonly<Record<RecurringCadence, string>> = {
  daily: 'Daily',
  weekly: 'Weekly',
  biweekly: 'Every two weeks',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  yearly: 'Yearly',
};

export const CADENCES: readonly RecurringCadence[] = [
  'daily',
  'weekly',
  'biweekly',
  'monthly',
  'quarterly',
  'yearly',
];

/**
 * Whether this viewer has a membership row on the team.
 *
 * That is the whole test the server uses to pick a default template, so the composer has
 * to use it too: applying the member default locally and then sending no `templateId` would
 * be a no-op (the server would apply the same one), but applying the *wrong* default and
 * sending its id would file an outsider's issue from a member template, which is the one
 * thing the two defaults exist to prevent.
 */
export function viewerIsTeamMember(store: Store, teamId: UUID, viewerId: UUID | null): boolean {
  if (viewerId === null) return false;
  for (const membershipId of store.membershipIdsForUser(viewerId)) {
    if (store.get('teamMembership', membershipId)?.teamId === teamId) return true;
  }
  return false;
}

/**
 * The team's member or non-member default, depending on who is filing.
 *
 * `null` while the viewer is unknown: applying the non-member default and then swapping to
 * the member one a frame later would flash a prefill nobody asked for. The composer waits.
 */
export function defaultTemplateFor(
  store: Store,
  teamId: UUID,
  viewerId: UUID | null,
): IssueTemplate | null {
  if (viewerId === null) return null;
  const team = store.get('team', teamId);
  if (team === undefined) return null;
  const id = viewerIsTeamMember(store, teamId, viewerId)
    ? team.defaultTemplateForMembersId
    : team.defaultTemplateForNonMembersId;
  if (id === undefined) return null;
  const template = store.get('issueTemplate', id);
  return template === undefined || template.archivedAt !== undefined ? null : template;
}

/**
 * The property bag a schedule snapshots off a live issue.
 *
 * A schedule is not a live template link. Minting reads this bag, never the issue that
 * originated it, so converting has to copy the fields the next occurrence should be born
 * with rather than hoping they are still on the source later.
 */
export function propertiesOfIssue(store: Store, issue: Issue): TemplateProperties {
  const labelIds = [...store.labelIdsFor(issue.id)];
  return {
    stateId: issue.stateId,
    ...(issue.assigneeId === undefined ? null : { assigneeId: issue.assigneeId }),
    ...(issue.priority === 0 ? null : { priority: issue.priority }),
    ...(issue.estimate === undefined ? null : { estimate: issue.estimate }),
    ...(labelIds.length === 0 ? null : { labelIds }),
  };
}

export async function updateTeamTemplates(
  engine: SyncEngine,
  teamId: UUID,
  patch: {
    defaultTemplateForMembersId?: UUID | null | undefined;
    defaultTemplateForNonMembersId?: UUID | null | undefined;
  },
): Promise<void> {
  const before = engine.store.get('team', teamId);
  if (before === undefined) return;

  const after: Team = {
    ...before,
    ...(patch.defaultTemplateForMembersId === undefined
      ? null
      : patch.defaultTemplateForMembersId === null
        ? { defaultTemplateForMembersId: undefined }
        : { defaultTemplateForMembersId: patch.defaultTemplateForMembersId }),
    ...(patch.defaultTemplateForNonMembersId === undefined
      ? null
      : patch.defaultTemplateForNonMembersId === null
        ? { defaultTemplateForNonMembersId: undefined }
        : { defaultTemplateForNonMembersId: patch.defaultTemplateForNonMembersId }),
    updatedAt: new Date().toISOString(),
  };

  await engine.mutate({
    mutation: UPDATE_TEAM_TEMPLATES,
    variables: {
      input: {
        teamId,
        ...(patch.defaultTemplateForMembersId === undefined
          ? null
          : patch.defaultTemplateForMembersId === null
            ? { clearDefaultTemplateForMembers: true }
            : { defaultTemplateForMembersId: patch.defaultTemplateForMembersId }),
        ...(patch.defaultTemplateForNonMembersId === undefined
          ? null
          : patch.defaultTemplateForNonMembersId === null
            ? { clearDefaultTemplateForNonMembers: true }
            : { defaultTemplateForNonMembersId: patch.defaultTemplateForNonMembersId }),
      },
    },
    optimistic: [{ type: 'team', id: teamId, before, after }],
  });
}

export interface NewRecurringIssue {
  readonly teamId: UUID;
  readonly title: string;
  readonly body?: string | undefined;
  readonly properties?: TemplateProperties | undefined;
  readonly templateId?: UUID | undefined;
  readonly cadence: RecurringCadence;
  readonly firstDueDate: string;
  readonly sourceIssueId?: UUID | undefined;
}

export async function createRecurringIssue(
  engine: SyncEngine,
  input: NewRecurringIssue,
): Promise<UUID> {
  const now = new Date().toISOString();
  const id = uuidv7();
  const provisional: RecurringIssue = {
    id,
    workspaceId: engine.store.workspaceId,
    teamId: input.teamId,
    title: input.title.trim(),
    body: input.body ?? '',
    properties: input.properties ?? {},
    ...(input.templateId === undefined ? null : { templateId: input.templateId }),
    cadence: input.cadence,
    nextDueDate: input.firstDueDate,
    lastCreatedAt: now,
    createdAt: now,
    updatedAt: now,
  };

  const source = input.sourceIssueId === undefined
    ? undefined
    : engine.store.get('issue', input.sourceIssueId);

  const optimistic: EntityPatch[] = [
    { type: 'recurringIssue', id, before: null, after: provisional },
  ];
  if (source !== undefined) {
    optimistic.push({
      type: 'issue',
      id: source.id,
      before: source,
      after: {
        ...source,
        recurringIssueId: id,
        ...(source.dueDate === undefined ? { dueDate: input.firstDueDate } : null),
      },
    });
  }

  const data = await engine.mutate<{ createRecurringIssue: { recurringIssue: RecurringIssue } }>({
    mutation: CREATE_RECURRING_ISSUE,
    variables: {
      input: {
        teamId: input.teamId,
        title: input.title,
        ...(input.body === undefined || input.body === '' ? null : { body: input.body }),
        ...(input.properties === undefined ? null : { properties: input.properties }),
        ...(input.templateId === undefined ? null : { templateId: input.templateId }),
        cadence: toWire(input.cadence),
        firstDueDate: input.firstDueDate,
        ...(input.sourceIssueId === undefined ? null : { sourceIssueId: input.sourceIssueId }),
      },
    },
    optimistic,
  });

  return swapRecurring(
    engine.store,
    id,
    data.createRecurringIssue.recurringIssue,
    input.sourceIssueId,
  );
}

export async function archiveRecurringIssue(engine: SyncEngine, id: UUID): Promise<void> {
  const before = engine.store.get('recurringIssue', id);
  await engine.mutate({
    mutation: ARCHIVE_RECURRING_ISSUE,
    variables: { id, archived: true },
    optimistic: before === undefined ? [] : [{ type: 'recurringIssue', id, before, after: null }],
  });
}

/**
 * Puts the server's row in place of the stand-in, in one store write.
 *
 * One write rather than two because every subscribed row re-renders between them otherwise,
 * and a schedule that vanishes for a frame on its way to being replaced by itself is the
 * exact flicker the optimistic patch exists to prevent. See `swapTemplate`.
 *
 * When the schedule was converted from an existing issue, the issue's `recurringIssueId` is
 * rewritten onto the server's id in the same write — the optimistic patch pointed at the
 * stand-in, and leaving it there would make `issue.recurringIssueId` a dangling reference
 * the moment the stand-in was dropped.
 */
function swapRecurring(
  store: Store,
  provisionalId: UUID,
  wire: RecurringIssue,
  sourceIssueId: UUID | undefined,
): UUID {
  const real = fromWire('recurringIssue', wire);
  const patch: EntityPatch[] = [
    {
      type: 'recurringIssue',
      id: real.id,
      before: store.get('recurringIssue', real.id) ?? null,
      after: real,
    },
  ];
  if (real.id !== provisionalId) {
    patch.unshift({ type: 'recurringIssue', id: provisionalId, before: null, after: null });
  }
  if (sourceIssueId !== undefined) {
    const issue = store.get('issue', sourceIssueId);
    if (issue !== undefined) {
      patch.push({
        type: 'issue',
        id: issue.id,
        before: issue,
        after: {
          ...issue,
          recurringIssueId: real.id,
          ...(issue.dueDate === undefined ? { dueDate: real.nextDueDate } : null),
        },
      });
    }
  }
  store.applyOptimistic(patch);
  return real.id;
}
