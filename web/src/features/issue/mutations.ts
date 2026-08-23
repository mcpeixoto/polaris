/**
 * Every write the issue screens make, with the optimistic patch that goes with it.
 *
 * They live together rather than beside the components that call them because the same
 * three writes are made from four places — the list's bulk actions, the detail view's
 * pickers, the create modal, the command menu — and an optimistic patch written twice is
 * two answers to what the screen shows before the server replies.
 *
 * The shape of every one of them is the same, and it is the point of the whole
 * architecture: compute what the change looks like locally, hand it to `engine.mutate`
 * along with the mutation, and return. The store applies the patch synchronously, the
 * subscribed lists re-render inside the frame, and the network happens afterwards to
 * somebody else's schedule. Nothing here awaits a server before the screen changes.
 *
 * A note on failure. `engine.mutate` already reverts the patch when the server rejects a
 * write, and leaves it standing when the request never left the building — the difference
 * between "that was not allowed" and "you are on a train". Everything here still rejects, so
 * a caller that has somewhere to put an error can, and the screens that do not pass `report`,
 * which says so once in the console: the revert has already corrected what is on screen, and
 * M0 has no toast host to say more than that.
 */

import { fromWire, toWire } from '~/gql/enums';
import {
  ARCHIVE_ISSUE,
  CREATE_COMMENT,
  CREATE_ISSUE,
  DELETE_ISSUE,
  RESOLVE_COMMENT,
  UPDATE_COMMENT,
  UPDATE_ISSUE,
} from '~/gql/operations';
import {
  issueIdentifier,
  uuidv7,
  type Comment,
  type DateOnly,
  type EntityOf,
  type EntityPatch,
  type Issue,
  type IssueLabel,
  type IssueRelation,
  type IssueSubscription,
  type RecurringCadence,
  type RelationType,
  type Store,
  type UUID,
  type WorkflowState,
} from '~/store';
import { ApiError } from '~/sync/api';
import type { SyncEngine } from '~/sync/engine';
import { withAutoAssignOnStart } from './auto-assign';
import {
  CREATE_ISSUE_RELATION,
  CREATE_SUB_ISSUE,
  DELETE_ISSUE_RELATION,
  SET_ISSUE_SUBSCRIPTION,
} from './operations';

/** The issue properties every picker and every bulk action can set. */
export interface IssueFields {
  readonly title?: string | undefined;
  readonly description?: string | undefined;
  readonly stateId?: UUID | undefined;
  readonly priority?: number | undefined;
  /** `null` unassigns. There is no id that means "nobody", so the two cases are separate. */
  readonly assigneeId?: UUID | null | undefined;
  /** `null` removes the issue from its project. */
  readonly projectId?: UUID | null | undefined;
  /** `null` removes the issue from its cycle. */
  readonly cycleId?: UUID | null | undefined;
}

export interface NewIssue {
  readonly teamId: UUID;
  readonly title: string;
  readonly description?: string | undefined;
  readonly stateId?: UUID | undefined;
  readonly assigneeId?: UUID | undefined;
  readonly priority?: number | undefined;
  readonly estimate?: number | undefined;
  /** A calendar day, `2006-01-02`. */
  readonly dueDate?: DateOnly | undefined;
  /** Makes the new issue a child of this one. Cross-team is allowed. */
  readonly parentId?: UUID | undefined;
  /**
   * Labels to apply on creation.
   *
   * Sent with the create rather than as N `addIssueLabel` calls afterwards, because a
   * template that prefills three labels should not produce four writes and four versions —
   * and because an issue that exists for a moment without the labels that define it is
   * briefly in a state no filter would find.
   */
  readonly labelIds?: readonly UUID[] | undefined;
  /**
   * The template this issue came from.
   *
   * Recorded so that "is this template still worth having" is a question the data can
   * answer. It is the only reason `issue.template_id` exists, and nothing was sending it.
   */
  readonly templateId?: UUID | undefined;
  readonly formTemplateId?: UUID | undefined;
  /**
   * Stops the team's member/non-member default from being applied.
   *
   * The composer applies a default locally and then sends its `templateId`. Clearing that
   * default must send this flag, or the server would put the same template back on an
   * issue the filer just emptied.
   */
  readonly skipDefaultTemplate?: boolean | undefined;
  /**
   * Makes this issue the first occurrence of a new schedule. `recurringFirstDueDate` is
   * required with it; the issue's own due date is used when that is omitted.
   */
  readonly recurringCadence?: RecurringCadence | undefined;
  readonly recurringFirstDueDate?: DateOnly | undefined;
  readonly projectId?: UUID | undefined;
  readonly projectMilestoneId?: UUID | undefined;
  readonly cycleId?: UUID | undefined;
  /**
   * Files into the team's triage status. Used by `C` from the inbox; the chosen status in
   * the modal is ignored, matching the server.
   */
  readonly fromTriage?: boolean | undefined;
  /** The viewer, when it is known. Only used by the optimistic row. */
  readonly creatorId?: UUID | undefined;
}

