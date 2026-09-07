/**
 * The initiatives list's display menu: grouping, ordering, and which cells a row draws.
 *
 * A `Menu` rather than the issue list's popover panel, because the options here are three
 * questions and not a settings surface: two of them are a single choice out of a short list,
 * and a menu that closes when a choice is made is exactly right for that. The columns are the
 * one set somebody may want to change twice in a row, so they sit in a submenu — closing back
 * to the list after each tick, which costs a click and buys the whole menu one behaviour
 * instead of two.
 *
 * The rows are the display panel's shape, so the two menus read as one product: the option's
 * name at the left, the value in force at the right, and a tick beside the value that is
 * chosen. Nothing here owns a key handler; `Menu` brings its own focus trap and its own
 * Escape, and every row is an ordinary item.
 */

import { type RefObject } from 'react';

import { Menu, type MenuNode } from '~/components';

import {
  changedInitiativeDisplayCount,
  DEFAULT_INITIATIVE_DISPLAY,
  INITIATIVE_COLUMN_LABELS,
  INITIATIVE_COLUMNS,
  INITIATIVE_GROUP_LABELS,
  INITIATIVE_ORDER_LABELS,
  type InitiativeColumn,
  type InitiativeDisplayOptions,
  type InitiativeGroupBy,
  type InitiativeOrderBy,
  type RequiredInitiativeDisplay,
} from './display';
import styles from './InitiativeDisplayMenu.module.css';

export interface InitiativeDisplayMenuProps {
  readonly display: RequiredInitiativeDisplay;
  onChange(patch: Partial<InitiativeDisplayOptions>): void;
  readonly open: boolean;
  onClose(): void;
  readonly trigger: RefObject<HTMLElement | null>;
}

const GROUP_ORDER: readonly InitiativeGroupBy[] = ['none', 'status', 'owner'];
const ORDER_ORDER: readonly InitiativeOrderBy[] = [
  'manual',
  'name',
  'targetDate',
  'progress',
  'updated',
];

/** A submenu's row: what the option is, and what it is currently set to. */
function row(label: string, value: string) {
  return (
    <span className={styles.row}>
      <span>{label}</span>
      <span className={styles.value}>{value}</span>
    </span>
  );
}

export function InitiativeDisplayMenu({
  display,
  onChange,
  open,
  onClose,
  trigger,
}: InitiativeDisplayMenuProps) {
  const changed = changedInitiativeDisplayCount(display);

  const shown = display.columns.length;
  const columnsValue =
    shown === INITIATIVE_COLUMNS.length ? 'All' : shown === 0 ? 'None' : `${shown} shown`;

  const items: MenuNode[] = [
    {
      kind: 'submenu',
      id: 'grouping',
      label: row('Grouping', INITIATIVE_GROUP_LABELS[display.grouping]),
      text: 'Grouping',
      items: GROUP_ORDER.map((value) => ({
        id: `grouping-${value}`,
        label: INITIATIVE_GROUP_LABELS[value],
        selected: display.grouping === value,
        onSelect: () => onChange({ grouping: value }),
      })),
    },
    {
      kind: 'submenu',
      id: 'ordering',
      label: row('Ordering', INITIATIVE_ORDER_LABELS[display.ordering]),
      text: 'Ordering',
      items: ORDER_ORDER.map((value) => ({
        id: `ordering-${value}`,
        label: INITIATIVE_ORDER_LABELS[value],
        selected: display.ordering === value,
        onSelect: () => onChange({ ordering: value }),
      })),
    },
    {
      kind: 'submenu',
      id: 'columns',
      label: row('Columns', columnsValue),
      text: 'Columns',
      items: INITIATIVE_COLUMNS.map((column) => ({
        id: `column-${column}`,
        label: INITIATIVE_COLUMN_LABELS[column],
        selected: display.columns.includes(column),
        onSelect: () => onChange({ columns: toggleColumn(display.columns, column) }),
      })),
    },
    ...(changed === 0
      ? []
      : [
          { kind: 'separator' } as const,
          {
            id: 'reset',
            label: 'Reset to default',
            onSelect: () => onChange(DEFAULT_INITIATIVE_DISPLAY),
          },
        ]),
  ];

  return (
    <Menu open={open} onClose={onClose} trigger={trigger} label="Display options" items={items} />
  );
}

function toggleColumn(
  columns: readonly InitiativeColumn[],
  column: InitiativeColumn,
): readonly InitiativeColumn[] {
  return columns.includes(column)
    ? columns.filter((candidate) => candidate !== column)
    : INITIATIVE_COLUMNS.filter((candidate) => candidate === column || columns.includes(candidate));
}
