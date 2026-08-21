/**
 * Project shell — name, health and tabs for overview, issues and activity.
 */

import { NavLink, Outlet, useNavigate, useParams } from 'react-router';

import { Button, EmptyState } from '~/components';
import { ProjectHealthCell } from '~/features/project-updates/ProjectHealthCell';
import { ProjectProperties } from '~/features/projects/properties';
import { ProjectViewTabs } from '~/features/projects/attachedViews';
import { useEngine } from '~/app/context';
import { useActions, useKeyContext } from '~/app/keymap';
import { copyText } from '~/features/github/copy';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import styles from './ProjectShell.module.css';

function tabClass({ isActive }: { isActive: boolean }): string {
  const tab = styles.tab ?? '';
  const active = styles.tabActive ?? '';
  return isActive ? `${tab} ${active}`.trim() : tab;
}

export function ProjectShell() {
  const engine = useEngine();
  const navigate = useNavigate();
  const { projectId = '' } = useParams<{ projectId: string }>();

  const project = useLiveQuery(
    (store) => store.projects.get(projectId) ?? null,
    ['project', 'projectUpdate', 'projectStatus', 'workspace'],
    [projectId],
  );

  useKeyContext('detail');
  useActions(
    [
      {
        id: 'project.copyModelUuid',
        title: 'Copy model UUID',
        when: 'detail',
        group: 'Projects',
        enabled: () => project !== null,
        run: () => {
          if (project !== null) void copyText(project.id);
        },
      },
    ],
    [project],
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
          <ProjectHealthCell store={engine.store} projectId={project.id} />
        </div>
        <nav className={styles.tabs} aria-label="Project sections">
          <NavLink to={base} end className={tabClass}>
            Overview
          </NavLink>
          <NavLink to={`${base}/issues`} className={tabClass}>
            Issues
          </NavLink>
          <ProjectViewTabs projectId={project.id} base={base} />
          <NavLink to={`${base}/activity`} className={tabClass}>
            Activity
          </NavLink>
        </nav>
      </header>
      <div className={styles.body}>
        <div className={styles.main}>
          <Outlet />
        </div>
        <aside className={styles.properties} aria-label="Project properties">
          <h2 className={styles.propertiesTitle}>Properties</h2>
          <ProjectProperties projectId={project.id} />
        </aside>
      </div>
    </div>
  );
}
