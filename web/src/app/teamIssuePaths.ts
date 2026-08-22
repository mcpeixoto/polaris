/**
 * Where `G A` and `G B` land.
 *
 * Linear's Active is work that is unstarted or started — not sitting in the backlog, not
 * done, not canceled. Backlog is the backlog category. Both hang off a team because there
 * is no workspace-wide issue list to invent; if the current route is already a team, that
 * team wins, otherwise the first team by key.
 *
 * The filter is the URL grammar, not a special route: the same list, the same shareable
 * link, the same thing somebody typed into the filter bar.
 */

import { FILTER_PARAM, filterSearchString, toFilterParam, type FilterNode } from '~/filter';
import type { Store } from '~/store';

const ACTIVE: FilterNode = {
  field: 'stateCategory',
  op: 'in',
  values: ['unstarted', 'started'],
};

const BACKLOG: FilterNode = { field: 'stateCategory', op: 'eq', values: ['backlog'] };

/** The team key in `/team/ENG` or `/team/ENG/cycles`, or null for every other screen. */
export function teamKeyFromPath(pathname: string): string | null {
  const match = /^\/team\/([^/]+)/.exec(pathname);
  return match?.[1] ?? null;
}

export function pathToActiveIssues(store: Store, pathname: string): string {
  return pathToFilteredTeam(store, pathname, ACTIVE);
}

export function pathToBacklogIssues(store: Store, pathname: string): string {
  return pathToFilteredTeam(store, pathname, BACKLOG);
}

function pathToFilteredTeam(store: Store, pathname: string, filter: FilterNode): string {
  const teams = [...store.teams.values()]
    .filter((team) => team.retiredAt === undefined)
    .sort((a, b) => a.key.localeCompare(b.key));
  const fromPath = teamKeyFromPath(pathname);
  const team =
    (fromPath === null ? undefined : teams.find((row) => row.key === fromPath)) ?? teams[0];
  if (team === undefined) return '/';

  const params = new URLSearchParams();
  params.set(FILTER_PARAM, toFilterParam(filter));
  // Not `params.toString()`: that escapes the grammar's own parentheses and commas, and the
  // link this returns is one somebody copies out of the address bar.
  return `/team/${team.key}${filterSearchString(params)}`;
}
