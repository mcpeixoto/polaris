/**
 * Roll-up of each linked project's latest update, one mark per project.
 *
 * This is the densest health indicator in the product — a whole initiative's worth of
 * projects inside one cell of a 32px row — so it cannot spell anything out. It used to
 * carry the meaning entirely in hue, which for a reader who cannot separate amber from
 * green made the strip a row of identical dots. Two things fix that without spending width:
 *
 * The marks differ in *shape* as well as colour — a disc on track, a rounded square at
 * risk, a diamond off track, a hollow ring for a project with no current update — so the
 * strip is readable in greyscale.
 *
 * And the strip as a whole is one `role="img"` with a written tally for its name, so a
 * screen reader hears "4 projects: 2 on track, 1 at risk, 1 with no update" rather than
 * four unlabelled marks or, as before, nothing at all: the per-dot `title` attributes were
 * a pointer-only affordance and the container's name was the constant string "Active
 * project health", which is the column heading and not the value.
 */

import type { ProjectUpdateHealth } from '~/store';

import { PROJECT_UPDATE_HEALTH_TOKEN } from '~/features/project-updates/helpers';
import { INITIATIVE_UPDATE_HEALTH_LABEL } from './helpers';
import type { LinkedProjectHealth } from './helpers';
import styles from './ActiveProjectsHealth.module.css';

const SHAPE: Readonly<Record<ProjectUpdateHealth, string>> = {
  on_track: styles.onTrack ?? '',
  at_risk: styles.atRisk ?? '',
  off_track: styles.offTrack ?? '',
};

interface ActiveProjectsHealthProps {
  readonly projects: readonly LinkedProjectHealth[];
}

export function ActiveProjectsHealth({ projects }: ActiveProjectsHealthProps) {
  if (projects.length === 0) {
    return <span className={styles.muted}>No projects</span>;
  }

  return (
    <span className={styles.row} role="img" aria-label={tally(projects)}>
      {projects.map((project) => (
        <span
          key={project.projectId}
          className={
            project.health === null
              ? `${styles.dot} ${styles.unreported}`
              : `${styles.dot} ${SHAPE[project.health]}`
          }
          title={
            project.health === null
              ? `${project.name}: no current update`
              : `${project.name}: ${INITIATIVE_UPDATE_HEALTH_LABEL[project.health]}`
          }
          style={
            project.health === null
              ? undefined
              : { background: `var(${PROJECT_UPDATE_HEALTH_TOKEN[project.health]})` }
          }
          aria-hidden="true"
        />
      ))}
    </span>
  );
}

/**
 * The strip's accessible name: how many projects, and how they are doing.
 *
 * Naming each project instead would be accurate and unusable — an initiative with twenty
 * projects would read out twenty names to answer "is this in trouble?". The counts are
 * what the strip is for, and the names are a hover away.
 */
function tally(projects: readonly LinkedProjectHealth[]): string {
  const counts = new Map<ProjectUpdateHealth | 'none', number>();
  for (const project of projects) {
    const key = project.health ?? 'none';
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const parts: string[] = [];
  for (const health of ['on_track', 'at_risk', 'off_track'] as const) {
    const count = counts.get(health);
    if (count !== undefined) {
      parts.push(`${count} ${INITIATIVE_UPDATE_HEALTH_LABEL[health].toLowerCase()}`);
    }
  }
  const unreported = counts.get('none');
  if (unreported !== undefined) parts.push(`${unreported} with no update`);

  const head = projects.length === 1 ? '1 project' : `${projects.length} projects`;
  return `${head}: ${parts.join(', ')}`;
}
