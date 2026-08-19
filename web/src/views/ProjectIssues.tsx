/**
 * Project issues tab — the issue list scoped to this project.
 */

import { useMemo } from 'react';
import { useParams } from 'react-router';

import { useLiveQuery } from '~/hooks/useLiveQuery';
import { IssueList, type IssueListSource } from './IssueList';

export function ProjectIssues() {
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

  if (project === null || source === null) return null;

  return <IssueList source={source} />;
}
