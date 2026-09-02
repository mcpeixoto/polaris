/**
 * Project shell — the project's identity and state at a glance, then the tabs.
 *
 * The header says what the projects list says about the same project and in the same
 * order: mark, name, status, lead, target date, health. A person arriving from the list
 * should not have to open the properties rail to check they clicked the right row.
 */

import type { CSSProperties } from 'react';
import { NavLink, Outlet, useNavigate, useParams } from 'react-router';

import { Avatar, Button, EmptyState, StateIcon } from '~/components';
import { EntityGate } from '~/features/entity-gate/EntityGate';
import { ProjectHealthCell } from '~/features/project-updates/ProjectHealthCell';
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

  // The project, the status it sits on and the person leading it in one query. All three
  // are read on every render of the header, and three subscriptions over the same row buy
  // nothing but two more renders for the store to schedule.
  const row = useLiveQuery(
    (store) => {
      const found = store.projects.get(projectId);
      if (found === undefined) return null;
      return {
        project: found,
        status: store.projectStatuses.get(found.statusId) ?? null,
        lead: found.leadId === undefined ? null : (store.users.get(found.leadId) ?? null),
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
        const { status, lead } = row;
        const current = row.project;
        const base = `/project/${current.id}`;

        return (
          <div className={styles.screen}>
            <header className={styles.header}>
              <div className={styles.titleRow}>
                {/* The colour is workspace data and a project may have none — a project
                    created without one carries an empty string, which as an inline
                    background is not a colour at all. The custom property carries it and
                    the stylesheet supplies the fallback. */}
                <span
                  className={styles.mark}
                  style={{ '--project-mark-color': current.color } as CSSProperties}
                  aria-hidden="true"
                >
                  {current.icon}
                </span>
                <h1 className={styles.title}>{current.name}</h1>
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
                {lead !== null && (
                  <span className={styles.chip}>
                    <Avatar
                      name={lead.displayName}
                      src={lead.avatarUrl ?? null}
                      size="xs"
                      colorKey={lead.id}
                      decorative
                    />
                    {lead.displayName}
                  </span>
                )}
                {current.targetDate !== undefined && (
                  <span className={styles.chip}>
                    Target{' '}
                    {formatTimeframe(current.targetDate, current.targetDateGranularity ?? 'day')}
                  </span>
                )}
                <div className={styles.headerEnd}>
                  <ProjectHealthCell store={engine.store} projectId={current.id} />
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
