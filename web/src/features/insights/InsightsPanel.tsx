/**
 * Insights panel for an issue view: measure × slice over the replica.
 */

import { useState } from 'react';

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
  const idsKey = issueIds.join(',');

  const data = useLiveQuery(
    (store) => buildInsights(store, issueIds, measure, slice),
    ['issue', 'team', 'user', 'workflowState', 'label', 'issueLabel', 'project'],
    [idsKey, measure, slice],
  );

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

      <InsightChart data={data} />

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
