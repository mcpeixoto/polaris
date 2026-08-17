import { describe, expect, it } from 'vitest';

import type { EstimateScale } from '~/store/types';
import {
  estimateLabel,
  estimateOptions,
  estimatesEnabled,
  issueEstimateLabel,
  weightedProgress,
} from './estimate';

const team = (
  estimateScale: EstimateScale,
  estimateAllowZero = false,
  estimateExtended = false,
) => ({ estimateScale, estimateAllowZero, estimateExtended });

describe('estimate scales', () => {
  it('offers the ladder the team chose', () => {
    expect(estimateOptions(team('fibonacci'))).toEqual([1, 2, 3, 5, 8]);
    expect(estimateOptions(team('exponential'))).toEqual([1, 2, 4, 8, 16]);
    expect(estimateOptions(team('linear'))).toEqual([1, 2, 3, 4, 5]);
  });

  it('treats zero and the extension as settings, not as separate scales', () => {
    expect(estimateOptions(team('fibonacci', true))).toEqual([0, 1, 2, 3, 5, 8]);
    expect(estimateOptions(team('fibonacci', false, true))).toEqual([1, 2, 3, 5, 8, 13, 21]);
    expect(estimateOptions(team('fibonacci', true, true))).toEqual([0, 1, 2, 3, 5, 8, 13, 21]);
  });

  it('hides the control entirely rather than offering an empty one', () => {
    expect(estimatesEnabled(team('none'))).toBe(false);
    expect(estimateOptions(team('none'))).toEqual([]);
    expect(issueEstimateLabel(3, team('none'))).toBeNull();
  });

  // The whole reason the number is stored and the scale is not: a team can switch and no
  // issue is rewritten.
  it('renders the same stored number differently under different scales', () => {
    expect(estimateLabel(3, 'fibonacci')).toBe('3');
    expect(estimateLabel(3, 'tshirt')).toBe('M');
    expect(estimateLabel(1, 'tshirt')).toBe('XS');
    expect(estimateLabel(5, 'tshirt')).toBe('XL');
  });

  // Happens whenever a team narrows its scale. Those issues are not wrong, just no longer
  // offered — rendering them blank would make sized work look unsized.
  it('still renders a value the current ladder no longer offers', () => {
    expect(estimateLabel(21, 'fibonacci')).toBe('21');
    expect(estimateLabel(99, 'tshirt')).toBe('99');
  });

  // The raw number cannot express this difference and a view that blanks both loses it.
  it('distinguishes unestimated from an estimate of zero', () => {
    expect(issueEstimateLabel(undefined, team('fibonacci', true))).toBeNull();
    expect(issueEstimateLabel(0, team('fibonacci', true))).toBe('0');
  });
});

describe('progress rollup', () => {
  const child = (estimate: number | undefined, completed: boolean, canceled = false) => ({
    estimate,
    completed,
    canceled,
  });

  it('has nothing to say about an issue with no children', () => {
    expect(weightedProgress([])).toBeNull();
  });

  // Counting would call this 50% done when the only thing left is the hard part.
  it('weights by estimate when every child carries one', () => {
    const result = weightedProgress([child(1, true), child(15, false)]);
    expect(result).toEqual({ percent: 6, weighted: true });
  });

  it('falls back to counting when a child is unestimated, and says so', () => {
    const result = weightedProgress([child(1, true), child(undefined, false)]);
    expect(result).toEqual({ percent: 50, weighted: false });
  });

  // Cancelled work is not incomplete work — leaving it in the denominator means a parent
  // can never reach 100%.
  it('excludes cancelled children from the denominator', () => {
    expect(weightedProgress([child(1, true), child(1, false, true)])).toEqual({
      percent: 100,
      weighted: true,
    });
    expect(weightedProgress([child(1, false, true)])).toBeNull();
  });

  // A zero estimate cannot carry weight, so a set containing one is counted rather than
  // weighted — otherwise it contributes nothing and vanishes from its own rollup.
  it('counts rather than weights when a child is estimated at zero', () => {
    expect(weightedProgress([child(0, true), child(4, false)])).toEqual({
      percent: 50,
      weighted: false,
    });
  });
});
