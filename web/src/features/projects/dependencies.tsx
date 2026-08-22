/**
 * Blocked by / Blocking panels for a project — read from the replica, written through
 * `mutations.ts`.
 */

import { useMemo, useRef, useState, type RefObject } from 'react';
import { Link } from 'react-router';

import { useEngine } from '~/app/context';
import { useActions, useKeyContext } from '~/app/keymap';
import { Button, IconButton, Select } from '~/components';
import { report } from '~/features/issue/mutations';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import type { UUID } from '~/store';

import {
  listBlockedBy,
  listBlocking,
  type DependencyRow,
  type ProjectDependencyFilter,
} from './dependencyHelpers';
import { addBlockedBy, addBlocking, removeProjectDependency } from './mutations';
import { ProjectPicker } from './ProjectPicker';
import styles from './dependencies.module.css';

type LinkKind = 'blockedBy' | 'blocking';

interface ProjectDependenciesProps {
  readonly projectId: UUID;
  /** Sidebar uses a tighter layout; overview shows the add controls inline. */
  readonly compact?: boolean;
}

export function ProjectDependencies({ projectId, compact = false }: ProjectDependenciesProps) {
  const engine = useEngine();
  const [pickerKind, setPickerKind] = useState<LinkKind | null>(null);
  const blockedByTrigger = useRef<HTMLButtonElement>(null);
  const blockingTrigger = useRef<HTMLButtonElement>(null);
  const blockedByHead = useRef<HTMLDivElement>(null);
  const blockingHead = useRef<HTMLDivElement>(null);

  useKeyContext('detail');

  const blockedBy = useLiveQuery(
    (store) => listBlockedBy(store, projectId),
    ['projectDependency', 'project', 'projectStatus'],
    [projectId],
  );

  const blocking = useLiveQuery(
    (store) => listBlocking(store, projectId),
    ['projectDependency', 'project', 'projectStatus'],
    [projectId],
  );

  // A sorted array, and not the Set this wants to be, because the store decides whether a
  // subscriber has anything new by comparing the old answer with the new one structurally —
  // and a Set has no own enumerable properties, so two Sets always compare equal no matter
  // what is in them. Returning one here meant this query answered once, at mount, and never
  // again: the guard below went on offering a project that had just been linked, and the
  // server refused the second link with an error the user never asked to see.
  const linkedList = useLiveQuery(
    (store) => {
      const ids = new Set<UUID>([projectId]);
      for (const row of listBlockedBy(store, projectId)) ids.add(row.projectId);
      for (const row of listBlocking(store, projectId)) ids.add(row.projectId);
      return [...ids].sort();
    },
    ['projectDependency', 'project'],
    [projectId],
  );
  const linkedIds = useMemo(() => new Set(linkedList), [linkedList]);

  // Registered by the compact panel only, and that is load-bearing rather than a preference.
  // A project's overview mounts this component twice at once — once in the properties
  // sidebar, once in the overview body — and the registry refuses a second action with the
  // same id by throwing, which took the whole screen down with it. The sidebar copy is the
  // one that is mounted on every tab of the project, so it is the one that can honestly
  // offer the command; the overview copy has visible buttons and needs no shortcut of its
  // own. Ids are global, so two components can never both claim these.
  useActions(
    compact
      ? [
          {
            id: 'projectDetail.addBlockedBy',
            title: 'Dependencies → Blocked by…',
            when: 'detail',
            group: 'Projects',
            run: () => setPickerKind('blockedBy'),
          },
          {
            id: 'projectDetail.addBlocking',
            title: 'Dependencies → Blocking…',
            when: 'detail',
            group: 'Projects',
            run: () => setPickerKind('blocking'),
          },
        ]
      : [],
    [projectId, compact],
  );

  // `report` on every write, because these are click handlers and a registered command, and
  // neither can await. The server refuses a link for reasons the panel cannot see coming —
  // a cycle three projects long, a project somebody else linked a moment ago — and without
  // this the refusal is an unhandled rejection: a red line in the console, and nothing at
  // all on the screen the user is looking at.
  const onSelect = (otherId: UUID | null) => {
    if (otherId === null || pickerKind === null || otherId === projectId) {
      setPickerKind(null);
      return;
    }
    const write =
      pickerKind === 'blockedBy'
        ? addBlockedBy(engine, projectId, otherId)
        : addBlocking(engine, projectId, otherId);
    write.catch(report);
    setPickerKind(null);
  };

  const onRemove = (depId: UUID) => {
    removeProjectDependency(engine, depId).catch(report);
  };

  // The compact panel draws no add buttons, so on the copy that owns the two commands there
  // is no button to hang the picker off. A menu with no anchor is not positioned at all: it
  // keeps the stylesheet's `top: 0; left: 0` and opens in the corner of the window, nowhere
  // near the project whose dependencies it is about to change. The section heading is the
  // thing that is always there, so it is what the picker points at.
  const pickerTrigger: RefObject<HTMLElement | null> = compact
    ? pickerKind === 'blocking'
      ? blockingHead
      : blockedByHead
    : pickerKind === 'blocking'
      ? blockingTrigger
      : blockedByTrigger;

  return (
    <div className={compact ? styles.compact : styles.panel}>
      <DependencySection
        title="Blocked by"
        rows={blockedBy}
        empty="Not blocked by any project"
        onRemove={onRemove}
        addLabel="Add blocker…"
        addRef={blockedByTrigger}
        headRef={blockedByHead}
        onAdd={() => setPickerKind('blockedBy')}
        showAdd={!compact}
      />
      <DependencySection
        title="Blocking"
        rows={blocking}
        empty="Not blocking any project"
        onRemove={onRemove}
        addLabel="Add blocked project…"
        addRef={blockingTrigger}
        headRef={blockingHead}
        onAdd={() => setPickerKind('blocking')}
        showAdd={!compact}
      />
      <ProjectPicker
        open={pickerKind !== null}
        onClose={() => setPickerKind(null)}
        trigger={pickerTrigger}
        value={null}
        onSelect={(id) => {
          if (id !== null && linkedIds.has(id)) {
            setPickerKind(null);
            return;
          }
          onSelect(id);
        }}
      />
    </div>
  );
}

