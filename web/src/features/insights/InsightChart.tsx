/**
 * Shared Insights chart: bar / scatter / area over computeInsights output.
 */

import { useMemo, type KeyboardEvent } from 'react';

import type { InsightBucket, InsightData } from './computeInsights';
import { MEASURE_LABELS, SLICE_LABELS } from './computeInsights';
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

  return (
    <svg
      className={styles.chart}
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      role="img"
      aria-label={`${MEASURE_LABELS[data.measure]} by ${SLICE_LABELS[data.slice]}`}
    >
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
              onKeyDown={clickable ? (event) => onBarKey(event, bar.bucket) : undefined}
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
            <line
              key={line.key}
              x1={line.x1}
              x2={line.x2}
              y1={line.y}
              y2={line.y}
              className={styles.percentile}
            />
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
  return `${formatValue(total, unit)} ${unit}`;
}

export function formatValue(value: number, unit: string): string {
  if (unit === 'days') return Number.isInteger(value) ? `${value}d` : `${value.toFixed(1)}d`;
  return String(value);
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
  readonly lines: readonly { key: string; x1: number; x2: number; y: number }[];
}

export function toLayout(data: InsightData): Layout | null {
  const width = 360;
  const height = 96;
  const pad = 8;

  if (data.chart === 'bar') {
    if (data.buckets.length === 0) return null;
    const max = Math.max(...data.buckets.map((bucket) => bucket.value), 1);
    const gap = 2;
    const barWidth = Math.max(4, (width - pad * 2) / data.buckets.length - gap);
    return {
      width,
      height,
      kind: 'bar',
      bars: data.buckets.map((bucket, index) => {
        const h = (bucket.value / max) * (height - pad * 2);
        return {
          key: bucket.key,
          x: pad + index * (barWidth + gap),
          y: height - pad - h,
          width: barWidth,
          height: Math.max(1, h),
          bucket,
        };
      }),
      path: '',
      dots: [],
      lines: [],
    };
  }

  if (data.chart === 'area') {
    if (data.burn.length < 2) return null;
    const max = Math.max(...data.burn.map((point) => point.completed), 1);
    const last = data.burn.length - 1;
    const x = (index: number) => pad + (index / last) * (width - pad * 2);
    const y = (value: number) => height - pad - (value / max) * (height - pad * 2);
    const line = data.burn
      .map((point, index) => `${index === 0 ? 'M' : 'L'} ${x(index)} ${y(point.completed)}`)
      .join(' ');
    const path = `${line} L ${x(last)} ${height - pad} L ${x(0)} ${height - pad} Z`;
    return { width, height, kind: 'area', bars: [], path, dots: [], lines: [] };
  }

  if (data.scatter.length === 0) return null;
  const keys = data.buckets.map((bucket) => bucket.key);
  const maxY = Math.max(...data.scatter.map((point) => point.days), 1);
  const lastX = Math.max(keys.length - 1, 1);
  const yOf = (value: number) => height - pad - (value / maxY) * (height - pad * 2);
  return {
    width,
    height,
    kind: 'scatter',
    bars: [],
    path: '',
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
    })),
  };
}
