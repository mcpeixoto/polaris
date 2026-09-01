/**
 * A team’s home: who is on it, how much work is open, and the next surfaces to open.
 *
 * The issue list remains `/team/:key`. This page is the overview you open when you want
 * the team itself rather than its backlog — members, a count, and the shortcuts that used
 * to live only in the sidebar.
 */

import { Link, useNavigate, useParams } from 'react-router';

import { useKeymap } from '~/app/keymap';
import { Avatar, Badge, Button, EmptyState } from '~/components';
import { personName } from '~/features/prefs/prefs';
import { triageQueueCount } from '~/features/triage/queue';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import type { Store, Team, UUID } from '~/store';
import styles from './TeamHome.module.css';

interface MemberRow {
  readonly id: UUID;
  readonly name: string;
  readonly role: string;
}

interface TeamHomeView {
  readonly team: Team;
  readonly members: readonly MemberRow[];
  readonly openCount: number;
  readonly projectCount: number;
  /**
   * Unreviewed work still sitting in the team's triage statuses.
   *
   * Carried separately from the switch because turning triage off leaves the queue where
   * it is, and this page is the only navigation into it. Hiding the link on the switch
   * alone is what made a left-behind queue reachable from nothing but Search.
   */
  readonly triageQueue: number;
}

export function TeamHome() {
  const { teamKey } = useParams<{ teamKey: string }>();
  const navigate = useNavigate();
  const { registry, context } = useKeymap();

  const view = useLiveQuery(
    (store) => (teamKey === undefined ? null : snapshot(store, teamKey)),
    ['team', 'teamMembership', 'user', 'issue', 'project', 'projectTeam', 'workflowState'],
    [teamKey ?? ''],
  );

  if (view === null) {
    return (
      <div className={styles.screen}>
        <h1 className={styles.screenTitle}>Team</h1>
        <EmptyState
          title="No such team"
          description={
            teamKey === undefined
              ? 'Nothing in the URL named a team.'
              : `Nothing in this workspace has the key ${teamKey}.`
          }
        />
      </div>
    );
  }

  const { team, members, openCount, projectCount, triageQueue } = view;
  const create = () => registry.invoke('issue.create', { source: 'menu', context });
  /*
   * A retired team is frozen, and this page has to say so before it offers anything.
   *
   * The sidebar hides retired teams, but this URL is a bookmark and a link out of team
   * settings, so it is reachable — and it rendered a retired team as an ordinary one, down
   * to a primary "New issue" button. That button was worse than a refusal: the composer
   * drops retired teams from its picker and falls back to the first team in the workspace,
   * so pressing it here filed the issue into a different team than the page you pressed it
   * on, with nothing but a small select to say so.
   */
  const retired = team.retiredAt !== undefined;

  return (
    <div className={styles.screen}>
      <header className={styles.header}>
        <h1 className={styles.title}>
          {/* Badge, not a chip of this screen's own. Archives draws the same fact — this
              team's key, beside this team's heading — with a Badge, and two spellings of one
              chip is how a product ends up with two of everything. It also takes the height
              off the control ladder, which the local rule's hard-coded 16px did not. */}
          <Badge>{team.key}</Badge>
          {team.name}
        </h1>
        {retired ? null : (
          <Button variant="primary" onClick={create}>
            New issue
          </Button>
        )}
      </header>

      <div className={styles.body}>
        {retired ? (
          <p className={styles.retired} role="status">
            This team is retired. Its issues and settings are read-only until somebody restores it
            from <Link to={`/team/${team.key}/settings`}>team settings</Link>.
          </p>
        ) : null}

        <p className={styles.lede}>
          {openCount === 0
            ? 'No open issues. File one, or check the backlog.'
            : openCount === 1
              ? '1 open issue.'
              : `${openCount} open issues.`}
          {projectCount > 0
            ? ` ${projectCount === 1 ? '1 project' : `${projectCount} projects`} on this team.`
            : ''}
        </p>

        <nav className={styles.shortcuts} aria-label={`${team.name} pages`}>
          <Link to={`/team/${team.key}`} className={styles.shortcut}>
            Issues
          </Link>
          <Link to={`/team/${team.key}/projects`} className={styles.shortcut}>
            Projects
          </Link>
          {team.cyclesEnabled ? (
            <Link to={`/team/${team.key}/cycles`} className={styles.shortcut}>
              Cycles
            </Link>
          ) : null}
          {team.triageEnabled || triageQueue > 0 ? (
            <Link to={`/team/${team.key}/triage`} className={styles.shortcut}>
              Triage
            </Link>
          ) : null}
          <Link to={`/team/${team.key}/archives`} className={styles.shortcut}>
            Archives
          </Link>
          <Link to={`/team/${team.key}/settings`} className={styles.shortcut}>
            Settings
          </Link>
        </nav>

        <section className={styles.section} aria-labelledby="members-heading">
          <h2 className={styles.sectionTitle} id="members-heading">
            Members
          </h2>
          {members.length === 0 ? (
            <EmptyState
              title="Nobody has joined this team"
              description="You can still file issues here. Add people from Settings → Members."
              action={<Button onClick={() => navigate('/settings/members')}>Open members</Button>}
            />
          ) : (
            <ul className={styles.members}>
              {members.map((member) => (
                <li key={member.id} className={styles.member}>
                  <Avatar name={member.name} size="sm" colorKey={member.id} />
                  <span className={styles.memberName}>{member.name}</span>
                  <span className={styles.memberRole}>{member.role}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function snapshot(store: Store, teamKey: string): TeamHomeView | null {
  const team = [...store.teams.values()].find((candidate) => candidate.key === teamKey);
  if (team === undefined) return null;

  const members: MemberRow[] = [];
  for (const membershipId of store.membershipIdsForTeam(team.id)) {
    const membership = store.teamMemberships.get(membershipId);
    if (membership === undefined) continue;
    const user = store.users.get(membership.userId);
    if (user === undefined || user.archivedAt !== undefined) continue;
    members.push({
      id: user.id,
      name: personName(user),
      role: membership.role === 'owner' ? 'Owner' : 'Member',
    });
  }
  members.sort((a, b) => a.name.localeCompare(b.name));

  let openCount = 0;
  for (const issueId of store.index.byTeam(team.id)) {
    const issue = store.issues.get(issueId);
    if (issue === undefined || issue.archivedAt !== undefined) continue;
    const state = store.workflowStates.get(issue.stateId);
    if (state === undefined) continue;
    if (
      state.category === 'completed' ||
      state.category === 'canceled' ||
      state.category === 'duplicate'
    ) {
      continue;
    }
    openCount += 1;
  }

  let projectCount = 0;
  for (const project of store.projects.values()) {
    if (project.archivedAt !== undefined || project.deletedAt !== undefined) continue;
    const onTeam = [...store.projectTeamIdsFor(project.id)].some(
      (id) => store.projectTeams.get(id)?.teamId === team.id,
    );
    if (onTeam) projectCount += 1;
  }

  return { team, members, openCount, projectCount, triageQueue: triageQueueCount(store, team.id) };
}
