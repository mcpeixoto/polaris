/**
 * The menu that moves a customer between active, prospect and churned.
 *
 * Same contract as the other property pickers: controlled, does not own its trigger, does
 * not perform the write. Unlike a project's status these three are not workspace data —
 * they are the `CustomerStatus` union and the server's enum — so there is no live query
 * here, nothing to sort by position, and no archived value to keep on offer.
 *
 * The rows are built by `customerStatusItems` rather than inline, because the list view
 * draws this same list twice: once in the picker the status cell opens, and once as the
 * `Status` submenu of the row menu, which is the keyboard's way to the same property. Two
 * literals would have been two places for a fourth status to be forgotten.
 */

import type { RefObject } from 'react';

import { Menu, type MenuNode, type MenuPlacement } from '~/components';
import type { CustomerStatus } from '~/store';

import { formatCustomerStatus } from './mutations';

/** Every status a customer can hold, in the order the product lists them. */
export const CUSTOMER_STATUSES: readonly CustomerStatus[] = ['active', 'prospect', 'churned'];

/**
 * The statuses as menu rows, ticked at the one the customer holds.
 *
 * Exported for the row menu's submenu, which needs the nodes rather than a `Menu` of its
 * own — a submenu draws inside the menu it hangs from.
 */
export function customerStatusItems(
  value: CustomerStatus | undefined,
  onSelect: (status: CustomerStatus) => void,
): MenuNode[] {
  return CUSTOMER_STATUSES.map((status) => ({
    id: status,
    label: formatCustomerStatus(status),
    selected: status === value,
    onSelect: () => onSelect(status),
  }));
}

export interface CustomerStatusPickerProps {
  open: boolean;
  onClose: () => void;
  trigger: RefObject<HTMLElement | null>;
  placement?: MenuPlacement | undefined;
  value: CustomerStatus | undefined;
  onSelect: (status: CustomerStatus) => void;
}

export function CustomerStatusPicker({
  open,
  onClose,
  trigger,
  placement,
  value,
  onSelect,
}: CustomerStatusPickerProps) {
  return (
    <Menu
      open={open}
      onClose={onClose}
      trigger={trigger}
      items={customerStatusItems(value, onSelect)}
      label="Customer status"
      placement={placement}
    />
  );
}
