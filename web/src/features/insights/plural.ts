/**
 * A count and the word it counts, written the way a person writes it.
 *
 * The chart total said "1 issues" while the dashboards list, on the screen next to it, said
 * "1 tile" — the same rule got right in one place and wrong in the other because each wrote
 * its own concatenation. `08-ui-composition.md`: numbers in prose read as prose.
 *
 * Only the units this product actually counts in are listed. `effort` is already a mass
 * noun and "completed points" is a phrase rather than a unit, so both are left exactly as
 * they were handed over — a rule that guesses at an unknown word is a rule that invents
 * "1 effortt".
 */

const SINGULAR: Readonly<Record<string, string>> = {
  issues: 'issue',
  points: 'point',
  tiles: 'tile',
  days: 'day',
  projects: 'project',
};

/** The unit as it should read for `count` — singular at one, unchanged otherwise. */
export function unitFor(count: number, unit: string): string {
  if (count !== 1) return unit;
  return SINGULAR[unit] ?? unit;
}

/** "1 issue", "4 issues". */
export function plural(count: number, unit: string): string {
  return `${count} ${unitFor(count, unit)}`;
}
