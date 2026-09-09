/**
 * The rules for linking one issue to another, shared by every surface that offers to.
 *
 * These began life inside `relations.tsx`, as the private vocabulary of the detail rail's
 * Relations panel. Then the row context menu grew "Mark as ▸ Blocked by…" and needed the same
 * three answers — which stored row a reading maps to, which issues are worth offering, and
 * what else has to happen when the reading is "duplicate of" — and the choice was between a
 * second copy of each and a module both can import. A second copy of `NEW_LINK` is the one
 * bug this file exists to make impossible: a `blocks` row written the wrong way round is
 * present, well-formed and says the opposite of what the user asked for.
 *
 * Everything here is a plain function over the store or the engine. The panel and the menu
 * own their own state, their own refusals and their own wording; what they share is the data
 * rule, and only that.
 */

import type { SyncEngine } from '~/sync/engine';
import type { RelationType, StateCategory, Store, UUID } from '~/store';

import { createRelation, updateIssue, updateIssueProperties } from './mutations';

/**
 * The five ways one issue can be linked to another, as a reader meets them.
 *
 * Five, from three stored types, because two of them read differently from each end. That is
 * the asymmetry every caller exists to hide: the reader thinks in "blocked by" and the
 * database only knows "blocks".
 */
export type RelationKind = 'blockedBy' | 'blocking' | 'related' | 'duplicateOf' | 'duplicatedBy';

/**
 * What the menu can declare about an issue's neighbours, from the issue's own end.
 *
 * The four addable relations, plus the two parenthood readings — a parent is not a relation
 * row at all but `parentId` on the child, and it belongs in the same list because that is where
 * Linear puts it and where a person looks for it.
 */
export type MarkAsKind = 'parentOf' | 'subIssueOf' | RelationKind;

export const MARK_AS_KINDS = [
  'parentOf',
  'subIssueOf',
  'related',
  'blockedBy',
  'blocking',
  'duplicateOf',
] as const;

/**
 * The five a person declares from this end, plus parenthood — never "duplicated by".
 *
 * That reading is real and is shown where a row exists, but nobody stands on an issue and
 * declares that some other issue duplicates it: the person who found the duplicate says so
 * from the duplicate. Offering it would produce rows written from the wrong end, which is the
 * same argument `ADDABLE` makes in the relations panel.
 */
export type OfferedMarkAsKind = (typeof MARK_AS_KINDS)[number];

export interface NewLink {
  readonly issueId: UUID;
  readonly relatedIssueId: UUID;
  readonly type: RelationType;
}

/**
 * Which row to write for each thing a person can add, and which way round.
 *
 * `blockedBy` is the load-bearing entry: there is no inverse type, so a blocker is a `blocks`
 * row with the two ids the other way about. Getting this backwards produces a relation that is
 * present, well-formed and says the opposite of what the user asked for — which is why it has
 * a test of its own.
 *
 * `related` is handed over in the order it was given. `createRelation` normalises the pair to
 * smaller-id-first because that is how the server stores it, and doing it here as well would be
 * a second copy of a rule that must not be able to disagree with itself.
 */
export const NEW_LINK: Readonly<Record<string, (issueId: UUID, otherId: UUID) => NewLink>> = {
  blockedBy: (issueId, otherId) => ({ issueId: otherId, relatedIssueId: issueId, type: 'blocks' }),
  blocking: (issueId, otherId) => ({ issueId, relatedIssueId: otherId, type: 'blocks' }),
  related: (issueId, otherId) => ({ issueId, relatedIssueId: otherId, type: 'related' }),
  duplicateOf: (issueId, otherId) => ({ issueId, relatedIssueId: otherId, type: 'duplicate' }),
};

/**
 * Which section a stored row belongs in, given which end of it this issue is.
 *
 * The comparisons are against the store's lower-case spelling and must stay that way. GraphQL
 * declares `RelationType` and its values are `BLOCKS`, `RELATED`, `DUPLICATE`; the client
 * converts at its boundary in `~/gql/enums`. A reader here that compared against the wire form
 * would match nothing at all for a relation that is sitting right there in the replica.
 */