/**
 * Creates an issue and returns its id.
 *
 * The client mints the id and sends it. That one decision is what makes an offline create
 * honest, and it is worth stating why, because the obvious arrangement is the other way
 * round.
 *
 * The server still allocates the *number* — it comes off a row-locked counter on the team,
 * and no client can predict it. But the id does not have to be server-chosen, and when it
 * was, this function had to invent a stand-in row and swap it for the real one when the
 * response arrived. Online that is a swap nobody sees. Offline the response comes minutes
 * later, as a delta, with nothing left holding the pairing — so the server's issue arrived
 * beside the stand-in and the user had two rows for one issue until the next full sync.
 *
 * With a client-minted id the stand-in *is* the issue. The response upserts over the same
 * id, the number and identifier settle, and the offline case needs no reconciliation at all
 * because there is nothing to reconcile. The cost is that ids become client-controlled
 * input, which the server validates as an unused v7 — and which matters less than it sounds,
 * because a client can already choose any content it likes.
 *
 * The number is still a guess until the server answers. See `nextNumberFor`.
 */
export async function createIssue(engine: SyncEngine, input: NewIssue): Promise<UUID> {
  const store = engine.store;
  const state = resolveState(
    store,
    input.teamId,
    input.fromTriage === true ? undefined : input.stateId,
    input.fromTriage === true,
  );
  const now = new Date().toISOString();
  const team = store.get('team', input.teamId);
  const number = nextNumberFor(store, input.teamId);
  const id = uuidv7();

  const provisional: Issue = {
    id,
    workspaceId: store.workspaceId,
    teamId: input.teamId,
    number,
    identifier: team === undefined ? `${number}` : issueIdentifier(team.key, number),
    title: input.title,
    description: input.description ?? '',
    stateId: state,
    assigneeId: input.assigneeId,
    creatorId: input.creatorId,
    priority: input.priority ?? 0,
    sortOrder: lastSortOrderIn(store, state),
    ...(input.estimate === undefined ? null : { estimate: input.estimate }),
    ...(input.dueDate === undefined && input.recurringFirstDueDate === undefined
      ? null
      : { dueDate: input.dueDate ?? input.recurringFirstDueDate }),
    ...(input.parentId === undefined ? null : { parentId: input.parentId }),
    ...(input.templateId === undefined ? null : { templateId: input.templateId }),
    ...(input.formTemplateId === undefined ? null : { formTemplateId: input.formTemplateId }),
    ...(input.projectId === undefined ? null : { projectId: input.projectId }),
    ...(input.cycleId === undefined ? null : { cycleId: input.cycleId }),
    dueDateSource: 'manual',
    createdAt: now,
    updatedAt: now,
  };

  // The labels the create carries, as the rows the replica holds them as.
  //
  // Written in the same patch as the issue rather than left for the server's delta, so the
  // chips are on the row in the frame the issue appears in. Their ids are provisional — the
  // server mints an `issue_label` id per application — and the delta does not replace them,
  // it arrives *beside* them, which is why each one is paired below rather than left to
  // sort itself out.
  const applications: EntityPatch[] = (input.labelIds ?? []).map((labelId) => {
    const application: IssueLabel = {
      id: uuidv7(),
      workspaceId: store.workspaceId,
      issueId: id,
      labelId,
      teamId: input.teamId,
      groupId: store.get('label', labelId)?.parentId,
      createdAt: now,
    };
    return { type: 'issueLabel', id: application.id, before: null, after: application };
  });

  try {
    const data = await engine.mutate<{ createIssue: { issue: Issue } }>({
      mutation: CREATE_ISSUE,
      variables: { input: createInputOf(input, state, id) },
      optimistic: [{ type: 'issue', id, before: null, after: provisional }, ...applications],
      // The issue keeps the id it was minted with, so it pairs with itself and needs
      // nothing. The label applications do not: the server allocates an `issue_label` id
      // per label and the response returns only the issue, so there is no path to read them
      // out of. They pair off the delta stream, on the issue and the label, which is the
      // pair the server holds unique — and if the response gets back first, `settle` retires
      // them there instead. Without either, the chips are written twice, once here and once
      // by the server, and the second copy is a real row that no reload clears.
      reconcile: applications.map((patch) => ({
        type: 'issueLabel' as const,
        provisionalId: patch.id,
        match: ['issueId', 'labelId'],
      })),
    });
    // Same id, so this is an upsert rather than a swap: the number and identifier settle
    // in place and the row never leaves the list.
    swap(store, 'issue', provisional, data.createIssue.issue);
    return id;
  } catch (error) {
    // Queued rather than refused: the issue is on screen, the outbox holds the mutation
    // carrying this same id, and the caller should carry on as if it had been created —
    // because it has been, from the user's point of view and eventually from the server's.
    if (error instanceof ApiError && error.isOffline) return id;
    throw error;
  }
}

