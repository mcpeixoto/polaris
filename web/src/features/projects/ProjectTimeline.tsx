/**
 * Projects timeline — Gantt bars, milestones and dependency lines from the local replica.
 *
 * The dependency arcs are the reason this view exists rather than the list, and until now
 * the only thing separating a satisfied arc from a violated one was its colour. They are
 * drawn dashed and heavier when violated, and each arc carries a `<title>` naming both
 * projects and saying "violated" or "satisfied" in words, so the drawing does not depend on
 * the reader being able to tell accent from red.
 */

import { useCallback, useMemo, useRef } from 'react';
import { Link } from 'react-router';

import { Button, EmptyState } from '~/components';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import type { UUID } from '~/store';

import { buildProjectTimeline } from './computeProjectTimeline';
import type { ProjectDependencyFilter } from './dependencyHelpers';
import type { ProjectCustomerFilter } from './customerFilter';
import type { ProjectStatusFilter } from './display';
import type { RequiredProjectDisplay } from './ProjectDisplayMenu';
import styles from './ProjectTimeline.module.css';

export interface ProjectTimelineProps {
  readonly teamId: UUID | undefined;
  readonly depFilter: ProjectDependencyFilter;
  readonly customerFilter?: ProjectCustomerFilter;
  readonly statusFilter?: ProjectStatusFilter;
  readonly display: RequiredProjectDisplay;
  /**
   * Reset the toolbar's filters. The timeline does not own them, so an empty timeline
   * cannot clear them by itself — and "no projects match" with no way out is the dead end
   * the empty-state rule is about.
   */
  onClearFilters?: (() => void) | undefined;
}

