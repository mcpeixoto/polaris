/**
 * Project progress graph — scope, started and completed at weekly granularity.
 *
 * Every series on the canvas has a line in the legend, and every legend swatch draws the
 * stroke pattern its series is actually drawn with. The prediction was the one series with
 * no legend entry at all: a dashed accent line running off past the last week of data, the
 * single most consequential mark on the chart, and nothing on screen said what it was.
 *
 * It also had no axes. Three curves floated in an unlabelled box, stretched by
 * `preserveAspectRatio="none"` so the same slope meant a different rate in a wide panel
 * than in a narrow one, and the per-period bars `computeProjectGraph` had been computing
 * all along were drawn by nobody. A chart whose numbers cannot be read off it is a
 * decoration; the scale, the dates and the bars are what make this one a chart.
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
        role="img"
        aria-label={`Project graph showing ${data.totalCompleted} of ${data.totalScope} ${unit} completed`}
      >
        {/* The scale first, under everything, so a gridline never crosses a series. */}
        {layout.yTicks.map((tick) => (
          <g key={tick.value}>
            <line
              x1={layout.left}
              x2={layout.width - layout.right}
              y1={tick.y}
              y2={tick.y}
              className={styles.grid}
            />
            <text x={layout.left - 4} y={tick.y + 3} className={styles.axisLabel} textAnchor="end">
              {tick.value}
            </text>
          </g>
        ))}
        {layout.xTicks.map((tick) => (
          <text
            key={tick.day}
            x={tick.x}
            y={layout.height - 6}
            className={styles.axisLabel}
            textAnchor={tick.anchor}
          >
            {formatDay(tick.day)}
          </text>
        ))}
        {/* Work finished in each week, which is the one thing the cumulative lines cannot
            show: three flat weeks and a busy one all read as the same rising curve. */}
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
        {layout.targetX !== undefined && (
          <>
            <line
              x1={layout.targetX}
              x2={layout.targetX}
              y1={layout.top}
              y2={layout.height - layout.bottom}
              className={styles.target}
            />
            <text
              x={layout.targetX - 3}
              y={layout.top + 8}
              className={styles.targetLabel}
              textAnchor="end"
            >
              Target
            </text>
          </>
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
        {data.prediction !== undefined && (
          <span className={styles.legendItem}>
            <span className={`${styles.swatch} ${styles.predictionSwatch}`} aria-hidden="true" />
            Predicted
          </span>
        )}
        {data.targetDate !== undefined && (
          <span className={styles.legendItem}>
            <span className={`${styles.swatch} ${styles.targetSwatch}`} aria-hidden="true" />
            Target
          </span>
        )}
      </div>
      {data.assignees.length > 0 && (
        <ul className={styles.assignees} aria-label="Distribution">
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
  left: number;
  right: number;
  top: number;
  bottom: number;
  scope: string;
  started: string;
  completed: string;
  bars: readonly { day: string; x: number; y: number; width: number; height: number }[];
  yTicks: readonly { value: number; y: number }[];
  xTicks: readonly { day: string; x: number; anchor: 'start' | 'middle' | 'end' }[];
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

/*
 * The canvas is 720 by 220 user units and scales uniformly, which is what makes the slope
 * of a line mean something: under `preserveAspectRatio="none"` the same two weeks of
 * progress rose steeply in the properties rail and gently on the overview. 720 also puts
 * the scale near 1:1 at the widths this panel is actually laid out at, so the axis text is
 * the size the token says it is rather than whatever the stretch made of it.
 */
function toLayout(data: ProjectGraphData): Layout | null {
  const width = 720;
  const height = 220;
  const left = 34;
  const right = 10;
  const top = 12;
  const bottom = 26;
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
    return left + (index / span) * (width - left - right);
  };

  const y = (value: number) => height - bottom - (value / maxY) * (height - top - bottom);

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

  // A bar per week, sized to the gap between two weeks so a long project's bars stay
  // separated and a four-week one does not draw four slabs.
  const step = data.weeks.length < 2 ? width : xForDay(data.weeks[1]!.weekStart) - xForDay(first);
  const barWidth = Math.max(1, Math.min(14, step * 0.55));
  const baseline = y(0);
  const bars = data.weeks
    .filter((week) => week.completedDelta > 0)
    .map((week) => {
      const top_ = y(week.completedDelta);
      return {
        day: week.weekStart,
        x: xForDay(week.weekStart) - barWidth / 2,
        y: top_,
        width: barWidth,
        height: Math.max(1, baseline - top_),
      };
    });

  // Three ticks — nothing, half, all — because a chart this size cannot carry more without
  // the labels touching, and those three are the ones anybody reads off it.
  const yTicks = [0, Math.round(maxY / 2), maxY]
    .filter((value, index, all) => all.indexOf(value) === index)
    .map((value) => ({ value, y: y(value) }));

  // First, last, and the middle if there is room. The end labels are anchored inward so
  // they cannot hang off the canvas.
  const xTicks: Layout['xTicks'] = [
    { day: first, x: xForDay(first), anchor: 'start' as const },
    ...(span > 21
      ? [
          {
            day: middleDay(first, span),
            x: xForDay(middleDay(first, span)),
            anchor: 'middle' as const,
          },
        ]
      : []),
    { day: last, x: xForDay(last), anchor: 'end' as const },
  ];

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

  return {
    width,
    height,
    left,
    right,
    top,
    bottom,
    scope,
    started,
    completed,
    bars,
    yTicks,
    xTicks,
    targetX,
    prediction,
    y,
  };
}

/** The day halfway along the plotted span, for the middle x-axis label. */
function middleDay(first: string, span: number): string {
  const date = new Date(`${first}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + Math.round(span / 2));
  return date.toISOString().slice(0, 10);
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
