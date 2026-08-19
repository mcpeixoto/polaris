/**
 * One cycle: its issues, under its name.
 *
 * The issue list with a different source, same as a project. Creating an issue with C
 * from here files it into this cycle.
 */

import { useMemo } from 'react';
import { useNavigate, useParams } from 'react-router';

import { Button, EmptyState } from '~/components';
import { CycleGraph } from '~/features/cycles/CycleGraph';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import { IssueList, type IssueListSource } from './IssueList';
import styles from './CycleDetail.module.css';

export function CycleDetail() {
  const navigate = useNavigate();
  const { cycleId = '' } = useParams<{ cycleId: string }>();
  const cycle = useLiveQuery(
    (store) => store.cycles.get(cycleId) ?? null,
    ['cycle'],
    [cycleId],
  );

  const source = useMemo<IssueListSource | null>(
    () => (cycle === null ? null : { kind: 'cycle', cycleId: cycle.id }),
    [cycle],
  );

  if (cycle === null || source === null) {
    return (
      <EmptyState
        title="No such cycle"
        description="It may have been removed when cycles were turned off, or it belongs to a team you are not in."
        action={<Button onClick={() => navigate(-1)}>Go back</Button>}
      />
    );
  }

  return (
    <div className={styles.screen}>
      <CycleGraph cycleId={cycle.id} />
      <IssueList source={source} heading={cycle.name} />
    </div>
  );
}
