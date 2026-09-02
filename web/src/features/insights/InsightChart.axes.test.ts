/**
 * The axis the charts grew.
 *
 * A bar chart with no tick labels can only be read by hovering every bar, and the burn-up
 * charted "completed over time" with no times on it. These check that the labels exist, that
 * they are the ones the data carries, and that a crowded axis thins out rather than
 * overprinting itself.
 */

import { describe, expect, it } from 'vitest';

import { formatTotal, toLayout } from './InsightChart';
import type { InsightBucket, InsightData } from './computeInsights';

function bucket(key: string, value: number): InsightBucket {
  return { key, label: key, value, count: value, filter: null };
}

function barData(buckets: readonly InsightBucket[]): InsightData {
  return {
    measure: 'count',
    slice: 'assignee',
    chart: 'bar',
    unit: 'issues',
    buckets,
    scatter: [],
    burn: [],
    percentiles: [],
    total: buckets.reduce((sum, row) => sum + row.value, 0),
  };
}

describe('chart axes', () => {
  it('labels every bar while they fit', () => {
    const layout = toLayout(barData([bucket('Ada', 3), bucket('Grace', 5)]));

    expect(layout!.xTicks.map((tick) => tick.label)).toEqual(['Ada', 'Grace']);
  });

  it('thins the labels out when the bars are too narrow to carry them all', () => {
    const many = Array.from({ length: 30 }, (_, index) => bucket(`b${index}`, index + 1));
    const layout = toLayout(barData(many));

    expect(layout!.xTicks.length).toBeLessThan(many.length);
    expect(layout!.xTicks.length).toBeGreaterThan(0);
  });

  it('cuts a long name and keeps the whole of it for the tooltip', () => {
    const layout = toLayout(barData([bucket('A very long assignee name', 1)]));

    expect(layout!.xTicks[0]!.short).toHaveLength(10);
    expect(layout!.xTicks[0]!.label).toBe('A very long assignee name');
  });

  it('carries a y scale and gridlines', () => {
    const layout = toLayout(barData([bucket('Ada', 4)]));

    expect(layout!.yTicks.map((tick) => tick.label)).toEqual(['4', '2']);
    expect(layout!.gridlines).toHaveLength(3);
  });

  it('dates the burn-up, which is the whole of "over time"', () => {
    const layout = toLayout({
      ...barData([]),
      measure: 'burnUp',
      chart: 'area',
      unit: 'completed',
      burn: [
        { period: '2026-06', completed: 1 },
        { period: '2026-07', completed: 4 },
        { period: '2026-08', completed: 9 },
      ],
    });

    expect(layout!.xTicks.map((tick) => tick.label)).toEqual(['2026-06', '2026-07', '2026-08']);
  });
});

describe('formatTotal', () => {
  it('writes one issue as one issue', () => {
    expect(formatTotal(1, 'issues')).toBe('1 issue');
    expect(formatTotal(4, 'issues')).toBe('4 issues');
  });

  it('leaves a unit it does not know alone rather than inventing a singular', () => {
    expect(formatTotal(1, 'effort')).toBe('1 effort');
    expect(formatTotal(1, 'completed points')).toBe('1 completed points');
  });
});
