import { useEffect, useState } from 'react';
import { Link } from 'react-router';

import { Button } from '~/components';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import { useViewerId } from '~/hooks/useViewer';
import type { UUID } from '~/store';

import {
  clearTeamIssueLimitDismissed,
  dismissTeamIssueLimit,
  isMemberOfTeam,
  isTeamIssueLimitDismissed,
  TEAM_ISSUE_LIMIT,
  TEAM_ISSUE_WARN_AT,
  teamIssueLimitNotice,
} from './issueLimit';
import styles from './TeamIssueLimitBanner.module.css';

export function TeamIssueLimitBanner({
  team,
  liveCount,
}: {
  team: { readonly id: UUID; readonly key: string };
  liveCount: number;
}) {
  const viewerId = useViewerId();
  const member = useLiveQuery(
    (store) => viewerId !== null && isMemberOfTeam(store, team.id, viewerId),
    ['teamMembership'],
    [team.id, viewerId],
  );
  const [dismissed, setDismissed] = useState(() => isTeamIssueLimitDismissed(team.id));

  useEffect(() => {
    if (liveCount < TEAM_ISSUE_WARN_AT) {
      clearTeamIssueLimitDismissed(team.id);
      setDismissed(false);
    }
  }, [liveCount, team.id]);

  const kind = teamIssueLimitNotice(liveCount, dismissed);
  if (!member || kind === null) return null;

  const formatted = liveCount.toLocaleString('en-US');
  const cap = TEAM_ISSUE_LIMIT.toLocaleString('en-US');
  const copy =
    kind === 'limit'
      ? `This team has reached its ${cap}-issue limit. Archive or move issues before creating more.`
      : `This team is nearing its ${cap}-issue limit (${formatted} of ${cap}). Archive old issues, move them to another team, or shorten the auto-archive period in team settings.`;

  return (
    <div className={styles.banner} role="status">
      <p className={styles.copy}>{copy}</p>
      <Link className={styles.link} to={`/team/${team.key}/settings`}>
        Team settings
      </Link>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => {
          dismissTeamIssueLimit(team.id);
          setDismissed(true);
        }}
      >
        Dismiss
      </Button>
    </div>
  );
}
