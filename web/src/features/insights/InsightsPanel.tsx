/**
 * Insights panel for an issue view: measure × slice over the replica.
 *
 * There is deliberately no "show archived" control, and `docs/01-features/12-analytics-*.md`
 * records why rather than listing it as a feature. Archiving an issue emits a *delete* to
 * every client — `Service.ArchiveIssue`: "archived issues are never part of the bootstrap
 * snapshot" — which is the same decision `02-issues.md` states as "deliberately loaded on
 * demand rather than kept in the client cache". So there is nothing archived in the store for
 * this panel to widen to, on any view, and the checkbox that used to sit here measured the
 * same issues whether it was ticked or not.
 *
 * Fetching the archive per team and merging it in is not the missing patch, either: the rows
 * `archivedIssues` returns arrive without their label and customer-request edges, so every
 * slice but assignee, priority, team and status type would file archived work under "No
 * label" and "No customer". That is a chart that lies rather than one that omits. Archived
 * work is reachable — the team's archives page — and this panel says so by not pretending.
 */

import { useEffect, useState } from 'react';

import { Button, Select } from '~/components';
import type { FilterNode } from '~/filter';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import { useViewer } from '~/hooks/useViewer';
import type { UUID } from '~/store';

import {
  CUSTOMER_INSIGHT_SLICES,
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
  const viewer = useViewer();
  const hideCustomers = viewer === null || viewer.role === 'guest';
  const slices = hideCustomers
    ? INSIGHT_SLICES.filter((value) => !CUSTOMER_INSIGHT_SLICES.includes(value))
    : INSIGHT_SLICES;
  const [measure, setMeasure] = useState<InsightMeasure>('count');
  const [slice, setSlice] = useState<InsightSlice>('assignee');
  const [burnPeriod, setBurnPeriod] = useState<BurnPeriod>('month');
  const idsKey = issueIds.join(',');

  useEffect(() => {
    if (!slices.includes(slice)) setSlice('assignee');
  }, [slices, slice]);

  const data = useLiveQuery(
    (store) =>
      buildInsights(
        store,
        issueIds,
        measure,
        slices.includes(slice) ? slice : 'assignee',
        Date.now(),
        { burnPeriod },
      ),
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
      'customer',
      'customerRequest',
    ],
    [idsKey, measure, slice, burnPeriod, hideCustomers],
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
            {slices.map((value) => (
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

      <InsightChart
        data={data}
        onSelect={(bucket) => {
          if (bucket.filter !== null) applyBucket(bucket.filter);
        }}
      />

      {data.chart === 'scatter' && data.percentiles.length > 0 && (
        <p className={styles.caption}>
          Each dot is one issue. The dashed lines are the 25th, 50th, 75th and 95th percentiles.
        </p>
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
