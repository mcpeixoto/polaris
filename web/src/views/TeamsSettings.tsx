/**
 * Settings → Teams: the index of live teams, and the only place a team can be created.
 *
 * The client could retire a team, delete one and restore one, and could not make one —
 * `CREATE_TEAM` had been generated and called by nothing. So a workspace's team list was
 * whatever the first-run flow happened to produce, for ever. This page is the other half
 * of a lifecycle that already had three of its four verbs.
 *
 * `/settings/teams/new` is a real address rather than a piece of component state, because
 * "create a team" is a thing people link each other to and a thing the empty-workspace
 * screen already navigates to. Closing the dialog goes back to the index.
 */

import { useNavigate, useLocation, Link } from 'react-router';

import { Badge, Button, EmptyState, SettingsPage, SettingsSection } from '~/components';
import { CreateTeamDialog } from '~/features/team/CreateTeamDialog';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import type { Store } from '~/store';

import styles from './TeamsSettings.module.css';

interface TeamRow {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly private: boolean;
  readonly retired: boolean;
  readonly members: number;
}

export function TeamsSettings() {
  const navigate = useNavigate();
  const location = useLocation();
  const creating = location.pathname.endsWith('/new');

  const teams = useLiveQuery(rows, ['team', 'teamMembership']);

  return (
    <SettingsPage
      title="Teams"
      description="Every team in this workspace. A team owns its issues, its statuses, its labels and its cycles."
      actions={
        <Button variant="primary" onClick={() => void navigate('/settings/teams/new')}>
          New team
        </Button>
      }
    >
      <SettingsSection flush>
        {teams.length === 0 ? (
          <EmptyState
            title="No teams yet"
            description="Issues live in teams, so the first team is the first thing this workspace needs."
            action={
              <Button variant="primary" onClick={() => void navigate('/settings/teams/new')}>
                New team
              </Button>
            }
          />
        ) : (
          <ul className={styles.teams}>
            {teams.map((team) => (
              <li key={team.id} className={styles.team}>
                <span className={styles.key}>{team.key}</span>
                <Link to={`/team/${team.key}/settings`} className={styles.name}>
                  {team.name}
                </Link>
                <span className={styles.members}>
                  {team.members === 1 ? '1 member' : `${String(team.members)} members`}
                </span>
                {team.private ? <Badge tone="neutral">Private</Badge> : null}
                {team.retired ? <Badge tone="warning">Retired</Badge> : null}
              </li>
            ))}
          </ul>
        )}
      </SettingsSection>

      {creating ? (
        <CreateTeamDialog
          onClose={() => void navigate('/settings/teams')}
          onCreated={(team) => void navigate(`/team/${team.key}/settings`)}
        />
      ) : null}
    </SettingsPage>
  );
}

/**
 * Retired teams are listed rather than hidden. The sidebar hides them because it is a place
 * to work; this is the index, and an index that omits a row cannot explain why the key it
 * held is still taken.
 */
function rows(store: Store): readonly TeamRow[] {
  return [...store.teams.values()]
    .filter((team) => team.archivedAt === undefined)
    .map((team) => ({
      id: team.id,
      key: team.key,
      name: team.name,
      private: team.private,
      retired: team.retiredAt !== undefined,
      members: store.membershipIdsForTeam(team.id).size,
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
}
