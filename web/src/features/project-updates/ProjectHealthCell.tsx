/**
 * Health plus staleness for a project — list rows and the shell header.
 */

import type { ProjectUpdateHealth, Store, UUID } from '~/store';

import { ProjectHealthBadge } from './ProjectHealthBadge';
import { latestProjectUpdate } from './helpers';
import { PROJECT_UPDATE_STALENESS_LABEL, projectUpdateStaleness } from './staleness';
import styles from './ProjectHealthCell.module.css';

interface ProjectHealthCellProps {
  readonly store: Store;
  readonly projectId: UUID;
  readonly compact?: boolean | undefined;
}

export function ProjectHealthCell({ store, projectId, compact = false }: ProjectHealthCellProps) {
  const staleness = projectUpdateStaleness(store, projectId);
  const health = latestProjectUpdate(store, projectId)?.health;

  if (staleness === 'not_expected') {
    return <span className={styles.muted}>{PROJECT_UPDATE_STALENESS_LABEL.not_expected}</span>;
  }
  if (staleness === 'missing') {
    return <span className={styles.missing}>{PROJECT_UPDATE_STALENESS_LABEL.missing}</span>;
  }
  if (health === undefined) {
    return <span className={styles.muted}>No update</span>;
  }

  return (
    <span className={staleness === 'due_soon' ? styles.dueSoonWrap : undefined}>
      <ProjectHealthBadge health={health as ProjectUpdateHealth} compact={compact} />
    </span>
  );
}
