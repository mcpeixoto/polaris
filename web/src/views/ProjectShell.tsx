/**
 * Project shell — where you are, what the project is called, the tabs, and the properties
 * rail; the tab's own content in between.
 *
 * The header is a breadcrumb rather than a title: "Projects › name" at the row's own size,
 * with the tabs beside it, the way every detail view in the product opens. The name in the
 * last crumb is the field you rename the project in — a project is renamed about once in its
 * life and read hundreds of times, so at rest it is text and it becomes a control when you
 * put the caret in it. That is the same bargain the issue title makes, and it is the same
 * component making it.
 *
 * Status and target ride at the far end as pills that open their pickers, not as chips that
 * only look like controls: a person arriving from the list checks they opened the right row
 * there, and changing it should not mean hunting for the rail. The rail is still where every
 * other property lives.
 */

import { useRef, useState } from 'react';
import { Outlet, useNavigate, useParams } from 'react-router';

import {
  Breadcrumb,
  Button,
  ConfirmDialog,
  DatePicker,
  EmptyState,
  IconButton,
  Menu,
  PropertyPill,
  StateIcon,
  Tabs,
  TitleField,
  type MenuNode,
  type TabItem,
  type TitleHandle,
} from '~/components';
import { EntityGate } from '~/features/entity-gate/EntityGate';
import { entityRowMenuItems } from '~/features/entity/entityRowMenu';
import { browserTimezone } from '~/features/locale';
import { ProjectHealthCell } from '~/features/project-updates/ProjectHealthCell';
import { DotsGlyph, StarGlyph } from '~/features/issue/glyphs';
import { ProjectGlyph } from '~/features/projects/glyphs';
import { ProjectProperties, formatTimeframe } from '~/features/projects/properties';
import { PROJECT_STATUS_ICON } from '~/features/projects/statusCategories';
import { ProjectStatusPicker } from '~/features/projects/ProjectStatusPicker';
import { ProjectViewTabs } from '~/features/projects/attachedViews';
import { archiveProject, deleteProject, updateProject } from '~/features/projects/mutations';
import { report, setProjectSubscription } from '~/features/subscriptions/mutations';
import { SubscribeBell } from '~/features/subscriptions/SubscribeBell';
import { isFavorite, toggleFavorite } from '~/features/view/mutations';
import { useEngine } from '~/app/context';
import { useActions, useKeyContext } from '~/app/keymap';
import { copyText } from '~/features/github/copy';
import { useContextMenu } from '~/hooks/useContextMenu';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import { useMenuTrigger } from '~/hooks/useMenuTrigger';
import { useViewer, useViewerId } from '~/hooks/useViewer';
import styles from './ProjectShell.module.css';

