/**
 * Health badge for a project update — on track, at risk, or off track.
 */

import type { ProjectUpdateHealth } from '~/store';

import { PROJECT_UPDATE_HEALTH_LABEL } from './helpers';
import styles from './ProjectHealthBadge.module.css';

const HEALTH_TOKEN: Readonly<Record<ProjectUpdateHealth, string>> = {
  on_track: '--state-completed',
  at_risk: '--priority-medium',
  off_track: '--priority-urgent',
};

interface ProjectHealthBadgeProps {
  readonly health: ProjectUpdateHealth;
  readonly compact?: boolean | undefined;
}

export function ProjectHealthBadge({ health, compact = false }: ProjectHealthBadgeProps) {
  return (
    <span
      className={compact ? styles.compact : styles.badge}
      style={{ color: `var(${HEALTH_TOKEN[health]})` }}
    >
      <span className={styles.dot} style={{ background: `var(${HEALTH_TOKEN[health]})` }} />
      {PROJECT_UPDATE_HEALTH_LABEL[health]}
    </span>
  );
}
