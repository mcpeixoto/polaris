/**
 * A team's cycles: current, upcoming, past, and the pause gaps between them.
 *
 * Cycles are minted by cadence, not filed by hand. The ⋯ menu — reachable by right-click on
 * any row as well — is where dates move, names change, the next window can be pulled forward
 * to today, and the team calendar can be subscribed as ICS.
 *
 * Three headed groups rather than one flat run, because a sprint list is read in three
 * tenses and the flat version made the reader find the boundary by scanning phase chips. The
 * one running now is at the top, what is coming next is under it, and everything finished is
 * below that and folds away — the group a team looks at least is the group with the most rows
 * in it. Inside each group the gutter still ticks each window's start and draws the running
 * one in the accent.
 *
 * Every row answers the same question in the tense that row is in. An upcoming cycle is
 * asked whether it is over-committed, so it wears the capacity ring; a running or finished
 * one is asked how much of it is done, so it wears progress and opens to its burn-up. The
 * graph used to be drawn for the current cycle alone, which is the one window whose outcome
 * nobody is asking about yet: how a sprint went is a question about a sprint that has ended.
 *
 * The keyboard is the issue list's, through `useListCursor`: `j`/`k` move, Enter opens,
 * right-click or the ⋯ button opens the same menu on the same row. Before this the screen
 * registered nothing at all and every one of those was a mouse-only affordance.
 */

import { useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';

import { useEngine } from '~/app/context';
import { useKeyContext } from '~/app/keymap';
import {
  Button,
  ConfirmDialog,
  EmptyState,
  IconButton,
  ListGroup,
  Menu,
  type MenuNode,
} from '~/components';
import { EntityLoading, useEntityState } from '~/features/entity-gate/EntityGate';
import { CycleEditModal, isNextUpcoming, phaseOf } from '~/features/cycles/CycleEditModal';
import { CycleCalendarModal } from '~/features/cycles/CycleCalendarModal';
import { CycleGraph } from '~/features/cycles/CycleGraph';
import { CapacityDial } from '~/features/cycles/CapacityDial';
import { cycleCapacity, type CycleCapacity } from '~/features/cycles/computeCapacity';
import { buildCycleGraph } from '~/features/cycles/computeCycleGraph';
import { cycleWindow, daysLeftLabel } from '~/features/cycles/format';
import { CycleGlyph, NextCycleGlyph, ScopeGlyph } from '~/features/cycles/glyphs';
import { inheritsCycleSchedule } from '~/features/cycles/inherit';
import { startCycleToday, updateCycle } from '~/features/cycles/mutations';
import { useNow } from '~/features/cycles/useNow';
// The three-dot glyph is the issue screens', rather than the fourth hand-drawn copy of
// three circles in this codebase.
import { CalendarGlyph, DotsGlyph, PencilGlyph } from '~/features/issue/glyphs';
import { uiLocale } from '~/features/locale';
import { ProgressRing } from '~/features/projects/ProgressRing';
import { readCollapsed } from '~/features/view/collapse';
import { useContextMenu } from '~/hooks/useContextMenu';
import { useListCursor, listRowDomId } from '~/hooks/useListCursor';
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

type CyclePhase = 'Current' | 'Upcoming' | 'Previous';

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
      readonly phase: CyclePhase;
      readonly canStartToday: boolean;
      readonly capacity: CycleCapacity | null;
      readonly progress: CycleProgress | null;
      /** Whether the burn-up has anything to draw: a started window with issues on it. */
      readonly hasGraph: boolean;
    }
  | {
      readonly kind: 'gap';
      readonly id: string;
      readonly label: string;
      readonly tick: string;
      readonly window: string;
      /** The tense of the cycle the pause runs up to, which is the group it belongs in. */
      readonly phase: CyclePhase;
    };

