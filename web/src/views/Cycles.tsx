/**
 * A team's cycles: upcoming, current, previous, and pause gaps between them, down a
 * timeline.
 *
 * Cycles are minted by cadence, not filed by hand. The ⋯ menu is where dates move,
 * names change, the next window can be pulled forward to today, and the team calendar
 * can be subscribed as ICS.
 *
 * Newest at the top, because the list is a calendar read backwards: what is coming, what
 * is running, what is done. The gutter on the left ticks each window's start and draws the
 * running one in the accent, and the running one alone opens up to its burn-up.
 *
 * Every row answers the same question in the tense that row is in. An upcoming cycle is
 * asked whether it is over-committed, so it wears the capacity ring; a running or finished
 * one is asked how much of it is done, so it wears progress. Before this, only the upcoming
 * rows had an answer and the rest of the list fell through to "12 issues" — a number that
 * says nothing about a sprint that ended last month.
 */

import { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';

import { useEngine } from '~/app/context';
import { Button, ConfirmDialog, EmptyState, IconButton, Menu } from '~/components';
import { EntityLoading, useEntityState } from '~/features/entity-gate/EntityGate';
import { CycleEditModal, isNextUpcoming, phaseOf } from '~/features/cycles/CycleEditModal';
import { CycleCalendarModal } from '~/features/cycles/CycleCalendarModal';
import { CycleGraph } from '~/features/cycles/CycleGraph';
import { CapacityDial } from '~/features/cycles/CapacityDial';
import { cycleCapacity, type CycleCapacity } from '~/features/cycles/computeCapacity';
import { buildCycleGraph } from '~/features/cycles/computeCycleGraph';
import { cycleWindow, daysLeftLabel } from '~/features/cycles/format';
import { CycleGlyph, ScopeGlyph } from '~/features/cycles/glyphs';
import { inheritsCycleSchedule } from '~/features/cycles/inherit';
import { startCycleToday, updateCycle } from '~/features/cycles/mutations';
import { useNow } from '~/features/cycles/useNow';
import { uiLocale } from '~/features/locale';
import { ProgressRing } from '~/features/projects/ProgressRing';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import type { Cycle, Store, Team, UUID } from '~/store';
import { ApiError } from '~/sync/api';
import styles from './Cycles.module.css';

interface CycleProgress {
  readonly completed: number;
  readonly scope: number;
  readonly percent: number;
  readonly unitLabel: 'issues' | 'points';
}

/** What the chip beside the name says. Linear's four words for a window's tense. */
export type CycleChip = 'Planned' | 'Upcoming' | 'Current' | 'Completed';

type ListRow =
  | {
      readonly kind: 'cycle';
      readonly id: UUID;
      readonly cycle: Cycle;
      readonly name: string;
      readonly chip: CycleChip;
      readonly tick: string;
      readonly window: string;
      readonly issueCount: number;
      readonly openCount: number;
      readonly phase: 'Current' | 'Upcoming' | 'Previous';
      readonly canStartToday: boolean;
      readonly capacity: CycleCapacity | null;
      readonly progress: CycleProgress | null;
    }
  | {
      readonly kind: 'gap';
      readonly id: string;
      readonly label: string;
      readonly tick: string;
      readonly window: string;
    };

export function Cycles() {
  const navigate = useNavigate();
  const engine = useEngine();
  const { teamKey = '' } = useParams<{ teamKey: string }>();
  const now = useNow();

  const team = useLiveQuery(
    (store) => [...store.teams.values()].find((candidate) => candidate.key === teamKey) ?? null,
    ['team'],
    [teamKey],
  );
  const teamState = useEntityState(team);

  const rows = useLiveQuery(
    (store) => (team === null ? [] : listRows(store, team, now)),
    ['cycle', 'issue', 'team', 'workflowState'],
    [team?.id ?? '', team?.cycleCooldownWeeks ?? 0, minuteOf(now)],
  );

  const allCycles = useLiveQuery(
    (store) =>
      team === null
        ? []
        : [...store.cycleIdsFor(team.id)]
            .map((id) => store.cycles.get(id))
            .filter(
              (cycle): cycle is Cycle => cycle !== undefined && cycle.archivedAt === undefined,
            ),
    ['cycle', 'team'],
    [team?.id ?? ''],
  );

  const parent = useLiveQuery(
    (store) =>
      team === null || team.parentTeamId === undefined
        ? null
        : (store.get('team', team.parentTeamId) ?? null),
    ['team'],
    [team?.parentTeamId ?? ''],
  );
  const inherited = team !== null && inheritsCycleSchedule(team, parent);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuCycle, setMenuCycle] = useState<Cycle | null>(null);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);

  const [editOpen, setEditOpen] = useState(false);
  const [editCycle, setEditCycle] = useState<Cycle | null>(null);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [startCycle, setStartCycle] = useState<Cycle | null>(null);
  const [startBusy, setStartBusy] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  if (teamState === 'loading') {
    return (
      <div className={styles.screen}>
        <EntityLoading label="Loading cycles…" lines={4} />
      </div>
    );
  }

  if (team === null) {
    return (
      <div className={styles.screen}>
        <EmptyState
          title="No such team"
          description={`Nothing in this workspace has the key ${teamKey}.`}
        />
      </div>
    );
  }

  const settings = () => navigate(`/team/${team.key}/settings`);

  const openMenu = (cycle: Cycle, trigger: HTMLButtonElement) => {
    menuTriggerRef.current = trigger;
    setMenuCycle(cycle);
    setMenuOpen(true);
  };

  const closeMenu = () => {
    setMenuOpen(false);
    setMenuCycle(null);
  };

  const openEdit = (cycle: Cycle) => {
    setEditCycle(cycle);
    setEditOpen(true);
    closeMenu();
  };

  const menuPhase = menuCycle === null ? 'Previous' : phaseOf(menuCycle, now);
  const currentRow = rows.find((row) => row.kind === 'cycle' && row.phase === 'Current');

  return (
    <div className={styles.screen}>
      <header className={styles.header}>
        <h1 className={styles.title}>
          {team.icon === undefined || team.icon === '' ? null : (
            <span className={styles.teamIcon} aria-hidden="true">
              {team.icon}
            </span>
          )}
          {team.name}
          <span className={styles.crumbSeparator} aria-hidden="true">
            ›
          </span>
          Cycles
        </h1>
      </header>

      {!team.cyclesEnabled || rows.length === 0 ? (
        <EmptyState
          title={team.cyclesEnabled ? 'No cycles yet' : 'Cycles are off'}
          description={
            team.cyclesEnabled
              ? 'The next window will appear when the cadence catches up. Check team settings if this stays empty.'
              : 'Turn cycles on in team settings. A current window and the next few are created for you — there is nothing to file into a cooldown, because a cooldown is a gap, not a cycle.'
          }
          action={
            <Button variant="primary" onClick={settings}>
              Team settings
            </Button>
          }
        />
      ) : (
        <ul className={styles.list}>
          {rows.map((row) =>
            row.kind === 'gap' ? (
              <li key={row.id} className={`${styles.item ?? ''} ${styles.gapItem ?? ''}`}>
                <span className={styles.tick} aria-hidden="true">
                  <span className={styles.tickLabel}>{row.tick}</span>
                </span>
                <div className={styles.gapRow}>
                  <span className={styles.gapLabel}>{row.label}</span>
                  <span className={styles.gapWindow}>{row.window}</span>
                </div>
              </li>
            ) : (
              <li
                key={row.id}
                className={[styles.item, row.phase === 'Current' ? styles.currentItem : null]
                  .filter(Boolean)
                  .join(' ')}
              >
                <span className={styles.tick} aria-hidden="true">
                  <span className={styles.tickLabel}>{row.tick}</span>
                </span>
                <div className={styles.body}>
                  <div className={styles.rowLine}>
                    <Link to={`/cycle/${row.id}`} className={styles.row}>
                      <span className={styles.glyph} aria-hidden="true">
                        <CycleGlyph />
                      </span>
                      <span className={styles.name}>{row.name}</span>
                      <span className={styles.chip}>{row.chip}</span>
                      <span className={styles.window}>{row.window}</span>
                      <span className={styles.meter}>
                        {row.capacity !== null ? (
                          <CapacityDial data={row.capacity} compact />
                        ) : (
                          <>
                            <ProgressRing
                              percent={row.progress?.percent ?? 0}
                              label={`${row.name} progress`}
                              detail={
                                row.progress === null
                                  ? 'nothing completed'
                                  : `${row.progress.completed} of ${row.progress.scope} ${row.progress.unitLabel} completed`
                              }
                            />
                            <span className={styles.meterText}>
                              {row.progress?.percent ?? 0}% completed
                            </span>
                          </>
                        )}
                      </span>
                      <span className={styles.scope}>
                        <ScopeGlyph />
                        {row.issueCount} scope
                      </span>
                    </Link>
                    <IconButton
                      aria-label={`Options for ${row.name}`}
                      size="sm"
                      className={styles.menuButton}
                      onClick={(event) => {
                        event.preventDefault();
                        openMenu(row.cycle, event.currentTarget);
                      }}
                      icon={
                        <svg viewBox="0 0 16 16" aria-hidden="true">
                          <circle cx="3" cy="8" r="1.2" fill="currentColor" />
                          <circle cx="8" cy="8" r="1.2" fill="currentColor" />
                          <circle cx="13" cy="8" r="1.2" fill="currentColor" />
                        </svg>
                      }
                    />
                  </div>
                  {/* The window you are in is the one the page is about, so it is the one
                      row that opens: the burn-up sits under it rather than above the list,
                      where it read as a chart of the list. */}
                  {row.phase === 'Current' && (
                    <div className={styles.graph}>
                      <CycleGraph cycleId={row.id} inline />
                    </div>
                  )}
                </div>
              </li>
            ),
          )}
        </ul>
      )}

      <Menu
        open={menuOpen}
        onClose={closeMenu}
        trigger={menuTriggerRef}
        label="Cycle options"
        items={[
          {
            id: 'edit',
            label: 'Edit cycle',
            onSelect: () => {
              if (menuCycle !== null) openEdit(menuCycle);
            },
          },
          {
            id: 'subscribe',
            label: 'Subscribe to cycle calendar',
            onSelect: () => {
              closeMenu();
              setCalendarOpen(true);
            },
          },
          ...(menuCycle !== null &&
          !inherited &&
          menuPhase === 'Upcoming' &&
          isNextUpcoming(menuCycle, allCycles, now)
            ? [
                {
                  id: 'start-today',
                  label: 'Start cycle today',
                  onSelect: () => {
                    if (menuCycle === null) return;
                    // Asked before it happens, because it closes whatever is running and
                    // moves its open work, and the spec calls that irreversible.
                    setStartError(null);
                    setStartCycle(menuCycle);
                    closeMenu();
                  },
                },
              ]
            : []),
        ]}
      />

      <CycleEditModal
        open={editOpen}
        cycle={editCycle}
        phase={editCycle === null ? 'Previous' : phaseOf(editCycle, now)}
        timezone={team.timezone}
        datesLocked={inherited}
        onClose={() => {
          setEditOpen(false);
          setEditCycle(null);
        }}
        onSave={async (edit) => {
          if (editCycle === null) return;
          await updateCycle(engine, editCycle.id, {
            name: edit.name,
            description: edit.description,
            clearDescription: edit.clearDescription,
            startsAt: edit.startsAt,
            endsAt: edit.endsAt,
          });
          setEditCycle(null);
        }}
      />
      <ConfirmDialog
        open={startCycle !== null}
        title={startCycle === null ? 'Start this cycle today?' : `Start ${startCycle.name} today?`}
        consequence={startConsequence(
          currentRow?.kind === 'cycle' ? currentRow.name : null,
          currentRow?.kind === 'cycle' ? currentRow.openCount : 0,
        )}
        confirmLabel="Start cycle today"
        destructive
        busy={startBusy}
        error={startError ?? undefined}
        onClose={() => {
          setStartCycle(null);
          setStartError(null);
        }}
        onConfirm={() => {
          if (startCycle === null) return;
          setStartBusy(true);
          setStartError(null);
          void startCycleToday(engine, startCycle.id).then(
            () => {
              setStartBusy(false);
              setStartCycle(null);
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
        teamId={team.id}
        teamName={team.name}
        onClose={() => setCalendarOpen(false)}
      />
    </div>
  );
}

/** What starting the next cycle now takes away, named rather than implied. */
function startConsequence(currentName: string | null, openCount: number): string {
  if (currentName === null) {
    return 'The cycle starts at 12:00 AM today in the team’s timezone and the pause before it ends. This cannot be undone.';
  }
  const work =
    openCount === 1 ? '1 open issue moves into it' : `${openCount} open issues move into it`;
  return `${currentName} is completed immediately and ${work}. This cannot be undone.`;
}

/**
 * The minute `now` falls in, as the live query's input.
 *
 * The clock ticks so the phases stay honest, and the query only has to be re-asked when
 * something it can see has changed — which for a boundary measured in days is a minute, not
 * every render.
 */
function minuteOf(now: number): number {
  return Math.floor(now / 60_000);
}

/** "Sep 14": the day a window opens, in the team's zone, for the gutter. */
function tickLabel(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat(uiLocale(), { month: 'short', day: 'numeric', timeZone }).format(
    new Date(iso),
  );
}

/**
 * Linear's word for each window's tense. "Upcoming" is only the next window — the one the
 * ⋯ menu can start today — and the ones after it are "Planned".
 */
export function cycleChip(phase: 'Current' | 'Upcoming' | 'Previous', isNext: boolean): CycleChip {
  if (phase === 'Current') return 'Current';
  if (phase === 'Previous') return 'Completed';
  return isNext ? 'Upcoming' : 'Planned';
}

function listRows(store: Store, team: Team, now: number): ListRow[] {
  const zone = team.timezone;
  const cooldownWeeks = team.cycleCooldownWeeks;
  const cycles: Cycle[] = [];
  for (const id of store.cycleIdsFor(team.id)) {
    const cycle = store.cycles.get(id);
    if (cycle === undefined || cycle.archivedAt !== undefined) continue;
    cycles.push(cycle);
  }
  cycles.sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));

  const rows: ListRow[] = [];
  const cooldownMs = cooldownWeeks * 7 * 24 * 60 * 60 * 1000;

  for (let index = 0; index < cycles.length; index++) {
    const cycle = cycles[index];
    if (cycle === undefined) continue;
    if (index > 0) {
      const prev = cycles[index - 1];
      if (prev === undefined) continue;
      const gapMs = Date.parse(cycle.startsAt) - Date.parse(prev.endsAt);
      if (gapMs > 60_000) {
        const isCooldown = cooldownWeeks > 0 && Math.abs(gapMs - cooldownMs) < 60_000;
        rows.push({
          kind: 'gap',
          id: `gap-${prev.id}-${cycle.id}`,
          label: isCooldown ? 'Cooldown' : 'Cycles paused',
          tick: tickLabel(prev.endsAt, zone),
          window: cycleWindow(prev.endsAt, cycle.startsAt, zone, now),
        });
      }
    }

    const phase = phaseOf(cycle, now);
    const window = cycleWindow(cycle.startsAt, cycle.endsAt, zone, now);
    const graph = phase === 'Upcoming' ? null : buildCycleGraph(store, cycle.id);
    const isNext = phase === 'Upcoming' && isNextUpcoming(cycle, cycles, now);
    rows.push({
      kind: 'cycle',
      id: cycle.id,
      cycle,
      name: cycle.name,
      chip: cycleChip(phase, isNext),
      tick: tickLabel(cycle.startsAt, zone),
      // How long is left is only a question while the cycle is running; on a finished one
      // it is noise, and on one that has not begun it is the wrong end of the window.
      window:
        phase === 'Current' ? `${window} · ${daysLeftLabel(cycle.endsAt, zone, now)}` : window,
      issueCount: store.index.byCycle(cycle.id).size,
      openCount: openIssueCount(store, cycle.id),
      phase,
      canStartToday: isNext,
      capacity: phase === 'Upcoming' ? cycleCapacity(store, cycle.id, now) : null,
      progress:
        graph === null || graph.totalScope === 0
          ? null
          : {
              completed: graph.totalCompleted,
              scope: graph.totalScope,
              percent: Math.round((graph.totalCompleted / graph.totalScope) * 100),
              unitLabel: graph.unitLabel,
            },
    });
  }

  // Newest first: the timeline reads down from what is coming to what is done.
  return rows.reverse();
}

/** Issues that would move if this cycle were closed now: anything not done or dropped. */
function openIssueCount(store: Store, cycleId: UUID): number {
  let open = 0;
  for (const issueId of store.index.byCycle(cycleId)) {
    const issue = store.issues.get(issueId);
    if (issue === undefined || issue.archivedAt !== undefined) continue;
    const category = store.workflowStates.get(issue.stateId)?.category;
    if (category === 'completed' || category === 'canceled' || category === 'duplicate') continue;
    open += 1;
  }
  return open;
}
