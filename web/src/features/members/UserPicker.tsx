/**
 * Choosing a person: one of them, or several.
 *
 * This is `AssigneePicker` with the issue taken out of it. Every surface in the product that
 * names somebody asks the same question of the same replica — a project's lead, an
 * initiative's owner, a team's members, a customer's contact — and each one that grew its own
 * `<select>` over `store.users` lost something: the filter box, the avatars, the suspended
 * member who is still on the row, or the ability to say nobody.
 *
 * It lives under `features/` and not in the component library because it reads the store, and
 * a component that reads the store cannot be used by anything that does not have one. That is
 * the line `components/` holds.
 *
 * Three things are worth knowing before changing it.
 *
 * **"Nobody" is a value, not a blank.** `noneLabel` draws that row and `null` hides it, which
 * is the difference between an assignee (may be nobody) and an owner (may not). Hiding the row
 * is how a required field is expressed here; disabling it would leave a control that declines
 * silently.
 *
 * **A suspended member is offered only when they already hold the value.** Hiding them
 * outright would leave a row whose person cannot be seen in the picker that is supposed to be
 * showing them; listing everyone who ever left makes the common list longer for everybody.
 *
 * **Multiple mode does not close on a choice.** A single-value picker closes because choosing
 * is the decision; a set is built by several acts, and a menu that shut after each one would
 * make adding four people four round trips. `Menu` calls `onClose` immediately after an item's
 * `onSelect`, so a toggle marks itself and that one close is swallowed — the caller's
 * `onClose` still runs for Escape, Tab and an outside click, which are the ways somebody says
 * they are finished.
 */

import { useRef } from 'react';
import type { RefObject } from 'react';

import { Avatar, Menu, type MenuNode, type MenuPlacement } from '~/components';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import type { UUID } from '~/store';

/** The id of the "nobody" row. A word rather than an id, because there is no id for nobody. */
const NONE = 'none';

interface UserPickerBase {
  open: boolean;
  onClose: () => void;
  /** The control the menu belongs to: what it is positioned against, and where focus returns. */
  trigger: RefObject<HTMLElement | null>;
  placement?: MenuPlacement | undefined;
  /** The menu's accessible name, which is the property being set: "Assignee", "Lead". */
  label?: string | undefined;
  /**
   * The wording of the nobody row, or `null` to leave it out entirely — which is how a
   * property that must have a person is expressed.
   */
  noneLabel?: string | null | undefined;
  filterPlaceholder?: string | undefined;
  /** The chord that opens this picker, drawn in the filter box. See `MenuProps.filterHint`. */
  filterHint?: string | undefined;
  /**
   * People to leave out: those already on the row being added to, or the person on the other
   * side of a pairing. They are absent rather than disabled, because a disabled row in a list
   * somebody is filtering is a row they will type at and get nothing from.
   */
  exclude?: ReadonlySet<UUID> | undefined;
}

export interface SingleUserPickerProps extends UserPickerBase {
  multiple?: false | undefined;
  /** The chosen person, `null` for nobody, `undefined` when the targets disagree. */
  value: UUID | null | undefined;
  onSelect: (userId: UUID | null) => void;
}

export interface MultiUserPickerProps extends UserPickerBase {
  multiple: true;
  /** Everybody currently chosen. Ticked rather than removed from the list. */
  value: ReadonlySet<UUID>;
  /** Called with one id per act. The caller owns the set and decides what a toggle means. */
  onToggle: (userId: UUID) => void;
}

export type UserPickerProps = SingleUserPickerProps | MultiUserPickerProps;

export function UserPicker(props: UserPickerProps) {
  const {
    open,
    onClose,
    trigger,
    placement,
    label = 'Assignee',
    noneLabel = 'No assignee',
    filterPlaceholder = 'Assign to…',
    filterHint,
    exclude,
  } = props;

  // Whether the close `Menu` is about to perform was caused by a toggle. See the note above.
  const toggled = useRef(false);

  const holds = (id: UUID): boolean =>
    props.multiple === true ? props.value.has(id) : props.value === id;

  const users = useLiveQuery(
    (store) =>
      [...store.users.values()]
        .filter(
          (user) =>
            user.archivedAt === undefined &&
            (user.status === 'active' || holds(user.id)) &&
            exclude?.has(user.id) !== true,
        )
        .map((user) => ({
          id: user.id,
          name: user.displayName,
          avatarUrl: user.avatarUrl ?? null,
          suspended: user.status !== 'active',
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    ['user'],
    // The value is a dependency because it decides which suspended members are still on offer.
    [props.multiple === true ? [...props.value].sort().join(' ') : props.value, exclude],
  );

  const items: MenuNode[] = [];
  if (props.multiple !== true && noneLabel !== null) {
    // Nobody leads rather than trails: it is the most-used entry in the list — dropping
    // something back into the pool is a normal move — and a filter box a user has to scroll
    // past to reach the common case is a filter box working against them.
    items.push(
      {
        id: NONE,
        label: noneLabel,
        text: `${noneLabel} nobody none clear unassigned`.toLowerCase(),
        selected: props.value === null,
        onSelect: () => props.onSelect(null),
      },
      { kind: 'separator' },
    );
  }
  for (const user of users) {
    items.push({
      id: user.id,
      label: user.name,
      icon: (
        <Avatar name={user.name} src={user.avatarUrl} size="xs" colorKey={user.id} decorative />
      ),
      hint: user.suspended ? 'Suspended' : undefined,
      selected: holds(user.id),
      onSelect: () => {
        if (props.multiple === true) {
          toggled.current = true;
          props.onToggle(user.id);
          return;
        }
        props.onSelect(user.id);
      },
    });
  }

  return (
    <Menu
      open={open}
      onClose={() => {
        if (toggled.current) {
          toggled.current = false;
          return;
        }
        onClose();
      }}
      trigger={trigger}
      items={items}
      label={label}
      placement={placement}
      filterable
      filterPlaceholder={filterPlaceholder}
      filterHint={filterHint}
      emptyLabel="Nobody by that name"
    />
  );
}
