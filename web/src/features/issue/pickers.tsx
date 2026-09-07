/**
 * The three property pickers: status, assignee, priority.
 *
 * They are written once and used from both places that change an issue — the list, where
 * `S`, `A` and `P` act on the selection, and the detail view, where the same three
 * properties are buttons. A second implementation of "choose a status" is how the bulk
 * version ends up missing the category headings, or the detail version ends up unable to
 * unassign; the pickers being one component is what keeps the two surfaces honest.
 *
 * Each one is a controlled Menu and nothing else. It does not own its trigger (see
 * `useMenuTrigger`), it does not perform the write, and it does not know whether it is
 * changing one issue or forty — it reports a chosen value and the caller decides what that
 * means. That is what lets the list hand the same component a value of `MIXED` when the
 * selected rows disagree, which a picker that read the issue itself could not express.
 */

import type { RefObject } from 'react';

import {
  Menu,
  PriorityIcon,
  priorityLabel,
  PRIORITY_LEVELS,
  StateIcon,
  STATE_LABELS,
  type MenuNode,
  type MenuPlacement,
} from '~/components';
import { UserPicker } from '~/features/members/UserPicker';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import { CATEGORY_ORDER, type StateCategory, type UUID, type WorkflowState } from '~/store';

/**
 * The value a picker shows a tick against when the rows it is acting on do not agree.
 *
 * `undefined` and not `null`, because `null` is a real answer for an assignee — nobody —
 * and a picker that conflated "unassigned" with "these forty issues have four different
 * assignees" would tick the wrong row and mislead the user into thinking a bulk change had
 * already happened.
 */
export type Mixed = undefined;

interface PickerProps {
  open: boolean;
  onClose: () => void;
  /** The control the menu belongs to: what it is positioned against, and where focus returns. */
  trigger: RefObject<HTMLElement | null>;
  placement?: MenuPlacement | undefined;
}

export interface StatusPickerProps extends PickerProps {
  teamId: UUID;
  /** The current status, or `undefined` when the targets disagree. */
  value: UUID | Mixed;
  onSelect: (stateId: UUID) => void;
}

/**
 * The team's workflow statuses, grouped under their category.
 *
 * The headings are not decoration. A team may have three statuses called "In Review",
 * "Needs QA" and "Ready to ship", and which of them means *started* rather than *completed*
 * is the difference between an issue counting towards the cycle and not — the category is
 * the only thing on screen that says so.
 */
export function StatusPicker({
  open,
  onClose,
  trigger,
  placement,
  teamId,
  value,
  onSelect,
}: StatusPickerProps) {
  const states = useLiveQuery(
    (store) =>
      [...store.workflowStateIdsFor(teamId)]
        .map((id) => store.get('workflowState', id))
        .filter(
          (state): state is WorkflowState => state !== undefined && state.archivedAt === undefined,
        )
        .map((state) => ({
          id: state.id,
          name: state.name,
          color: state.color,
          category: state.category,
          position: state.position,
          isSystem: state.isSystem,
        }))
        .sort(byCategoryThenPosition),
    ['workflowState'],
    [teamId],
  );

  const items: MenuNode[] = [];
  let previous: StateCategory | null = null;
  for (const state of states) {
    // Duplicate is assigned by the system when an issue is closed as a duplicate of
    // another, never by hand, so offering it here would let a user create a state the
    // product has no way to explain.
    if (state.isSystem) continue;
    if (state.category !== previous) {
      items.push({ kind: 'heading', label: STATE_LABELS[state.category] });
      previous = state.category;
    }
    items.push({
      id: state.id,
      label: state.name,
      icon: <StateIcon category={state.category} color={state.color} decorative />,
      selected: state.id === value,
      onSelect: () => onSelect(state.id),
    });
  }

  return (
    <Menu
      open={open}
      onClose={onClose}
      trigger={trigger}
      items={items}
      label="Status"
      placement={placement}
      emptyLabel="This team has no statuses"
    />
  );
}

export interface AssigneePickerProps extends PickerProps {
  /** The assignee, `null` for unassigned, `undefined` when the targets disagree. */
  value: UUID | null | Mixed;
  onSelect: (assigneeId: UUID | null) => void;
}

/**
 * Everybody in the workspace, filterable, with unassigned at the top.
 *
 * A thin wrapper over `UserPicker`, which is the same list under every other name the product
 * gives a person — a project's lead, an initiative's owner. What is issue-specific is only the
 * wording: an issue's is called an assignee, and nobody having it is "No assignee" rather than
 * "No lead". Keeping the name here means the three pickers this file is about stay one import.
 */
export function AssigneePicker({
  open,
  onClose,
  trigger,
  placement,
  value,
  onSelect,
}: AssigneePickerProps) {
  return (
    <UserPicker
      open={open}
      onClose={onClose}
      trigger={trigger}
      placement={placement}
      value={value}
      onSelect={onSelect}
      label="Assignee"
      noneLabel="No assignee"
      filterPlaceholder="Assign to…"
    />
  );
}

export interface PriorityPickerProps extends PickerProps {
  /** The priority, or `undefined` when the targets disagree. */
  value: number | Mixed;
  onSelect: (priority: number) => void;
}

/** The five levels, urgent first. See `PRIORITY_LEVELS` for why that is not `0..4`. */
export function PriorityPicker({
  open,
  onClose,
  trigger,
  placement,
  value,
  onSelect,
}: PriorityPickerProps) {
  const items: MenuNode[] = PRIORITY_LEVELS.map((priority) => ({
    id: `priority-${priority}`,
    label: priorityLabel(priority),
    icon: <PriorityIcon priority={priority} decorative />,
    selected: priority === value,
    onSelect: () => onSelect(priority),
  }));

  return (
    <Menu
      open={open}
      onClose={onClose}
      trigger={trigger}
      items={items}
      label="Priority"
      placement={placement}
    />
  );
}

/**
 * Categories in the product's order, then the team's own order inside each.
 *
 * Positions are fractional indices and are only comparable within a category — comparing
 * them across one interleaves "In Progress" with "Backlog" in an order nobody chose. This is
 * the same rule the store's grouping applies; it is restated here because a picker sorts its
 * own list rather than going through a query.
 */
function byCategoryThenPosition(
  a: { category: StateCategory; position: string },
  b: { category: StateCategory; position: string },
): number {
  const byCategory = CATEGORY_ORDER[a.category] - CATEGORY_ORDER[b.category];
  if (byCategory !== 0) return byCategory;
  return a.position < b.position ? -1 : a.position > b.position ? 1 : 0;
}
