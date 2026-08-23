/**
 * A saved view, rendered as the issue list it is.
 *
 * The interesting decision here is one hook long: on arrival, if the URL carries no filter of
 * its own, this screen *writes the view's saved filter into the URL* and then gets out of the
 * way. Everything after that is the ordinary list — the same filter bar, the same display
 * menu, the same board. `useSavedFilter` holds it, shared with `ProjectAttachedView`, along
 * with the rule that makes it survivable: it has its say once, so clearing the filter bar
 * clears it rather than being undone by the effect that seeded it.
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

import { useParams } from 'react-router';

import { useSavedFilter } from '~/features/view/ui/useSavedFilter';
import type { UUID } from '~/store';

import { IssueList, type IssueListSource } from './IssueList';

export function SavedView() {
  const { viewId = '' } = useParams<{ viewId: string }>();

  useSavedFilter(viewId);

  const source: IssueListSource = { kind: 'view', viewId: viewId as UUID };
  return <IssueList source={source} />;
}
