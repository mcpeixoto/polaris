/**
 * The menu that puts a customer in one of the workspace's tiers.
 *
 * A tier is not an enum, and that is the thing to know before reusing this. There is no
 * `CustomerTier` type: `workspace.customerTiers` is a list an admin types into Settings →
 * Customer requests, and `customer.tier` is a free string the API takes as given. A
 * workspace that has never opened that screen has no tiers at all, which is why the detail
 * screen draws a text field where this draws a menu — see the branch at
 * `views/CustomerDetail.tsx`.
 *
 * So a caller must decide whether picking is even the right gesture before it renders one:
 * with no tiers configured there is nothing to pick from, and a menu holding only "No tier"
 * would be a control that can take a value away and never give one back. The customer list
 * asks that question before drawing the trigger.
 *
 * The tier the customer already holds is offered even when it has since been dropped from
 * the workspace's list — the same call `ProjectStatusPicker` makes about a retired status.
 * A customer does not move off a tier by itself, and a picker that omitted the value it is
 * showing would read as if nothing were set.
 */

import type { RefObject } from 'react';

import { Menu, type MenuNode, type MenuPlacement } from '~/components';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import type { Store } from '~/store';

/** The id of the row that clears the tier. Prefixed ids keep it off a tier called "none". */
const NONE = 'none';

export interface CustomerTierPickerProps {
  open: boolean;
  onClose: () => void;
  trigger: RefObject<HTMLElement | null>;
  placement?: MenuPlacement | undefined;
  /** The tier the customer holds, or `null` for none. */
  value: string | null;
  onSelect: (tier: string | null) => void;
}

export function CustomerTierPicker({
  open,
  onClose,
  trigger,
  placement,
  value,
  onSelect,
}: CustomerTierPickerProps) {
  const tiers = useLiveQuery((store) => offerings(store, value), ['workspace'], [value ?? '']);

  const items: MenuNode[] = [
    {
      id: NONE,
      label: 'No tier',
      text: 'no tier none clear',
      selected: value === null,
      onSelect: () => onSelect(null),
    },
    { kind: 'separator' },
    ...tiers.map((tier) => ({
      id: `tier:${tier}`,
      label: tier,
      selected: tier === value,
      onSelect: () => onSelect(tier),
    })),
  ];

  return (
    <Menu
      open={open}
      onClose={onClose}
      trigger={trigger}
      items={items}
      label="Customer tier"
      placement={placement}
      emptyLabel="No tiers in this workspace"
    />
  );
}

/** The workspace's tiers, plus the one being held if it is no longer among them. */
function offerings(store: Store, current: string | null): string[] {
  const tiers = [...(store.workspaces.get(store.workspaceId)?.customerTiers ?? [])];
  if (current !== null && !tiers.includes(current)) tiers.push(current);
  return tiers;
}
