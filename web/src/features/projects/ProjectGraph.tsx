/**
 * Project progress graph — scope, started and completed at weekly granularity.
 */

import { useMemo } from 'react';

import { useLiveQuery } from '~/hooks/useLiveQuery';
import type { UUID } from '~/store';

import { buildProjectGraph, type ProjectGraphData } from './computeProjectGraph';
import styles from './ProjectGraph.module.css';

interface ProjectGraphProps {
  readonly projectId: UUID;
}

export function ProjectGraph({ projectId }: ProjectGraphProps) {
  const data = useLiveQuery(
    (store) => buildProjectGraph(store, projectId),
    ['project', 'projectStatus', 'issue', 'team', 'workflowState', 'user'],
    [projectId],
  );

  const layout = useMemo(() => (data === null ? null : toLayout(data)), [data]);

  if (data === null) {
    return (
      <p className={styles.muted}>
        The graph appears once a project is in progress and has issues filed to it.
      </p>
    );
  }

  if (layout === null || data.weeks.length < 2) {
    return <p className={styles.muted}>Not enough history to chart this project yet.</p>;
  }

  const unit = data.unitLabel === 'issues' ? 'issues' : 'points';

  return (
    <section className={styles.panel} aria-label="Project graph">
      <div className={styles.meta}>
        <span className={styles.stat}>
          Completed <strong>{data.totalCompleted}</strong> / {data.totalScope} {unit}
        </span>
        {data.totalStarted > data.totalCompleted && (
          <span className={styles.stat}>
            In progress <strong>{data.totalStarted - data.totalCompleted}</strong> {unit}
          </span>
        )}
        {data.prediction !== undefined && (
          <span className={styles.stat}>
            Predicted <strong>{formatDay(data.prediction.date)}</strong>
          </span>
        )}
      </div>
      <svg
        className={styles.chart}
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`Project graph showing ${data.totalCompleted} of ${data.totalScope} ${unit} completed`}
      >
        {layout.targetX !== undefined && (
          <line
            x1={layout.targetX}
            x2={layout.targetX}
            y1={layout.pad}
            y2={layout.height - layout.pad}
            className={styles.target}
          />
        )}
        {layout.prediction !== undefined && (
          <>
            <line
              x1={layout.prediction.optimisticX}
              x2={layout.prediction.pessimisticX}
              y1={layout.y(data.totalScope)}
              y2={layout.y(data.totalScope)}
              className={styles.predictionBand}
            />
            <path d={layout.prediction.path} className={styles.prediction} />
          </>
        )}
        <path d={layout.scope} className={styles.scope} />
        <path d={layout.started} className={styles.started} />
        <path d={layout.completed} className={styles.completed} />
      </svg>
      <div className={styles.legend}>
        <span className={styles.legendItem}>
          <span className={`${styles.swatch} ${styles.scopeSwatch}`} aria-hidden="true" />
          Scope
        </span>
        <span className={styles.legendItem}>
          <span className={`${styles.swatch} ${styles.startedSwatch}`} aria-hidden="true" />
          Started
        </span>
        <span className={styles.legendItem}>
          <span className={`${styles.swatch} ${styles.completedSwatch}`} aria-hidden="true" />
          Completed
        </span>
        {data.targetDate !== undefined && (
          <span className={styles.legendItem}>
            <span className={`${styles.swatch} ${styles.targetSwatch}`} aria-hidden="true" />
            Target
          </span>
        )}
      </div>
      {data.assignees.length > 0 && (
        <ul className={styles.assignees}>
          {data.assignees.map((row) => (
            <li key={row.assigneeId ?? 'none'} className={styles.assigneeRow}>
              <span className={styles.assigneeName}>{row.name}</span>
              <span className={styles.assigneeStat}>
                {row.percent}% · {row.completed}/{row.total} {unit}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

interface Layout {
  width: number;
  height: number;
  pad: number;
  scope: string;
  started: string;
  completed: string;
  targetX: number | undefined;
  prediction:
    | {
        path: string;
        optimisticX: number;
        pessimisticX: number;
      }
    | undefined;
  y: (value: number) => number;
}

function toLayout(data: ProjectGraphData): Layout | null {
  const width = 360;
  const height = 140;
  const pad = 8;
  const maxY = Math.max(...data.weeks.map((week) => week.scope), 1);

  const timeline = [...data.weeks.map((week) => week.weekStart)];
  if (data.prediction !== undefined) {
    timeline.push(data.prediction.optimistic, data.prediction.date, data.prediction.pessimistic);
  }
  if (data.targetDate !== undefined) timeline.push(data.targetDate);
  timeline.sort();

  const first = timeline[0]!;
  const last = timeline[timeline.length - 1]!;
  const span = Math.max(dayIndex(last, first), 1);

  const xForDay = (day: string) => {
    const index = dayIndex(day, first);
    return pad + (index / span) * (width - pad * 2);
  };

  const y = (value: number) => height - pad - (value / maxY) * (height - pad * 2);

  const line = (values: readonly number[]) =>
    data.weeks
      .map(
        (week, index) =>
          `${index === 0 ? 'M' : 'L'} ${xForDay(week.weekStart)} ${y(values[index] ?? 0)}`,
      )
      .join(' ');

  const scope = line(data.weeks.map((week) => week.scope));
  const started = line(data.weeks.map((week) => week.started));
  const completed = line(data.weeks.map((week) => week.completed));

  const targetX = data.targetDate === undefined ? undefined : xForDay(data.targetDate);

  let prediction: Layout['prediction'];
  if (data.prediction !== undefined) {
    const lastWeek = data.weeks[data.weeks.length - 1]!;
    const lastX = xForDay(lastWeek.weekStart);
    const lastY = y(lastWeek.completed);
    const predX = xForDay(data.prediction.date);
    const predY = y(data.totalScope);
    prediction = {
      path: `M ${lastX} ${lastY} L ${predX} ${predY}`,
      optimisticX: xForDay(data.prediction.optimistic),
      pessimisticX: xForDay(data.prediction.pessimistic),
    };
  }

  return { width, height, pad, scope, started, completed, targetX, prediction, y };
}

function dayIndex(day: string, origin: string): number {
  const start = new Date(`${origin}T00:00:00.000Z`).getTime();
  const current = new Date(`${day.slice(0, 10)}T00:00:00.000Z`).getTime();
  return Math.round((current - start) / (24 * 60 * 60 * 1000));
}

function formatDay(day: string): string {
  return new Date(`${day.slice(0, 10)}T00:00:00.000Z`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}
