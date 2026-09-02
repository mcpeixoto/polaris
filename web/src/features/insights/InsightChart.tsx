/**
 * Shared Insights chart: bar / scatter / area over computeInsights output.
 *
 * The chart carries its own axes. A bar chart with no tick labels cannot be read without
 * hovering every bar, which is a chart that only works for someone holding a mouse, and the
 * burn-up showed "completed over time" with no times on it at all. The gutters are small
 * because the panel is narrow: two y labels and up to four x labels, truncated with a
 * `<title>`, rather than a full grid.
 *
 * The accessibility story turns on whether the bars are interactive. `role="img"` makes the
 * SVG a leaf, so a screen reader never reaches the per-bar buttons underneath while the Tab
 * key still does — a keyboard user landing on stops nothing will name. So a chart with an
 * `onSelect` is a `group` whose children are real buttons, and a chart without one stays an
 * image with a written label.
 */

import { useMemo, type KeyboardEvent } from 'react';

import type { InsightBucket, InsightData } from './computeInsights';
import { MEASURE_LABELS, SLICE_LABELS } from './computeInsights';
import { unitFor } from './plural';
import styles from './InsightsPanel.module.css';

interface InsightChartProps {
  readonly data: InsightData;
  onSelect?(bucket: InsightBucket): void;
}

export function InsightChart({ data, onSelect }: InsightChartProps) {
  const layout = useMemo(() => toLayout(data), [data]);
  if (layout === null) {
    return <p className={styles.empty}>Nothing in this view to chart yet.</p>;
  }

  const activate = (bucket: InsightBucket) => {
    if (bucket.filter === null || onSelect === undefined) return;
    onSelect(bucket);
  };

  const onBarKey = (event: KeyboardEvent<SVGRectElement>, bucket: InsightBucket) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    activate(bucket);
  };

  const label = `${MEASURE_LABELS[data.measure]} by ${SLICE_LABELS[data.slice]}`;
  const interactive = onSelect !== undefined;

  return (
    <svg
      className={styles.chart}
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      role={interactive ? 'group' : 'img'}
      aria-label={label}
    >
      {layout.gridlines.map((line) => (
        <line
          key={`grid-${line.y}`}
          x1={line.x1}
          x2={line.x2}
          y1={line.y}
          y2={line.y}
          className={styles.gridline}
        />
      ))}
      {layout.yTicks.map((tick) => (
        <text key={`y-${tick.label}`} x={tick.x} y={tick.y} className={styles.tickY}>
          {tick.label}
        </text>
      ))}
      {layout.xTicks.map((tick) => (
        <text key={`x-${tick.key}`} x={tick.x} y={tick.y} className={styles.tickX}>
          {tick.short}
          {tick.short === tick.label ? null : <title>{tick.label}</title>}
        </text>
      ))}
      {layout.kind === 'bar' &&
        layout.bars.map((bar) => {
          const clickable = bar.bucket.filter !== null && onSelect !== undefined;
          return (
            <rect
              key={bar.key}
              x={bar.x}
              y={bar.y}
              width={bar.width}
              height={bar.height}
              className={clickable ? `${styles.bar} ${styles.barClick}` : styles.bar}
              role={clickable ? 'button' : undefined}
              tabIndex={clickable ? 0 : undefined}
              aria-label={
                clickable
                  ? `Filter by ${bar.bucket.label}`
                  : `${bar.bucket.label}: ${bar.bucket.value}`
              }
              onClick={clickable ? () => activate(bar.bucket) : undefined}
              onKeyDown={
                /* keymap-lint-allow: an SVG rect has no native Enter/Space activation */ clickable
                  ? (event) => onBarKey(event, bar.bucket)
                  : undefined
              }
            >
              <title>
                {bar.bucket.label}: {formatValue(bar.bucket.value, data.unit)}
              </title>
            </rect>
          );
        })}
      {layout.kind === 'area' && <path d={layout.path} className={styles.area} />}
      {layout.kind === 'scatter' && (
        <>
          {layout.lines.map((line) => (
            <g key={line.key}>
              <line
                x1={line.x1}
                x2={line.x2}
                y1={line.y}
                y2={line.y}
                className={styles.percentile}
              />
              {/* The prose caption under the chart said which lines these were; a reader
               * still had to count them from the top to tell which was which. */}
              <text x={line.x2} y={line.y - 2} className={styles.tickY} textAnchor="end">
                {line.label}
              </text>
            </g>
          ))}
          {layout.dots.map((dot) => (
            <circle key={dot.key} cx={dot.x} cy={dot.y} r={2.2} className={styles.dot} />
          ))}
        </>
      )}
    </svg>
  );
}

