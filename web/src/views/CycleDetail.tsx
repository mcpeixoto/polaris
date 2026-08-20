/**
 * One cycle: its issues, under its name, with a per-member sidebar.
 *
 * The issue list with a different source, same as a project. Creating an issue with C
 * from here files it into this cycle. Cmd/Ctrl+I toggles the member distribution; clicking
 * a member filters the list the same way the filter bar would.
 */

import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';

import { Button, EmptyState } from '~/components';
import { CapacityDial } from '~/features/cycles/CapacityDial';
import { cycleCapacity } from '~/features/cycles/computeCapacity';
import { CycleGraph } from '~/features/cycles/CycleGraph';
import { CycleMembers } from '~/features/cycles/CycleMembers';
import { cycleMemberShares } from '~/features/cycles/cycleDistribution';
import { phaseOf } from '~/features/cycles/CycleEditModal';
import { useActions } from '~/app/keymap';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import { IssueList, type IssueListSource } from './IssueList';
import styles from './CycleDetail.module.css';

export function CycleDetail() {
  const navigate = useNavigate();
  const { cycleId = '' } = useParams<{ cycleId: string }>();
  const [membersOpen, setMembersOpen] = useState(true);
  const cycle = useLiveQuery((store) => store.cycles.get(cycleId) ?? null, ['cycle'], [cycleId]);

  const phase = cycle === null ? null : phaseOf(cycle, Date.now());
  const capacity = useLiveQuery(
    (store) => (cycle === null || phase !== 'Upcoming' ? null : cycleCapacity(store, cycle.id)),
    ['cycle', 'issue', 'team', 'teamMembership', 'workflowState'],
    [cycle?.id ?? '', phase],
  );
  const shares = useLiveQuery(
    (store) => (cycle === null ? [] : cycleMemberShares(store, cycle.id)),
    ['cycle', 'issue', 'user', 'team', 'workflowState'],
    [cycle?.id ?? ''],
  );
  const unitLabel = useLiveQuery(
    (store) => {
      if (cycle === null) return 'issues' as const;
      const team = store.teams.get(cycle.teamId);
      return team?.estimateScale === 'none' || team === undefined ? 'issues' : 'points';
    },
    ['team', 'cycle'],
    [cycle?.id ?? '', cycle?.teamId ?? ''],
  );

  const source = useMemo<IssueListSource | null>(
    () => (cycle === null ? null : { kind: 'cycle', cycleId: cycle.id }),
    [cycle],
  );

  useActions(
    [
      {
        id: 'cycle.toggleMembers',
        title: 'Toggle cycle members',
        keys: ['mod+i'],
        group: 'Views',
        run: () => setMembersOpen((open) => !open),
      },
    ],
    [],
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
      <div className={styles.main}>
        {capacity !== null && <CapacityDial data={capacity} />}
        <CycleGraph cycleId={cycle.id} />
        <IssueList source={source} heading={cycle.name} />
      </div>
      {membersOpen ? <CycleMembers rows={shares} unitLabel={unitLabel} /> : null}
    </div>
  );
}
