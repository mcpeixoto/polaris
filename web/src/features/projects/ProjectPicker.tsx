/**
 * The menu that chooses a project for an issue.
 *
 * Same contract as the three property pickers: controlled, does not own its trigger, does
 * not perform the write. The order is a product rule rather than a preference — lead, then
 * member, then recently created by you, then overlapping teams, then the rest of active,
 * then recently created, then cancelled and completed — so a filer looking for "the one I
 * am on" does not scroll past twenty archived launches to find it.
 */

import type { RefObject } from 'react';

import { Menu, type MenuNode, type MenuPlacement } from '~/components';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import { useViewerId } from '~/hooks/useViewer';
import type { Project, ProjectStatus, ProjectStatusCategory, Store, UUID } from '~/store';

import type { Mixed } from '~/features/issue/pickers';

const NONE = 'none';
const RECENT_MS = 14 * 24 * 60 * 60 * 1000;

interface PickerProps {
  open: boolean;
  onClose: () => void;
  trigger: RefObject<HTMLElement | null>;
  placement?: MenuPlacement | undefined;
}

export interface ProjectPickerProps extends PickerProps {
  /**
   * Teams the issue (or the screen) belongs to. Used only to rank "overlapping" projects
   * — a project that shares a team with this work, which is the one you usually mean.
   */
  teamIds?: readonly UUID[] | undefined;
  /** The current project, `null` for none, `undefined` when the targets disagree. */
  value: UUID | null | Mixed;
  onSelect: (projectId: UUID | null) => void;
}

const DONE: ReadonlySet<ProjectStatusCategory> = new Set(['completed', 'canceled']);

export function ProjectPicker({
  open,
  onClose,
  trigger,
  placement,
  teamIds = [],
  value,
  onSelect,
}: ProjectPickerProps) {
  const viewerId = useViewerId();
  const ranked = useLiveQuery(
    (store) => rankProjects(store, viewerId, teamIds),
    ['project', 'projectStatus', 'projectTeam', 'projectMember'],
    [viewerId ?? '', teamIds.join(',')],
  );

  const items: MenuNode[] = [
    {
      id: NONE,
      label: 'No project',
      selected: value === null,
      onSelect: () => onSelect(null),
    },
  ];

  let previous: string | null = null;
  for (const row of ranked) {
    if (row.heading !== previous) {
      items.push({ kind: 'heading', label: row.heading });
      previous = row.heading;
    }
    items.push({
      id: row.project.id,
      label: row.project.name,
      hint: row.status?.name,
      selected: row.project.id === value,
      onSelect: () => onSelect(row.project.id),
    });
  }

  return (
    <Menu
      open={open}
      onClose={onClose}
      trigger={trigger}
      items={items}
      label="Project"
      placement={placement}
      filterable
      filterPlaceholder="Set project…"
      emptyLabel="No matching project"
    />
  );
}

interface Ranked {
  readonly project: Project;
  readonly status: ProjectStatus | undefined;
  readonly heading: string;
  readonly rank: number;
}

function rankProjects(
  store: Store,
  viewerId: UUID | null,
  teamIds: readonly UUID[],
): readonly Ranked[] {
  const now = Date.now();
  const teamSet = new Set(teamIds);
  const out: Ranked[] = [];

  for (const project of store.projects.values()) {
    if (project.archivedAt !== undefined || project.deletedAt !== undefined) continue;
    const status = store.projectStatuses.get(project.statusId);
    const member =
      viewerId !== null &&
      [...store.projectMemberIdsFor(project.id)].some(
        (id) => store.projectMembers.get(id)?.userId === viewerId,
      );
    const overlapping = [...store.projectTeamIdsFor(project.id)].some((id) => {
      const teamId = store.projectTeams.get(id)?.teamId;
      return teamId !== undefined && teamSet.has(teamId);
    });
    const createdAt = Date.parse(project.createdAt);
    const recent = Number.isFinite(createdAt) && now - createdAt < RECENT_MS;
    const mine = viewerId !== null && project.creatorId === viewerId;
    const done = status !== undefined && DONE.has(status.category);

    let rank: number;
    let heading: string;
    if (viewerId !== null && project.leadId === viewerId) {
      rank = 0;
      heading = 'Lead';
    } else if (member) {
      rank = 1;
      heading = 'Member';
    } else if (mine && recent) {
      rank = 2;
      heading = 'Created by you';
    } else if (overlapping) {
      rank = 3;
      heading = 'Your teams';
    } else if (!done) {
      rank = recent ? 5 : 4;
      heading = recent ? 'Recently created' : 'Active';
    } else {
      rank = 6;
      heading = 'Completed';
    }

    out.push({ project, status, heading, rank });
  }

  out.sort((a, b) => {
    if (a.rank !== b.rank) return a.rank - b.rank;
    if (a.project.sortOrder !== b.project.sortOrder) {
      return a.project.sortOrder < b.project.sortOrder ? -1 : 1;
    }
    return a.project.name.localeCompare(b.project.name);
  });
  return out;
}
