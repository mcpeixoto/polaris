/**
 * Day math for dragging a project bar on the timeline.
 *
 * The layout already places bars from start/target dates; this file only answers "how many
 * days did the pointer move" and "what dates does that write". Keeping it pure means the
 * pointer handlers stay thin and the day arithmetic is testable without a DOM.
 */

import type { DateOnly, Project } from '~/store';

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

/** Whole days from a horizontal pointer delta at the current zoom. */
export function daysFromPx(deltaX: number, pxPerDay: number): number {
  if (pxPerDay <= 0) return 0;
  return Math.round(deltaX / pxPerDay);
}

/** Shift a calendar day by N days in UTC. */
export function addDaysUtc(day: DateOnly, count: number): DateOnly {
  const index = Math.floor(new Date(`${day}T00:00:00.000Z`).getTime() / DAY_MS);
  const next = new Date((index + count) * DAY_MS);
  return next.toISOString().slice(0, 10);
}

export interface ShiftedProjectDates {
  readonly startDate?: DateOnly;
  readonly targetDate?: DateOnly;
}

/**
 * The start/target patch for a bar moved by `deltaDays`.
 *
 * Only fields the project already has are rewritten — a one-date bar stays a one-date bar.
 * A zero shift returns null so the caller can skip the mutation.
 */
export function shiftedProjectDates(
  project: Pick<Project, 'startDate' | 'targetDate'>,
  deltaDays: number,
): ShiftedProjectDates | null {
  if (deltaDays === 0) return null;
  const start = parseDay(project.startDate);
  const target = parseDay(project.targetDate);
  if (start === null && target === null) return null;

  const out: { startDate?: DateOnly; targetDate?: DateOnly } = {};
  if (start !== null) out.startDate = addDaysUtc(start, deltaDays);
  if (target !== null) out.targetDate = addDaysUtc(target, deltaDays);
  return out;
}

function parseDay(date: string | undefined): DateOnly | null {
  if (date === undefined) return null;
  return DAY.test(date) ? date : null;
}
