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

import { phaseOf } from './CycleEditModal';
import { cycleWindow } from './format';

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
      hint: row.window,
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
  readonly window: string;
}

function rankCycles(store: Store, teamId: UUID | undefined): readonly Ranked[] {
  const now = Date.now();
  const rows: Ranked[] = [];
  for (const cycle of store.cycles.values()) {
    if (cycle.archivedAt !== undefined) continue;
    if (teamId !== undefined && cycle.teamId !== teamId) continue;
    // `phaseOf` rather than a second reading of the dates, which is how a cycle closed
    // early — completed, but not yet past its end date — kept listing as Current here while
    // the Cycles page had already filed it under Previous.
    const zone = store.teams.get(cycle.teamId)?.timezone ?? 'UTC';
    rows.push({
      heading: phaseOf(cycle, now),
      cycle,
      window: cycleWindow(cycle.startsAt, cycle.endsAt, zone, now),
    });
  }
  const order = { Current: 0, Upcoming: 1, Previous: 2 };
  return rows.sort((a, b) => {
    const byHeading =
      order[a.heading as keyof typeof order] - order[b.heading as keyof typeof order];
    if (byHeading !== 0) return byHeading;
    // Upcoming counts forward from now; Previous counts back from it. Sorting both
    // ascending buried last week's sprint under every cycle the team had ever run.
    const byStart = Date.parse(a.cycle.startsAt) - Date.parse(b.cycle.startsAt);
    return a.heading === 'Previous' ? -byStart : byStart;
  });
}
