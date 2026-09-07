/**
 * The menu that chooses an initiative.
 *
 * Written once because the question is asked from four places — the create dialog's parent,
 * the detail page's sub-initiative row, a project's initiatives, the command menu — and every
 * one of them had reached for a native `<select>` over the whole table. That control has no
 * filter box, so in a workspace with sixty objectives the only way to find one is to scroll
 * past the fifty-nine that are archived, completed or the very row you are editing. Which is
 * the mistake this prevents: `exclude` takes the initiative that must not be offered, because
 * a picker that lets somebody nest an initiative under itself is a picker that produces a
 * cycle the graph cannot draw.
 *
 * Same contract as the other property pickers: controlled, does not own its trigger, does not
 * perform the write. It reports a choice and the caller decides what it means; `null` is "no
 * initiative" and is a real answer, and `noneLabel: null` is how a caller that must have one
 * says so.
 */

import type { RefObject } from 'react';

import { Menu, StateIcon, type MenuNode, type MenuPlacement } from '~/components';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import type { UUID } from '~/store';

import { INITIATIVE_STATUS_ICON, formatInitiativeStatus } from './mutations';

/** The id of the "no initiative" row. A word, because there is no id for nothing. */
const NONE = 'none';

export interface InitiativePickerProps {
  open: boolean;
  onClose: () => void;
  /** The control the menu belongs to: what it is positioned against, and where focus returns. */
  trigger: RefObject<HTMLElement | null>;
  placement?: MenuPlacement | undefined;
  /** The menu's accessible name, which is the property being set: "Parent", "Initiative". */
  label?: string | undefined;
  /** The chosen initiative, or `null` for none. */
  value: UUID | null;
  onSelect: (initiativeId: UUID | null) => void;
  /**
   * The wording of the empty row, or `null` to leave it out — which is how a property that
   * must hold an initiative is expressed.
   */
  noneLabel?: string | null | undefined;
  filterPlaceholder?: string | undefined;
  /** The chord that opens this picker, drawn in the filter box. See `MenuProps.filterHint`. */
  filterHint?: string | undefined;
  /**
   * Initiatives to leave out: the one being edited, and anything nesting it under this one
   * would loop. Absent rather than disabled — a disabled row in a list somebody is filtering
   * is a row they will type at and get nothing from.
   */
  exclude?: ReadonlySet<UUID> | undefined;
}

export function InitiativePicker({
  open,
  onClose,
  trigger,
  placement,
  label = 'Initiative',
  value,
  onSelect,
  noneLabel = 'No initiative',
  filterPlaceholder = 'Initiative…',
  filterHint,
  exclude,
}: InitiativePickerProps) {
  const initiatives = useLiveQuery(
    (store) =>
      [...store.initiatives.values()]
        // An archived or deleted initiative is offered only while it already holds the value,
        // so the pill's own initiative can still be seen in the picker that is showing it.
        .filter(
          (row) =>
            ((row.archivedAt === undefined && row.deletedAt === undefined) || row.id === value) &&
            exclude?.has(row.id) !== true,
        )
        .map((row) => ({
          id: row.id,
          name: row.name,
          status: row.status,
          archived: row.archivedAt !== undefined || row.deletedAt !== undefined,
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    ['initiative'],
    // The value decides which archived initiative is still on offer.
    [value ?? '', exclude],
  );

  const items: MenuNode[] = [];
  if (noneLabel !== null) {
    items.push(
      {
        id: NONE,
        label: noneLabel,
        text: `${noneLabel} none clear`.toLowerCase(),
        selected: value === null,
        onSelect: () => onSelect(null),
      },
      { kind: 'separator' },
    );
  }
  for (const row of initiatives) {
    items.push({
      id: row.id,
      label: row.name,
      icon: <StateIcon category={INITIATIVE_STATUS_ICON[row.status]} decorative />,
      hint: row.archived ? 'Archived' : formatInitiativeStatus(row.status),
      selected: row.id === value,
      onSelect: () => onSelect(row.id),
    });
  }

  return (
    <Menu
      open={open}
      onClose={onClose}
      trigger={trigger}
      items={items}
      label={label}
      placement={placement}
      filterable
      filterPlaceholder={filterPlaceholder}
      filterHint={filterHint}
      emptyLabel={initiatives.length === 0 ? 'No initiatives yet' : 'No initiative matches'}
    />
  );
}
