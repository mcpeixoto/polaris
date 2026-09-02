/**
 * A team's archives: issues, cycles and projects that have been archived, plus the same
 * recently-deleted list the trash holds, scoped to this team.
 *
 * Loaded on demand. Archived work is a delete as far as the replica is concerned, so there
 * is nothing to query locally and a spinner is the honest first frame. Editing still
 * requires the row to be live.
 *
 * The table is a `role="grid"` with a roving tab stop, because the selection is what `#`
 * acts on and the only way to make a selection used to be a mouse click. `aria-selected` on
 * a plain `<tr>` names nothing and announces nothing; inside a grid it is the row's state,
 * and `j`/`k` — registered like every other shortcut in the product — move it.
 */

import { useEffect, useRef, useState, type RefObject } from 'react';
import { useNavigate, useParams } from 'react-router';

import { useEngine } from '~/app/context';
import { useActions, useKeyContext } from '~/app/keymap';
import { Badge, Button, EmptyState, Spinner } from '~/components';
import {
  fetchArchivedCycles,
  fetchArchivedIssues,
  fetchArchivedProjects,
  unarchiveCycle,
  unarchiveIssue,
  unarchiveProject,
} from '~/features/archive/mutations';
import { EntityLoading, useEntityState } from '~/features/entity-gate/EntityGate';
import { when } from '~/features/time';
import { fetchDeletedIssues, restoreIssue, type DeletedIssue } from '~/features/trash/mutations';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import type { Cycle, Issue, Project, UUID } from '~/store';
import { ApiError } from '~/sync/api';
import styles from './Archives.module.css';

type Tab = 'issues' | 'cycles' | 'projects' | 'deleted';

type Load<T> =
  | { readonly phase: 'loading' }
  | { readonly phase: 'ready'; readonly rows: readonly T[] }
  | { readonly phase: 'failed'; readonly message: string };

const TABS: readonly { id: Tab; label: string }[] = [
  { id: 'issues', label: 'Issues' },
  { id: 'cycles', label: 'Cycles' },
  { id: 'projects', label: 'Projects' },
  { id: 'deleted', label: 'Recently deleted' },
];

