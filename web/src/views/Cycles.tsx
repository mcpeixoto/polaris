/**
 * A team's cycles: current, upcoming, previous.
 *
 * A scan of dated windows, not a settings form. Empty teaches the next action — turn
 * cycles on in team settings — because there is nothing to create by hand: the cadence
 * mints them.
 */

import { Link, useNavigate, useParams } from 'react-router';

import { Button, EmptyState } from '~/components';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import type { Cycle, Store, UUID } from '~/store';
import styles from './Cycles.module.css';

interface CycleRow {
  readonly id: UUID;
  readonly name: string;
  readonly heading: string;
  readonly window: string;
  readonly issueCount: number;
}

export function Cycles() {
  const navigate = useNavigate();
  const { teamKey = '' } = useParams<{ teamKey: string }>();

  const team = useLiveQuery(
    (store) => [...store.teams.values()].find((candidate) => candidate.key === teamKey) ?? null,
    ['team'],
    [teamKey],
  );

  const rows = useLiveQuery(
    (store) => (team === null ? [] : listCycles(store, team.id)),
    ['cycle', 'issue', 'team'],
    [team?.id ?? ''],
  );

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

  return (
    <div className={styles.screen}>
      <header className={styles.header}>
        <h1 className={styles.title}>{team.name} cycles</h1>
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
          {rows.map((row) => (
            <li key={row.id}>
              <Link to={`/cycle/${row.id}`} className={styles.row}>
                <span className={styles.phase}>{row.heading}</span>
                <span className={styles.body}>
                  <span className={styles.name}>{row.name}</span>
                  <span className={styles.summary}>{row.window}</span>
                </span>
                <span className={styles.count}>
                  {row.issueCount === 1 ? '1 issue' : `${row.issueCount} issues`}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function listCycles(store: Store, teamId: UUID): CycleRow[] {
  const now = Date.now();
  const rows: CycleRow[] = [];
  for (const id of store.cycleIdsFor(teamId)) {
    const cycle = store.cycles.get(id);
    if (cycle === undefined || cycle.archivedAt !== undefined) continue;
    rows.push({
      id: cycle.id,
      name: cycle.name,
      heading: phaseOf(cycle, now),
      window: windowOf(cycle),
      issueCount: store.index.byCycle(cycle.id).size,
    });
  }
  const order = { Current: 0, Upcoming: 1, Previous: 2 };
  return rows.sort((a, b) => {
    const byHeading = order[a.heading as keyof typeof order] - order[b.heading as keyof typeof order];
    if (byHeading !== 0) return byHeading;
    return a.name.localeCompare(b.name);
  });
}

function phaseOf(cycle: Cycle, now: number): string {
  const start = Date.parse(cycle.startsAt);
  const end = Date.parse(cycle.endsAt);
  if (start <= now && now < end) return 'Current';
  if (start > now) return 'Upcoming';
  return 'Previous';
}

function windowOf(cycle: Cycle): string {
  const fmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
  return `${fmt.format(new Date(cycle.startsAt))} – ${fmt.format(new Date(cycle.endsAt))}`;
}
