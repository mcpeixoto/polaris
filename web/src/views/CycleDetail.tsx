/**
 * One cycle: its issues, under its name.
 *
 * The issue list with a different source, same as a project. Creating an issue with C
 * from here files it into this cycle.
 */

import { useMemo } from 'react';
import { useNavigate, useParams } from 'react-router';

import { Button, EmptyState } from '~/components';
import { CapacityDial } from '~/features/cycles/CapacityDial';
import { cycleCapacity } from '~/features/cycles/computeCapacity';
import { CycleGraph } from '~/features/cycles/CycleGraph';
import { phaseOf } from '~/features/cycles/CycleEditModal';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import { IssueList, type IssueListSource } from './IssueList';
import styles from './CycleDetail.module.css';

export function CycleDetail() {
  const navigate = useNavigate();
  const { cycleId = '' } = useParams<{ cycleId: string }>();
  const cycle = useLiveQuery((store) => store.cycles.get(cycleId) ?? null, ['cycle'], [cycleId]);

  const phase = cycle === null ? null : phaseOf(cycle, Date.now());
  const capacity = useLiveQuery(
    (store) => (cycle === null || phase !== 'Upcoming' ? null : cycleCapacity(store, cycle.id)),
    ['cycle', 'issue', 'team', 'teamMembership', 'workflowState'],
    [cycle?.id ?? '', phase],
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
      {capacity !== null && <CapacityDial data={capacity} />}
      <CycleGraph cycleId={cycle.id} />
      <IssueList source={source} heading={cycle.name} />
    </div>
  );
}