export function ProjectShell() {
  const engine = useEngine();
  const navigate = useNavigate();
  const { projectId = '' } = useParams<{ projectId: string }>();
  const viewer = useViewer();
  const viewerId = useViewerId();

  const status = useMenuTrigger();
  const target = useMenuTrigger<HTMLButtonElement>('dialog');
  const more = useMenuTrigger();
  const contextMenu = useContextMenu<string>();
  const titleRef = useRef<TitleHandle | null>(null);
  const [confirming, setConfirming] = useState<'archive' | 'delete' | null>(null);

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

  const favourite = useLiveQuery(
    (store) => viewerId !== null && isFavorite(store, viewerId, 'project', projectId),
    ['favorite'],
    [projectId, viewerId],
  );

  const watch = useLiveQuery(
    (store) => {
      if (viewer === null) return null;
      const id = store.projectSubscriptionIdFor(viewer.id, projectId);
      return id === undefined ? null : (store.get('projectSubscription', id) ?? null);
    },
    ['projectSubscription'],
    [projectId, viewer?.id],
  );

  const toggleFavourite = () => {
    if (viewerId === null || project === null) return;
    toggleFavorite(engine, viewerId, 'project', project.id).catch(report);
  };
  const copyLink = () => {
    if (project !== null) void copyText(`${window.location.origin}/project/${project.id}`);
  };

  useKeyContext('detail');
  useActions(
    [
      {
        id: 'project.rename',
        title: 'Rename project',
        keys: ['e'],
        when: 'detail',
        group: 'Projects',
        enabled: () => project !== null,
        run: () => titleRef.current?.focus(),
      },
      {
        // Escape while the name is being typed abandons the edit. Registered here rather
        // than inside the field for the reason every other one is: the registry lives above
        // it, and an unfocused field must not be holding Escape hostage from the rail.
        id: 'project.rename.cancel',
        title: 'Stop renaming the project',
        keys: ['Escape'],
        when: 'detail',
        group: 'Projects',
        enabled: () => titleRef.current?.editing() === true,
        run: () => titleRef.current?.revert(),
      },
      {
        id: 'project.status',
        title: 'Set status',
        keys: ['s'],
        when: 'detail',
        group: 'Projects',
        enabled: () => project !== null,
        run: () => status.show(),
      },
      {
        id: 'project.favorite',
        title: 'Favourite project',
        when: 'detail',
        group: 'Projects',
        enabled: () => viewerId !== null && project !== null,
        run: toggleFavourite,
      },
      {
        id: 'project.copyLink',
        title: 'Copy link to project',
        when: 'detail',
        group: 'Projects',
        enabled: () => project !== null,
        run: copyLink,
      },
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
      {
        id: 'project.delete',
        title: 'Delete project',
        when: 'detail',
        group: 'Projects',
        enabled: () => project !== null,
        run: () => setConfirming('delete'),
      },
    ],
    [project, viewerId],
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
        const { status: current } = row;
        const project = row.project;
        const base = `/project/${project.id}`;
        // Tinted with the project's own colour, which is the other half of what the icon
        // picker writes and until now was stored and never drawn.
        const mark =
          project.icon === undefined || project.icon === '' ? (
            <ProjectGlyph />
          ) : (
            <span style={{ color: project.color }}>{project.icon}</span>
          );

        // One row, one landmark. The attached views sit between Issues and Activity and draw
        // themselves, because a saved view's tab also drags to reorder and opens a context
        // menu — behaviour a plain `TabItem` has no way to carry.
        const tabs: TabItem[] = [
          { id: 'overview', label: 'Overview', to: base, end: true },
          { id: 'issues', label: 'Issues', to: `${base}/issues` },
          {
            id: 'views',
            label: 'Views',
            render: () => <ProjectViewTabs projectId={project.id} base={base} />,
          },
          { id: 'activity', label: 'Activity', to: `${base}/activity` },
        ];

        const closeMenus = () => {
          more.hide();
          contextMenu.close();
        };

        /**
         * The list's menu, built by the same shared builder so the wording and order cannot
         * drift: `Open project` is dropped because this is the project it would open, and
         * `Copy model UUID` rides in the properties slot — the list has no equivalent, and it
         * is the one item here that belongs to a developer rather than to the project.
         *
         * Two deliberate differences from `Projects.tsx`. `Delete project` is offered here and
         * not there, which is where it already was. And the status and lead pickers are not
         * repeated: the header pills and the rail already open them on this screen.
         */
        const menuItems = (): MenuNode[] =>
          entityRowMenuItems(
            { noun: 'project', name: project.name, favorited: favourite },
            {
              copyLink: () => {
                closeMenus();
                copyLink();
              },
              ...(viewerId === null
                ? {}
                : {
                    toggleFavorite: () => {
                      closeMenus();
                      toggleFavourite();
                    },
                  }),
              properties: [
                {
                  id: 'copy-id',
                  label: 'Copy model UUID',
                  onSelect: () => {
                    closeMenus();
                    void copyText(project.id);
                  },
                },
              ],
              archive: () => {
                closeMenus();
                setConfirming('archive');
              },
              askDelete: () => {
                closeMenus();
                setConfirming('delete');
              },
              deleteLabel: 'Delete project',
            },
          );

        return (
          <div className={styles.screen}>
            <header
              className={styles.header}
              onContextMenu={(event) => {
                event.preventDefault();
                contextMenu.openAt(event.clientX, event.clientY, project.id);
              }}
            >
              {/* The name is the rename field in the last crumb, so the screen would
                  otherwise have no heading at all. Hidden the way `IssueDetail`'s
                  `.screenTitle` is: a `<textarea>` inside an `<h1>` gives the heading no
                  name, and the heading list is how somebody with a screen reader finds out
                  which project they opened. */}
              <h1 className={styles.screenTitle}>{project.name}</h1>
              <Breadcrumb
                className={styles.crumbs}
                items={[
                  { label: 'Projects', to: '/projects' },
                  {
                    icon: mark,
                    label: (
                      <TitleField
                        key={`project-title-${project.id}`}
                        subjectId={project.id}
                        value={project.name}
                        label="Project name"
                        size="md"
                        handle={titleRef}
                        className={styles.titleField}
                        onSave={(name) => updateProject(engine, project.id, { name }).catch(report)}
                      />
                    ),
                  },
                ]}
              />
              {/* Beside the name rather than in the trailing group: health is the one fact a
                  reader wants in the same glance as the project. */}
              <ProjectHealthCell store={engine.store} projectId={project.id} compact />
              <Tabs aria-label="Project sections" className={styles.tabs} items={tabs} />
              <div className={styles.headerEnd}>
                <PropertyPill
                  {...status.props}
                  name="Status"
                  describe={`${project.id}-header-status`}
                  empty={current === null ? 'No status' : undefined}
                  icon={
                    current === null ? undefined : (
                      <StateIcon
                        category={PROJECT_STATUS_ICON[current.category]}
                        color={current.color}
                        decorative
                      />
                    )
                  }
                >
                  {current === null ? 'Status' : current.name}
                </PropertyPill>
                <PropertyPill
                  {...target.props}
                  name="Target date"
                  describe={`${project.id}-header-target`}
                  empty={project.targetDate === undefined ? 'No target date' : undefined}
                >
                  {project.targetDate === undefined
                    ? 'Target'
                    : formatTimeframe(project.targetDate, project.targetDateGranularity ?? 'day')}
                </PropertyPill>
                {viewerId === null ? null : (
                  <IconButton
                    icon={<StarGlyph on={favourite} />}
                    aria-label={favourite ? 'Remove from favourites' : 'Add to favourites'}
                    aria-pressed={favourite}
                    className={favourite ? styles.starOn : undefined}
                    onClick={toggleFavourite}
                  />
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
                        projectId: project.id,
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
                <IconButton
                  {...more.props}
                  variant="secondary"
                  icon={<DotsGlyph />}
                  aria-label="More actions"
                />
              </div>
            </header>

            <Menu
              open={more.open}
              onClose={more.hide}
              trigger={more.ref}
              label="More actions"
              placement="bottom-end"
              items={menuItems()}
            />

            {contextMenu.at === null ? null : <div {...contextMenu.anchorProps} />}
            <Menu
              open={contextMenu.at !== null}
              onClose={contextMenu.close}
              trigger={contextMenu.anchorRef}
              label={`Options for ${project.name}`}
              items={menuItems()}
            />

            <ProjectStatusPicker
              open={status.open}
              onClose={status.hide}
              trigger={status.ref}
              placement="bottom-end"
              value={project.statusId}
              onSelect={(statusId) => updateProject(engine, project.id, { statusId }).catch(report)}
            />

            <DatePicker
              open={target.open}
              onClose={target.hide}
              trigger={target.ref}
              value={project.targetDate ?? null}
              // The reader's zone rather than a team's: a project belongs to as many teams
              // as it likes, so there is no one team whose Friday this date is.
              timezone={browserTimezone()}
              actionId="project.header.closeTargetPicker"
              actionGroup="Projects"
              label="Target date"
              clearLabel="No target date"
              onSelect={(targetDate) =>
                updateProject(engine, project.id, {
                  targetDate,
                  targetDateGranularity: project.targetDateGranularity ?? 'day',
                }).catch(report)
              }
            />

            <ConfirmDialog
              open={confirming !== null}
              title={
                confirming === 'delete' ? `Delete ${project.name}?` : `Archive ${project.name}?`
              }
              consequence={
                confirming === 'delete'
                  ? `${project.name} leaves every list, board and initiative it is on, for everybody. Its issues keep their history but stop belonging to a project.`
                  : `${project.name} leaves the project list and the sidebar. Its issues stay where they are, and it can be restored from the team's archives.`
              }
              confirmLabel={confirming === 'delete' ? 'Delete project' : 'Archive project'}
              destructive
              onConfirm={() => {
                const write =
                  confirming === 'delete'
                    ? deleteProject(engine, project.id)
                    : archiveProject(engine, project.id);
                write.catch(report);
                setConfirming(null);
                // The row has left the replica optimistically, so staying here would render
                // the "no such project" page this screen just caused.
                void navigate('/projects');
              }}
              onClose={() => setConfirming(null)}
            />

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
      }}
    </EntityGate>
  );
}
