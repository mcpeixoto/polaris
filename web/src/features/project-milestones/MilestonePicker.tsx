/**
 * The menu that chooses a milestone for an issue.
 *
 * Same contract as the three property pickers: controlled, does not own its trigger, does
 * not perform the write. The order and the archived filter come from `listProjectMilestones`
 * rather than from a second query, so a checkpoint sits where the project screen just put it
 * — a picker with its own idea of the order is how "the third one" stops meaning the same
 * thing on two screens.
 *
 * Not filterable, unlike the project picker. A project has a handful of checkpoints; a filter
 * box over three rows costs a keystroke and saves none. That leaves nowhere to draw the chord
 * — `filterHint` is a row of the filter box — so `Shift+M` is taught on the trigger's tooltip
 * instead.
 *
 * The two empty states say different things because they are different problems with
 * different fixes. An issue in no project has nothing to choose from at all: milestones
 * belong to a project, and the server refuses one that crosses projects
 * (`issue_milestone_matches_project`, services/migrations/000024_projects.up.sql). A project
 * with no milestones is one checkpoint away from working. Telling either of them "no
 * matches" would send the reader looking for a filter they never typed.
 */

import type { RefObject } from 'react';

import { Menu, type MenuNode, type MenuPlacement } from '~/components';
import type { Mixed } from '~/features/issue/pickers';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import type { UUID } from '~/store';

import { listProjectMilestones } from './helpers';

const NONE = 'none';

export interface MilestonePickerProps {
  open: boolean;
  onClose: () => void;
  /** The control the menu belongs to: what it is positioned against, and where focus returns. */
  trigger: RefObject<HTMLElement | null>;
  placement?: MenuPlacement | undefined;
  /** The issue's project. `null` is a state to explain, not an error to hide. */
  projectId: UUID | null;
  /** The current milestone, `null` for none, `undefined` when the targets disagree. */
  value: UUID | null | Mixed;
  onSelect: (milestoneId: UUID | null) => void;
}

export function MilestonePicker({
  open,
  onClose,
  trigger,
  placement,
  projectId,
  value,
  onSelect,
}: MilestonePickerProps) {
  const milestones = useLiveQuery(
    (store) =>
      projectId === null
        ? []
        : listProjectMilestones(store, projectId).map((row) => ({
            id: row.milestone.id,
            name: row.milestone.name,
          })),
    // `issue` because the helper counts them: this list drops the progress it computes, but
    // subscribing to less than the query reads is how a list goes stale for the next caller
    // who does not.
    ['projectMilestone', 'issue'],
    [projectId ?? ''],
  );

  // No none-row either when there is nothing to choose from: a menu whose only row is "No
  // milestone" reads as a working picker with one odd option, which is precisely the wrong
  // thing to say to somebody whose issue is in no project.
  const items: MenuNode[] =
    milestones.length === 0
      ? []
      : [
          {
            id: NONE,
            label: 'No milestone',
            selected: value === null,
            onSelect: () => onSelect(null),
          },
          ...milestones.map((milestone) => ({
            id: milestone.id,
            label: milestone.name,
            selected: milestone.id === value,
            onSelect: () => onSelect(milestone.id),
          })),
        ];

  return (
    <Menu
      open={open}
      onClose={onClose}
      trigger={trigger}
      items={items}
      label="Milestone"
      placement={placement}
      emptyLabel={
        projectId === null ? 'This issue is not in a project' : 'This project has no milestones yet'
      }
    />
  );
}
