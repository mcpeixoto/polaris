/**
 * One label as an issue list.
 *
 * The list itself is ordinary: same virtualiser, same filter bar, same board. This file
 * only names the source. Team labels stay on that team because they cannot be applied
 * anywhere else; a workspace label (or a group of them) spans every team the replica holds.
 *
 * The label is a replicated row, so an unsynced one used to read as a deleted one: a
 * bookmarked label URL opened on a cold start said "No such label" over a row that was
 * still arriving. The gate holds the screen until the store has settled, and only then is
 * an absence an answer.
 */

import { useMemo } from 'react';
import { useNavigate, useParams } from 'react-router';

import { Button, EmptyState } from '~/components';
import { EntityLoading, useEntityState } from '~/features/entity-gate/EntityGate';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import type { UUID } from '~/store';

import { IssueList, type IssueListSource } from './IssueList';

export function LabelView() {
  const navigate = useNavigate();
  const { labelId = '' } = useParams<{ labelId: string }>();
  const label = useLiveQuery((store) => store.labels.get(labelId) ?? null, ['label'], [labelId]);

  const source = useMemo<IssueListSource | null>(
    () => (label === null ? null : { kind: 'label', labelId: labelId as UUID }),
    [label, labelId],
  );

  const state = useEntityState(label);

  if (state === 'loading') {
    return <EntityLoading label="Loading this label…" lines={4} />;
  }

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
