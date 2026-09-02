/**
 * Settings → Project statuses: the workspace workflow projects move through.
 *
 * Grouped by category the way team issue statuses are. The category is what the rest of
 * the product means by a status — timeline bars, the graph, Pulse. The name and colour
 * are the workspace's words for it.
 *
 * There is no reorder control. The API can create, rename, recolour, promote a default
 * and archive; it has no "put this after that one" verb, and inventing local positions
 * that the server will not honour would be a lie on screen.
 */

import { useMemo, useState, type FormEvent } from 'react';

import { useEngine } from '~/app/context';
import { Badge, Button, IconButton, Input, Select, StateIcon } from '~/components';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import { byOrderKey } from '~/store';
import type { ProjectStatus, ProjectStatusCategory, StateCategory, Store } from '~/store';
import { ApiError } from '~/sync/api';
import styles from '~/views/TeamSettings.module.css';

import { archiveProjectStatus, createProjectStatus, updateProjectStatus } from './mutations';

const CATEGORIES: readonly ProjectStatusCategory[] = [
  'backlog',
  'planned',
  'started',
  'completed',
  'canceled',
];

const CATEGORY_LABELS: Readonly<Record<ProjectStatusCategory, string>> = {
  backlog: 'Backlog',
  planned: 'Planned',
  started: 'Started',
  completed: 'Completed',
  canceled: 'Canceled',
};

/**
 * Which categories may hold the workspace default.
 *
 * A new project lands in the default status, so the database only allows Backlog and
 * Planned to be it (`project_status_default_category_check`). Offering "Make default"
 * anywhere else is a button whose only outcome is an error, so it is not offered.
 */
const CAN_BE_DEFAULT: ReadonlySet<ProjectStatusCategory> = new Set(['backlog', 'planned']);

/** Project "planned" is issue "unstarted": work that exists and has not begun. */
const ICON_CATEGORY: Readonly<Record<ProjectStatusCategory, StateCategory>> = {
  backlog: 'backlog',
  planned: 'unstarted',
  started: 'started',
  completed: 'completed',
  canceled: 'canceled',
};

const DEFAULT_STATUS_COLOR = '#6b7280';

