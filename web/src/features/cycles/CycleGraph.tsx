/**
 * Cycle burn-up — scope, started, completed, and a weekday-flattened target.
 *
 * Two of the three things this can say are "not yet", and both have to be reachable. A
 * cycle that has not started cannot have burnt anything down — the graph is generated once
 * a cycle begins, and until then the capacity dial is the answer — and a cycle with no
 * issues in it has nothing to plot, however long its window is. Drawing either anyway puts
 * a flat line and a *Cycle success 0%* verdict on work nobody could have done yet.
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
    ['cycle', 'issue', 'team', 'workflowState', 'user'],
    [cycleId],
  );

  const layout = useMemo(() => (data === null ? null : toLayout(data)), [data]);

  if (data !== null && Date.parse(data.startsAt) > Date.now()) {
    return <p className={styles.muted}>The graph appears once this cycle begins.</p>;
  }

  if (data === null || layout === null || data.issueCount === 0 || data.points.length < 2) {
    return <p className={styles.muted}>Not enough data to chart this cycle yet.</p>;
  }

  const unit = data.unitLabel === 'issues' ? 'issues' : 'points';
  // A count of one reads as a count, not as a ratio, so it needs the singular.
  const startedUnit =
    data.totalStarted === 1 ? (data.unitLabel === 'issues' ? 'issue' : 'point') : unit;

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
            In progress <strong>{data.totalStarted}</strong> {startedUnit}
          </span>
        )}
      </div>
      <svg
        className={styles.chart}
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`Cycle graph showing ${data.totalCompleted} of ${data.totalScope} ${unit} completed`}
      >
        {layout.bars.map((bar) => (
          <rect
            key={bar.day}
            x={bar.x}
            y={bar.y}
            width={bar.width}
            height={bar.height}
            className={styles.bar}
          />
        ))}
        <path d={layout.scope} className={styles.scope} />
        <path d={layout.target} className={styles.target} />
        <path d={layout.started} className={styles.started} />
        <path d={layout.completed} className={styles.completed} />
      </svg>
      <div className={styles.legend}>
        <span className={styles.legendItem}>
          <span className={`${styles.swatch} ${styles.scopeSwatch}`} aria-hidden="true" />
          Scope
        </span>
        <span className={styles.legendItem}>
          <span className={`${styles.swatch} ${styles.targetSwatch}`} aria-hidden="true" />
          Target
        </span>
        <span className={styles.legendItem}>
          <span className={`${styles.swatch} ${styles.startedSwatch}`} aria-hidden="true" />
          Started
        </span>
        <span className={styles.legendItem}>
          <span className={`${styles.swatch} ${styles.completedSwatch}`} aria-hidden="true" />
          Completed
        </span>
      </div>
      {data.assignees.length > 0 && (
        <ul className={styles.assignees} aria-label="Distribution">
          {data.assignees.map((row) => (
            <li key={row.assigneeId ?? 'unassigned'} className={styles.assigneeRow}>
              <span className={styles.assigneeName}>{row.name}</span>
              <span className={styles.assigneeStat}>
                {row.completed}/{row.total} · {row.percent}%
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function toLayout(data: CycleGraphData): {
  width: number;
  height: number;
  scope: string;
  started: string;
  completed: string;
  target: string;
  bars: readonly { day: string; x: number; y: number; width: number; height: number }[];
} {
  const width = 320;
  const height = 120;
  const pad = 8;
  const maxY = Math.max(
    ...data.points.map((point) => Math.max(point.scope, point.started, point.target)),
    1,
  );
  const last = data.points.length - 1;
  const barWidth = Math.max(1, ((width - pad * 2) / data.points.length) * 0.55);

  const x = (index: number) => pad + (index / last) * (width - pad * 2);
  const y = (value: number) => height - pad - (value / maxY) * (height - pad * 2);

  const line = (value: (point: (typeof data.points)[number]) => number) =>
    data.points
      .map((point, index) => `${index === 0 ? 'M' : 'L'} ${x(index)} ${y(value(point))}`)
      .join(' ');

  const bars = data.points.flatMap((point, index) => {
    if (point.completedDelta <= 0) return [];
    const top = y(point.completed);
    const bottom = y(point.completed - point.completedDelta);
    return [
      {
        day: point.day,
        x: x(index) - barWidth / 2,
        y: top,
        width: barWidth,
        height: Math.max(1, bottom - top),
      },
    ];
  });

  return {
    width,
    height,
    scope: line((point) => point.scope),
    started: line((point) => point.started),
    completed: line((point) => point.completed),
    target: line((point) => point.target),
    bars,
  };
}
