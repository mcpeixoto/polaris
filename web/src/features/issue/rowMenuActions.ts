/**
 * What the row menu's new items actually do, once a surface has said which issues it is about.
 *
 * The builder reports a decision and never writes; six surfaces would otherwise each spell out
 * "a status goes through `updateIssues`, an estimate through `updateIssueProperties`, a label
 * is its own row" — three rules that are easy to get subtly different and impossible to notice
 * when you do. So the decision is turned into a write exactly once, here.
 */

import type { CreateIssueHandle } from './create-context';
import type { IssueComposerSeed } from './create-url';
import { applyLabel, removeLabel } from '~/features/labels/mutations';
import type { Store, UUID } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { markIssueAs, type MarkAsKind } from './relationLinks';
import { report, updateIssueProperties, updateIssues } from './mutations';
import type { IssuePropertyKind, RelatedKind } from './rowMenu';

/**
 * Writes one property to every targeted issue.
 *
 * The split between the two mutations is not arbitrary and is the reason this function exists:
 * `updateIssues` batches a shared field across a selection in one `bulkUpdateIssues`, while an
 * estimate and a due date each need a companion "clear" flag that the bulk input does not
 * carry — so those two are written per issue. Getting it the other way round produces a write
 * that silently drops the clear and leaves the old value in place.
 */
export function applyIssueMenuValue(
  engine: SyncEngine,
  ids: readonly UUID[],
  kind: IssuePropertyKind,
  value: string | number | null,
  viewerId: UUID | null,
): void {
  if (ids.length === 0) return;
  switch (kind) {
    case 'status':
      if (typeof value !== 'string') return;
      // `viewerId` on the status write and on no other: it is the argument
      // `withAutoAssignOnStart` reads, so moving an unowned issue into a started state takes
      // it, exactly as it does everywhere else in the product.
      updateIssues(engine, ids, { stateId: value }, viewerId).catch(report);
      return;
    case 'assignee':
      if (typeof value === 'number') return;
      updateIssues(engine, ids, { assigneeId: value }).catch(report);
      return;
    case 'priority':
      if (typeof value !== 'number') return;
      updateIssues(engine, ids, { priority: value }).catch(report);
      return;
    case 'project':
      if (typeof value === 'number') return;
      updateIssues(engine, ids, { projectId: value }).catch(report);
      return;
    case 'cycle':
      if (typeof value === 'number') return;
      updateIssues(engine, ids, { cycleId: value }).catch(report);
      return;
    case 'milestone':
      if (typeof value === 'number') return;
      updateIssues(engine, ids, { projectMilestoneId: value }).catch(report);
      return;
    case 'estimate': {
      if (typeof value === 'string') return;
      for (const id of ids) updateIssueProperties(engine, id, { estimate: value }).catch(report);
      return;
    }
    case 'due': {
      if (typeof value === 'number') return;
      for (const id of ids) {
        updateIssueProperties(engine, id, { dueDate: value }).catch(report);
      }
      return;
    }
    default:
      return;
  }
}

/**
 * Applies or removes one label across the targets, displacing its group-mates.
 *
 * A label is its own row rather than a field, so this is N writes and not a batch — the same
 * shape `LabelPicker`'s callers already use.
 */
export function toggleIssueLabel(
  engine: SyncEngine,
  ids: readonly UUID[],
  labelId: UUID,
  applied: boolean,
  displaces: readonly UUID[],
): void {
  for (const id of ids) {
    if (applied) removeLabel(engine, id, labelId).catch(report);
    else applyLabel(engine, id, labelId, displaces).catch(report);
  }
}

/** Declares a link to an issue that already exists. Thin, so the surfaces stay thin. */
export function markIssueRelation(
  engine: SyncEngine,
  issueId: UUID,
  kind: MarkAsKind,
  otherId: UUID,
  viewerId: UUID | null,
): void {
  markIssueAs(engine, issueId, kind, otherId, viewerId).catch(report);
}

/**
 * The composer, seeded from an issue, with the link written once the new issue exists.
 *
 * Four of the five kinds cannot be expressed as a seed: `parentId` can (that is what makes a
 * sub-issue a sub-issue), but "a new issue that blocks this one" is a relation row, and a
 * relation row needs an id the server has not minted yet. So the seed carries what it can and
 * `onCreated` writes the rest — which is why the composer grew that callback at all.
 *
 * "Issue…" files a *related* issue rather than an unattached one. That is what "Create related"
 * means, and 03-issue-properties.md names the command outright: "Create new issue related to…".
 */
export function createRelatedIssue(
  create: CreateIssueHandle,
  engine: SyncEngine,
  issueId: UUID,
  kind: RelatedKind,
  viewerId: UUID | null,
): void {
  const issue = engine.store.get('issue', issueId);
  if (issue === undefined) return;
  const seed: IssueComposerSeed = {
    teamId: issue.teamId,
    ...(issue.projectId === undefined ? {} : { projectId: issue.projectId }),
    ...(kind === 'subIssue' ? { parentId: issueId } : {}),
  };
  create.open(seed, {
    onCreated: (createdId) => {
      switch (kind) {
        case 'issue':
          markIssueRelation(engine, issueId, 'related', createdId, viewerId);
          return;
        case 'parent':
          markIssueRelation(engine, issueId, 'subIssueOf', createdId, viewerId);
          return;
        case 'blocked':
          markIssueRelation(engine, issueId, 'blocking', createdId, viewerId);
          return;
        case 'blocking':
          markIssueRelation(engine, issueId, 'blockedBy', createdId, viewerId);
          return;
        default:
          // A sub-issue is already attached: the seed carried `parentId`, so the server made
          // it a child on the create rather than in a second write nobody would see fail.
          return;
      }
    },
  });
}

/**
 * This issue's words and properties, as a seed for a new one.
 *
 * A copy rather than a duplicate: the API has no `duplicateIssue`, and a copy is nearly always
 * a copy with one thing changed — so the composer opens filled in and the person filing it
 * decides what the second issue actually says. The title is carried verbatim, without a
 * "(copy)" suffix, because that suffix is something people delete.
 */
export function copySeedOf(store: Store, issueId: UUID): IssueComposerSeed | null {
  const issue = store.get('issue', issueId);
  if (issue === undefined) return null;
  const labelIds = [...store.labelIdsFor(issueId)];
  return {
    teamId: issue.teamId,
    title: issue.title,
    description: issue.description,
    stateId: issue.stateId,
    priority: issue.priority,
    ...(issue.assigneeId === undefined ? {} : { assigneeId: issue.assigneeId }),
    ...(issue.estimate === undefined ? {} : { estimate: issue.estimate }),
    ...(issue.cycleId === undefined ? {} : { cycleId: issue.cycleId }),
    ...(issue.projectId === undefined ? {} : { projectId: issue.projectId }),
    ...(issue.projectMilestoneId === undefined
      ? {}
      : { projectMilestoneId: issue.projectMilestoneId }),
    ...(issue.parentId === undefined ? {} : { parentId: issue.parentId }),
    ...(labelIds.length === 0 ? {} : { labelIds }),
  };
}
