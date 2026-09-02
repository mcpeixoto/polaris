/**
 * A team's triage inbox: unreviewed work, under its own heading.
 *
 * Two panes, not one. The queue on the left is the issue list with the triage source — the
 * same rows, the same shortcuts, the same filter bar — and the right is the issue the cursor
 * is on, with the four decisions under it. Triage is the one screen where reading and
 * deciding are the same motion: a reviewer who has to open each row, decide, and come back to
 * a cursor that has moved is doing three things where the queue only asks for one. Creating
 * an issue with C from here files it into triage. The layout stays a list so `H` can snooze
 * without fighting the board's column nav.
 *
 * The cursor is the list's, and this screen only listens to it. The one thing it decides for
 * itself is where to go after a decision: the row acted on leaves the triage category
 * optimistically, so `TriagePane` captures the next id before the write and hands it back
 * here — and the effect below covers the same move made from the keyboard, where the row
 * vanishes without this screen having been asked anything. Both routes read the queue as it
 * was, because read afterwards "the next issue" is whatever is now first.
 *
 * Turning triage off does not empty the queue. The server keeps the reserved statuses and
 * whatever is sitting in them, deliberately — the switch is about intake, and there is no
 * answer it could give on somebody's behalf to an issue a person still has to read. So the
 * screen follows the queue rather than the switch: off with rows left, it is the same
 * read-write inbox and says why it is still here; off and drained, it is the settings
 * pointer below. Nothing else in the product can reach a triage-category issue — every
 * ordinary view excludes it by default — so refusing to render here is what stranded them.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';

import { Button, EmptyState } from '~/components';
import { nextInQueue, triageQueueIds } from '~/features/triage/focus';
import { triageQueueCount } from '~/features/triage/queue';
import { TriagePane } from '~/features/triage/TriagePane';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import type { UUID } from '~/store';
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

  const queueIds = useLiveQuery(
    (store) => (team === null ? [] : triageQueueIds(store, team.id)),
    ['issue', 'workflowState'],
    [team?.id ?? ''],
  );

  const [focused, setFocused] = useState<UUID | null>(null);
  const onCursorChange = useCallback((id: UUID | null) => setFocused(id), []);

  /**
   * Where to go when the row being read leaves the queue without this screen deciding it.
   *
   * `1` / `2` / `3` / `H` are the list's own bindings and act on its cursor, so a decision
   * taken from the keyboard reaches here as a row that has simply gone. The queue from the
   * render before is the only place the answer still exists, which is why it is kept — and
   * why this runs on the queue rather than on the cursor: the list's cursor may not have
   * moved yet, and following it would put the reader back at the top.
   */
  const previousQueue = useRef<readonly UUID[]>(queueIds);
  useEffect(() => {
    const before = previousQueue.current;
    previousQueue.current = queueIds;
    if (focused === null || queueIds.includes(focused)) return;
    setFocused(nextInQueue(before, focused) ?? queueIds[0] ?? null);
  }, [queueIds, focused]);

  // The list is the authority on the cursor, and this screen is the authority on nothing —
  // so a focus that no longer names a queued row falls back to the head of the queue rather
  // than leaving the right-hand pane on an issue that is no longer in triage.
  const shown = focused !== null && queueIds.includes(focused) ? focused : (queueIds[0] ?? null);

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
      <div className={styles.split}>
        <div className={styles.queue}>
          <IssueList
            source={source}
            heading={`${team.name} triage`}
            onCursorChange={onCursorChange}
          />
        </div>
        <div className={styles.detail}>
          <TriagePane issueId={shown} queueIds={queueIds} onAdvance={setFocused} />
        </div>
      </div>
    </>
  );
}
