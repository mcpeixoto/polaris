/**
 * Project issues tab — the issue list scoped to this project.
 */

import { useMemo } from 'react';
import { useNavigate, useParams } from 'react-router';

import { Button, EmptyState } from '~/components';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import { IssueList, type IssueListSource } from './IssueList';

export function ProjectIssues() {
  const { projectId = '' } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const project = useLiveQuery(
    (store) => store.projects.get(projectId) ?? null,
    ['project'],
    [projectId],
  );

  const source = useMemo<IssueListSource | null>(
    () => (project === null ? null : { kind: 'project', projectId: project.id }),
    [project],
  );

  if (project === null || source === null) {
    /*
     * An explanatory state and not a blank pane, which is what this returned.
     *
     * In a local-first client a blank pane is indistinguishable from data still arriving —
     * the composition doc's rule — and a project that is simply not in the replica yet is
     * the ordinary case here, not the exceptional one. `IssueList`'s own "No such project"
     * state was unreachable, because this returned before the list was ever rendered.
     * `MyIssues`, `LabelView` and `UserView` all answer their own unresolved source this
     * way; this is the same answer.
     */
    return (
      <EmptyState
        title="No such project"
        description="This project has been deleted, or it belongs to a team you are not in — or it has not reached this device yet."
        action={
          <Button variant="secondary" onClick={() => void navigate(-1)}>
            Go back
          </Button>
        }
      />
    );
  }

  return <IssueList source={source} />;
}
