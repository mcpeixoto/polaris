/**
 * Blocked by / Blocking panels for a project — read from the replica, written through
 * `mutations.ts`.
 */

import { useRef, useState, type RefObject } from 'react';
import { Link } from 'react-router';

import { useEngine } from '~/app/context';
import { useActions, useKeyContext } from '~/app/keymap';
import { Button, IconButton, Select } from '~/components';
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

  const linkedIds = useLiveQuery(
    (store) => {
      const ids = new Set<UUID>([projectId]);
      for (const row of listBlockedBy(store, projectId)) ids.add(row.projectId);
      for (const row of listBlocking(store, projectId)) ids.add(row.projectId);
      return ids;
    },
    ['projectDependency', 'project'],
    [projectId],
  );

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

  const onSelect = async (otherId: UUID | null) => {
    if (otherId === null || pickerKind === null || otherId === projectId) {
      setPickerKind(null);
      return;
    }
    if (pickerKind === 'blockedBy') {
      await addBlockedBy(engine, projectId, otherId);
    } else {
      await addBlocking(engine, projectId, otherId);
    }
    setPickerKind(null);
  };

  const onRemove = async (depId: UUID) => {
    await removeProjectDependency(engine, depId);
  };

  const pickerTrigger: RefObject<HTMLElement | null> =
    pickerKind === 'blocking' ? blockingTrigger : blockedByTrigger;

  return (
    <div className={compact ? styles.compact : styles.panel}>
      <DependencySection
        title="Blocked by"
        rows={blockedBy}
        empty="Not blocked by any project"
        onRemove={onRemove}
        addLabel="Add blocker…"
        addRef={blockedByTrigger}
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
          void onSelect(id);
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
  onAdd,
  showAdd,
}: SectionProps) {
  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
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