/**
 * Applies the same change to every issue given, as one mutation each.
 *
 * There is no bulk mutation in the API and there deliberately should not be: a partial
 * failure over fifty issues has to be reportable per issue, and an "update issues" endpoint
 * that half-succeeds is a transaction nobody can retry. Fifty ops carry fifty opIds, so a
 * replay after a dropped connection applies each exactly once.
 */
export function updateIssues(
  engine: SyncEngine,
  ids: readonly UUID[],
  fields: IssueFields,
  viewerId?: UUID | null,
): Promise<void> {
  return all(ids.map((id) => updateIssue(engine, id, fields, viewerId)));
}

export async function updateIssue(
  engine: SyncEngine,
  id: UUID,
  fields: IssueFields,
  viewerId?: UUID | null,
): Promise<void> {
  const before = engine.store.get('issue', id);
  if (before === undefined) return;

  const next = withAutoAssignOnStart(engine.store, id, fields, viewerId ?? null);

  const after: Issue = unsnooze({
    ...before,
    ...(next.title === undefined ? null : { title: next.title }),
    ...(next.description === undefined ? null : { description: next.description }),
    ...(next.stateId === undefined ? null : { stateId: next.stateId }),
    ...(next.priority === undefined ? null : { priority: next.priority }),
    ...(next.assigneeId === undefined
      ? null
      : { assigneeId: next.assigneeId === null ? undefined : next.assigneeId }),
    ...(next.projectId === undefined
      ? null
      : { projectId: next.projectId === null ? undefined : next.projectId }),
    ...(next.cycleId === undefined
      ? null
      : { cycleId: next.cycleId === null ? undefined : next.cycleId }),
    updatedAt: new Date().toISOString(),
  });
  if (sameIssue(before, after)) return;

  await engine.mutate({
    mutation: UPDATE_ISSUE,
    variables: { input: { id, ...updateInputOf(next) } },
    optimistic: [{ type: 'issue', id, before, after }],
  });
}

/**
 * Archives issues, which locally means dropping them.
 *
 * The optimistic patch is a delete rather than a flag, because that is exactly what the
 * server's own change for an archive is: archived work is not meant to sit in a client's
 * IndexedDB waiting to be turned up by a filter somebody forgot to constrain. Matching the
 * delta means the rows leave the list on the keystroke and the confirmation that follows
 * changes nothing at all.
 *
 * The consequence, and the reason nothing in M0 offers to restore: a client cannot
 * un-archive what it no longer holds. Bringing an issue back is an API call, and the screen
 * that would list archived issues to choose one from is a later milestone.
 */
export function archiveIssues(engine: SyncEngine, ids: readonly UUID[]): Promise<void> {
  return all(
    ids.map((id) => {
      const before = engine.store.get('issue', id);
      if (before === undefined) return Promise.resolve();
      return engine.mutate({
        mutation: ARCHIVE_ISSUE,
        variables: { id, archived: true },
        optimistic: [{ type: 'issue', id, before, after: null }],
      });
    }),
  );
}

/**
 * Deletes issues, which is a soft delete the server keeps for thirty days.
 *
 * The same optimistic shape as an archive — the row leaves the replica — because the server's
 * change for a delete says exactly that, and a client holding a row the stream has removed is
 * a filter result nobody can explain.
 *
 * What makes this different from archiving is that it is *recoverable*, and the caller is
 * expected to say so. `deleteIssue` deliberately does not raise the undo offer itself: the
 * label is the user's words for what just happened, and only the call site knows them. Pair
 * it with `offerUndo` from `~/features/undo/UndoToast` and `restoreIssue` from
 * `~/features/trash/mutations`, which returns `Promise<void>` for exactly that purpose.
 *
 * The document for this has existed since M0 and had no caller at all, so deleting an issue
 * was unreachable from the client — the trash screen was a recovery route for something
 * nothing could do.
 */
export function deleteIssues(engine: SyncEngine, ids: readonly UUID[]): Promise<void> {
  return all(
    ids.map((id) => {
      const before = engine.store.get('issue', id);
      if (before === undefined) return Promise.resolve();
      return engine.mutate({
        mutation: DELETE_ISSUE,
        variables: { id },
        optimistic: [{ type: 'issue', id, before, after: null }],
      });
    }),
  );
}

export interface NewComment {
  readonly issueId: UUID;
  readonly body: string;
  /** The comment being replied to. Threads are one level deep in M0. */
  readonly parentId?: UUID | undefined;
  /** The viewer. Absent only while the viewer query is still in flight. */
  readonly authorId?: UUID | undefined;
  readonly anchorStart?: number | undefined;
  readonly anchorEnd?: number | undefined;
  readonly quote?: string | undefined;
}

