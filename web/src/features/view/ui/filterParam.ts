/**
 * The filter as it lives in the address bar, shared by every list that has one.
 *
 * `useView` and Search each used to keep a private copy of the same two lines. A project
 * list is the third reader, and a third copy is where the subject argument gets forgotten:
 * a project filter opened as an issue filter is a hard error, which is the whole point of
 * tagging fields, and only if every reader passes the subject.
 */

import {
  FILTER_PARAM,
  isStateCategory,
  parseFilterParam,
  toFilterParam,
  type FilterNode,
  type FilterSubject,
} from '~/filter';

export function readFilter(
  raw: string | null,
  subject: FilterSubject = 'issue',
): { filter: FilterNode; error: string | null } {
  let error: string | null = null;
  const filter = parseFilterParam(
    raw,
    (message) => {
      error = message;
    },
    subject,
  );
  return { filter, error };
}

/** Writes the filter into `search`, deleting the param when the filter matches everything. */
export function applyFilterParam(search: URLSearchParams, next: FilterNode): void {
  const encoded = toFilterParam(next);
  // An empty string is what a filter matching everything serialises to, and a bare
  // `?filter=` in a shared link says "filtered" about a view that is not.
  if (encoded === '') search.delete(FILTER_PARAM);
  else search.set(FILTER_PARAM, encoded);
}

/**
 * The category tab, ANDed with whatever filter is already there.
 *
 * A separate parameter from the filter on purpose: clearing the filter must not clear the
 * tab, and a shared link has to carry both. An unknown tab is ignored rather than applied,
 * so a hand-edited link cannot hide every row behind a category the grammar does not have.
 */
export function andCategoryTab(filter: FilterNode, tab: string | null): FilterNode {
  if (tab === null || !isStateCategory(tab)) return filter;
  const clause: FilterNode = { field: 'stateCategory', op: 'eq', values: [tab] };
  return { conj: 'and', nodes: [clause, filter] };
}
