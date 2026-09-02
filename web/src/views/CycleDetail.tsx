/**
 * One cycle: its issues, under its name, with a per-member sidebar.
 *
 * The issue list with a different source, same as a project. Creating an issue with C
 * from here files it into this cycle. Cmd/Ctrl+I toggles the member distribution; clicking
 * a member filters the list the same way the filter bar would.
 *
 * The header is what makes this a cycle rather than a list that happens to be filtered to
 * one. A sprint is read as a position in a series — which window is this, how far through
 * is it, what came before — and none of that was on the screen: no dates, no phase, no way
 * to step to the neighbouring cycle without going back to the list and picking again. The
 * step is bound through the keymap registry like every other movement in the product, so it
 * appears in the help overlay and the command menu rather than being a key this one screen
 * happens to listen for.
 */

import { useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';

import { useEngine } from '~/app/context';
import { Badge, Button, ConfirmDialog, EmptyState, IconButton, Menu, Progress } from '~/components';
import { EntityLoading, useEntityState } from '~/features/entity-gate/EntityGate';
import { CapacityDial } from '~/features/cycles/CapacityDial';
import { cycleCapacity } from '~/features/cycles/computeCapacity';
import { buildCycleGraph } from '~/features/cycles/computeCycleGraph';
import { CycleCalendarModal } from '~/features/cycles/CycleCalendarModal';
import { CycleGraph } from '~/features/cycles/CycleGraph';
import { CycleMembers } from '~/features/cycles/CycleMembers';
import { cycleMemberShares } from '~/features/cycles/cycleDistribution';
import { CycleEditModal, isNextUpcoming, phaseOf } from '~/features/cycles/CycleEditModal';
import { cycleWindow, daysLeftLabel } from '~/features/cycles/format';
import { inheritsCycleSchedule } from '~/features/cycles/inherit';
import { startCycleToday, updateCycle } from '~/features/cycles/mutations';
import { useNow } from '~/features/cycles/useNow';
import { useActions } from '~/app/keymap';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import type { Cycle } from '~/store';
import { ApiError } from '~/sync/api';
import { IssueList, type IssueListSource } from './IssueList';
import styles from './CycleDetail.module.css';

export function CycleDetail() {
  const navigate = useNavigate();
  const engine = useEngine();
  const { cycleId = '' } = useParams<{ cycleId: string }>();
  const [membersOpen, setMembersOpen] = useState(true);
  const now = useNow();
  const cycle = useLiveQuery((store) => store.cycles.get(cycleId) ?? null, ['cycle'], [cycleId]);
  const cycleState = useEntityState(cycle);

  // Read from the clock rather than from the render, so a screen left open across the end
  // of a cycle stops calling it Current and stops offering to move its end date.
  const phase = cycle === null ? null : phaseOf(cycle, now);
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
  const team = useLiveQuery(
    (store) => (cycle === null ? null : (store.teams.get(cycle.teamId) ?? null)),
    ['team', 'cycle'],
    [cycle?.teamId ?? ''],
  );
  const parent = useLiveQuery(
    (store) =>
      team === null || team.parentTeamId === undefined
        ? null
        : (store.get('team', team.parentTeamId) ?? null),
    ['team'],
    [team?.parentTeamId ?? ''],
  );
  const unitLabel = team === null || team.estimateScale === 'none' ? 'issues' : 'points';

  /** The team's cycles in cadence order, which is the order the switcher steps through. */
  const siblings = useLiveQuery(
    (store) =>
      cycle === null
        ? []
        : [...store.cycleIdsFor(cycle.teamId)]
            .map((id) => store.cycles.get(id))
            .filter((c): c is Cycle => c !== undefined && c.archivedAt === undefined)
            .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt)),
    ['cycle', 'team'],
    [cycle?.teamId ?? ''],
  );
  const graph = useLiveQuery(
    (store) => (cycle === null ? null : buildCycleGraph(store, cycle.id)),
    ['cycle', 'issue', 'team', 'workflowState', 'user'],
    [cycle?.id ?? ''],
  );

  const index = siblings.findIndex((candidate) => candidate.id === cycleId);
  const previous = index > 0 ? (siblings[index - 1] ?? null) : null;
  const next = index >= 0 && index < siblings.length - 1 ? (siblings[index + 1] ?? null) : null;

  const source = useMemo<IssueListSource | null>(
    () => (cycle === null ? null : { kind: 'cycle', cycleId: cycle.id }),
    [cycle],
  );

  const [menuOpen, setMenuOpen] = useState(false);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [confirmStart, setConfirmStart] = useState(false);
  const [startBusy, setStartBusy] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const go = (target: Cycle | null) => {
    if (target !== null) void navigate(`/cycle/${target.id}`);
  };

  useActions(
    [
      {
        id: 'cycle.toggleMembers',
        title: 'Toggle cycle members',
        keys: ['mod+i'],
        group: 'Views',
        run: () => setMembersOpen((open) => !open),
      },
      {
        id: 'cycle.previous',
        title: 'Previous cycle',
        keys: ['alt+ArrowLeft'],
        group: 'Navigation',
        enabled: () => previous !== null,
        run: () => go(previous),
      },
      {
        id: 'cycle.next',
        title: 'Next cycle',
        keys: ['alt+ArrowRight'],
        group: 'Navigation',
        enabled: () => next !== null,
        run: () => go(next),
      },
    ],
    [],
  );

  if (cycleState === 'loading') {
    return (
      <div className={styles.screen}>
        <EntityLoading label="Loading cycle…" lines={4} className={styles.loading} />
      </div>
    );
  }

  if (cycle === null || source === null) {
    return (
      <EmptyState
        title="No such cycle"
        description="It may have been removed when cycles were turned off, or it belongs to a team you are not in."
        action={<Button onClick={() => navigate(-1)}>Go back</Button>}
      />
    );
  }

  const zone = team?.timezone ?? 'UTC';
  const inherited = team !== null && inheritsCycleSchedule(team, parent);
  const canStartToday = !inherited && phase === 'Upcoming' && isNextUpcoming(cycle, siblings, now);
  const running = siblings.find((candidate) => phaseOf(candidate, now) === 'Current') ?? null;
  const percent =
    graph === null || graph.totalScope === 0
      ? null
      : Math.round((graph.totalCompleted / graph.totalScope) * 100);

  return (
    <div className={styles.screen}>
      <div className={styles.main}>
        {/* Named, because the issue list below draws a header of its own and two unnamed
            banners on one screen are two things a screen reader cannot tell apart. */}
        <header className={styles.header} aria-label="Cycle">
          <h1 className={styles.title}>{cycle.name}</h1>
          <Badge tone={phase === 'Current' ? 'accent' : 'neutral'}>{phase}</Badge>
          <span className={styles.window}>
            {cycleWindow(cycle.startsAt, cycle.endsAt, zone, now)}
            {phase === 'Current' ? ` · ${daysLeftLabel(cycle.endsAt, zone, now)}` : ''}
          </span>
          {percent === null || graph === null ? null : (
            <span className={styles.progress}>
              <Progress
                percent={percent}
                label={`${cycle.name} progress`}
                detail={`${graph.totalCompleted} of ${graph.totalScope} ${graph.unitLabel} completed`}
                size="sm"
              />
              <span className={styles.ratio}>
                {graph.totalCompleted}/{graph.totalScope}
              </span>
            </span>
          )}
          <span className={styles.switcher}>
            <IconButton
              aria-label="Previous cycle"
              keys="["
              size="sm"
              disabled={previous === null}
              onClick={() => go(previous)}
              icon={
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <path
                    d="M10 3.5 5.5 8l4.5 4.5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              }
            />
            <IconButton
              aria-label="Next cycle"
              keys="]"
              size="sm"
              disabled={next === null}
              onClick={() => go(next)}
              icon={
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <path
                    d="M6 3.5 10.5 8 6 12.5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              }
            />
          </span>
          <IconButton
            ref={menuTriggerRef}
            aria-label={`Options for ${cycle.name}`}
            size="sm"
            onClick={() => setMenuOpen(true)}
            icon={
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <circle cx="3" cy="8" r="1.2" fill="currentColor" />
                <circle cx="8" cy="8" r="1.2" fill="currentColor" />
                <circle cx="13" cy="8" r="1.2" fill="currentColor" />
              </svg>
            }
          />
        </header>
        {capacity !== null && <CapacityDial data={capacity} />}
        <CycleGraph cycleId={cycle.id} />
        <IssueList source={source} heading={cycle.name} />
      </div>
      {membersOpen ? <CycleMembers rows={shares} unitLabel={unitLabel} /> : null}

      {/* The same three commands the list's ⋯ menu offers, because a cycle opened directly
          is the same cycle and should not have fewer things you can do to it. */}
      <Menu
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        trigger={menuTriggerRef}
        label="Cycle options"
        items={[
          {
            id: 'edit',
            label: 'Edit cycle',
            onSelect: () => {
              setMenuOpen(false);
              setEditOpen(true);
            },
          },
          {
            id: 'subscribe',
            label: 'Subscribe to cycle calendar',
            onSelect: () => {
              setMenuOpen(false);
              setCalendarOpen(true);
            },
          },
          ...(canStartToday
            ? [
                {
                  id: 'start-today',
                  label: 'Start cycle today',
                  onSelect: () => {
                    setMenuOpen(false);
                    setStartError(null);
                    setConfirmStart(true);
                  },
                },
              ]
            : []),
        ]}
      />

      <CycleEditModal
        open={editOpen}
        cycle={cycle}
        phase={phase ?? 'Previous'}
        timezone={zone}
        datesLocked={inherited}
        onClose={() => setEditOpen(false)}
        onSave={async (edit) => {
          await updateCycle(engine, cycle.id, {
            name: edit.name,
            description: edit.description,
            clearDescription: edit.clearDescription,
            startsAt: edit.startsAt,
            endsAt: edit.endsAt,
          });
        }}
      />
      <ConfirmDialog
        open={confirmStart}
        title={`Start ${cycle.name} today?`}
        consequence={
          running === null
            ? 'The cycle starts at 12:00 AM today in the team’s timezone and the pause before it ends. This cannot be undone.'
            : `${running.name} is completed immediately and its open issues move into this cycle. This cannot be undone.`
        }
        confirmLabel="Start cycle today"
        destructive
        busy={startBusy}
        error={startError ?? undefined}
        onClose={() => {
          setConfirmStart(false);
          setStartError(null);
        }}
        onConfirm={() => {
          setStartBusy(true);
          setStartError(null);
          void startCycleToday(engine, cycle.id).then(
            () => {
              setStartBusy(false);
              setConfirmStart(false);
            },
            (cause: unknown) => {
              setStartBusy(false);
              setStartError(
                cause instanceof ApiError ? cause.message : 'Could not start this cycle.',
              );
            },
          );
        }}
      />
      <CycleCalendarModal
        open={calendarOpen}
        teamId={cycle.teamId}
        teamName={team?.name ?? ''}
        onClose={() => setCalendarOpen(false)}
      />
    </div>
  );
}