export function ProjectTimeline({
  teamId,
  depFilter,
  customerFilter = 'all',
  statusFilter = 'all',
  display,
  onClearFilters,
}: ProjectTimelineProps) {
  const data = useLiveQuery(
    (store) =>
      buildProjectTimeline(
        store,
        teamId,
        depFilter,
        display.zoom,
        display.showMilestones,
        display.showDependencies,
        customerFilter,
        statusFilter,
      ),
    [
      'project',
      'projectStatus',
      'projectTeam',
      'projectDependency',
      'projectMilestone',
      'issue',
      'customer',
      'customerRequest',
    ],
    [
      teamId ?? '',
      depFilter,
      customerFilter,
      statusFilter,
      display.zoom,
      display.showMilestones,
      display.showDependencies,
    ],
  );

  // The label column and the date canvas are two scroll containers side by side, because
  // only one of them scrolls sideways. That makes their vertical positions independent,
  // which is wrong: a Gantt row is a name *and* a bar, and once the canvas has scrolled a
  // row or two the name beside a bar is somebody else's project. Nothing about the drawing
  // is off — the reader is simply told the wrong thing, which is worse than a visible
  // glitch. So the two panes share one vertical offset, whichever of them was scrolled.
  const sidebarRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);

  // Assigning `scrollTop` fires the other pane's scroll event, so the guard is what stops
  // the two handlers bouncing a value between them forever.
  const syncScroll = useCallback((from: HTMLDivElement | null, to: HTMLDivElement | null) => {
    if (from === null || to === null) return;
    if (to.scrollTop !== from.scrollTop) to.scrollTop = from.scrollTop;
  }, []);

  const onCanvasScroll = useCallback(
    () => syncScroll(canvasRef.current, sidebarRef.current),
    [syncScroll],
  );
  const onSidebarScroll = useCallback(
    () => syncScroll(sidebarRef.current, canvasRef.current),
    [syncScroll],
  );

  // An arc knows the two project ids and nothing else; the names are on the rows. Built
  // once per render rather than searched per arc, because a dense team draws hundreds.
  const nameOf = useMemo(() => {
    const names = new Map<UUID, string>();
    for (const bar of data.bars) names.set(bar.projectId, bar.name);
    for (const row of data.unscheduled) names.set(row.id, row.name);
    return (id: UUID) => names.get(id) ?? 'a project';
  }, [data.bars, data.unscheduled]);

  const filtered = depFilter !== 'all' || customerFilter !== 'all' || statusFilter !== 'all';

  if (data.bars.length === 0 && data.unscheduled.length === 0) {
    return (
      <EmptyState
        title={filtered ? 'Nothing matches these filters' : 'No projects on this timeline'}
        description={
          filtered
            ? 'Every project here is excluded by the filters above.'
            : 'A project draws as a bar once it has a start and a target date. Set both in the project’s properties rail, and it appears here.'
        }
        action={
          filtered && onClearFilters !== undefined ? (
            <Button variant="secondary" onClick={onClearFilters}>
              Clear the filters
            </Button>
          ) : undefined
        }
      />
    );
  }

  return (
    <div
      className={`${styles.timeline ?? ''} ${styles.enter ?? ''}`}
      aria-label="Projects timeline"
    >
      <div className={styles.body}>
        <div ref={sidebarRef} className={styles.sidebar} onScroll={onSidebarScroll}>
          <div className={styles.sidebarHeader}>Project</div>
          {data.bars.map((bar) => (
            <Link
              key={bar.projectId}
              to={`/project/${bar.projectId}`}
              className={styles.sidebarRow}
            >
              <span className={styles.mark} style={{ background: bar.color }} aria-hidden="true" />
              <span className={styles.sidebarName}>{bar.name}</span>
              <span className={styles.sidebarStatus}>{bar.statusName}</span>
            </Link>
          ))}
          {data.unscheduled.length > 0 && (
            <>
              <div className={styles.sidebarHeader}>Unscheduled</div>
              {data.unscheduled.map((row) => (
                <Link key={row.id} to={`/project/${row.id}`} className={styles.sidebarRow}>
                  <span
                    className={styles.mark}
                    style={{ background: row.color }}
                    aria-hidden="true"
                  />
                  <span className={styles.sidebarName}>{row.name}</span>
                  <span className={styles.sidebarStatus}>{row.statusName}</span>
                </Link>
              ))}
            </>
          )}
        </div>

        <div ref={canvasRef} className={styles.canvas} onScroll={onCanvasScroll}>
          <div
            className={styles.grid}
            style={{ width: data.totalWidth, minHeight: data.totalHeight }}
          >
            <div className={styles.months} aria-hidden="true">
              {data.months.map((month) => (
                <span
                  key={`${month.label}-${month.x}`}
                  className={styles.month}
                  style={{ left: month.x }}
                >
                  {month.label}
                </span>
              ))}
            </div>

            {data.bars.map((bar) => (
              <div key={bar.projectId} className={styles.row}>
                <div
                  className={styles.bar}
                  style={{ left: bar.x, width: bar.width, background: bar.color }}
                  title={`${bar.name}: ${bar.startDay} → ${bar.endDay}`}
                >
                  <Link
                    to={`/project/${bar.projectId}`}
                    className={styles.barLink}
                    aria-label={`${bar.name}, ${bar.startDay} to ${bar.endDay}`}
                  />
                  {bar.milestones.map((milestone) => (
                    <span
                      key={milestone.id}
                      className={styles.milestone}
                      style={{ left: milestone.x }}
                      // A tick is a hairline with a tooltip, which is a name only a pointer
                      // can read. `role="img"` plus the label gives the same fact to a
                      // screen reader walking the bar.
                      role="img"
                      title={`${milestone.name} — ${milestone.day}`}
                      aria-label={`Milestone ${milestone.name}, ${milestone.day}`}
                    />
                  ))}
                </div>
              </div>
            ))}

            {data.dependencies.length > 0 && (
              <svg className={styles.deps} width={data.totalWidth} height={data.totalHeight}>
                {data.dependencies.map((dep) => (
                  <path
                    key={dep.depId}
                    d={dependencyPath(dep.x1, dep.y1, dep.x2, dep.y2)}
                    className={dep.violated ? styles.depViolated : styles.depSatisfied}
                  >
                    <title>
                      {nameOf(dep.blockingProjectId)} blocks {nameOf(dep.blockedProjectId)} —{' '}
                      {dep.violated ? 'dates violate this dependency' : 'dates satisfy this'}
                    </title>
                  </path>
                ))}
              </svg>
            )}
          </div>
        </div>
      </div>

      {data.bars.length === 0 && data.unscheduled.length > 0 && (
        <p className={styles.muted}>
          {data.unscheduled.length === 1
            ? '1 project has'
            : `${data.unscheduled.length} projects have`}{' '}
          no dates — listed under Unscheduled.
        </p>
      )}
    </div>
  );
}

function dependencyPath(x1: number, y1: number, x2: number, y2: number): string {
  const midX = x1 + (x2 - x1) / 2;
  return `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`;
}
