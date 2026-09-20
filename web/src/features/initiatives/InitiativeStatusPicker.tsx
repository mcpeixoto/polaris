/**
 * The menu that moves an initiative through its five statuses.
 *
 * Same contract as every other property picker: controlled, does not own its trigger, does
 * not perform the write. Flat rather than grouped — unlike a project's, an initiative's
 * status is not a workspace-defined row with a category behind it, it is the fixed
 * lifecycle `INITIATIVE_STATUSES` spells out, and a heading over each of five items would
 * be five headings saying what the item already says.
 *
 * It exists because the list was about to build the same five `MenuNode`s the rail already
 * built. Two copies of a lifecycle is how one of them ends up missing "canceled" — which is
 * the reason `INITIATIVE_STATUSES` itself is exported from `mutations.ts`, and the same
 * reason applies one level up to the menu drawn from it.
 */

import type { RefObject } from 'react';

import { Menu, StateIcon, type MenuNode, type MenuPlacement } from '~/components';
import type { InitiativeStatus } from '~/store';

import { formatInitiativeStatus, INITIATIVE_STATUS_ICON, INITIATIVE_STATUSES } from './mutations';

export interface InitiativeStatusPickerProps {
  open: boolean;
  onClose: () => void;
  trigger: RefObject<HTMLElement | null>;
  placement?: MenuPlacement | undefined;
  /** The status the initiative is on, ticked. `undefined` while the row is not resolved. */
  value: InitiativeStatus | undefined;
  onSelect: (status: InitiativeStatus) => void;
}

export function InitiativeStatusPicker({
  open,
  onClose,
  trigger,
  placement,
  value,
  onSelect,
}: InitiativeStatusPickerProps) {
  const items: MenuNode[] = INITIATIVE_STATUSES.map((status) => ({
    id: status,
    label: formatInitiativeStatus(status),
    icon: <StateIcon category={INITIATIVE_STATUS_ICON[status]} decorative />,
    selected: status === value,
    onSelect: () => onSelect(status),
  }));

  return (
    <Menu
      open={open}
      onClose={onClose}
      trigger={trigger}
      items={items}
      label="Status"
      placement={placement}
    />
  );
}
