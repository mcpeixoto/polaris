/**
 * Rendering an estimate.
 *
 * The issue stores a number and the team stores a scale, and this is the only place the
 * two meet. That split is what lets a team switch from Fibonacci to t-shirt sizes without
 * rewriting a single issue: 3 is 3 under one scale and "M" under another, and the stored
 * value never moves.
 *
 * It also means rollups, sorting and insights work on the number and never have to know
 * which scale a team chose — which they would, if the scale's label were what was stored.
 */

import type { EstimateScale } from '~/store/types';

/**
 * The values each scale offers, without zero and without the extension.
 *
 * Zero and the extended top end are separate team settings rather than separate scales
 * because they are opinions about the same ladder: some teams use 0 for "no work" and for
 * others a zero estimate is always a mistake, and offering it invites one.
 */
const LADDERS: Readonly<Record<Exclude<EstimateScale, 'none'>, readonly number[]>> = {
  // Doubling. The gaps are the point: an estimate between 4 and 8 does not exist, which
  // is what stops the conversation being about whether something is a 5 or a 6.
  exponential: [1, 2, 4, 8, 16],
  fibonacci: [1, 2, 3, 5, 8],
  linear: [1, 2, 3, 4, 5],
  // Stored as 1–5 so that sorting, averaging and rolling up work exactly as they do for
  // every other scale. Only the label is different.
  tshirt: [1, 2, 3, 4, 5],
};

/** What `extended` adds to the top of each ladder. */
const EXTENSIONS: Readonly<Record<Exclude<EstimateScale, 'none'>, readonly number[]>> = {
  exponential: [32, 64],
  fibonacci: [13, 21],
  linear: [6, 7, 8, 9, 10],
  tshirt: [6, 7],
};

const TSHIRT_LABELS: readonly string[] = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL'];

export interface EstimateSettings {
  readonly estimateScale: EstimateScale;
  readonly estimateAllowZero: boolean;
  readonly estimateExtended: boolean;
}

/** Whether the team estimates at all. `none` hides the control rather than leaving it empty. */
export function estimatesEnabled(team: EstimateSettings): boolean {
  return team.estimateScale !== 'none';
}

/**
 * What an issue contributes to a graph, a capacity dial, or an insight.
 *
 * Unestimated work still counts: hiding it would make a cycle look empty because nobody
 * had sized it yet. The unestimated default is 1, matching Linear, so a team that has not
 * turned estimates on and a team that has but left a row blank agree on the arithmetic.
 */
export function effortOf(
  issue: { readonly estimate?: number },
  team: EstimateSettings | undefined,
): number {
  if (team === undefined || team.estimateScale === 'none') return 1;
  return issue.estimate ?? 1;
}

/** The values a picker should offer, in order. */
export function estimateOptions(team: EstimateSettings): readonly number[] {
  if (team.estimateScale === 'none') return [];
  const ladder = LADDERS[team.estimateScale];
  const values = team.estimateExtended ? [...ladder, ...EXTENSIONS[team.estimateScale]] : ladder;
  return team.estimateAllowZero ? [0, ...values] : values;
}

/**
 * The label for a stored value.
 *
 * A value outside the team's current ladder still renders, and renders as itself. It
 * happens whenever a team narrows its scale or turns off the extension, and the issues
 * estimated under the old settings are not wrong — they are just no longer offered. Hiding
 * them, or rendering an empty cell, would make an issue look unestimated when it is not.
 */
export function estimateLabel(value: number, scale: EstimateScale): string {
  if (scale === 'tshirt') {
    if (value === 0) return '0';
    return TSHIRT_LABELS[value - 1] ?? String(value);
  }
  return String(value);
}

/**
 * The label for an issue's estimate, or null when there is nothing to show.
 *
 * Distinguishes "unestimated" from zero, which the raw number cannot: `undefined` means
 * nobody has said, and 0 means somebody said none. A view that shows both as blank loses
 * the difference between work not yet sized and work sized at nothing.
 */
export function issueEstimateLabel(
  estimate: number | undefined,
  team: EstimateSettings,
): string | null {
  if (estimate === undefined || team.estimateScale === 'none') return null;
  return estimateLabel(estimate, team.estimateScale);
}

/**
 * Sub-issue progress by estimate rather than by count.
 *
 * Counting children treats a one-point task and a sixteen-point one as equal, which makes
 * a parent look nearly done when the only thing left is the hard part. Where every child
 * carries an estimate, weighting by it is the honest answer; where they do not, falling
 * back to counting is better than pretending, and the caller is told which happened so it
 * can say so.
 */
export function weightedProgress(
  children: readonly { estimate?: number; completed: boolean; canceled: boolean }[],
): { percent: number; weighted: boolean } | null {
  const live = children.filter((c) => !c.canceled);
  if (live.length === 0) return null;

  const allEstimated = live.every((c) => c.estimate !== undefined && c.estimate > 0);
  if (allEstimated) {
    const total = live.reduce((sum, c) => sum + (c.estimate ?? 0), 0);
    const done = live.reduce((sum, c) => sum + (c.completed ? (c.estimate ?? 0) : 0), 0);
    return { percent: Math.round((done / total) * 100), weighted: true };
  }

  const done = live.filter((c) => c.completed).length;
  return { percent: Math.round((done / live.length) * 100), weighted: false };
}
