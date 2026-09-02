/**
 * Which issues a triage row can be merged into.
 *
 * This used to be the forty most recently updated issues in one team, filtered by the menu's
 * own type-ahead — which meant the type-ahead searched forty rows and nothing else. The
 * canonical issue a duplicate points at is almost always an *older* one, because it is the
 * report that came first, and a merge across teams (a bug filed in Support, already tracked
 * in Platform) could not be expressed at all.
 *
 * So recency is now only the answer to the empty query: the last few things touched, which is
 * the right guess when somebody opens the menu having just been looking at the target. The
 * moment a word is typed the question changes to a search over every live issue in the
 * workspace, matched the way the server matches — folded, term by term, over the identifier
 * and the title. Ranking still prefers the row's own team, because most duplicates are local
 * and a cross-team match should not push the obvious one off the list.
 */

import { foldForSearch, searchTerms } from '~/features/search/search';
import type { StateCategory, Store, UUID } from '~/store';

/**
 * How many rows the menu is given.
 *
 * A menu is scanned, not paged: past a screenful or two the answer is to type another word,
 * and every extra row costs a live subscription's worth of work on every keystroke.
 */
export const DUPLICATE_CANDIDATE_LIMIT = 40;

export interface DuplicateCandidate {
  readonly id: UUID;
  readonly identifier: string;
  readonly title: string;
  /** Shown only for a match outside the row's own team, where the team is the surprising part. */
  readonly teamKey: string | undefined;
  readonly stateCategory: StateCategory;
  readonly stateColor: string | undefined;
}

export interface DuplicateQuery {
  /** What was typed into the menu's filter. Empty is the recency default. */
  readonly query: string;
  /** The team the triage row belongs to: the empty-query scope, and the ranking's thumb. */
  readonly teamId: UUID | undefined;
  /** The rows being merged — an issue cannot be a duplicate of itself. */
  readonly exclude: ReadonlySet<UUID>;
  readonly limit?: number | undefined;
}

export function duplicateCandidates(
  store: Store,
  { query, teamId, exclude, limit = DUPLICATE_CANDIDATE_LIMIT }: DuplicateQuery,
): DuplicateCandidate[] {
  const terms = searchTerms(query);
  // With nothing typed the workspace is not worth walking: the menu is about to show a
  // screenful of recently touched work from this team, and reading every issue in every team
  // to throw all but forty away is the cost this file exists to avoid paying per keystroke.
  const ids = terms.length === 0 ? teamIds(store, teamId) : store.index.active();

  const rows: { candidate: DuplicateCandidate; ownTeam: boolean; updatedAt: string }[] = [];
  for (const id of ids) {
    if (exclude.has(id)) continue;
    const issue = store.issues.get(id);
    if (issue === undefined || issue.archivedAt !== undefined) continue;
    const identifier = store.identifierOf(issue);
    if (terms.length > 0 && !matchesAll(`${identifier} ${issue.title}`, terms)) continue;

    const state = store.workflowStates.get(issue.stateId);
    const ownTeam = issue.teamId === teamId;
    rows.push({
      candidate: {
        id: issue.id,
        identifier,
        title: issue.title,
        teamKey: ownTeam ? undefined : store.teams.get(issue.teamId)?.key,
        stateCategory: state?.category ?? ('backlog' as StateCategory),
        stateColor: state?.color,
      },
      ownTeam,
      updatedAt: issue.updatedAt,
    });
  }

  rows.sort((a, b) => {
    if (a.ownTeam !== b.ownTeam) return a.ownTeam ? -1 : 1;
    if (a.updatedAt !== b.updatedAt) return a.updatedAt < b.updatedAt ? 1 : -1;
    return a.candidate.identifier < b.candidate.identifier ? -1 : 1;
  });
  return rows.slice(0, limit).map((row) => row.candidate);
}

/**
 * Every term, not any of them, which is the server's rule for a search query and the one
 * people expect: typing a second word narrows.
 */
function matchesAll(haystack: string, terms: readonly string[]): boolean {
  const folded = foldForSearch(haystack);
  return terms.every((term) => folded.includes(term));
}

function teamIds(store: Store, teamId: UUID | undefined): ReadonlySet<UUID> {
  return teamId === undefined ? new Set<UUID>() : store.index.byTeam(teamId);
}
