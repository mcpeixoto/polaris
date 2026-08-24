/**
 * A team's triage inbox: unreviewed work, under its own heading.
 *
 * The issue list with a different source. Creating an issue with C from here files it into
 * triage. The layout stays a list so `H` can snooze without fighting the board's column nav.
 *
 * Turning triage off does not empty the queue. The server keeps the reserved statuses and
 * whatever is sitting in them, deliberately — the switch is about intake, and there is no
 * answer it could give on somebody's behalf to an issue a person still has to read. So the
 * screen follows the queue rather than the switch: off with rows left, it is the same
 * read-write inbox and says why it is still here; off and drained, it is the settings
 * pointer below. Nothing else in the product can reach a triage-category issue — every
 * ordinary view excludes it by default — so refusing to render here is what stranded them.
 */

import { useMemo } from 'react';
import { Link, useNavigate, useParams } from 'react-router';

import { Button, EmptyState } from '~/components';
import { triageQueueCount } from '~/features/triage/queue';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import { IssueList, type IssueListSource } from './IssueList';
import styles from './Triage.module.css';

export function Triage() {
  const navigate = useNavigate();
  const { teamKey = '' } = useParams<{ teamKey: string }>();
  const team = useLiveQuery(
    (store) => [...store.teams.values()].find((candidate) => candidate.key === teamKey) ?? null,
    ['team'],
    [teamKey],
  );

  // Asked whether or not triage is on, because it is the answer that decides which screen
  // this is — and a hook cannot be asked conditionally.
  const queued = useLiveQuery(
    (store) => (team === null ? 0 : triageQueueCount(store, team.id)),
    ['issue', 'workflowState'],
    [team?.id ?? ''],
  );

  const source = useMemo<IssueListSource | null>(
    () => (team === null ? null : { kind: 'triage', teamId: team.id }),
    [team],
  );

  if (team === null || source === null) {
    return (
      <EmptyState
        title="No such team"
        description={`Nothing in this workspace has the key ${teamKey}.`}
        action={<Button onClick={() => navigate(-1)}>Go back</Button>}
      />
    );
  }

  if (!team.triageEnabled && queued === 0) {
    return (
      <EmptyState
        title="Triage is off"
        description="Turn triage on in team settings. Incoming work from outside the team will then land here instead of in the backlog."
        action={
          <Button variant="primary" onClick={() => navigate(`/team/${team.key}/settings`)}>
            Team settings
          </Button>
        }
      />
    );
  }

  return (
    <>
      {team.triageEnabled ? null : (
        <p className={styles.intakeOff}>
          Intake is off, so nothing new lands here.{' '}
          {queued === 1 ? '1 issue is' : `${queued} issues are`} still waiting on a decision —
          accept, decline, merge or snooze to clear the queue and this screen goes away. Turn intake
          back on in{' '}
          <Link className={styles.link} to={`/team/${team.key}/settings`}>
            team settings
          </Link>
          .
        </p>
      )}
      <IssueList source={source} heading={`${team.name} triage`} />
    </>
  );
}
