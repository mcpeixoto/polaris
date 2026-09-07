/**
 * Where a saved view lives.
 *
 * Its own route rather than a team's list with a query string, because a view is a thing
 * somebody named and can be shared as itself — and because a workspace-scoped view spans
 * every team and so has no team list to hang off. `SavedView` seeds the URL from the saved
 * filter on arrival, which is what keeps "the URL is the state" true for these too.
 *
 * A module of its own because the sidebar and the command menu both link to views, and the
 * second surface to need this rule must not be the second place it is written down.
 */

import type { View } from '~/store';

export function viewPath(view: View): string {
  if (view.projectId !== undefined) return `/project/${view.projectId}/view/${view.id}`;
  return `/view/${view.id}`;
}