/** The three groups, in the order they are read: what is running, what is next, what is done. */
const GROUPS: readonly { readonly key: CyclePhase; readonly name: string }[] = [
  { key: 'Current', name: 'Current' },
  { key: 'Upcoming', name: 'Upcoming' },
  { key: 'Previous', name: 'Past' },
];

const PREFERENCE_KEY = 'cycles';

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
  const scrollerRef = useRef<HTMLDivElement>(null);

  const [editOpen, setEditOpen] = useState(false);
  const [editCycle, setEditCycle] = useState<Cycle | null>(null);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [startCycle, setStartCycle] = useState<Cycle | null>(null);
  const [startBusy, setStartBusy] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  // Folded groups are excluded from the cursor's list: a cursor inside a shut group means
  // `j` steps through rows nobody can see and Enter opens one of them.
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() =>
    readCollapsed(PREFERENCE_KEY),
  );

  const grouped = useMemo(
    () =>
      GROUPS.map((group) => ({
        ...group,
        rows: rows.filter((row) => row.phase === group.key),
      })),
    [rows],
  );

  const ids = useMemo(
    () =>
      grouped.flatMap((group) =>
        collapsed.has(group.key)
          ? []
          : group.rows.filter((row) => row.kind === 'cycle').map((row) => row.id),
      ),
    [grouped, collapsed],
  );

  useKeyContext('list');
  const cursor = useListCursor({
    ids,
    prefix: 'cycleList',
    noun: 'cycle',
    onOpen: (id) => void navigate(`/cycle/${id}`),
  });

  const contextMenu = useContextMenu<UUID>({
    onOpen: (id) => cursor.setCursor(id),
    returnFocusTo: scrollerRef,
  });

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
    contextMenu.close();
  };

  const askStart = (cycle: Cycle) => {
    // Asked before it happens, because it closes whatever is running and moves its open
    // work, and the spec calls that irreversible.
    setStartError(null);
    setStartCycle(cycle);
    closeMenu();
    contextMenu.close();
  };

  const currentRow = rows.find((row) => row.kind === 'cycle' && row.phase === 'Current');
  const contextCycle =
    contextMenu.id === null
      ? null
      : (allCycles.find((cycle) => cycle.id === contextMenu.id) ?? null);

  const go = (id: UUID) => {
    closeMenu();
    contextMenu.close();
    void navigate(`/cycle/${id}`);
  };

  /** One menu, whichever way it was opened: the ⋯ button and the right-click agree. */
  const itemsFor = (cycle: Cycle): MenuNode[] => [
    { id: 'open', label: 'Open cycle', icon: <CycleGlyph />, onSelect: () => go(cycle.id) },
    { id: 'edit', label: 'Edit cycle', icon: <PencilGlyph />, onSelect: () => openEdit(cycle) },
    {
      id: 'subscribe',
      label: 'Subscribe to cycle calendar',
      icon: <CalendarGlyph />,
      onSelect: () => {
        closeMenu();
        contextMenu.close();
        setCalendarOpen(true);
      },
    },
    ...(!inherited && phaseOf(cycle, now) === 'Upcoming' && isNextUpcoming(cycle, allCycles, now)
      ? [
          {
            id: 'start-today',
            label: 'Start cycle today',
            icon: <NextCycleGlyph />,
            danger: true,
            onSelect: () => askStart(cycle),
          },
        ]
      : []),
  ];

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

      {/* Two empty states, not one. A team with cycles switched off is one click from having
          them; a team whose cadence has not minted a window yet has nothing to click, and
          offering it a settings button says the wait is a misconfiguration. */}
      {!team.cyclesEnabled ? (
        <EmptyState
          title="Cycles are off"
          description="Turn cycles on in team settings. A current window and the next few are created for you — there is nothing to file into a cooldown, because a cooldown is a gap, not a cycle."
          action={
            <Button variant="primary" onClick={settings}>
              Team settings
            </Button>
          }
        />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No cycles yet"
          description="The first window appears when the cadence reaches it. Nothing to do until then."
        />
      ) : (
        <div
          ref={scrollerRef}
          className={styles.list}
          role="listbox"
          aria-label={`${team.name} cycles`}
          aria-activedescendant={
            cursor.cursorId === null ? undefined : listRowDomId('cycleList', cursor.cursorId)
          }
          tabIndex={0}
        >
          {grouped.map((group) =>
            group.rows.length === 0 ? null : (
              <ListGroup
                key={group.key}
                groupKey={group.key}
                preferenceKey={PREFERENCE_KEY}
                name={group.name}
                count={group.rows.filter((row) => row.kind === 'cycle').length}
                onToggle={(key, shut) =>
                  setCollapsed((held) => {
                    const next = new Set(held);
                    if (shut) next.add(key);
                    else next.delete(key);
                    return next;
                  })
                }
              >
                {/* A real list inside the group, so a row is a list item as well as an
                    option: the outer scroller is the listbox and this only carries them. */}
                <ul role="presentation" className={styles.groupList}>
                  {group.rows.map((row) =>
                    row.kind === 'gap' ? (
                      <li
                        key={row.id}
                        role="presentation"
                        className={`${styles.item ?? ''} ${styles.gapItem ?? ''}`}
                      >
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
                        {...cursor.rowProps(row.id)}
                        role="option"
                        className={[
                          styles.item,
                          row.phase === 'Current' ? styles.currentItem : null,
                          row.id === cursor.cursorId ? styles.cursorItem : null,
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        onContextMenu={(event) => {
                          event.preventDefault();
                          contextMenu.openAt(event.clientX, event.clientY, row.id);
                        }}
                      >
                        <span className={styles.tick} aria-hidden="true">
                          <span className={styles.tickLabel}>{row.tick}</span>
                        </span>
                        <div className={styles.body}>
                          <div className={styles.rowLine}>
                            <Link
                              to={`/cycle/${row.id}`}
                              className={styles.row}
                              onClick={() => cursor.setCursor(row.id)}
                            >
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
                              icon={<DotsGlyph />}
                            />
                          </div>
                          {/* Under the row rather than above the list, where it read as a
                              chart of the list. Drawn wherever there is something to draw:
                              how a sprint went is a question about a sprint that has ended. */}
                          {row.hasGraph && (
                            <div className={styles.graph}>
                              <CycleGraph cycleId={row.id} inline />
                            </div>
                          )}
                        </div>
                      </li>
                    ),
                  )}
                </ul>
              </ListGroup>
            ),
          )}
        </div>
      )}

      <Menu
        open={menuOpen}
        onClose={closeMenu}
        trigger={menuTriggerRef}
        label="Cycle options"
        items={menuCycle === null ? [] : itemsFor(menuCycle)}
      />

      {contextMenu.at === null ? null : <div {...contextMenu.anchorProps} />}
      <Menu
        open={contextMenu.at !== null && contextCycle !== null}
        onClose={contextMenu.close}
        trigger={contextMenu.anchorRef}
        label={contextCycle === null ? 'Cycle options' : `Options for ${contextCycle.name}`}
        items={contextCycle === null ? [] : itemsFor(contextCycle)}
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
export function cycleChip(phase: CyclePhase, isNext: boolean): CycleChip {
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
    const phase = phaseOf(cycle, now);
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
          // The pause belongs with the window it runs up to: a break before next month's
          // sprint is upcoming, not past.
          phase,
        });
      }
    }

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
      // The same three questions `CycleGraph` asks itself, asked here so a row with no
      // answer draws no chart rather than a paragraph saying it has none.
      hasGraph:
        graph !== null &&
        graph.issueCount > 0 &&
        graph.points.length >= 2 &&
        Date.parse(graph.startsAt) <= now,
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

  // Newest first within each group: the timeline still reads down from what is coming to
  // what is done, now inside a heading that says which of the three it is.
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
