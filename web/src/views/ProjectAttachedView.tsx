/**
 * A project-attached view — the issue list scoped to the project and the saved filter.
 *
 * Same bargain as `SavedView`: on arrival with a bare URL, seed the filter from the saved view
 * row, then let `IssueList` read the URL like every other screen. The view's saved *display*
 * is not seeded here — `useView` resolves it, below the reader's own remembered options.
 */

import { useEffect } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';

import { FILTER_PARAM, filterSearchString, toFilterParam } from '~/filter';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import type { UUID } from '~/store';

import { IssueList, type IssueListSource } from './IssueList';

export function ProjectAttachedView() {
  const { projectId = '', viewId = '' } = useParams<{ projectId: string; viewId: string }>();
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
      if (view === undefined || view.projectId !== projectId) return null;
      return { filter: toFilterParam(view.filter) };
    },
    ['view'],
    [viewId, projectId],
  );

  const untouched = !params.has(FILTER_PARAM);

  useEffect(() => {
    if (saved === null || !untouched) return;

    const next = new URLSearchParams(params);
    if (saved.filter !== '') next.set(FILTER_PARAM, saved.filter);

    void navigate({ search: filterSearchString(next) }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved, untouched, navigate]);

  const source: IssueListSource = { kind: 'view', viewId: viewId as UUID };
  return <IssueList source={source} />;
}