/** Posts a comment, appearing under the issue before the request leaves. See `createIssue`. */
export async function postComment(engine: SyncEngine, input: NewComment): Promise<void> {
  const store = engine.store;
  const now = new Date().toISOString();
  const provisional: Comment = {
    id: uuidv7(),
    workspaceId: store.workspaceId,
    issueId: input.issueId,
    parentId: input.parentId,
    body: input.body,
    actor: input.authorId === undefined ? { type: 'user' } : { type: 'user', id: input.authorId },
    anchorStart: input.anchorStart,
    anchorEnd: input.anchorEnd,
    quote: input.quote,
    createdAt: now,
    updatedAt: now,
  };

  try {
    await engine.mutate<{ createComment: { comment: Comment } }>({
      mutation: CREATE_COMMENT,
      variables: {
        input: {
          issueId: input.issueId,
          body: input.body,
          ...(input.parentId === undefined ? null : { parentId: input.parentId }),
          ...(input.quote === undefined
            ? null
            : {
                anchorStart: input.anchorStart,
                anchorEnd: input.anchorEnd,
                quote: input.quote,
              }),
        },
      },
      optimistic: [{ type: 'comment', id: provisional.id, before: null, after: provisional }],
      // A comment's id is the server's, so the stand-in above has to be swapped for the
      // real row. Declared rather than done in the `await` below, because the `await` does
      // not survive the reload — see `SyncEngine.settle`.
      reconcile: {
        type: 'comment',
        provisionalId: provisional.id,
        path: ['createComment', 'comment'],
        // And the same row off the delta stream, which usually gets here first — see
        // `adopt`. Issue, parent and body are what the client chose, so they are what the
        // pairing can be made on; the id is the one thing it did not know.
        match: ['issueId', 'parentId', 'body'],
      },
    });
  } catch (error) {
    if (error instanceof ApiError && error.isOffline) return;
    throw error;
  }
}

export async function editComment(engine: SyncEngine, id: UUID, body: string): Promise<void> {
  const before = engine.store.get('comment', id);
  if (before === undefined || before.body === body) return;
  const now = new Date().toISOString();
  const after: Comment = { ...before, body, editedAt: now, updatedAt: now };

  await engine.mutate({
    mutation: UPDATE_COMMENT,
    variables: { id, body },
    optimistic: [{ type: 'comment', id, before, after }],
  });
}

export async function resolveComment(
  engine: SyncEngine,
  id: UUID,
  resolved: boolean,
  actorId?: UUID | undefined,
): Promise<void> {
  const before = engine.store.get('comment', id);
  if (before === undefined) return;
  const now = new Date().toISOString();
  const after: Comment = resolved
    ? { ...before, resolvedAt: now, resolvedBy: actorId, updatedAt: now }
    : { ...before, resolvedAt: undefined, resolvedBy: undefined, updatedAt: now };

  const data = await engine.mutate<{ resolveComment: { comment: Comment } }>({
    mutation: RESOLVE_COMMENT,
    variables: { id, resolved },
    optimistic: [{ type: 'comment', id, before, after }],
  });
  swap(engine.store, 'comment', after, data.resolveComment.comment);
}

export interface NewSubIssue {
  readonly parentId: UUID;
  /** The child's team. The parent's, unless the caller has a reason — cross-team is normal. */
  readonly teamId: UUID;
  readonly title: string;
  /** The viewer, when it is known. Only used by the optimistic row. */
  readonly creatorId?: UUID | undefined;
}

/**
 * Creates a child of an issue.
 *
 * The same client-minted id as `createIssue`, for the same reason — see there — and
 * deliberately not a call into it. That function's response is shaped by `IssueFields`,
 * which does not carry `parentId`, so the swap that lands the server's row would take the
 * child straight back out of the list it was just added to and leave it there until an
 * unrelated delta arrived. This one asks for the whole issue instead.
 */
export async function createSubIssue(engine: SyncEngine, input: NewSubIssue): Promise<UUID> {
  const store = engine.store;
  const state = resolveState(store, input.teamId, undefined);
  const now = new Date().toISOString();
  const team = store.get('team', input.teamId);
  const number = nextNumberFor(store, input.teamId);
  const id = uuidv7();

  const provisional: Issue = {
    id,
    workspaceId: store.workspaceId,
    teamId: input.teamId,
    number,
    identifier: team === undefined ? `${number}` : issueIdentifier(team.key, number),
    title: input.title,
    description: '',
    stateId: state,
    creatorId: input.creatorId,
    priority: 0,
    sortOrder: lastSortOrderIn(store, state),
    parentId: input.parentId,
    subIssueSortOrder: lastSubIssueSortOrderIn(store, input.parentId),
    dueDateSource: 'manual',
    createdAt: now,
    updatedAt: now,
  };

  try {
    const data = await engine.mutate<{ createIssue: { issue: Issue } }>({
      mutation: CREATE_SUB_ISSUE,
      variables: {
        input: {
          id,
          teamId: input.teamId,
          title: input.title,
          parentId: input.parentId,
          ...(state === '' ? null : { stateId: state }),
        },
      },
      optimistic: [{ type: 'issue', id, before: null, after: provisional }],
    });
    swap(store, 'issue', provisional, data.createIssue.issue);
    return id;
  } catch (error) {
    // Queued rather than refused, exactly as a top-level create is: the child is on screen
    // under its parent and the outbox holds the mutation carrying this same id.
    if (error instanceof ApiError && error.isOffline) return id;
    throw error;
  }
}

