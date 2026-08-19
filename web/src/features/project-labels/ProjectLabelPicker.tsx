import type { CSSProperties, RefObject } from 'react';

import { Menu, type MenuNode, type MenuPlacement } from '~/components';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import type { ProjectLabel, Store, UUID } from '~/store';

import styles from '../labels/LabelPicker.module.css';

export interface ProjectLabelOption {
  readonly id: UUID;
  readonly name: string;
  readonly color: string;
  readonly applied: boolean;
  readonly displaces: readonly UUID[];
  readonly displacedNames: readonly string[];
}

export interface ProjectLabelSection {
  readonly key: string;
  readonly heading: string | null;
  readonly options: readonly ProjectLabelOption[];
}

export interface ProjectLabelPickerProps {
  open: boolean;
  onClose: () => void;
  trigger: RefObject<HTMLElement | null>;
  placement?: MenuPlacement | undefined;
  value: readonly UUID[];
  onApply: (labelId: UUID, displaced: readonly UUID[]) => void;
  onRemove: (labelId: UUID) => void;
}

export function ProjectLabelPicker({
  open,
  onClose,
  trigger,
  placement,
  value,
  onApply,
  onRemove,
}: ProjectLabelPickerProps) {
  const sections = useLiveQuery(
    (store) => offerings(store, new Set(value)),
    ['projectLabel'],
    [value.join(',')],
  );

  const items: MenuNode[] = [];
  for (const section of sections) {
    if (section.heading !== null) items.push({ kind: 'heading', label: section.heading });
    for (const option of section.options) {
      items.push({
        id: option.id,
        label: option.name,
        text: section.heading === null ? option.name : `${section.heading} ${option.name}`,
        icon: (
          <span
            className={styles.swatch}
            style={{ '--label-color': option.color } as CSSProperties}
          />
        ),
        selected: option.applied,
        hint:
          option.displacedNames.length === 0
            ? undefined
            : `Replaces ${option.displacedNames.join(', ')}`,
        onSelect: () =>
          option.applied ? onRemove(option.id) : onApply(option.id, option.displaces),
      });
    }
  }

  return (
    <Menu
      open={open}
      onClose={onClose}
      trigger={trigger}
      items={items}
      label="Project labels"
      placement={placement}
      filterable
      filterPlaceholder="Label…"
      emptyLabel={items.length === 0 ? 'No project labels yet' : 'No labels match'}
    />
  );
}

function offerings(store: Store, applied: ReadonlySet<UUID>): ProjectLabelSection[] {
  const groups = new Map<UUID, ProjectLabel>();
  const children = new Map<UUID, ProjectLabel[]>();
  const loose: ProjectLabel[] = [];

  for (const label of store.projectLabels.values()) {
    if (label.archivedAt !== undefined) continue;
    if (label.isGroup) {
      groups.set(label.id, label);
      continue;
    }
    if (label.parentId === undefined) {
      loose.push(label);
      continue;
    }
    const bucket = children.get(label.parentId);
    if (bucket === undefined) children.set(label.parentId, [label]);
    else bucket.push(label);
  }

  for (const [parentId, bucket] of children) {
    if (groups.has(parentId)) continue;
    loose.push(...bucket);
    children.delete(parentId);
  }

  const displacedBy = (label: ProjectLabel): ProjectLabel[] => {
    if (label.parentId === undefined || applied.has(label.id)) return [];
    const out: ProjectLabel[] = [];
    for (const id of applied) {
      const other = store.get('projectLabel', id);
      if (other !== undefined && other.id !== label.id && other.parentId === label.parentId) {
        out.push(other);
      }
    }
    return out.sort(byName);
  };

  const optionsOf = (labels: readonly ProjectLabel[]): ProjectLabelOption[] =>
    [...labels].sort(byName).map((label) => {
      const displaced = displacedBy(label);
      return {
        id: label.id,
        name: label.name,
        color: label.color,
        applied: applied.has(label.id),
        displaces: displaced.map((row) => row.id),
        displacedNames: displaced.map((row) => row.name),
      };
    });

  const sections: ProjectLabelSection[] = [];
  if (loose.length > 0) {
    sections.push({ key: 'loose', heading: null, options: optionsOf(loose) });
  }
  for (const group of [...groups.values()].sort(byName)) {
    const bucket = children.get(group.id) ?? [];
    if (bucket.length === 0) continue;
    sections.push({
      key: group.id,
      heading: group.name,
      options: optionsOf(bucket),
    });
  }
  return sections;
}

function byName(a: ProjectLabel, b: ProjectLabel): number {
  return a.name.localeCompare(b.name);
}