export function ProjectStatusSettings() {
  const engine = useEngine();
  const [error, setError] = useState<string | null>(null);

  const statuses = useLiveQuery(
    (store: Store) =>
      [...store.projectStatuses.values()]
        .filter((status) => status.archivedAt === undefined)
        .sort(byOrderKey('position')),
    ['projectStatus'],
  );

  const byCategory = useMemo(() => {
    const groups = new Map<ProjectStatusCategory, ProjectStatus[]>();
    for (const category of CATEGORIES) groups.set(category, []);
    for (const status of statuses) {
      groups.get(status.category)?.push(status);
    }
    return groups;
  }, [statuses]);

  const run = (work: Promise<unknown>) => {
    setError(null);
    work.catch((failure: unknown) => {
      setError(failure instanceof ApiError ? failure.message : 'That change could not be saved.');
    });
  };

  return (
    <div className={styles.screen}>
      <header className={styles.header}>
        <h1 className={styles.title}>Project statuses</h1>
      </header>

      <div className={styles.body}>
        {error === null ? null : (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}

        <section className={styles.section} aria-labelledby="statuses-heading">
          <h2 className={styles.sectionTitle} id="statuses-heading">
            Workflow
          </h2>
          <p className={styles.sectionHint}>
            Projects move through these. The category decides what a status means to the rest of the
            product; the name is the workspace&rsquo;s own.
          </p>

          {CATEGORIES.map((category) => {
            const rows = byCategory.get(category) ?? [];
            if (rows.length === 0) return null;
            return (
              <div key={category} className={styles.category}>
                <h3 className={styles.categoryTitle}>{CATEGORY_LABELS[category]}</h3>
                <ul className={styles.statusList}>
                  {rows.map((status) => (
                    <StatusRow
                      key={status.id}
                      status={status}
                      onRename={(name) => run(updateProjectStatus(engine, status.id, { name }))}
                      onRecolor={(color) => run(updateProjectStatus(engine, status.id, { color }))}
                      onMakeDefault={() =>
                        run(updateProjectStatus(engine, status.id, { makeDefault: true }))
                      }
                      onArchive={() => run(archiveProjectStatus(engine, status.id))}
                    />
                  ))}
                </ul>
              </div>
            );
          })}

          <AddStatusForm
            onAdd={(name, category, color) =>
              run(createProjectStatus(engine, { name, category, color }))
            }
          />
        </section>
      </div>
    </div>
  );
}

function StatusRow({
  status,
  onRename,
  onRecolor,
  onMakeDefault,
  onArchive,
}: {
  status: ProjectStatus;
  onRename: (name: string) => void;
  onRecolor: (color: string) => void;
  onMakeDefault: () => void;
  onArchive: () => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  // The colour input fires on every pixel of a drag through the picker, and each of those
  // was a mutation with an optimistic patch broadcast to every client. The swatch follows
  // the drag from the draft; only leaving the control writes.
  const [colorDraft, setColorDraft] = useState<string | null>(null);

  return (
    <li className={styles.status} role="group" aria-label={`${status.name} status`}>
      <StateIcon category={ICON_CATEGORY[status.category]} color={status.color} decorative />

      <Input
        label="Name"
        hideLabel
        className={styles.statusName}
        value={draft ?? status.name}
        onFocus={() => setDraft(status.name)}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          const next = draft?.trim();
          setDraft(null);
          if (next !== undefined && next !== '' && next !== status.name) onRename(next);
        }}
      />

      <Input
        label="Colour"
        hideLabel
        type="color"
        className={styles.statusColor}
        value={colorDraft ?? status.color}
        onChange={(event) => setColorDraft(event.target.value)}
        onBlur={() => {
          const next = colorDraft;
          setColorDraft(null);
          if (next !== null && next !== status.color) onRecolor(next);
        }}
      />

      {status.isDefault ? (
        <Badge tone="accent">Default</Badge>
      ) : CAN_BE_DEFAULT.has(status.category) ? (
        <Button size="sm" onClick={onMakeDefault}>
          Make default
        </Button>
      ) : null}

      <IconButton
        aria-label={`Retire ${status.name}`}
        tooltip="Retire this status"
        size="sm"
        variant="danger"
        onClick={onArchive}
        icon={
          <svg viewBox="0 0 16 16" fill="none">
            <path
              d="M3.5 5h9m-7 0V4a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1m-6.5 0 .6 7a1 1 0 0 0 1 .9h4.8a1 1 0 0 0 1-.9l.6-7"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
            />
          </svg>
        }
      />
    </li>
  );
}

function AddStatusForm({
  onAdd,
}: {
  onAdd: (name: string, category: ProjectStatusCategory, color: string) => void;
}) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState<ProjectStatusCategory>('planned');
  const [color, setColor] = useState(DEFAULT_STATUS_COLOR);

  return (
    <form
      className={styles.addStatus}
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        const trimmed = name.trim();
        if (trimmed === '') return;
        onAdd(trimmed, category, color);
        setName('');
      }}
    >
      <Input
        label="New status"
        placeholder="In review"
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <Select
        label="Category"
        value={category}
        onChange={(event) => setCategory(event.target.value as ProjectStatusCategory)}
      >
        {CATEGORIES.map((option) => (
          <option key={option} value={option}>
            {CATEGORY_LABELS[option]}
          </option>
        ))}
      </Select>
      <Input
        label="Colour"
        type="color"
        className={styles.statusColor}
        value={color}
        onChange={(event) => setColor(event.target.value)}
      />
      <Button type="submit" disabled={name.trim() === ''}>
        Add status
      </Button>
    </form>
  );
}
