/**
 * Health plus staleness for a project — list rows and the shell header.
 *
 * "Due soon" used to be a 1px dashed outline and nothing else: a whole state carried by a
 * hairline, invisible to a screen reader and to anyone who cannot pick a dashed border out
 * of a dense row. The word is now always in the accessibility tree — visible beside the
 * badge where there is room, hidden text plus a tooltip in the compact list cell — and the
 * outline is left as emphasis on top of it rather than as the message itself.
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

  const badge = <ProjectHealthBadge health={health as ProjectUpdateHealth} compact={compact} />;
  if (staleness !== 'due_soon') return badge;

  const dueSoon = PROJECT_UPDATE_STALENESS_LABEL.due_soon;
  return (
    <span className={styles.dueSoonWrap} title={`${dueSoon}: this project owes an update`}>
      {badge}
      <span className={compact ? styles.hidden : styles.dueSoon}>{dueSoon}</span>
    </span>
  );
}