export function kindOf(type: RelationType, fromOtherEnd: boolean): RelationKind | null {
  switch (type) {
    case 'blocks':
      return fromOtherEnd ? 'blockedBy' : 'blocking';
    case 'related':
      // Symmetric: the row is stored smaller-id-first, so this issue is at whichever end that
      // put it, and both readings are the same word.
      return 'related';
    case 'duplicate':
      return fromOtherEnd ? 'duplicatedBy' : 'duplicateOf';
    default:
      // A newer server may stream a type this build has never heard of. Dropping the row is
      // better than inventing a heading for it.
      return null;
  }
}

/**
 * How many issues a link picker offers at once.
 *
 * It is the one picker in the product whose candidate set is the whole corpus, and it renders
 * under a search box rather than as a scrolling menu — so the cap is a handful rather than the
 * fifty the filter bar allows itself. Past that the answer is to type more, which is why there
 * is a box.
 */
export const MAX_LINK_RESULTS = 8;

export interface LinkCandidate {
  readonly id: UUID;
  readonly identifier: string;
  readonly title: string;
  /** The candidate's status, so a menu can draw the ring the list draws. */
  readonly category: StateCategory;
  /** The workspace's own colour for that status, where the replica holds it. */
  readonly color?: string | undefined;
}

/**
 * Issues that could be linked to this one, by identifier or by title.
 *
 * Two narrowings, because the two things a person types are indexed differently. Titles come
 * out of the trigram index — that is what `store.index.search` is — so a workspace of five
 * thousand issues costs a set intersection rather than a scan. Identifiers cannot: they are
 * derived from the team key at read time and are in no index at all, so they are a walk, and
 * the walk stops at `MAX_LINK_RESULTS` rather than at the end of the corpus.
 *
 * Anything already linked is left out, as is the issue's own parent and its children. Offering
 * one would produce a duplicate row on the server or a silent no-op, and neither of those is a
 * thing the person clicking it asked for.
 */
export function searchIssues(store: Store, issueId: UUID, query: string): LinkCandidate[] {
  const needle = query.trim().toLowerCase();
  // Nothing until something is typed. The alternative is an arbitrary eight issues appearing
  // under the box, which reads as a suggestion the product is not in a position to make.
  if (needle === '') return [];

  const linked = new Set<UUID>([issueId]);
  for (const id of store.relationIdsFrom(issueId)) {
    const row = store.get('issueRelation', id);
    if (row !== undefined) linked.add(row.relatedIssueId);
  }
  for (const id of store.relationIdsTo(issueId)) {
    const row = store.get('issueRelation', id);
    if (row !== undefined) linked.add(row.issueId);
  }

  const byTitle = store.index.search(needle);
  const found: LinkCandidate[] = [];
  for (const issue of store.issues.values()) {
    if (issue.archivedAt !== undefined || linked.has(issue.id)) continue;
    const identifier = store.identifierOf(issue);
    if (!byTitle.has(issue.id) && !identifier.toLowerCase().includes(needle)) continue;
    const state = store.workflowStates.get(issue.stateId);
    found.push({
      id: issue.id,
      identifier,
      title: issue.title,
      category: state?.category ?? 'backlog',
      color: state?.color,
    });
    if (found.length >= MAX_LINK_RESULTS) break;
  }
  // Ordered within the page rather than across the corpus: which eight you get is the store's
  // order, and typing more is how you reach a particular one.
  return found.sort((a, b) => a.identifier.localeCompare(b.identifier));
}

/**
 * The team's reserved Duplicate status, or null when this replica cannot name it.
 *
 * One per team and system-managed — `domain.seedReservedStatuses` creates it — so it is found
 * by category and by the `isSystem` flag rather than by name, which a team may not rename but
 * a future one might. Null is a real answer: a team whose statuses have not arrived yet, or an
 * issue that has left the replica, and in both cases the link is still worth writing.
 */