/** The two properties the detail view's rail sets that a bulk action has no shape for. */
export interface IssueProperties {
  /** `null` clears it. Absent leaves it alone, and 0 is a real estimate rather than none. */
  readonly estimate?: number | null | undefined;
  /** A calendar day, `2006-01-02`. `null` clears it. */
  readonly dueDate?: DateOnly | null | undefined;
  /**
   * The parent, making this a sub-issue. `null` detaches it.
   *
   * `UpdateIssueInput` has carried `parentId` and `clearParent` since M0 and nothing in the
   * client ever sent either, so detaching a sub-issue was unreachable — the same shape as
   * `DELETE_ISSUE` having no caller. Cross-team is allowed and normal: platform work
   * blocking a feature is the ordinary case, not the exception.
   */
  readonly parentId?: UUID | null | undefined;
}

/**
 * Sets an issue's estimate or its due date.
 *
 * Separate from `updateIssue` because both fields need a companion flag to be clearable and
 * neither belongs in the field set the list's bulk actions share. The mutation's response is
 * ignored here, as it is there: the optimistic patch is what the screen renders and the
 * delta for the same write is what settles it.
 */
export async function updateIssueProperties(
  engine: SyncEngine,
  id: UUID,
  fields: IssueProperties,
): Promise<void> {
  const before = engine.store.get('issue', id);
  if (before === undefined) return;

  const after: Issue = {
    ...before,
    ...(fields.estimate === undefined ? null : { estimate: fields.estimate ?? undefined }),
    ...(fields.dueDate === undefined ? null : { dueDate: fields.dueDate ?? undefined }),
    ...(fields.parentId === undefined ? null : { parentId: fields.parentId ?? undefined }),
    updatedAt: new Date().toISOString(),
  };
  // A picker reselecting the value an issue already has is free rather than a round trip.
  if (
    before.estimate === after.estimate &&
    before.dueDate === after.dueDate &&
    before.parentId === after.parentId
  ) {
    return;
  }

  await engine.mutate({
    mutation: UPDATE_ISSUE,
    variables: { input: { id, ...propertiesInputOf(fields) } },
    optimistic: [{ type: 'issue', id, before, after }],
  });
}

export interface NewRelation {
  readonly issueId: UUID;
  readonly relatedIssueId: UUID;
  readonly type: RelationType;
  /** The viewer, when it is known. Only used by the optimistic row. */
  readonly createdBy?: UUID | undefined;
}

/**
 * Links two issues, as one row.
 *
 * One row whichever end the user is standing at: "blocked by" is a `blocks` row read from
 * the other end, so a caller adding a blocker swaps the two ids rather than asking for an
 * inverse type that does not exist. Two rows could disagree, and an issue that blocks
 * another without the other being blocked by it is a state no user can explain or repair.
 *
 * `related` is symmetric and the server stores it with the smaller id first, so the
 * optimistic row is normalised the same way. Without that the client's copy and the
 * server's would name the same pair from opposite ends, and the panel would render the
 * link twice until the next bootstrap.
 */