export function formatTotal(total: number, unit: string): string {
  if (unit === 'days') return `${formatValue(total, unit)} avg`;
  // "1 issues" is a machine talking. The unit knows its own singular.
  return `${formatValue(total, unit)} ${unitFor(total, unit)}`;
}

export function formatValue(value: number, unit: string): string {
  if (unit === 'days') return Number.isInteger(value) ? `${value}d` : `${value.toFixed(1)}d`;
  return String(value);
}

interface Tick {
  readonly key: string;
  readonly x: number;
  readonly y: number;
  /** The full value, kept for the `<title>` when the drawn form had to be cut. */
  readonly label: string;
  readonly short: string;
}

interface Layout {
  readonly width: number;
  readonly height: number;
  readonly kind: 'bar' | 'area' | 'scatter';
  readonly bars: readonly {
    key: string;
    x: number;
    y: number;
    width: number;
    height: number;
    bucket: InsightBucket;
  }[];
  readonly path: string;
  readonly dots: readonly { key: string; x: number; y: number }[];
  readonly lines: readonly { key: string; x1: number; x2: number; y: number; label: string }[];
  readonly gridlines: readonly { x1: number; x2: number; y: number }[];
  readonly yTicks: readonly { x: number; y: number; label: string }[];
  readonly xTicks: readonly Tick[];
}

/** Bottom gutter, in viewBox units: one line of x labels under the plot. */
const GUTTER = 14;

/** Long bucket names are cut rather than allowed to collide; the `<title>` keeps the rest. */
function short(label: string): string {
  return label.length <= 10 ? label : `${label.slice(0, 9)}…`;
}

