/**
 * A team's cycles: current, upcoming, previous, and pause gaps between them.
 *
 * Cycles are minted by cadence, not filed by hand. The ⋯ menu is where dates move,
 * names change, the next window can be pulled forward to today, and the team calendar
 * can be subscribed as ICS.
 */

import { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';

import { useEngine } from '~/app/context';
import { Button, EmptyState, IconButton, Menu } from '~/components';
import { CycleEditModal, isNextUpcoming, phaseOf } from '~/features/cycles/CycleEditModal';
import { CycleCalendarModal } from '~/features/cycles/CycleCalendarModal';
import { CycleGraph } from '~/features/cycles/CycleGraph';
import { CapacityDial } from '~/features/cycles/CapacityDial';
import { cycleCapacity, type CycleCapacity } from '~/features/cycles/computeCapacity';
import { startCycleToday, updateCycle } from '~/features/cycles/mutations';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import type { Cycle, Store, UUID } from '~/store';
import styles from './Cycles.module.css';

type ListRow =
  | {
      readonly kind: 'cycle';
      readonly id: UUID;
      readonly cycle: Cycle;
      readonly name: string;
      readonly heading: string;
      readonly window: string;
      readonly issueCount: number;
      readonly phase: 'Current' | 'Upcoming' | 'Previous';
      readonly canStartToday: boolean;
      readonly capacity: CycleCapacity | null;
    }
  | {
      readonly kind: 'gap';
      readonly id: string;
      readonly label: string;
      readonly window: string;
    };

export function Cycles() {
  const navigate = useNavigate();
  const engine = useEngine();
  const { teamKey = '' } = useParams<{ teamKey: string }>();

  const team = useLiveQuery(
    (store) => [...store.teams.values()].find((candidate) => candidate.key === teamKey) ?? null,
    ['team'],
    [teamKey],
  );

  const rows = useLiveQuery(
    (store) => (team === null ? [] : listRows(store, team.id, team.cycleCooldownWeeks)),
    ['cycle', 'issue', 'team'],
    [team?.id ?? '', team?.cycleCooldownWeeks ?? 0],
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

  const [menuOpen, setMenuOpen] = useState(false);
  const [menuCycle, setMenuCycle] = useState<Cycle | null>(null);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);

  const [editOpen, setEditOpen] = useState(false);
  const [editCycle, setEditCycle] = useState<Cycle | null>(null);
  const [calendarOpen, setCalendarOpen] = useState(false);

  const run = async (work: Promise<void>) => {
    try {
      await work;
    } catch {
      // The sync layer surfaces API errors; this screen stays on the replica.
    }
  };

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

  const menuPhase = menuCycle === null ? 'Previous' : phaseOf(menuCycle, Date.now());
  const currentId = rows.find((row) => row.kind === 'cycle' && row.phase === 'Current')?.id;

  return (
    <div className={styles.screen}>
      <header className={styles.header}>
        <h1 className={styles.title}>{team.name} cycles</h1>
      </header>

      {currentId !== undefined && <CycleGraph cycleId={currentId} />}

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
              <li key={row.id} className={styles.gapRow}>
                <span className={styles.phase}>{row.label}</span>
                <span className={styles.gapWindow}>{row.window}</span>
              </li>
            ) : (
              <li key={row.id} className={styles.item}>
                <Link to={`/cycle/${row.id}`} className={styles.row}>
                  <span className={styles.phase}>{row.heading}</span>
                  <span className={styles.body}>
                    <span className={styles.name}>{row.name}</span>
                    <span className={styles.summary}>{row.window}</span>
                  </span>
                  <span className={styles.count}>
                    {row.capacity !== null ? (
                      <CapacityDial data={row.capacity} compact />
                    ) : row.issueCount === 1 ? (
                      '1 issue'
                    ) : (
                      `${row.issueCount} issues`
                    )}
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
          menuPhase === 'Upcoming' &&
          isNextUpcoming(menuCycle, allCycles, Date.now())
            ? [
                {
                  id: 'start-today',
                  label: 'Start cycle today',
                  onSelect: () => {
                    if (menuCycle === null) return;
                    void run(startCycleToday(engine, menuCycle.id));
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
        phase={editCycle === null ? 'Previous' : phaseOf(editCycle, Date.now())}
        onClose={() => {
          setEditOpen(false);
          setEditCycle(null);
        }}
        onSave={(edit) => {
          if (editCycle === null) return;
          void run(
            updateCycle(engine, editCycle.id, {
              name: edit.name,
              description: edit.description,
              clearDescription: edit.clearDescription,
              startsAt: edit.startsAt,
              endsAt: edit.endsAt,
            }),
          );
          setEditOpen(false);
          setEditCycle(null);
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

function listRows(store: Store, teamId: UUID, cooldownWeeks: number): ListRow[] {
  const now = Date.now();
  const cycles: Cycle[] = [];
  for (const id of store.cycleIdsFor(teamId)) {
    const cycle = store.cycles.get(id);
    if (cycle === undefined || cycle.archivedAt !== undefined) continue;
    cycles.push(cycle);
  }
  cycles.sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));

  const rows: ListRow[] = [];
  const cooldownMs = cooldownWeeks * 7 * 24 * 60 * 60 * 1000;
  const fmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });

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
          window: `${fmt.format(new Date(prev.endsAt))} – ${fmt.format(new Date(cycle.startsAt))}`,
        });
      }
    }

    const phase = phaseOf(cycle, now);
    rows.push({
      kind: 'cycle',
      id: cycle.id,
      cycle,
      name: cycle.name,
      heading: phase,
      window: windowOf(cycle),
      issueCount: store.index.byCycle(cycle.id).size,
      phase,
      canStartToday: phase === 'Upcoming' && isNextUpcoming(cycle, cycles, now),
      capacity: phase === 'Upcoming' ? cycleCapacity(store, cycle.id, now) : null,
    });
  }

  return rows;
}

function windowOf(cycle: Cycle): string {
  const fmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
  return `${fmt.format(new Date(cycle.startsAt))} – ${fmt.format(new Date(cycle.endsAt))}`;
}
