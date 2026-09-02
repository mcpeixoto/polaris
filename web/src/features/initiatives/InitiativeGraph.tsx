/**
 * Initiative graph — one cumulative completed-issue curve per project.
 *
 * The curves are separated by stroke pattern rather than by hue, and the legend below draws
 * the same patterns. That is `CycleGraph`'s answer to the same problem, and it is the only
 * one available here: distinguishing series by colour would need a chart ramp the token file
 * does not have, and the ramps it does have are spoken for — priority means urgency and the
 * state tokens mean workflow state, so borrowing either would let a theme that recolours one
 * silently recolour this. Four patterns cycle; past four projects the legend's numbers are
 * what separates them, which is what a reader is looking at by then anyway.
 *
 * The whole plot is one `role="img"` with a written name, so a screen reader hears what the
 * chart says rather than a list of unlabelled paths.
 */

import { useMemo } from 'react';

import { useLiveQuery } from '~/hooks/useLiveQuery';
import type { UUID } from '~/store';

import { buildInitiativeGraph, type InitiativeGraphData } from './computeInitiativeGraph';
import styles from './InitiativeGraph.module.css';

const WIDTH = 320;
const HEIGHT = 96;

/** Four silhouettes, cycled. Index into the stylesheet's series classes. */
const SERIES_CLASS = [styles.series0, styles.series1, styles.series2, styles.series3];

interface InitiativeGraphProps {
  readonly initiativeId: UUID;
}

export function InitiativeGraph({ initiativeId }: InitiativeGraphProps) {
  const data = useLiveQuery(
    (store) => buildInitiativeGraph(store, initiativeId),
    ['initiative', 'initiativeProject', 'initiativeRelation', 'project', 'issue'],
    [initiativeId],
  );

  const paths = useMemo(() => (data === null ? null : toPaths(data)), [data]);

  if (data === null || paths === null || data.weekStarts.length < 2) {
    return <p className={styles.muted}>Not enough history to chart this initiative yet.</p>;
  }

  return (
    <div className={styles.panel}>
      <div className={styles.meta}>
        <span className={styles.stat}>
          Completed <strong>{data.totalCompleted}</strong> / {data.totalScope} issues
        </span>
        <span className={styles.stat}>
          {data.series.length === 1 ? '1 project' : `${data.series.length} projects`}
        </span>
      </div>
      <svg
        className={styles.chart}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={describe(data)}
      >
        {paths.map((path, index) => (
          <path
            key={path.projectId}
            d={path.d}
            className={`${styles.line ?? ''} ${SERIES_CLASS[index % SERIES_CLASS.length] ?? ''}`}
          />
        ))}
      </svg>
      <ul className={styles.legend}>
        {data.series.map((row, index) => (
          <li key={row.projectId} className={styles.legendItem}>
            <svg className={styles.swatch} viewBox="0 0 16 2" aria-hidden="true">
              <path
                d="M0 1 H16"
                className={`${styles.line ?? ''} ${SERIES_CLASS[index % SERIES_CLASS.length] ?? ''}`}
              />
            </svg>
            <span className={styles.legendName}>{row.name}</span>
            <span className={styles.legendStat}>
              {row.completed}/{row.total}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The chart in words, for the reader who never sees it.
 *
 * The per-project totals rather than the shape of each line: "how much of this is done, and
 * which projects is it in" is the question the picture answers, and a description of curves
 * would be a description of the drawing instead of of the data.
 */
function describe(data: InitiativeGraphData): string {
  const head = `Initiative graph: ${data.totalCompleted} of ${data.totalScope} issues completed across ${
    data.series.length === 1 ? '1 project' : `${data.series.length} projects`
  }`;
  const parts = data.series.map((row) => `${row.name} ${row.completed} of ${row.total}`);
  return `${head}. ${parts.join(', ')}.`;
}

function toPaths(data: InitiativeGraphData): { projectId: UUID; d: string }[] {
  const span = Math.max(1, data.weekStarts.length - 1);
  const top = Math.max(1, data.peak);
  return data.series.map((row) => ({
    projectId: row.projectId,
    d: row.weeks
      .map((week, index) => {
        const x = (index / span) * WIDTH;
        const y = HEIGHT - (week.completed / top) * HEIGHT;
        return `${index === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`;
      })
      .join(' '),
  }));
}
