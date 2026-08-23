import { describe, expect, it } from 'vitest';

import type { InsightBurnPoint, InsightData } from './computeInsights';
import { toLayout } from './InsightChart';

function burnData(burn: readonly InsightBurnPoint[]): InsightData {
  return {
    measure: 'burnUp',
    slice: 'assignee',
    chart: 'area',
    unit: 'completed',
    buckets: [],
    scatter: [],
    burn,
    percentiles: [],
    total: burn.length === 0 ? 0 : burn[burn.length - 1]!.completed,
  };
}

describe('toLayout, burn-up', () => {
  it('draws nothing when nothing has been completed', () => {
    expect(toLayout(burnData([]))).toBeNull();
  });

  it('draws a single period rather than claiming there is nothing to chart', () => {
    const layout = toLayout(burnData([{ period: '2026-08', completed: 6 }]));
    expect(layout).not.toBeNull();
    expect(layout!.kind).toBe('area');
    // Spans the full plot width, so a first-month burn-up is visible rather than a
    // zero-width sliver, and carries no NaN from dividing by a zero span.
    expect(layout!.path).not.toContain('NaN');
    expect(layout!.path).toContain('352');
  });

  it('still draws several periods as a ramp', () => {
    const layout = toLayout(
      burnData([
        { period: '2026-07', completed: 2 },
        { period: '2026-08', completed: 6 },
      ]),
    );
    expect(layout).not.toBeNull();
    expect(layout!.path).not.toContain('NaN');
    expect(layout!.path.startsWith('M 8 ')).toBe(true);
  });
});
