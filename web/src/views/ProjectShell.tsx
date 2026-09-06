/**
 * Project shell — where you are, the tabs, and the properties rail; the tab's own content
 * in between.
 *
 * The header is a breadcrumb rather than a title: "Projects › name" at the row's own size,
 * with the tabs beside it, the way every detail view in the product opens. The big title
 * belongs to the overview, which is the one tab that is about the project rather than about
 * its issues. Status, target and health ride at the far end so a person arriving from the
 * list can check they opened the right row without reading the rail.
 */

import { Link, NavLink, Outlet, useNavigate, useParams } from 'react-router';

import { Button, EmptyState, StateIcon } from '~/components';
import { EntityGate } from '~/features/entity-gate/EntityGate';
import { ProjectHealthCell } from '~/features/project-updates/ProjectHealthCell';
import { ProjectGlyph } from '~/features/projects/glyphs';
import { ProjectProperties, formatTimeframe } from '~/features/projects/properties';
import { PROJECT_STATUS_ICON } from '~/features/projects/statusCategories';
import { ProjectViewTabs } from '~/features/projects/attachedViews';
import { report, setProjectSubscription } from '~/features/subscriptions/mutations';
import { SubscribeBell } from '~/features/subscriptions/SubscribeBell';
import { useEngine } from '~/app/context';
import { useActions, useKeyContext } from '~/app/keymap';
import { copyText } from '~/features/github/copy';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import { useViewer } from '~/hooks/useViewer';
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
  const viewer = useViewer();

  // The project and the status it sits on in one query. Both are read on every render of
  // the header, and two subscriptions over the same row buy nothing but another render
  // for the store to schedule.
  const row = useLiveQuery(
    (store) => {
      const found = store.projects.get(projectId);
      if (found === undefined) return null;
      return {
        project: found,
        status: store.projectStatuses.get(found.statusId) ?? null,
      };
    },
    ['project', 'projectUpdate', 'projectStatus', 'user', 'workspace'],
    [projectId],
  );
  const project = row?.project ?? null;

  const watch = useLiveQuery(
    (store) => {
      if (viewer === null) return null;
      const id = store.projectSubscriptionIdFor(viewer.id, projectId);
      return id === undefined ? null : (store.get('projectSubscription', id) ?? null);
    },
    ['projectSubscription'],
    [projectId, viewer?.id],
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

  return (
    <EntityGate
      entity={row}
      label="Loading project…"
      lines={4}
      missing={
        <EmptyState
          title="No such project"
          description="It may have been deleted, or it may belong to a team you are not in."
          action={<Button onClick={() => navigate(-1)}>Go back</Button>}
        />
      }
    >
      {() => {
        if (row === null) return null;
        const { status } = row;
        const current = row.project;
        const base = `/project/${current.id}`;

        return (
          <div className={styles.screen}>
            <header className={styles.header}>
              <div className={styles.crumbs}>
                <Link to="/projects" className={styles.crumb}>
                  Projects
                </Link>
                <span className={styles.crumbSeparator} aria-hidden="true">
                  ›
                </span>
                <span className={styles.mark} aria-hidden="true">
                  {current.icon === undefined || current.icon === '' ? (
                    <ProjectGlyph />
                  ) : (
                    current.icon
                  )}
                </span>
                <h1 className={styles.title}>{current.name}</h1>
                {/* Beside the name rather than in the trailing group: health is the one fact a
                    reader wants in the same glance as the project. */}
                <ProjectHealthCell store={engine.store} projectId={current.id} compact />
              </div>
              <nav className={styles.tabs} aria-label="Project sections">
                <NavLink to={base} end className={tabClass}>
                  Overview
                </NavLink>
                <NavLink to={`${base}/issues`} className={tabClass}>
                  Issues
                </NavLink>
                <ProjectViewTabs projectId={current.id} base={base} />
                <NavLink to={`${base}/activity`} className={tabClass}>
                  Activity
                </NavLink>
              </nav>
              <div className={styles.headerEnd}>
                {/* Standing facts, not controls: everything here is editable in the rail,
                    and a chip that looked clickable would promise a second place to do it. */}
                {status !== null && (
                  <span className={styles.chip}>
                    <StateIcon
                      category={PROJECT_STATUS_ICON[status.category]}
                      color={status.color}
                      decorative
                    />
                    {status.name}
                  </span>
                )}
                {current.targetDate !== undefined && (
                  <span className={styles.chip}>
                    Target{' '}
                    {formatTimeframe(current.targetDate, current.targetDateGranularity ?? 'day')}
                  </span>
                )}
                {viewer !== null && viewer.role !== 'guest' ? (
                  <SubscribeBell
                    menuLabel="Project notifications"
                    flags={[
                      {
                        id: 'issuesAdded',
                        label: 'An issue is added',
                        on: watch?.issuesAdded === true,
                      },
                      {
                        id: 'issuesCompleted',
                        label: 'An issue is completed',
                        on: watch?.issuesCompleted === true,
                      },
                      {
                        id: 'updates',
                        label: 'A new update is posted',
                        on: watch?.updates === true,
                      },
                    ]}
                    onToggle={(id) => {
                      setProjectSubscription(engine, {
                        projectId: current.id,
                        userId: viewer.id,
                        issuesAdded:
                          id === 'issuesAdded'
                            ? watch?.issuesAdded !== true
                            : watch?.issuesAdded === true,
                        issuesCompleted:
                          id === 'issuesCompleted'
                            ? watch?.issuesCompleted !== true
                            : watch?.issuesCompleted === true,
                        updates:
                          id === 'updates' ? watch?.updates !== true : watch?.updates === true,
                      }).catch(report);
                    }}
                  />
                ) : null}
              </div>
            </header>
            <div className={styles.body}>
              <div className={styles.main}>
                <Outlet />
              </div>
              <aside className={styles.properties} aria-label="Project properties">
                <h2 className={styles.propertiesTitle}>Properties</h2>
                <ProjectProperties projectId={current.id} />
              </aside>
            </div>
          </div>
        );
      }}
    </EntityGate>
  );
}
