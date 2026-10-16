/**
 * What a right-click on a group heading offers.
 *
 * The heading is the one place that already means "these issues". A status chosen here is
 * written to every issue in the group, and the statuses are the rows themselves rather than
 * a submenu: right-click, then the status, is the whole gesture. A cascade would make the
 * second click open another menu and the status a third, which is the picker this exists to
 * avoid.
 *
 * Select all is the other half. Status is the property this menu can apply in that one
 * click; everything else — assignee, priority, labels — is already on the bulk bar, and
 * selecting the group is how those stay one menu rather than a second copy of the row menu.
 */

import type { MenuNode } from '~/components';
import { StateIcon } from '~/components';
import { CATEGORY_ORDER, type StateCategory, type Store, type UUID } from '~/store';

export interface GroupStateChoice {
  readonly id: UUID;
  readonly name: string;
  readonly category: StateCategory;
  readonly color?: string | undefined;
}

export interface GroupStatusOffer {
  /**
   * Why a status list is or isn't here.
   *
   * `ok` is one team's workflow. `teams` is a group whose issues do not share one — a Focus
   * section on My Issues is the ordinary case — and there is no status that is legal for
   * both. `empty` is a heading with nothing under it, which has nothing to move.
   */
  readonly reason: 'ok' | 'teams' | 'empty';
  /** The status every issue already has, when they agree. Ticked, and a re-select is free. */
  readonly stateId: UUID | undefined;
  readonly states: readonly GroupStateChoice[];
}

const EMPTY_OFFER: GroupStatusOffer = { reason: 'empty', stateId: undefined, states: [] };

/**
 * The statuses a group can be moved to, read from the issues it holds.
 *
 * Empty and mixed-team groups are answered here rather than by the menu, so a caller that
 * only wants the reason — a disabled row, or none — does not rebuild the list to find out.
 */
export function readGroupStatusOffer(store: Store, ids: readonly UUID[]): GroupStatusOffer {
  let teamId: UUID | undefined;
  let stateId: UUID | undefined;
  let agreed = true;
  let seen = false;

  for (const id of ids) {
    const issue = store.issues.get(id);
    if (issue === undefined) continue;
    if (!seen) {
      teamId = issue.teamId;
      stateId = issue.stateId;
      seen = true;
      continue;
    }
    if (teamId !== issue.teamId) return { reason: 'teams', stateId: undefined, states: [] };
    if (stateId !== issue.stateId) {
      stateId = undefined;
      agreed = false;
    }
  }
  if (!seen || teamId === undefined) return EMPTY_OFFER;

  const states = [...store.workflowStateIdsFor(teamId)]
    .flatMap((id) => {
      const state = store.workflowStates.get(id);
      // Duplicate is assigned when an issue is closed as a duplicate, never by hand — the
      // same refusal `StatusPicker` makes, so this menu cannot put a group somewhere a row
      // cannot go.
      if (state === undefined || state.archivedAt !== undefined || state.isSystem) return [];
      return [state];
    })
    .sort((a, b) => {
      const byCategory = CATEGORY_ORDER[a.category] - CATEGORY_ORDER[b.category];
      if (byCategory !== 0) return byCategory;
      return a.position < b.position ? -1 : a.position > b.position ? 1 : 0;
    })
    .map((state) => ({
      id: state.id,
      name: state.name,
      category: state.category,
      color: state.color,
    }));

  return { reason: 'ok', stateId: agreed ? stateId : undefined, states };
}

export function groupMenuItems(input: {
  count: number;
  offer: GroupStatusOffer;
  onSelectAll?: (() => void) | undefined;
  onSetStatus?: ((stateId: string) => void) | undefined;
}): MenuNode[] {
  const items: MenuNode[] = [];
  if (input.onSelectAll !== undefined) {
    const selectAll = input.onSelectAll;
    items.push({
      id: 'select-all',
      label: 'Select all',
      hint: input.count > 0 ? String(input.count) : undefined,
      disabled: input.count === 0,
      onSelect: () => selectAll(),
    });
  }

  const statuses = statusRows(input.offer, input.onSetStatus);
  if (statuses.length === 0) return items;
  if (items.length > 0) items.push({ kind: 'separator' });
  items.push(...statuses);
  return items;
}

function statusRows(
  offer: GroupStatusOffer,
  onSetStatus: ((stateId: string) => void) | undefined,
): MenuNode[] {
  if (onSetStatus === undefined) return [];
  if (offer.reason === 'teams') {
    return [
      {
        id: 'status-teams',
        label: 'These issues are in more than one team',
        disabled: true,
        onSelect: () => {},
      },
    ];
  }
  if (offer.reason !== 'ok') return [];
  const setStatus = onSetStatus;
  return offer.states.map((state) => ({
    id: state.id,
    label: state.name,
    icon: <StateIcon category={state.category} color={state.color} decorative />,
    selected: state.id === offer.stateId,
    onSelect: () => setStatus(state.id),
  }));
}
