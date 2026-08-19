/**
 * A project-attached view — the issue list scoped to the project and the saved filter.
 *
 * Same bargain as `SavedView`: on arrival with a bare URL, seed the filter and display from
 * the saved view row, then let `IssueList` read the URL like every other screen.
 */

import { useEffect } from 'react';
import { useParams, useSearchParams } from 'react-router';

import { DISPLAY_PARAMS, FILTER_PARAM, toDisplayParams, toFilterParam } from '~/filter';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import type { UUID } from '~/store';

import { IssueList, type IssueListSource } from './IssueList';

export function ProjectAttachedView() {
  const { projectId = '', viewId = '' } = useParams<{ projectId: string; viewId: string }>();
  const [params, setParams] = useSearchParams();

  const saved = useLiveQuery(
    (store) => {
      const view = store.views.get(viewId);
      if (view === undefined || view.projectId !== projectId) return null;
      return { filter: toFilterParam(view.filter), display: toDisplayParams(view.display) };
    },
    ['view'],
    [viewId, projectId],
  );

  const untouched = !params.has(FILTER_PARAM);

  useEffect(() => {
    if (saved === null || !untouched) return;

    const next = new URLSearchParams(params);
    if (saved.filter !== '') next.set(FILTER_PARAM, saved.filter);
    for (const name of Object.values(DISPLAY_PARAMS)) next.delete(name);
    for (const [name, value] of Object.entries(saved.display)) next.set(name, value);

    setParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved, untouched, setParams]);

  const source: IssueListSource = { kind: 'view', viewId: viewId as UUID };
  return <IssueList source={source} />;
}