export function Archives() {
  const navigate = useNavigate();
  const { teamKey = '' } = useParams<{ teamKey: string }>();
  const engine = useEngine();
  const team = useLiveQuery(
    (store) => [...store.teams.values()].find((candidate) => candidate.key === teamKey) ?? null,
    ['team'],
    [teamKey],
  );

  const [tab, setTab] = useState<Tab>('issues');
  const [attempt, setAttempt] = useState(0);
  const [issues, setIssues] = useState<Load<Issue>>({ phase: 'loading' });
  const [cycles, setCycles] = useState<Load<Cycle>>({ phase: 'loading' });
  const [projects, setProjects] = useState<Load<Project>>({ phase: 'loading' });
  const [deleted, setDeleted] = useState<Load<DeletedIssue>>({ phase: 'loading' });
  const [selected, setSelected] = useState<UUID | null>(null);
  const [restoring, setRestoring] = useState<UUID | null>(null);
  const [restored, setRestored] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const selectedRowRef = useRef<HTMLTableRowElement>(null);
  // Set only by the two movement actions. Selection also follows focus and the mouse, and
  // pulling focus back to the row on those would take it off the Restore button the user
  // just pressed.
  const movedByKey = useRef(false);

  useEffect(() => {
    if (team === null) return;
    const controller = new AbortController();
    setSelected(null);
    setError(null);
    // The confirmation names a row that is about to leave the screen, so it has to go with
    // it. Left standing, "Issue restored." is read out again on a tab that holds cycles.
    setRestored(null);

    if (tab === 'issues') {
      setIssues({ phase: 'loading' });
      fetchArchivedIssues(team.id, controller.signal)
        .then((rows) => {
          if (!controller.signal.aborted) setIssues({ phase: 'ready', rows });
        })
        .catch((failure: unknown) => {
          if (controller.signal.aborted) return;
          setIssues({
            phase: 'failed',
            message:
              failure instanceof ApiError
                ? failure.message
                : 'Archives could not be loaded just now.',
          });
        });
    } else if (tab === 'cycles') {
      setCycles({ phase: 'loading' });
      fetchArchivedCycles(team.id, controller.signal)
        .then((rows) => {
          if (!controller.signal.aborted) setCycles({ phase: 'ready', rows });
        })
        .catch((failure: unknown) => {
          if (controller.signal.aborted) return;
          setCycles({
            phase: 'failed',
            message:
              failure instanceof ApiError
                ? failure.message
                : 'Archives could not be loaded just now.',
          });
        });
    } else if (tab === 'projects') {
      setProjects({ phase: 'loading' });
      fetchArchivedProjects(team.id, controller.signal)
        .then((rows) => {
          if (!controller.signal.aborted) setProjects({ phase: 'ready', rows });
        })
        .catch((failure: unknown) => {
          if (controller.signal.aborted) return;
          setProjects({
            phase: 'failed',
            message:
              failure instanceof ApiError
                ? failure.message
                : 'Archives could not be loaded just now.',
          });
        });
    } else {
      setDeleted({ phase: 'loading' });
      fetchDeletedIssues(controller.signal)
        .then((rows) => {
          if (!controller.signal.aborted) {
            setDeleted({ phase: 'ready', rows: rows.filter((row) => row.teamId === team.id) });
          }
        })
        .catch((failure: unknown) => {
          if (controller.signal.aborted) return;
          setDeleted({
            phase: 'failed',
            message:
              failure instanceof ApiError
                ? failure.message
                : 'Recently deleted could not be loaded just now.',
          });
        });
    }

    return () => controller.abort();
  }, [team, tab, attempt]);

  const restoreOne = async (id: UUID) => {
    if (team === null || restoring !== null) return;
    setRestoring(id);
    setError(null);
    try {
      if (tab === 'issues') {
        await unarchiveIssue(engine, id);
        setIssues((current) => drop(current, id));
        setRestored('Issue restored.');
      } else if (tab === 'cycles') {
        await unarchiveCycle(engine, id);
        setCycles((current) => drop(current, id));
        setRestored('Cycle restored.');
      } else if (tab === 'projects') {
        await unarchiveProject(engine, id);
        setProjects((current) => drop(current, id));
        setRestored('Project restored.');
      } else {
        await restoreIssue(engine, id);
        setDeleted((current) => drop(current, id));
        setRestored('Issue restored from recently deleted.');
      }
      setSelected(null);
    } catch (failure) {
      setError(
        failure instanceof ApiError ? failure.message : 'That could not be restored just now.',
      );
    } finally {
      setRestoring(null);
    }
  };

  const load =
    tab === 'issues' ? issues : tab === 'cycles' ? cycles : tab === 'projects' ? projects : deleted;

  const rowIds: readonly UUID[] = load.phase === 'ready' ? load.rows.map((row) => row.id) : [];

  // Selection follows focus, which is what a grid's roving tab stop means: the row `#` will
  // restore is the row the ring is on, so a keyboard user can see what they are about to do.
  const moveTo = (index: number) => {
    if (rowIds.length === 0) return;
    movedByKey.current = true;
    setSelected(rowIds[Math.min(rowIds.length - 1, Math.max(0, index))] ?? null);
  };

  const move = (delta: number) => {
    if (rowIds.length === 0) return;
    const at = selected === null ? -1 : rowIds.indexOf(selected);
    moveTo(at === -1 ? (delta > 0 ? 0 : rowIds.length - 1) : at + delta);
  };

  useKeyContext('list');

  useActions(
    [
      {
        id: 'archives.up',
        title: 'Previous row',
        keys: ['k', 'ArrowUp'],
        when: 'list',
        group: 'Archives',
        run: () => move(-1),
      },
      {
        id: 'archives.down',
        title: 'Next row',
        keys: ['j', 'ArrowDown'],
        when: 'list',
        group: 'Archives',
        run: () => move(1),
      },
      // Home and End are registered rather than handled on the table, even though the grid
      // pattern calls them local navigation: the registry is the only place that can tell
      // anyone the keys exist, and a jump to the end of a two-hundred-row archive is the one
      // a person is most likely to go looking for.
      {
        id: 'archives.first',
        title: 'First row',
        keys: ['Home'],
        when: 'list',
        group: 'Archives',
        run: () => moveTo(0),
      },
      {
        id: 'archives.last',
        title: 'Last row',
        keys: ['End'],
        when: 'list',
        group: 'Archives',
        run: () => moveTo(rowIds.length - 1),
      },
      {
        id: 'archives.restore',
        title: 'Restore',
        keys: ['#'],
        when: 'list',
        group: 'Archives',
        run: () => {
          if (selected !== null) void restoreOne(selected);
        },
      },
    ],
    [selected, tab, restoring, team, rowIds.join(',')],
  );

  // Moving the selection has to move the ring with it, or the roving tab stop is a lie: Tab
  // would still land on whichever row happened to hold `tabIndex={0}` at first paint.
  useEffect(() => {
    if (!movedByKey.current) return;
    movedByKey.current = false;
    selectedRowRef.current?.focus();
  }, [selected]);

  const teamState = useEntityState(team);

  if (team === null) {
    return (
      <div className={styles.screen}>
        {teamState === 'loading' ? (
          <EntityLoading label="Loading the archives…" lines={3} />
        ) : (
          <EmptyState
            title="No such team"
            description={`Nothing in this workspace has the key ${teamKey}.`}
            action={<Button onClick={() => navigate(-1)}>Go back</Button>}
          />
        )}
      </div>
    );
  }

  return (
    <div className={styles.screen}>
      <header className={styles.header}>
        <h1 className={styles.title}>Archives</h1>
        <Badge>{team.key}</Badge>
      </header>

      <nav className={styles.tabs} aria-label="Archives">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className={styles.tab}
            aria-current={tab === entry.id ? 'page' : undefined}
            onClick={() => setTab(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </nav>

      <div className={styles.body}>
        <p className={styles.intro}>
          Archiving takes work out of every list, board, search and filter — this page is where it
          goes, and a link to an archived issue will not open until it is back. Move through the
          rows with j and k or the arrow keys and restore the selected one with #, or use its
          Restore button. Recently deleted issues stay here for thirty days, then they are gone.
        </p>

        <p className={styles.restored} role="status" aria-live="polite">
          {restored ?? ''}
        </p>

        {error === null ? null : (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}

        {load.phase === 'loading' ? (
          <div className={styles.loading}>
            <Spinner label="Looking in the archives" />
          </div>
        ) : null}

        {load.phase === 'failed' ? (
          <div role="alert">
            <EmptyState
              title="The archives could not be loaded"
              description={load.message}
              action={<Button onClick={() => setAttempt((n) => n + 1)}>Try again</Button>}
            />
          </div>
        ) : null}

        {load.phase === 'ready' && load.rows.length === 0 ? (
          <EmptyState title={emptyTitle(tab)} description={emptyDescription(tab)} />
        ) : null}

        {load.phase === 'ready' && load.rows.length > 0 ? (
          <table className={styles.table} role="grid">
            <caption className={styles.caption}>{caption(tab)}</caption>
            <thead>
              <tr>
                <th scope="col">{tab === 'issues' || tab === 'deleted' ? 'Issue' : 'Name'}</th>
                <th scope="col">{dateHeader(tab)}</th>
                <th scope="col">
                  <span className={styles.hidden}>Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {tab === 'issues' || tab === 'deleted'
                ? (load.rows as readonly DeletedIssue[]).map((row, index) => (
                    <ArchiveRow
                      key={row.id}
                      id={row.id}
                      label={row.identifier}
                      title={row.title}
                      when={stamp(tab, row)}
                      selected={selected === row.id}
                      focusable={selected === null ? index === 0 : selected === row.id}
                      rowRef={selected === row.id ? selectedRowRef : undefined}
                      restoring={restoring === row.id}
                      onSelect={setSelected}
                      onRestore={() => void restoreOne(row.id)}
                    />
                  ))
                : tab === 'cycles'
                  ? (load.rows as readonly Cycle[]).map((row, index) => (
                      <ArchiveRow
                        key={row.id}
                        id={row.id}
                        label={`Cycle ${row.number}`}
                        title={row.name}
                        when={stamp(tab, row)}
                        selected={selected === row.id}
                        focusable={selected === null ? index === 0 : selected === row.id}
                        rowRef={selected === row.id ? selectedRowRef : undefined}
                        restoring={restoring === row.id}
                        onSelect={setSelected}
                        onRestore={() => void restoreOne(row.id)}
                      />
                    ))
                  : (load.rows as readonly Project[]).map((row, index) => (
                      <ArchiveRow
                        key={row.id}
                        id={row.id}
                        label={row.name}
                        title={row.summary ?? ''}
                        when={stamp(tab, row)}
                        selected={selected === row.id}
                        focusable={selected === null ? index === 0 : selected === row.id}
                        rowRef={selected === row.id ? selectedRowRef : undefined}
                        restoring={restoring === row.id}
                        onSelect={setSelected}
                        onRestore={() => void restoreOne(row.id)}
                      />
                    ))}
            </tbody>
          </table>
        ) : null}
      </div>
    </div>
  );
}

function ArchiveRow({
  id,
  label,
  title,
  when: at,
  selected,
  focusable,
  rowRef,
  restoring,
  onSelect,
  onRestore,
}: {
  id: UUID;
  label: string;
  title: string;
  /**
   * Absent where the server has no date to give — an issue deleted before the column
   * existed. The cell says so rather than borrowing a timestamp that means something else.
   */
  when?: string | undefined;
  selected: boolean;
  /** Holds the grid's single tab stop: the selected row, or the first when nothing is. */
  focusable: boolean;
  rowRef?: RefObject<HTMLTableRowElement | null> | undefined;
  restoring: boolean;
  onSelect: (id: UUID) => void;
  onRestore: () => void;
}) {
  return (
    <tr
      ref={rowRef}
      className={styles.row}
      aria-selected={selected}
      // One tab stop for the whole grid, as WAI-ARIA's grid pattern requires: Tab reaches
      // the table once and j/k walk it, rather than Tab visiting two hundred archived rows.
      tabIndex={focusable ? 0 : -1}
      onClick={() => onSelect(id)}
      onFocus={() => onSelect(id)}
    >
      <th scope="row" className={styles.issue}>
        <span className={styles.identifier}>{label}</span>
        {title !== '' ? <span className={styles.issueTitle}>{title}</span> : null}
      </th>
      <td>
        <span className={styles.secondary}>{at === undefined ? 'Unknown' : when(at)}</span>
      </td>
      <td className={styles.actions}>
        <Button
          size="sm"
          aria-label={`Restore ${label}`}
          loading={restoring}
          onClick={(event) => {
            event.stopPropagation();
            onRestore();
          }}
        >
          Restore
        </Button>
      </td>
    </tr>
  );
}

function drop<T extends { id: UUID }>(load: Load<T>, id: UUID): Load<T> {
  return load.phase === 'ready'
    ? { phase: 'ready', rows: load.rows.filter((row) => row.id !== id) }
    : load;
}

function emptyTitle(tab: Tab): string {
  switch (tab) {
    case 'issues':
      return 'No archived issues';
    case 'cycles':
      return 'No archived cycles';
    case 'projects':
      return 'No archived projects';
    case 'deleted':
      return 'Nothing has been deleted';
  }
}

function emptyDescription(tab: Tab): string {
  switch (tab) {
    case 'issues':
      return 'Completed work stays in the team until auto-archive, or until somebody archives it.';
    case 'cycles':
      return 'Completed cycles archive on the same period as issues.';
    case 'projects':
      return 'A project archives with its issues, never the other way around.';
    case 'deleted':
      return 'Nothing in this team has been deleted in the last thirty days.';
  }
}

function dateHeader(tab: Tab): string {
  switch (tab) {
    case 'issues':
    case 'cycles':
    case 'projects':
      return 'Archived';
    case 'deleted':
      return 'Deleted';
  }
}

/**
 * The date the column names, which is a different column on the deleted tab.
 *
 * A deleted issue was never archived, so it has no `archivedAt`, and the fallback to
 * `updatedAt` was printing whenever the row last changed for any reason under a header
 * that said "Archived" and a caption that promised most recently deleted first. Three
 * statements about one row, two of them wrong.
 */
function stamp(
  tab: Tab,
  row: { readonly archivedAt?: string; readonly deletedAt?: string; readonly updatedAt: string },
): string | undefined {
  return tab === 'deleted' ? row.deletedAt : (row.archivedAt ?? row.updatedAt);
}

function caption(tab: Tab): string {
  switch (tab) {
    case 'issues':
      return 'Archived issues, most recently archived first.';
    case 'cycles':
      return 'Archived cycles, most recently archived first.';
    case 'projects':
      return 'Archived projects, most recently archived first.';
    case 'deleted':
      return 'Recently deleted issues, most recently deleted first.';
  }
}
