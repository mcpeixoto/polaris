/**
 * Project shell — name, health and tabs for overview, issues and activity.
 */

import { NavLink, Outlet, useNavigate, useParams } from 'react-router';

import { Button, EmptyState } from '~/components';
import { ProjectHealthBadge } from '~/features/project-updates/ProjectHealthBadge';
import { latestProjectUpdate } from '~/features/project-updates/helpers';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import styles from './ProjectShell.module.css';

function tabClass({ isActive }: { isActive: boolean }): string {
  const tab = styles.tab ?? '';
  const active = styles.tabActive ?? '';
  return isActive ? `${tab} ${active}`.trim() : tab;
}

export function ProjectShell() {
  const navigate = useNavigate();
  const { projectId = '' } = useParams<{ projectId: string }>();

  const project = useLiveQuery(
    (store) => store.projects.get(projectId) ?? null,
    ['project'],
    [projectId],
  );

  const latestHealth = useLiveQuery(
    (store) => latestProjectUpdate(store, projectId)?.health,
    ['projectUpdate'],
    [projectId],
  );

  if (project === null) {
    return (
      <EmptyState
        title="No such project"
        description="It may have been deleted, or it may belong to a team you are not in."
        action={<Button onClick={() => navigate(-1)}>Go back</Button>}
      />
    );
  }

  const base = `/project/${project.id}`;

  return (
    <div className={styles.screen}>
      <header className={styles.header}>
        <div className={styles.titleRow}>
          <span className={styles.mark} style={{ background: project.color }} aria-hidden="true" />
          <h1 className={styles.title}>{project.name}</h1>
          {latestHealth !== undefined && <ProjectHealthBadge health={latestHealth} />}
        </div>
        <nav className={styles.tabs} aria-label="Project sections">
          <NavLink to={base} end className={tabClass}>
            Overview
          </NavLink>
          <NavLink to={`${base}/issues`} className={tabClass}>
            Issues
          </NavLink>
          <NavLink to={`${base}/activity`} className={tabClass}>
            Activity
          </NavLink>
        </nav>
      </header>
      <div className={styles.body}>
        <Outlet />
      </div>
    </div>
  );
}
