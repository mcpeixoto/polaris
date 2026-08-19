/**
 * Cycle burn-up chart — scope and completed cumulative lines.
 */

import { useMemo } from 'react';

import { useLiveQuery } from '~/hooks/useLiveQuery';
import type { UUID } from '~/store';

import { buildCycleGraph, type CycleGraphData } from './computeCycleGraph';
import styles from './CycleGraph.module.css';

interface CycleGraphProps {
  readonly cycleId: UUID;
}

export function CycleGraph({ cycleId }: CycleGraphProps) {
  const data = useLiveQuery(
    (store) => buildCycleGraph(store, cycleId),
    ['cycle', 'issue', 'team', 'workflowState'],
    [cycleId],
  );

  const paths = useMemo(() => (data === null ? null : toPaths(data)), [data]);

  if (data === null || paths === null || data.points.length < 2) {
    return (
      <p className={styles.muted}>Not enough data to chart this cycle yet.</p>
    );
  }

  const unit = data.unitLabel === 'issues' ? 'issues' : 'points';

  return (
    <section className={styles.panel} aria-label="Cycle graph">
      <div className={styles.meta}>
        <span className={styles.stat}>
          Cycle success <strong>{data.successPercent}%</strong>
        </span>
        <span className={styles.stat}>
          Completed <strong>{data.totalCompleted}</strong> / {data.totalScope} {unit}
        </span>
        {data.totalStarted > 0 && (
          <span className={styles.stat}>
            In progress <strong>{data.totalStarted}</strong> {unit}
          </span>
        )}
      </div>
      <svg
        className={styles.chart}
        viewBox={`0 0 ${paths.width} ${paths.height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`Cycle graph showing ${data.totalCompleted} of ${data.totalScope} ${unit} completed`}
      >
        <path d={paths.scope} className={styles.scope} />
        <path d={paths.completed} className={styles.completed} />
      </svg>
      <div className={styles.legend}>
        <span className={styles.legendItem}>
          <span className={`${styles.swatch} ${styles.scopeSwatch}`} aria-hidden="true" />
          Scope
        </span>
        <span className={styles.legendItem}>
          <span className={`${styles.swatch} ${styles.completedSwatch}`} aria-hidden="true" />
          Completed
        </span>
      </div>
    </section>
  );
}

function toPaths(data: CycleGraphData): {
  width: number;
  height: number;
  scope: string;
  completed: string;
} {
  const width = 320;
  const height = 120;
  const pad = 8;
  const maxY = Math.max(...data.points.map((point) => point.scope), 1);
  const last = data.points.length - 1;

  const x = (index: number) => pad + (index / last) * (width - pad * 2);
  const y = (value: number) => height - pad - (value / maxY) * (height - pad * 2);

  const scope = data.points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${x(index)} ${y(point.scope)}`)
    .join(' ');
  const completed = data.points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${x(index)} ${y(point.completed)}`)
    .join(' ');

  return { width, height, scope, completed };
}
