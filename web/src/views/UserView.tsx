/**
 * One person's assigned issues, across every team the replica can see.
 *
 * Not favouritable — Linear's workaround is a custom view filtered by assignee, and this
 * clone keeps the same bargain rather than inventing a fifth favourite kind. Completed
 * work is in, unlike My Issues: a profile is a record of what someone holds and has held,
 * not an inbox of what still needs them.
 *
 * The person is read out of the replica, so "not there" and "not there yet" are the same
 * answer to `useLiveQuery` and only one of them means what this screen used to say. A
 * profile link followed on a cold start rendered "No such person — they may have left the
 * workspace" over a row still on the wire; `useEntityState` is the signal that tells the
 * two apart, and this screen is one of the ten the gate was written for.
 */

import { useMemo } from 'react';
import { useNavigate, useParams } from 'react-router';

import { Button, EmptyState } from '~/components';
import { EntityLoading, useEntityState } from '~/features/entity-gate/EntityGate';
import { personName } from '~/features/prefs/prefs';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import type { UUID } from '~/store';

import { IssueList, type IssueListSource } from './IssueList';

export function UserView() {
  const navigate = useNavigate();
  const { userId = '' } = useParams<{ userId: string }>();
  const name = useLiveQuery(
    (store) => {
      const user = store.users.get(userId);
      return user === undefined ? null : personName(user);
    },
    ['user'],
    [userId],
  );

  const source = useMemo<IssueListSource | null>(
    () =>
      name === null ? null : { kind: 'assignee', userId: userId as UUID, includeCompleted: true },
    [name, userId],
  );

  const state = useEntityState(name);

  if (state === 'loading') {
    return <EntityLoading label="Loading this person…" lines={4} />;
  }

  if (source === null || name === null) {
    return (
      <EmptyState
        title="No such person"
        description="They may have left the workspace, or this link is from a team you cannot see."
        action={<Button onClick={() => navigate(-1)}>Go back</Button>}
      />
    );
  }

  return <IssueList source={source} heading={name} />;
}
