/**
 * Seeding a saved view's filter into the address bar, once, on arrival.
 *
 * Both screens that render a saved view — `SavedView` and `ProjectAttachedView` — make the
 * same bargain: the URL is the only copy of the view state, and the row's filter is the
 * *starting point* for it rather than a parallel channel. So on arrival with a bare URL the
 * saved filter is written into the search params, and everything afterwards is the ordinary
 * list reading the ordinary URL. `SavedView` explains at length why that is a redirect
 * rather than a prop.
 *
 * It lives here, shared, because the two screens differ in exactly one thing — whether the
 * row has to belong to a project — and a copy each is how they drifted: the parentheses in
 * `?filter=label.in(…)` had to be un-escaped twice, in two files, in one commit.
 *
 * **Once per arrival, and that is the whole subtlety.** The obvious guard is "the URL says
 * nothing about a filter", and it is wrong, because clearing the filter bar is also a URL
 * that says nothing about a filter. Under that guard the last chip somebody removed came
 * straight back — the effect that seeds on arrival re-fired on the removal and wrote the
 * saved filter again, so `Remove filter` and `Clear the filter` were controls that undid
 * themselves and the view could not be widened at all. Removing one clause of two worked,
 * because the parameter survived; removing the last one did not, which is the shape of the
 * bug that makes it look like a rendering glitch rather than a rule.
 *
 * What distinguishes the two is not in the params, so it is remembered here: a ref holding
 * the view this hook has already answered for. It is set as soon as the row resolves —
 * including when the URL arrived carrying its own filter, which is somebody's refinement and
 * must not be overwritten later either — and it is keyed by the view's id so that moving
 * between two tabs without unmounting still seeds the second one.
 *
 * Nothing re-seeds after that. A view whose saved filter is edited elsewhere does not
 * rewrite the URL of a reader standing on it, which is the same answer the screen already
 * gave for every other route to the same state.
 */

import { useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router';

import { FILTER_PARAM, filterSearchString, toFilterParam } from '~/filter';
import { useLiveQuery } from '~/hooks/useLiveQuery';

/**
 * @param viewId  The view being rendered.
 * @param projectId  Set on the attached-view route: the row has to be a tab on *this*
 *   project, or the link is one somebody edited by hand and the screen shows nothing.
 */
export function useSavedFilter(viewId: string, projectId?: string): void {
  const [params] = useSearchParams();
  // Not `useSearchParams`'s setter: it serialises through `URLSearchParams.toString()`,
  // which escapes the parentheses and commas the filter grammar is built from — so opening
  // a saved view produced `?filter=label.in%28…%29` and every link copied from it said
  // nothing a reader could parse. `filterSearchString` is the writer that keeps it readable.
  const navigate = useNavigate();

  const saved = useLiveQuery(
    (store) => {
      const view = store.views.get(viewId);
      if (view === undefined) return null;
      if (projectId !== undefined && view.projectId !== projectId) return null;
      return { filter: toFilterParam(view.filter) };
    },
    ['view'],
    [viewId, projectId ?? ''],
  );

  /** The view this hook has already had its one say about. */
  const answered = useRef<string | null>(null);

  useEffect(() => {
    // Not in the replica yet, and possibly never — a link to a view in a team you cannot
    // see is the second case. Either way there is nothing to seed and nothing to remember,
    // so a filter typed in the meantime is still the reader's own.
    if (saved === null) return;
    if (answered.current === viewId) return;
    answered.current = viewId;

    // The URL carried a filter of its own: somebody's refinement of this view, and
    // overwriting it on arrival would make the refinement unshareable — which is the whole
    // reason this is a redirect rather than a prop.
    if (!params.has(FILTER_PARAM)) {
      const encoded = saved.filter;
      // An empty saved filter is a view over everything, and `?filter=` in a shared link
      // says "filtered" about a view that is not.
      if (encoded !== '') {
        const next = new URLSearchParams(params);
        next.set(FILTER_PARAM, encoded);
        // `replace`: arriving at a view and being sent to the same view with its filter
        // spelled out is one navigation from the user's point of view, and a back button
        // that returned to the bare URL would immediately redirect forward again.
        void navigate({ search: filterSearchString(next) }, { replace: true });
      }
    }
    // `params` is deliberately absent from the deps: this must run when the view resolves,
    // not on every search-param change — including the ones it makes itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved, viewId, navigate]);
}
