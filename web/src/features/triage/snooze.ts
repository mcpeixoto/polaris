/**
 * The snooze choices for a triage issue.
 *
 * Relative rather than a calendar. The inbox uses the same three, and a fourth that
 * unsnoozes; here unsnooze is "do not snooze" because the row is still in triage and the
 * next edit would wake it anyway.
 */

import type { MenuNode } from '~/components';

export function snoozeItems(onPick: (until: Date) => void): MenuNode[] {
  const at = (hours: number) => {
    const d = new Date();
    d.setHours(d.getHours() + hours, 0, 0, 0);
    return d;
  };
  const tomorrowMorning = () => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
    return d;
  };
  const nextWeek = () => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    d.setHours(9, 0, 0, 0);
    return d;
  };

  return [
    { id: 'hour', label: 'In an hour', onSelect: () => onPick(at(1)) },
    { id: 'tomorrow', label: 'Tomorrow morning', onSelect: () => onPick(tomorrowMorning()) },
    { id: 'week', label: 'Next week', onSelect: () => onPick(nextWeek()) },
  ];
}