interface SectionProps {
  readonly title: string;
  readonly rows: readonly DependencyRow[];
  readonly empty: string;
  readonly onRemove: (depId: UUID) => void;
  readonly addLabel: string;
  readonly addRef: RefObject<HTMLButtonElement | null>;
  /** What the picker is anchored to when there is no add button to anchor it to. */
  readonly headRef: RefObject<HTMLDivElement | null>;
  readonly onAdd: () => void;
  readonly showAdd: boolean;
}

function DependencySection({
  title,
  rows,
  empty,
  onRemove,
  addLabel,
  addRef,
  headRef,
  onAdd,
  showAdd,
}: SectionProps) {
  return (
    <section className={styles.section}>
      <div ref={headRef} className={styles.sectionHead}>
        <h3 className={styles.sectionTitle}>{title}</h3>
        {showAdd && (
          <Button ref={addRef} variant="ghost" size="sm" onClick={onAdd}>
            {addLabel}
          </Button>
        )}
      </div>
      {rows.length === 0 ? (
        <p className={styles.empty}>{empty}</p>
      ) : (
        <ul className={styles.list}>
          {rows.map((row) => (
            <li key={row.depId} className={styles.row}>
              <Link to={`/project/${row.projectId}`} className={styles.link}>
                <span
                  className={styles.mark}
                  style={{ background: row.color }}
                  aria-hidden="true"
                />
                <span className={styles.name}>{row.name}</span>
              </Link>
              {row.violated && <span className={styles.violated}>Violated</span>}
              <IconButton
                aria-label={`Remove dependency on ${row.name}`}
                icon="×"
                onClick={() => onRemove(row.depId)}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export type { ProjectDependencyFilter };
export { matchesDependencyFilter } from './dependencyHelpers';

export function ProjectDependencyFilterSelect({
  value,
  onChange,
}: {
  readonly value: ProjectDependencyFilter;
  readonly onChange: (value: ProjectDependencyFilter) => void;
}) {
  return (
    <Select
      label="Dependencies"
      value={value}
      onChange={(event) => onChange(event.target.value as ProjectDependencyFilter)}
    >
      <option value="all">All projects</option>
      <option value="has-dependencies">Has dependencies</option>
      <option value="blocking">Has blocking dependency</option>
      <option value="blocked-by">Has blocked-by dependency</option>
      <option value="violated">Has violated dependencies</option>
    </Select>
  );
}
