/**
 * One label as an issue list.
 *
 * The list itself is ordinary: same virtualiser, same filter bar, same board. This file
 * only names the source. Team labels stay on that team because they cannot be applied
 * anywhere else; a workspace label (or a group of them) spans every team the replica holds.
 */

import { useMemo } from 'react';
import { useNavigate, useParams } from 'react-router';

import { Button, EmptyState } from '~/components';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import type { UUID } from '~/store';

import { IssueList, type IssueListSource } from './IssueList';

export function LabelView() {
  const navigate = useNavigate();
  const { labelId = '' } = useParams<{ labelId: string }>();
  const exists = useLiveQuery(
    (store) => store.labels.get(labelId) !== undefined,
    ['label'],
    [labelId],
  );

  const source = useMemo<IssueListSource | null>(
    () => (exists ? { kind: 'label', labelId: labelId as UUID } : null),
    [exists, labelId],
  );

  if (source === null) {
    return (
      <EmptyState
        title="No such label"
        description="It may have been archived, or it belongs to a team you are not in."
        action={<Button onClick={() => navigate(-1)}>Go back</Button>}
      />
    );
  }

  return <IssueList source={source} />;
}
