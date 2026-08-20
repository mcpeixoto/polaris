/**
 * Insights panel for an issue view: measure × slice over the replica.
 */

import { useState } from 'react';

import { Button, Checkbox, Select } from '~/components';
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
  type BurnPeriod,
  type InsightMeasure,
  type InsightSlice,
} from './computeInsights';
import { InsightChart, formatTotal, formatValue } from './InsightChart';
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
  const [includeArchived, setIncludeArchived] = useState(false);
  const [burnPeriod, setBurnPeriod] = useState<BurnPeriod>('month');
  const idsKey = issueIds.join(',');

  const data = useLiveQuery(
    (store) =>
      buildInsights(store, issueIds, measure, slice, Date.now(), { includeArchived, burnPeriod }),
    [
      'issue',
      'team',
      'user',
      'workflowState',
      'label',
      'issueLabel',
      'project',
      'cycle',
      'issueTemplate',
    ],
    [idsKey, measure, slice, includeArchived, burnPeriod],
  );

  const applyBucket = (clause: NonNullable<(typeof data.buckets)[number]['filter']>) => {
    onFilter(andFilterClause(filter, clause));
  };

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
        {measure === 'burnUp' ? (
          <Select
            label="Burn-up period"
            hideLabel
            value={burnPeriod}
            onChange={(event) => setBurnPeriod(event.target.value as BurnPeriod)}
          >
            <option value="month">Monthly</option>
            <option value="week">Weekly</option>
          </Select>
        ) : (
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
        <Checkbox
          label="Show archived"
          checked={includeArchived}
          onChange={(event) => setIncludeArchived(event.target.checked)}
        />
        <span className={styles.total}>{formatTotal(data.total, data.unit)}</span>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Close
        </Button>
      </div>

      <InsightChart
        data={data}
        onSelect={(bucket) => {
          if (bucket.filter !== null) applyBucket(bucket.filter);
        }}
      />

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
                      onClick={() => applyBucket(bucket.filter!)}
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