export async function createRelation(engine: SyncEngine, input: NewRelation): Promise<void> {
  const store = engine.store;
  const [issueId, relatedIssueId] =
    input.type === 'related' && input.relatedIssueId < input.issueId
      ? [input.relatedIssueId, input.issueId]
      : [input.issueId, input.relatedIssueId];

  const subject = store.get('issue', issueId);
  const object = store.get('issue', relatedIssueId);
  // Both ends have to be in the replica: the row carries each one's team, and a relation to
  // an issue this client cannot see is one it could not render either.
  if (subject === undefined || object === undefined) return;

  const provisional: IssueRelation = {
    id: uuidv7(),
    workspaceId: store.workspaceId,
    issueId,
    relatedIssueId,
    type: input.type,
    teamId: subject.teamId,
    relatedTeamId: object.teamId,
    createdBy: input.createdBy,
    createdAt: new Date().toISOString(),
  };

  try {
    await engine.mutate<{ createIssueRelation: { relation: IssueRelation } }>({
      mutation: CREATE_ISSUE_RELATION,
      // `toWire`: the argument is declared `RelationType!`, and a GraphQL enum value is
      // case-sensitive, so `"blocks"` is not `BLOCKS` and the server rejects it outright.
      variables: { issueId, relatedIssueId, type: toWire(input.type) },
      optimistic: [{ type: 'issueRelation', id: provisional.id, before: null, after: provisional }],
      // The API mints a relation's id, so the stand-in has to be swapped for the real row —
      // and it has to survive a reload, or the two sit side by side and the panel shows one
      // link twice. See `SyncEngine.settle`.
      reconcile: {
        type: 'issueRelation',
        provisionalId: provisional.id,
        path: ['createIssueRelation', 'relation'],
        // Both ends and the kind, which the server treats as unique anyway.
        match: ['issueId', 'relatedIssueId', 'type'],
      },
    });
  } catch (error) {
    if (error instanceof ApiError && error.isOffline) return;
    throw error;
  }
}

/** Unlinks two issues. The row is identified by id, so either end may remove it. */
export async function deleteRelation(engine: SyncEngine, id: UUID): Promise<void> {
  const before = engine.store.get('issueRelation', id);
  if (before === undefined) return;

  await engine.mutate({
    mutation: DELETE_ISSUE_RELATION,
    variables: { id },
    optimistic: [{ type: 'issueRelation', id, before, after: null }],
  });
}

export interface SubscriptionChange {
  readonly issueId: UUID;
  /** The viewer. There is nobody to subscribe without one, so the call does nothing. */
  readonly userId: UUID;
  readonly subscribed: boolean;
}

/**
 * Subscribes the viewer to an issue, or unsubscribes them.
 *
 * An unsubscribe is a flag on a surviving row rather than a deleted one — deleting it would
 * let the next comment re-subscribe the person who just opted out — so the common case is an
 * update of a row that is already here and needs no id from anybody.
 *
 * The first subscription of an issue is the exception: the API mints that row's id, so the
 * client shows a stand-in and adopts the real one when it arrives. Offline there is nothing
 * to adopt and the stand-in stands until the server's row arrives as a delta, at which point
 * the issue briefly holds two rows for one person. The subscriber list is keyed by user, so
 * that is invisible where it matters, and the next bootstrap clears it.
 */
export async function setSubscribed(engine: SyncEngine, input: SubscriptionChange): Promise<void> {
  const store = engine.store;
  const now = new Date().toISOString();
  const variables = { issueId: input.issueId, subscribed: input.subscribed };
  const existing = subscriptionOf(store, input.issueId, input.userId);

  if (existing !== undefined) {
    // The row already says what this call is about to say.
    if (existing.unsubscribed === !input.subscribed) return;
    const after: IssueSubscription = {
      ...existing,
      unsubscribed: !input.subscribed,
      updatedAt: now,
    };
    await engine.mutate({
      mutation: SET_ISSUE_SUBSCRIPTION,
      variables,
      optimistic: [{ type: 'issueSubscription', id: existing.id, before: existing, after }],
    });
    return;
  }

  // Nothing to unsubscribe from: no row means not subscribed, which is what was asked for.
  if (!input.subscribed) return;

  const provisional: IssueSubscription = {
    id: uuidv7(),
    workspaceId: store.workspaceId,
    issueId: input.issueId,
    userId: input.userId,
    reason: 'subscribed',
    unsubscribed: false,
    createdAt: now,
    updatedAt: now,
  };

  try {
    await engine.mutate<{
      setIssueSubscription: { subscription: IssueSubscription };
    }>({
      mutation: SET_ISSUE_SUBSCRIPTION,
      variables,
      optimistic: [
        { type: 'issueSubscription', id: provisional.id, before: null, after: provisional },
      ],
      reconcile: {
        type: 'issueSubscription',
        provisionalId: provisional.id,
        path: ['setIssueSubscription', 'subscription'],
        // One subscription row per person per issue, so this pair is exact.
        match: ['issueId', 'userId'],
      },
    });
  } catch (error) {
    if (error instanceof ApiError && error.isOffline) return;
    throw error;
  }
}

/**
 * Reports a mutation that failed and returns.
 *
 * Exported because the screens call these helpers from click handlers and registered
 * actions, neither of which can await — and a floating promise that rejects is an unhandled
 * rejection in the console rather than a message anybody reads.
 */
export function report(error: unknown): void {
  if (error instanceof ApiError && error.isOffline) return;
  console.error('[polaris] a change could not be saved', error);
}

/**
 * Runs a batch to completion, then rejects with the first failure.
 *
 * `allSettled` rather than `all` because a rejection must not abandon the other
 * forty-nine: each issue is its own mutation with its own opId, and one of them being
 * refused says nothing about the rest. The first reason is rethrown afterwards so the
 * caller still learns that something went wrong.
 */
