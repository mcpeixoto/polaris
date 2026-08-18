/**
 * One project: its issues, under its name.
 *
 * Deliberately the issue list with a different source. A second copy of the virtualiser,
 * the selection model and the shortcuts is where a key gets fixed in one place and not
 * the other. Creating an issue with C from here files it into this project — the create
 * modal reads the path.
 */

import { useMemo } from 'react';
import { useNavigate, useParams } from 'react-router';

import { Button, EmptyState } from '~/components';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import { IssueList, type IssueListSource } from './IssueList';

export function ProjectDetail() {
  const navigate = useNavigate();
  const { projectId = '' } = useParams<{ projectId: string }>();
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
    return (
      <EmptyState
        title="No such project"
        description="It may have been deleted, or it may belong to a team you are not in."
        action={<Button onClick={() => navigate(-1)}>Go back</Button>}
      />
    );
  }

  return <IssueList source={source} heading={project.name} />;
}
