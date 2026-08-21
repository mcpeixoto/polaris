/**
 * Colour-coded roll-up of each linked project's latest update.
 */

import type { ProjectUpdateHealth } from '~/store';

import { INITIATIVE_UPDATE_HEALTH_LABEL } from './helpers';
import type { LinkedProjectHealth } from './helpers';
import styles from './ActiveProjectsHealth.module.css';

const HEALTH_TOKEN: Readonly<Record<ProjectUpdateHealth, string>> = {
  on_track: '--state-completed',
  at_risk: '--priority-medium',
  off_track: '--priority-urgent',
};

interface ActiveProjectsHealthProps {
  readonly projects: readonly LinkedProjectHealth[];
}

export function ActiveProjectsHealth({ projects }: ActiveProjectsHealthProps) {
  if (projects.length === 0) {
    return <span className={styles.muted}>No projects</span>;
  }

  return (
    <span className={styles.row} aria-label="Active project health">
      {projects.map((project) => (
        <span
          key={project.projectId}
          className={styles.dot}
          title={
            project.health === null
              ? `${project.name}: no current update`
              : `${project.name}: ${INITIATIVE_UPDATE_HEALTH_LABEL[project.health]}`
          }
          style={{
            background:
              project.health === null
                ? 'var(--text-tertiary)'
                : `var(${HEALTH_TOKEN[project.health]})`,
          }}
        />
      ))}
    </span>
  );
}
