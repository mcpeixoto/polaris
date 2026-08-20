/**
 * Insights panel for an issue view: measure × slice over the replica.
 */

import { useMemo, useState } from 'react';

import { Button, Select } from '~/components';
import type { FilterNode } from '~/filter';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import type { UUID } from '~/store';

import {
  INSIGHT_MEASURES,
  INSIGHT_SLICES,
  MEASURE_LABELS,
  SLICE_LABELS,
  andFilterClause,
  buildInsights,
  type InsightData,
  type InsightMeasure,
  type InsightSlice,
} from './computeInsights';
import styles from './InsightsPanel.module.css';

interface InsightsPanelProps {
  readonly issueIds: readonly UUID[];
  readonly filter: FilterNode;
  onFilter(next: FilterNode): void;
  onClose(): void;
}

export function InsightsPanel({ issueIds, filter, onFilter, onClose }: InsightsPanelProps) {
  const [measure, setMeasure] = useState<InsightMeasure>('count');
  const [slice, setSlice] = useState<InsightSlice>('assignee');
  const idsKey = issueIds.join(',');

  const data = useLiveQuery(
    (store) => buildInsights(store, issueIds, measure, slice),
    ['issue', 'team', 'user', 'workflowState', 'label', 'issueLabel', 'project'],
    [idsKey, measure, slice],
  );

  const layout = useMemo(() => toLayout(data), [data]);

  return (
    <section className={styles.panel} aria-label="Insights">
      <div className={styles.toolbar}>
        <h2 className={styles.title}>Insights</h2>
        <Select
          label="Measure"
          hideLabel
          value={measure}
          onChange={(event) => setMeasure(event.target.value as InsightMeasure)}
        >
          {INSIGHT_MEASURES.map((value) => (
            <option key={value} value={value}>
              {MEASURE_LABELS[value]}
            </option>
          ))}
        </Select>
        {measure !== 'burnUp' && (
          <Select
            label="Slice"
            hideLabel
            value={slice}
            onChange={(event) => setSlice(event.target.value as InsightSlice)}
          >
            {INSIGHT_SLICES.map((value) => (
              <option key={value} value={value}>
                {SLICE_LABELS[value]}
              </option>
            ))}
          </Select>
        )}
        <span className={styles.total}>{formatTotal(data.total, data.unit)}</span>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Close
        </Button>
      </div>

      {layout === null ? (
        <p className={styles.empty}>Nothing in this view to chart yet.</p>
      ) : (
        <svg
          className={styles.chart}
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          role="img"
          aria-label={`${MEASURE_LABELS[data.measure]} by ${SLICE_LABELS[data.slice]}`}
        >
          {layout.kind === 'bar' &&
            layout.bars.map((bar) => (
              <rect
                key={bar.key}
                x={bar.x}
                y={bar.y}
                width={bar.width}
                height={bar.height}
                className={styles.bar}
              />
            ))}
          {layout.kind === 'area' && <path d={layout.path} className={styles.area} />}
          {layout.kind === 'scatter' &&
            layout.dots.map((dot) => (
              <circle key={dot.key} cx={dot.x} cy={dot.y} r={2.2} className={styles.dot} />
            ))}
        </svg>
      )}

      {data.chart !== 'area' && data.buckets.length > 0 && (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>{SLICE_LABELS[data.slice]}</th>
              <th>{data.unit}</th>
              <th>Issues</th>
            </tr>
          </thead>
          <tbody>
            {data.buckets.map((bucket) => (
              <tr key={bucket.key}>
                <td>
                  {bucket.filter === null ? (
                    bucket.label
                  ) : (
                    <button
                      type="button"
                      className={styles.filter}
                      onClick={() => onFilter(andFilterClause(filter, bucket.filter!))}
                    >
                      {bucket.label}
                    </button>
                  )}
                </td>
                <td>{formatValue(bucket.value, data.unit)}</td>
                <td>{bucket.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function formatTotal(total: number, unit: string): string {
  if (unit === 'days') return `${formatValue(total, unit)} avg`;
  return `${formatValue(total, unit)} ${unit}`;
}

function formatValue(value: number, unit: string): string {
  if (unit === 'days') return Number.isInteger(value) ? `${value}d` : `${value.toFixed(1)}d`;
  return String(value);
}

interface Layout {
  readonly width: number;
  readonly height: number;
  readonly kind: 'bar' | 'area' | 'scatter';
  readonly bars: readonly { key: string; x: number; y: number; width: number; height: number }[];
  readonly path: string;
  readonly dots: readonly { key: string; x: number; y: number }[];
}

function toLayout(data: InsightData): Layout | null {
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
        };
      }),
      path: '',
      dots: [],
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
    return { width, height, kind: 'area', bars: [], path, dots: [] };
  }

  if (data.scatter.length === 0) return null;
  const keys = data.buckets.map((bucket) => bucket.key);
  const maxY = Math.max(...data.scatter.map((point) => point.days), 1);
  const lastX = Math.max(keys.length - 1, 1);
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
        y: height - pad - (point.days / maxY) * (height - pad * 2),
      };
    }),
  };
}
