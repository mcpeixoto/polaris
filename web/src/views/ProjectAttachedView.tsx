/**
 * A project-attached view — the issue list scoped to the project and the saved filter.
 *
 * Same bargain as `SavedView`: on arrival with a bare URL, seed the filter from the saved view
 * row, then let `IssueList` read the URL like every other screen. `useSavedFilter` is that one
 * decision, shared by both screens because they differ only in whether the row has to belong
 * to a project. The view's saved *display* is not seeded here — `useView` resolves it, below
 * the reader's own remembered options.
 */

import { useParams } from 'react-router';

import { useSavedFilter } from '~/features/view/ui/useSavedFilter';
import type { UUID } from '~/store';

import { IssueList, type IssueListSource } from './IssueList';

export function ProjectAttachedView() {
  const { projectId = '', viewId = '' } = useParams<{ projectId: string; viewId: string }>();

  useSavedFilter(viewId, projectId);

  const source: IssueListSource = { kind: 'view', viewId: viewId as UUID };
  return <IssueList source={source} />;
}