export function duplicateStateFor(store: Store, issueId: UUID): UUID | null {
  const issue = store.issues.get(issueId);
  if (issue === undefined) return null;
  for (const id of store.workflowStateIdsFor(issue.teamId)) {
    const state = store.get('workflowState', id);
    if (state === undefined || state.archivedAt !== undefined) continue;
    if (state.category === 'duplicate' && state.isSystem) return state.id;
  }
  return null;
}

/**
 * Writes a link from this issue's end, and — for a duplicate — closes the issue it was written
 * from.
 *
 * Marking something a duplicate is a decision about the issue's *status* as much as about its
 * neighbours: 03-issue-properties.md has the duplicate taking the team's reserved Duplicate
 * status. That status is system-managed and `StatusPicker` deliberately refuses to offer it, so
 * this is the only way it is ever reached from the client — which is why it happens here, once,
 * rather than being left to whichever surface remembers.
 *
 * The relation is the write that matters, so the status follows it rather than gating it: a
 * team whose replica has not yet received its Duplicate state still gets the link, and gets the
 * status from the server's own side of the same decision.
 *
 * Parenthood is not a relation row. "Parent of" writes the other issue's `parentId`; "sub-issue
 * of" writes this one's. Both go through `updateIssueProperties`, which owns the optimistic
 * patch for that field.
 */
export async function markIssueAs(
  engine: SyncEngine,
  issueId: UUID,
  kind: MarkAsKind,
  otherId: UUID,
  viewerId: UUID | null,
): Promise<void> {
  if (issueId === otherId) return;
  if (kind === 'parentOf') {
    await updateIssueProperties(engine, otherId, { parentId: issueId });
    return;
  }
  if (kind === 'subIssueOf') {
    await updateIssueProperties(engine, issueId, { parentId: otherId });
    return;
  }
  const make = NEW_LINK[kind];
  if (make === undefined) return;
  await createRelation(engine, { ...make(issueId, otherId), createdBy: viewerId ?? undefined });
  if (kind !== 'duplicateOf') return;
  const stateId = duplicateStateFor(engine.store, issueId);
  if (stateId === null) return;
  await updateIssue(engine, issueId, { stateId });
}

/** The categories a blocker can be in and still be in the way. */
const OPEN: ReadonlySet<StateCategory> = new Set(['triage', 'backlog', 'unstarted', 'started']);

/**
 * The identifiers of the issues still blocking this one, in identifier order.
 *
 * Only unresolved blockers count. 03-issue-properties.md has the pair moving under Related once
 * the blocker resolves, and a flag on a row whose blocker shipped last week would be a flag
 * nobody can act on. A blocker this replica does not hold is still a blocker — the relation row
 * is real — but it has no identifier to name and no status to read, so it is named by its team
 * where that is known and otherwise left out; a row is not flagged on the strength of an issue
 * nobody on this client can see.
 */
export function blockedBy(store: Store, issueId: UUID): readonly string[] {
  const out: string[] = [];
  for (const id of store.relationIdsTo(issueId)) {
    const row = store.get('issueRelation', id);
    if (row === undefined || row.type !== 'blocks') continue;
    const blocker = store.issues.get(row.issueId);
    if (blocker === undefined || blocker.archivedAt !== undefined) continue;
    const state = store.workflowStates.get(blocker.stateId);
    if (state !== undefined && !OPEN.has(state.category)) continue;
    out.push(store.identifierOf(blocker));
  }
  return out.sort((a, b) => a.localeCompare(b));
}

/**
 * "Blocked by ENG-4" — or by two of them, named rather than counted.
 *
 * Named because the next question after "is this blocked" is always "by what", and a row that
 * answered the first and not the second would send the reader to the issue page to find out.
 * Shared by the list row and the board card so the two say the same sentence.
 */
export function blockedTitle(identifiers: readonly string[]): string {
  return `Blocked by ${identifiers.join(', ')}`;
}
