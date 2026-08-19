import { useMemo, useState, type FormEvent } from 'react';

import { useEngine } from '~/app/context';
import { Button, Checkbox, EmptyState, Input, Select } from '~/components';
import { DEFAULT_LABEL_COLOR } from '~/features/labels/mutations';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import type { Store, UUID } from '~/store';
import { ApiError } from '~/sync/api';

import { archiveProjectLabel, createProjectLabel, updateProjectLabel } from './mutations';
import styles from '../labels/LabelSettings.module.css';

interface LabelView {
  readonly id: UUID;
  readonly name: string;
  readonly color: string;
  readonly isGroup: boolean;
  readonly parentId: UUID | undefined;
  readonly position: string;
  readonly uses: number;
}

export function ProjectLabelSettings() {
  const engine = useEngine();
  const [error, setError] = useState<string | null>(null);

  const labels = useLiveQuery(
    (store: Store) => {
      const rows: LabelView[] = [];
      for (const label of store.projectLabels.values()) {
        if (label.archivedAt !== undefined) continue;
        rows.push({
          id: label.id,
          name: label.name,
          color: label.color,
          isGroup: label.isGroup,
          parentId: label.parentId,
          position: label.position,
          uses: store.projectIdsWithProjectLabel(label.id).size,
        });
      }
      return rows;
    },
    ['projectLabel', 'projectLabelLink'],
  );

  const grouped = useMemo(() => groupLabels(labels), [labels]);

  const run = (work: Promise<unknown>) => {
    setError(null);
    work.catch((failure: unknown) => {
      setError(failure instanceof ApiError ? failure.message : 'That change could not be saved.');
    });
  };

  return (
    <div className={styles.screen}>
      <header className={styles.header}>
        <h1 className={styles.title}>Project labels</h1>
      </header>

      <div className={styles.body}>
        {error === null ? null : (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}

        <section className={styles.section}>
          <p className={styles.sectionHint}>
            Workspace taxonomy for projects — separate from issue labels. A project can carry at
            most one label from each group.
          </p>

          <CreateLabel
            groups={grouped.roots.filter((row) => row.isGroup)}
            onCreate={(input) => run(createProjectLabel(engine, input))}
          />

          {grouped.roots.length === 0 ? (
            <EmptyState
              title="No project labels yet"
              description="Label projects by team, tier, or strategic theme — then filter the projects list by them."
            />
          ) : (
            <ul className={styles.tree}>
              {grouped.roots.map((row) => (
                <li key={row.id}>
                  <LabelRow
                    row={row}
                    onEdit={(fields) => run(updateProjectLabel(engine, row.id, fields))}
                    onArchive={() => run(archiveProjectLabel(engine, row.id))}
                  />
                  {!row.isGroup ? null : (
                    <ul className={styles.children}>
                      {(grouped.children.get(row.id) ?? []).map((child) => (
                        <li key={child.id}>
                          <LabelRow
                            row={child}
                            onEdit={(fields) => run(updateProjectLabel(engine, child.id, fields))}
                            onArchive={() => run(archiveProjectLabel(engine, child.id))}
                            onUngroup={() =>
                              run(updateProjectLabel(engine, child.id, { parentId: null }))
                            }
                          />
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function CreateLabel({
  groups,
  onCreate,
}: {
  groups: readonly LabelView[];
  onCreate: (input: {
    name: string;
    parentId?: UUID | undefined;
    isGroup?: boolean | undefined;
    color?: string | undefined;
  }) => void;
}) {
  const [name, setName] = useState('');
  const [color, setColor] = useState(DEFAULT_LABEL_COLOR);
  const [parentId, setParentId] = useState('');
  const [isGroup, setIsGroup] = useState(false);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed === '') return;
    onCreate({
      name: trimmed,
      parentId: isGroup || parentId === '' ? undefined : parentId,
      isGroup,
      color,
    });
    setName('');
    setParentId('');
    setIsGroup(false);
  };

  return (
    <form className={styles.create} onSubmit={submit}>
      <Input
        label="Name"
        value={name}
        placeholder={isGroup ? 'Team' : 'Platform'}
        onChange={(event) => setName(event.target.value)}
      />
      <Select
        label="Group"
        value={parentId}
        disabled={isGroup || groups.length === 0}
        onChange={(event) => setParentId(event.target.value)}
      >
        <option value="">No group</option>
        {groups.map((group) => (
          <option key={group.id} value={group.id}>
            {group.name}
          </option>
        ))}
      </Select>
      <div className={styles.color}>
        <Input
          type="color"
          label="Colour"
          value={color}
          onChange={(event) => setColor(event.target.value)}
        />
      </div>
      <Button type="submit" variant="primary" disabled={name.trim() === ''}>
        Add
      </Button>
      <div className={styles.createOptions}>
        <Checkbox
          checked={isGroup}
          onChange={(event) => setIsGroup(event.target.checked)}
          label="A group of labels"
        />
      </div>
    </form>
  );
}

function LabelRow({
  row,
  onEdit,
  onArchive,
  onUngroup,
}: {
  row: LabelView;
  onEdit: (fields: { name?: string; color?: string }) => void;
  onArchive: () => void;
  onUngroup?: () => void;
}) {
  const [name, setName] = useState(row.name);

  const commitName = () => {
    const trimmed = name.trim();
    if (trimmed === '' || trimmed === row.name) {
      setName(row.name);
      return;
    }
    onEdit({ name: trimmed });
  };

  return (
    <div className={styles.row}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          commitName();
        }}
      >
        <Input
          label={`Name of ${row.name}`}
          hideLabel
          value={name}
          onChange={(event) => setName(event.target.value)}
          onBlur={commitName}
        />
      </form>
      <div className={styles.color}>
        <Input
          type="color"
          label={`Colour of ${row.name}`}
          hideLabel
          value={row.color}
          onChange={(event) => onEdit({ color: event.target.value })}
        />
      </div>
      {row.isGroup ? <span className={styles.quiet}>Group</span> : <span />}
      <span className={styles.uses}>
        {row.isGroup ? '' : `${row.uses} ${row.uses === 1 ? 'project' : 'projects'}`}
      </span>
      <span>
        {onUngroup === undefined ? null : (
          <Button type="button" variant="ghost" onClick={onUngroup}>
            Ungroup
          </Button>
        )}
        <Button type="button" variant="ghost" onClick={onArchive}>
          Archive
        </Button>
      </span>
    </div>
  );
}

function groupLabels(labels: readonly LabelView[]) {
  const roots: LabelView[] = [];
  const children = new Map<UUID, LabelView[]>();
  for (const label of [...labels].sort((a, b) => a.position.localeCompare(b.position))) {
    if (label.parentId === undefined) {
      roots.push(label);
      continue;
    }
    const bucket = children.get(label.parentId) ?? [];
    bucket.push(label);
    children.set(label.parentId, bucket);
  }
  return { roots, children };
}