function all(work: readonly Promise<unknown>[]): Promise<void> {
  return Promise.allSettled(work).then((results) => {
    const failed = results.find((result) => result.status === 'rejected');
    if (failed !== undefined) throw (failed as PromiseRejectedResult).reason;
  });
}

/**
 * Puts the server's entity in place of the stand-in, in one store write.
 *
 * One write rather than two because the list re-renders between them otherwise, and a row
 * that disappears for a frame on the way to being replaced by itself is the exact flicker
 * an optimistic create is supposed to prevent.
 *
 * Only issues reach this now, and they mint their own ids, so it is a plain upsert. The
 * differing-id branch is kept because a server that ever refuses a client's id must still
 * leave the client in a correct state. Rows whose id the *server* allocates are paired by
 * `SyncEngine.settle` instead, which is reached from the outbox as well as from the call
 * that sent the mutation — and so survives a reload taken between the two.
 */
function swap<T extends 'issue' | 'comment'>(
  store: Store,
  type: T,
  provisional: { id: UUID },
  wire: Issue | Comment,
): void {
  // `fromWire` because this row came back over GraphQL, where enumerated values are spelled
  // in upper case, while everything already in the store came off the sync stream in the
  // database's spelling. Writing the response through unconverted puts `"MANUAL"` where every
  // reader compares against `'manual'` — a value that is present, plausible and equal to
  // nothing. See web/src/gql/enums.ts.
  const real = fromWire(type, wire as EntityOf<T>);
  const existing = store.get(type, real.id) ?? null;
  const patch: EntityPatch[] = [{ type, id: real.id, before: existing, after: real }];
  if (real.id !== provisional.id) {
    patch.unshift({ type, id: provisional.id, before: null, after: null });
  }
  store.applyOptimistic(patch);
}

/** The viewer's own subscription row, whether or not it says they are subscribed. */
function subscriptionOf(store: Store, issueId: UUID, userId: UUID): IssueSubscription | undefined {
  for (const id of store.subscriptionIdsForIssue(issueId)) {
    const row = store.get('issueSubscription', id);
    if (row !== undefined && row.userId === userId) return row;
  }
  return undefined;
}

/** The state a new issue starts in: triage when filed from the inbox, else the caller's choice, else the team's default. */
function resolveState(
  store: Store,
  teamId: UUID,
  stateId: UUID | undefined,
  fromTriage = false,
): UUID {
  const states = [...store.workflowStateIdsFor(teamId)]
    .map((id) => store.get('workflowState', id))
    .filter(
      (state): state is WorkflowState => state !== undefined && state.archivedAt === undefined,
    );
  if (fromTriage) {
    return states.find((state) => state.category === 'triage')?.id ?? '';
  }
  if (stateId !== undefined) return stateId;
  const chosen = states.find((state) => state.isDefault) ?? states[0];
  // An empty string rather than a throw: a team with no statuses cannot happen — the
  // workspace seeds five — and a create screen that crashes on a replica that has not
  // finished arriving is worse than one that lets the server reject the write.
  return chosen?.id ?? '';
}

/** Drops a snooze the way any edit on the server does. */
function unsnooze(issue: Issue): Issue {
  if (issue.snoozedUntil === undefined) return issue;
  const { snoozedUntil: _cleared, ...rest } = issue;
  return rest;
}

/**
 * The number the server will most likely allocate.
 *
 * A guess, and knowingly so: the counter lives on the team row and another member creating
 * an issue in the same second wins it. It is still the right guess to make, because the
 * identifier is the issue's name in this product and a row reading "ENG-0" for two hundred
 * milliseconds is more wrong than one reading "ENG-52" that becomes "ENG-53".
 */
function nextNumberFor(store: Store, teamId: UUID): number {
  let highest = 0;
  for (const id of store.index.byTeam(teamId)) {
    const issue = store.issues.get(id);
    if (issue !== undefined && issue.number > highest) highest = issue.number;
  }
  return highest + 1;
}

/**
 * A sort key that lands the new issue at the bottom of its status column, matching where
 * the server appends it.
 *
 * Fractional indices compare as plain strings, so a key that extends the current maximum is
 * greater than every existing one whatever they look like. It is never sent anywhere — the
 * server mints the real key — so it only has to order correctly for the second it is on
 * screen.
 */
function lastSortOrderIn(store: Store, stateId: UUID): string {
  let highest = '';
  for (const id of store.index.byState(stateId)) {
    const issue = store.issues.get(id);
    if (issue !== undefined && issue.sortOrder > highest) highest = issue.sortOrder;
  }
  return `${highest}z`;
}

