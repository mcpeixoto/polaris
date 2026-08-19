/**
 * The menu that chooses a cycle for an issue.
 *
 * Current, then upcoming, then previous — so the window you are in is the first thing you
 * hit, not a date you have to parse. Cooldown is not in this list because it is not a cycle.
 */

import type { RefObject } from 'react';

import { Menu, type MenuNode, type MenuPlacement } from '~/components';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import type { Cycle, Store, UUID } from '~/store';

import type { Mixed } from '~/features/issue/pickers';

const NONE = 'none';

interface PickerProps {
  open: boolean;
  onClose: () => void;
  trigger: RefObject<HTMLElement | null>;
  placement?: MenuPlacement | undefined;
}

export interface CyclePickerProps extends PickerProps {
  teamId?: UUID | undefined;
  value: UUID | null | Mixed;
  onSelect: (cycleId: UUID | null) => void;
}

export function CyclePicker({
  open,
  onClose,
  trigger,
  placement,
  teamId,
  value,
  onSelect,
}: CyclePickerProps) {
  const ranked = useLiveQuery(
    (store) => rankCycles(store, teamId),
    ['cycle', 'team'],
    [teamId ?? ''],
  );

  const items: MenuNode[] = [
    {
      id: NONE,
      label: 'No cycle',
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
      id: row.cycle.id,
      label: row.cycle.name,
      hint: windowHint(row.cycle),
      selected: value === row.cycle.id,
      onSelect: () => onSelect(row.cycle.id),
    });
  }

  return (
    <Menu
      open={open}
      onClose={onClose}
      trigger={trigger}
      placement={placement}
      items={items}
      label="Cycle"
      filterable
      filterPlaceholder="Set cycle…"
      emptyLabel="No cycles yet"
    />
  );
}

interface Ranked {
  readonly heading: string;
  readonly cycle: Cycle;
}

function rankCycles(store: Store, teamId: UUID | undefined): readonly Ranked[] {
  const now = Date.now();
  const rows: Ranked[] = [];
  for (const cycle of store.cycles.values()) {
    if (cycle.archivedAt !== undefined) continue;
    if (teamId !== undefined && cycle.teamId !== teamId) continue;
    const start = Date.parse(cycle.startsAt);
    const end = Date.parse(cycle.endsAt);
    let heading = 'Previous';
    if (start <= now && now < end) heading = 'Current';
    else if (start > now) heading = 'Upcoming';
    rows.push({ heading, cycle });
  }
  const order = { Current: 0, Upcoming: 1, Previous: 2 };
  return rows.sort((a, b) => {
    const byHeading =
      order[a.heading as keyof typeof order] - order[b.heading as keyof typeof order];
    if (byHeading !== 0) return byHeading;
    return Date.parse(a.cycle.startsAt) - Date.parse(b.cycle.startsAt);
  });
}

function windowHint(cycle: Cycle): string {
  const start = new Date(cycle.startsAt);
  const end = new Date(cycle.endsAt);
  const fmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
  return `${fmt.format(start)} – ${fmt.format(end)}`;
}
