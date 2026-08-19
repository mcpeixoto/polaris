/**
 * A team's triage inbox: unreviewed work, under its own heading.
 *
 * The issue list with a different source. Creating an issue with C from here files it into
 * triage. The layout stays a list so `H` can snooze without fighting the board's column nav.
 */

import { useMemo } from 'react';
import { useNavigate, useParams } from 'react-router';

import { Button, EmptyState } from '~/components';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import { IssueList, type IssueListSource } from './IssueList';

export function Triage() {
  const navigate = useNavigate();
  const { teamKey = '' } = useParams<{ teamKey: string }>();
  const team = useLiveQuery(
    (store) => [...store.teams.values()].find((candidate) => candidate.key === teamKey) ?? null,
    ['team'],
    [teamKey],
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

  if (!team.triageEnabled) {
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

  return <IssueList source={source} heading={`${team.name} triage`} />;
}
