/**
 * A saved view, rendered as the issue list it is.
 *
 * The interesting decision here is one line long: on arrival, if the URL carries no filter of
 * its own, this screen *writes the view's saved filter into the URL* and then gets out of the
 * way. Everything after that is the ordinary list — the same filter bar, the same display
 * menu, the same board.
 *
 * The filter and nothing else. The view's saved *display* is handled a layer down, by
 * `useView`, because it is only one of three possible answers there — below whatever the
 * reader has remembered for this screen and below the URL. Seeding it from here as well made
 * this effect and that fallback race to write the same parameters, and the shared default won
 * on every visit.
 *
 * The alternative was to pass the view's filter down as a prop and let the list render it
 * without touching the address bar. That is less code and it is wrong, for three reasons that
 * only show up later:
 *
 *   - A saved view you have refined would not be shareable. Adding "and assigned to me" to
 *     somebody's saved view and pasting the link would send them the unrefined one.
 *   - The filter bar would have to know whether it is editing the URL or a prop, which is a
 *     second mode in the one component that must never quietly mean two things.
 *   - The back button would stop working across a refinement, because nothing moved.
 *
 * So the URL stays the single copy of the view state, exactly as `useView` requires, and a
 * saved view is a *starting point* for it rather than a parallel channel. The cost is one
 * history-replacing navigation on arrival, which is invisible.
 *
 * A view whose filter cannot be encoded, or that is not in the replica yet, renders the
 * list's own "no such thing" empty state rather than a spinner that might never resolve: the
 * replica is either going to have it in a moment or never, and a link somebody sent to a view
 * in a team you cannot see is the second case.
 */

import { useEffect } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';

import { FILTER_PARAM, filterSearchString, toFilterParam } from '~/filter';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import type { UUID } from '~/store';

import { IssueList, type IssueListSource } from './IssueList';

export function SavedView() {
  const { viewId = '' } = useParams<{ viewId: string }>();
  const [params] = useSearchParams();
  // Not `useSearchParams`'s setter: it serialises through
  // `URLSearchParams.toString()`, which escapes the parentheses and commas the filter
  // grammar is built from — so opening a saved view produced
  // `?filter=label.in%28…%29` and every link copied from it said nothing a reader
  // could parse. `filterSearchString` is the writer that keeps the grammar readable.
  const navigate = useNavigate();

  const saved = useLiveQuery(
    (store) => {
      const view = store.views.get(viewId);
      if (view === undefined) return null;
      return { filter: toFilterParam(view.filter) };
    },
    ['view'],
    [viewId],
  );

  // Only when the URL says nothing. A link to a view *with* a filter in it is somebody's
  // refinement of that view, and overwriting it on arrival would make the refinement
  // unshareable — which is the whole reason this is a redirect rather than a prop.
  const untouched = !params.has(FILTER_PARAM);

  useEffect(() => {
    if (saved === null || !untouched) return;

    const next = new URLSearchParams(params);
    if (saved.filter !== '') next.set(FILTER_PARAM, saved.filter);

    // `replace`: arriving at a view and being sent to the same view with its filter spelled
    // out is one navigation from the user's point of view, and a back button that returns to
    // the bare URL would immediately redirect forward again.
    void navigate({ search: filterSearchString(next) }, { replace: true });
    // `params` is deliberately absent: this must run when the view resolves or the URL turns
    // out to be bare, not on every search-param change — including the one it makes itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved, untouched, navigate]);

  const source: IssueListSource = { kind: 'view', viewId: viewId as UUID };
  return <IssueList source={source} />;
}