function niceNumber(value: number, unit: string): string {
  if (unit === 'days') return Number.isInteger(value) ? `${value}d` : `${value.toFixed(1)}d`;
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/** Zero, half and full, which is as much scale as a 100px-tall plot can carry legibly. */
function scaleTicks(max: number, unit: string, top: number, bottom: number) {
  const values = [max, max / 2, 0];
  return {
    gridlines: values.map((value) => ({
      x1: PAD,
      x2: WIDTH - PAD,
      y: bottom - (value / max) * (bottom - top),
    })),
    yTicks: values.slice(0, 2).map((value) => ({
      x: PAD,
      y: bottom - (value / max) * (bottom - top) - 2,
      label: niceNumber(value, unit),
    })),
  };
}

const WIDTH = 360;
const PAD = 8;

/** In the order computeInsights emits them: nearest-rank 25 / 50 / 75 / 95. */
const PERCENTILE_LABELS = ['p25', 'p50', 'p75', 'p95'] as const;

export function toLayout(data: InsightData): Layout | null {
  const width = WIDTH;
  // Taller than it was by exactly the gutter, so the plot itself is the size it always was
  // and the axis is added rather than taken out of the data.
  const height = 96 + GUTTER;
  const pad = PAD;
  const bottom = height - pad - GUTTER;

  if (data.chart === 'bar') {
    if (data.buckets.length === 0) return null;
    const max = Math.max(...data.buckets.map((bucket) => bucket.value), 1);
    const gap = 2;
    const barWidth = Math.max(4, (width - pad * 2) / data.buckets.length - gap);
    const scale = scaleTicks(max, data.unit, pad, bottom);
    // Every bucket gets a label where they fit, and every third otherwise: a dozen assignees
    // in 360 units is a row of overlapping words, which reads worse than a sparse axis.
    const step = barWidth < 24 ? Math.ceil(data.buckets.length / 6) : 1;
    return {
      width,
      height,
      kind: 'bar',
      bars: data.buckets.map((bucket, index) => {
        const h = (bucket.value / max) * (bottom - pad);
        return {
          key: bucket.key,
          x: pad + index * (barWidth + gap),
          y: bottom - h,
          width: barWidth,
          height: Math.max(1, h),
          bucket,
        };
      }),
      path: '',
      dots: [],
      lines: [],
      ...scale,
      xTicks: data.buckets
        .map((bucket, index) => ({
          key: bucket.key,
          x: pad + index * (barWidth + gap),
          y: height - 3,
          label: bucket.label,
          short: short(bucket.label),
          index,
        }))
        .filter((tick) => tick.index % step === 0),
    };
  }

  if (data.chart === 'area') {
    if (data.burn.length === 0) return null;
    const max = Math.max(...data.burn.map((point) => point.completed), 1);
    const last = data.burn.length - 1;
    // A single period is the normal case, not an edge one: every workspace spends its
    // first month there, and a weekly burn-up spends its first week there. Dividing by
    // `last` would be a divide by zero, so span it instead — one period draws as a flat
    // band at its cumulative total, which is what the total beside the chart already
    // claims. Returning null here instead said "nothing to chart yet" next to a total
    // reading "6 completed", and the user had just completed those six.
    const x = (index: number) => (last === 0 ? pad : pad + (index / last) * (width - pad * 2));
    const y = (value: number) => bottom - (value / max) * (bottom - pad);
    const right = width - pad;
    const line = data.burn
      .map((point, index) => `${index === 0 ? 'M' : 'L'} ${x(index)} ${y(point.completed)}`)
      .join(' ');
    const flat = last === 0 ? ` L ${right} ${y(data.burn[0]!.completed)}` : '';
    const path = `${line}${flat} L ${last === 0 ? right : x(last)} ${bottom} L ${x(0)} ${bottom} Z`;
    // First, middle and last period. "Completed over time" with no times on it was the
    // whole complaint, and three dates are enough to place the curve.
    const marks = last === 0 ? [0] : last === 1 ? [0, 1] : [0, Math.round(last / 2), last];
    return {
      width,
      height,
      kind: 'area',
      bars: [],
      path,
      dots: [],
      lines: [],
      ...scaleTicks(max, data.unit, pad, bottom),
      xTicks: marks.map((index) => {
        const period = data.burn[index]!.period;
        return {
          key: period,
          x: index === last && last !== 0 ? width - pad - 28 : x(index),
          y: height - 3,
          label: period,
          short: period,
        };
      }),
    };
  }

  if (data.scatter.length === 0) return null;
  const keys = data.buckets.map((bucket) => bucket.key);
  const maxY = Math.max(...data.scatter.map((point) => point.days), 1);
  const lastX = Math.max(keys.length - 1, 1);
  const yOf = (value: number) => bottom - (value / maxY) * (bottom - pad);
  const step = keys.length > 6 ? Math.ceil(keys.length / 6) : 1;
  return {
    width,
    height,
    kind: 'scatter',
    bars: [],
    path: '',
    ...scaleTicks(maxY, data.unit, pad, bottom),
    xTicks: data.buckets
      .map((bucket, index) => ({
        key: bucket.key,
        x: pad + (index / lastX) * (width - pad * 2),
        y: height - 3,
        label: bucket.label,
        short: short(bucket.label),
        index,
      }))
      .filter((tick) => tick.index % step === 0),
    dots: data.scatter.map((point, index) => {
      const bucketIndex = Math.max(keys.indexOf(point.bucketKey), 0);
      return {
        key: `${point.issueId}-${index}`,
        x: pad + (bucketIndex / lastX) * (width - pad * 2),
        y: yOf(point.days),
      };
    }),
    lines: data.percentiles.map((value, index) => ({
      key: `p-${index}`,
      x1: pad,
      x2: width - pad,
      y: yOf(value),
      label: PERCENTILE_LABELS[index] ?? '',
    })),
  };
}