/**
 * A sibling key that lands the new child at the bottom of the checklist, where the server
 * appends it.
 *
 * Sub-issue order is its own key rather than `sortOrder`: a checklist's order has nothing to
 * do with the backlog's, and sorting children by the backlog's key would reorder somebody's
 * checklist every time an unrelated issue was dragged in the list.
 */
function lastSubIssueSortOrderIn(store: Store, parentId: UUID): string {
  let highest = '';
  for (const id of store.childIssueIdsFor(parentId)) {
    const child = store.issues.get(id);
    const order = child?.subIssueSortOrder ?? '';
    if (order > highest) highest = order;
  }
  return `${highest}z`;
}

function createInputOf(input: NewIssue, stateId: UUID, id: UUID): Record<string, unknown> {
  return {
    id,
    teamId: input.teamId,
    title: input.title,
    ...(input.description === undefined || input.description === ''
      ? null
      : { description: input.description }),
    ...(input.fromTriage === true || stateId === '' ? null : { stateId }),
    ...(input.assigneeId === undefined ? null : { assigneeId: input.assigneeId }),
    ...(input.priority === undefined ? null : { priority: input.priority }),
    ...(input.estimate === undefined ? null : { estimate: input.estimate }),
    ...(input.dueDate === undefined ? null : { dueDate: input.dueDate }),
    ...(input.parentId === undefined ? null : { parentId: input.parentId }),
    // Omitted when empty rather than sent as `[]`. They mean the same thing to the server,
    // but a variable that is present only when it carries something keeps the request legible
    // in a log and in the network tab.
    ...(input.labelIds === undefined || input.labelIds.length === 0
      ? null
      : { labelIds: [...input.labelIds] }),
    ...(input.templateId === undefined ? null : { templateId: input.templateId }),
    ...(input.formTemplateId === undefined ? null : { formTemplateId: input.formTemplateId }),
    ...(input.skipDefaultTemplate === true ? { skipDefaultTemplate: true } : null),
    ...(input.recurringCadence === undefined
      ? null
      : { recurringCadence: toWire(input.recurringCadence) }),
    ...(input.recurringFirstDueDate === undefined
      ? null
      : { recurringFirstDueDate: input.recurringFirstDueDate }),
    ...(input.projectId === undefined ? null : { projectId: input.projectId }),
    ...(input.projectMilestoneId === undefined
      ? null
      : { projectMilestoneId: input.projectMilestoneId }),
    ...(input.cycleId === undefined ? null : { cycleId: input.cycleId }),
    ...(input.fromTriage === true ? { fromTriage: true } : null),
  };
}

/**
 * Turns the field set into the API's partial update.
 *
 * `clearAssignee` is why this is not a spread: a null `assigneeId` on the wire is
 * indistinguishable from "leave it alone" in a partial update, so unassigning has its own
 * flag. Every partial-update API grows this problem; this one names it.
 */
function updateInputOf(fields: IssueFields): Record<string, unknown> {
  return {
    ...(fields.title === undefined ? null : { title: fields.title }),
    ...(fields.description === undefined ? null : { description: fields.description }),
    ...(fields.stateId === undefined ? null : { stateId: fields.stateId }),
    ...(fields.priority === undefined ? null : { priority: fields.priority }),
    ...(fields.assigneeId === undefined
      ? null
      : fields.assigneeId === null
        ? { clearAssignee: true }
        : { assigneeId: fields.assigneeId }),
    ...(fields.projectId === undefined
      ? null
      : fields.projectId === null
        ? { clearProject: true }
        : { projectId: fields.projectId }),
    ...(fields.cycleId === undefined
      ? null
      : fields.cycleId === null
        ? { clearCycle: true }
        : { cycleId: fields.cycleId }),
  };
}

/**
 * The partial update for the rail's two properties.
 *
 * `clearEstimate` and `clearDueDate` exist for the same reason `clearAssignee` does: in a
 * partial update a null is indistinguishable from "leave it alone", and an estimate of zero
 * is a real answer that must not be read as one either.
 */
function propertiesInputOf(fields: IssueProperties): Record<string, unknown> {
  return {
    ...(fields.estimate === undefined
      ? null
      : fields.estimate === null
        ? { clearEstimate: true }
        : { estimate: fields.estimate }),
    ...(fields.dueDate === undefined
      ? null
      : fields.dueDate === null
        ? { clearDueDate: true }
        : { dueDate: fields.dueDate }),
    ...(fields.parentId === undefined
      ? null
      : fields.parentId === null
        ? { clearParent: true }
        : { parentId: fields.parentId }),
  };
}

/** Whether an update would change anything, so a picker reselecting the current value is free. */
function sameIssue(before: Issue, after: Issue): boolean {
  return (
    before.title === after.title &&
    before.description === after.description &&
    before.stateId === after.stateId &&
    before.priority === after.priority &&
    before.assigneeId === after.assigneeId &&
    before.projectId === after.projectId &&
    before.cycleId === after.cycleId
  );
}
