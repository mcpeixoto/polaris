/**
 * The menu that moves a project through the workspace's project statuses.
 *
 * Same contract as the other property pickers: controlled, does not own its trigger, does
 * not perform the write. Grouped by category rather than listed flat, because the category
 * is the part the rest of the product reads — the graph only draws for a started or
 * completed project, auto-archive only fires in completed or canceled — while the name is
 * whatever this workspace decided to call it.
 */

import type { RefObject } from 'react';

import { Menu, StateIcon, type MenuNode, type MenuPlacement } from '~/components';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import type { ProjectStatus, ProjectStatusCategory, StateCategory, Store, UUID } from '~/store';

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

/** Project "planned" is issue "unstarted": work that exists and has not begun. */
export const PROJECT_STATUS_ICON: Readonly<Record<ProjectStatusCategory, StateCategory>> = {
  backlog: 'backlog',
  planned: 'unstarted',
  started: 'started',
  completed: 'completed',
  canceled: 'canceled',
};

export interface ProjectStatusPickerProps {
  open: boolean;
  onClose: () => void;
  trigger: RefObject<HTMLElement | null>;
  placement?: MenuPlacement | undefined;
  value: UUID | undefined;
  onSelect: (statusId: UUID) => void;
}

export function ProjectStatusPicker({
  open,
  onClose,
  trigger,
  placement,
  value,
  onSelect,
}: ProjectStatusPickerProps) {
  const statuses = useLiveQuery(
    (store) => offerings(store, value),
    ['projectStatus'],
    [value ?? ''],
  );

  const items: MenuNode[] = [];
  let previous: ProjectStatusCategory | null = null;
  for (const status of statuses) {
    if (status.category !== previous) {
      items.push({ kind: 'heading', label: CATEGORY_LABELS[status.category] });
      previous = status.category;
    }
    items.push({
      id: status.id,
      label: status.name,
      text: `${CATEGORY_LABELS[status.category]} ${status.name}`,
      icon: (
        <StateIcon
          category={PROJECT_STATUS_ICON[status.category]}
          color={status.color}
          decorative
        />
      ),
      selected: status.id === value,
      onSelect: () => onSelect(status.id),
    });
  }

  return (
    <Menu
      open={open}
      onClose={onClose}
      trigger={trigger}
      items={items}
      label="Project status"
      placement={placement}
      filterable
      filterPlaceholder="Status…"
      emptyLabel={items.length === 0 ? 'No project statuses yet' : 'No statuses match'}
    />
  );
}

/**
 * Live statuses in category order.
 *
 * The one the project already sits on is kept even when it has been archived: a project
 * does not move off a retired status by itself, and hiding it would show the sidebar as
 * having no status at all.
 */
function offerings(store: Store, current: UUID | undefined): ProjectStatus[] {
  const rank = new Map(CATEGORIES.map((category, index) => [category, index]));
  return [...store.projectStatuses.values()]
    .filter((status) => status.archivedAt === undefined || status.id === current)
    .sort(
      (a, b) =>
        (rank.get(a.category) ?? 0) - (rank.get(b.category) ?? 0) ||
        a.position.localeCompare(b.position) ||
        a.name.localeCompare(b.name),
    );
}
