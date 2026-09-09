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
 * The header carries where you are and what you can do to the project as a whole — the star,
 * the notifications bell, the ⋯ menu — and nothing else. Status and target used to ride at
 * the far end as pills, which put two copies of both on the screen: the properties are the
 * page's now, stated once in the overview's property row and edited in the rail beside it.
 * Health stays, because it is the one fact worth reading in the same glance as the name.
 *
 * The tabs are a row of their own beneath, with the rail's toggle at its trailing edge —
 * the rail is a property of this screen rather than of the project, so its control belongs
 * to the chrome and not to the trail.
 */

import { useRef, useState } from 'react';
import { Outlet, useNavigate, useParams } from 'react-router';

import {
  Breadcrumb,
  Button,
  ConfirmDialog,
  EmptyState,
  IconButton,
  Menu,
  Tabs,
  TitleField,
  type MenuNode,
  type TabItem,
  type TitleHandle,
} from '~/components';
import { EntityGate } from '~/features/entity-gate/EntityGate';
import { EntityIcon } from '~/features/icon/EntityIcon';
import { IconPicker } from '~/features/icon/IconPicker';
import { entityRowMenuItems } from '~/features/entity/entityRowMenu';
import { ProjectHealthCell } from '~/features/project-updates/ProjectHealthCell';
import { DotsGlyph, StarGlyph } from '~/features/issue/glyphs';
import { ProjectGlyph } from '~/features/projects/glyphs';
import { ProjectProperties } from '~/features/projects/properties';
import { ProjectStatusPicker } from '~/features/projects/ProjectStatusPicker';
import { ProjectViewTabs } from '~/features/projects/attachedViews';
import { archiveProject, deleteProject, updateProject } from '~/features/projects/mutations';
import { report, setProjectSubscription } from '~/features/subscriptions/mutations';
import { SubscribeBell } from '~/features/subscriptions/SubscribeBell';
import { readCollapsed, writeCollapsed } from '~/features/view/collapse';
import { isFavorite, toggleFavorite } from '~/features/view/mutations';
import { useEngine } from '~/app/context';
import { useActions, useKeyContext } from '~/app/keymap';
import { copyText } from '~/features/github/copy';
import { useContextMenu } from '~/hooks/useContextMenu';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import { useMenuTrigger } from '~/hooks/useMenuTrigger';
import { useViewer, useViewerId } from '~/hooks/useViewer';
import styles from './ProjectShell.module.css';

/** One screen, one folded thing: the rail. Its own key, so the rail's sections keep theirs. */
const RAIL_PREFERENCE = 'project-rail';
const RAIL_KEY = 'rail';

export function ProjectShell() {
  const engine = useEngine();
  const navigate = useNavigate();
  const { projectId = '' } = useParams<{ projectId: string }>();
  const viewer = useViewer();
  const viewerId = useViewerId();

  const status = useMenuTrigger();
  const more = useMenuTrigger();
  const headerIcon = useMenuTrigger<HTMLButtonElement>('dialog');
  const contextMenu = useContextMenu<string>();
  const titleRef = useRef<TitleHandle | null>(null);
  const [confirming, setConfirming] = useState<'archive' | 'delete' | null>(null);

  // Whether the rail is open, remembered the way a folded group is: in localStorage, keyed
  // by the screen, because it is one reader's arrangement of one afternoon and not something
  // a shared link should carry. Open is the default — a project's properties are half of
  // what the screen is for.
  //
  // Folded means unmounted rather than hidden, which costs the rail's own shortcuts (`P`,
  // `L`, `A`, `I`) while it is away. That is the honest trade: those actions open pickers,
  // and a picker positioned against a `display: none` trigger opens in the corner of the
  // window. `E` and `S` are registered here and keep working either way.
  const [railShut, setRailShut] = useState(() => readCollapsed(RAIL_PREFERENCE).has(RAIL_KEY));
  const toggleRail = () => {
    setRailShut((shut) => {
      const next = !shut;
      writeCollapsed(RAIL_PREFERENCE, next ? new Set([RAIL_KEY]) : new Set());
      return next;
    });
  };

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
        const project = row.project;
        const base = `/project/${project.id}`;
        // Tinted with the project's own colour, which is the other half of what the icon
        // picker writes and until now was stored and never drawn. It is also the control
        // that changes both, because the breadcrumb is where a person looking at a project
        // is looking when they decide the icon is wrong.
        const mark = (
          <button
            type="button"
            {...headerIcon.props}
            className={styles.iconTrigger}
            aria-label="Change project icon"
          >
            <EntityIcon
              icon={project.icon}
              color={project.color}
              fallback={<ProjectGlyph />}
              size="md"
            />
          </button>
        );

        // One row, one landmark. Overview, Activity, Issues — Linear's order, and an order
        // with an argument: the two tabs about the project as a whole come before the one
        // about the work inside it. The attached views draw themselves after Issues, because
        // a saved view's tab also drags to reorder and opens a context menu — behaviour a
        // plain `TabItem` has no way to carry — and because a saved view *is* a view of the
        // issues, so it belongs beside them.
        const tabs: TabItem[] = [
          { id: 'overview', label: 'Overview', to: base, end: true },
          { id: 'activity', label: 'Activity', to: `${base}/activity` },
          { id: 'issues', label: 'Issues', to: `${base}/issues` },
          {
            id: 'views',
            label: 'Views',
            render: () => <ProjectViewTabs projectId={project.id} base={base} />,
          },
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
                // A descendant that already answered this right-click owns it: a saved view's
                // tab sits inside this header and opens a menu of its own, and two menus at once
                // means neither can be clicked.
                if (event.defaultPrevented) return;
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
                    control: mark,
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
              {/* Named, because it is a fact about the project rather than a decoration of
                  the trail: "how is it going" is the one thing worth reading in the same
                  glance as the name, and a group with a name is what lets a reader — or a
                  test — ask for it rather than infer it from where it sits. */}
              <div className={styles.health} role="group" aria-label="Project health">
                <ProjectHealthCell store={engine.store} projectId={project.id} compact />
              </div>
              <div className={styles.headerEnd}>
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

            {/* The sections, and the one control that belongs to this screen rather than to
                the project. The toggle sits at the trailing edge of the row so the tabs keep
                the leading edge they share with every other detail screen. */}
            <div className={styles.tabRow}>
              <Tabs aria-label="Project sections" className={styles.tabs} items={tabs} />
              <IconButton
                size="sm"
                className={styles.railToggle}
                icon={<RailGlyph />}
                aria-label="Toggle properties"
                aria-pressed={!railShut}
                tooltip={railShut ? 'Show properties' : 'Hide properties'}
                onClick={toggleRail}
              />
            </div>

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

            <IconPicker
              open={headerIcon.open}
              onClose={headerIcon.hide}
              trigger={headerIcon.ref}
              label="Project icon"
              actionId="project.closeHeaderIconPicker"
              value={{ icon: project.icon ?? '', color: project.color }}
              onChange={(next) => {
                if (next.icon !== (project.icon ?? '')) {
                  updateProject(engine, project.id, { icon: next.icon }).catch(report);
                  return;
                }
                if (next.color !== project.color) {
                  updateProject(engine, project.id, { color: next.color }).catch(report);
                }
              }}
            />

            {/* `S` opens this from anywhere in the project, so it hangs off the ⋯ button:
                the header's trailing group is the only anchor on screen on every tab and
                whether or not the rail is open. The rail's own status row and the overview's
                property pill open their own copies, positioned under themselves. */}
            <ProjectStatusPicker
              open={status.open}
              onClose={status.hide}
              trigger={more.ref}
              placement="bottom-end"
              value={project.statusId}
              onSelect={(statusId) => updateProject(engine, project.id, { statusId }).catch(report)}
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
              {railShut ? null : (
                <aside className={styles.properties} aria-label="Project properties">
                  <ProjectProperties projectId={project.id} />
                </aside>
              )}
            </div>
          </div>
        );
      }}
    </EntityGate>
  );
}

/**
 * The rail toggle's glyph: a pane with its trailing column marked.
 *
 * A mirror of the sidebar's own toggle in `AppShell`, because the two controls do the same
 * thing at opposite edges of the window and a reader should not have to learn them twice.
 */
function RailGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect
        x="2.5"
        y="3"
        width="11"
        height="10"
        rx="1.5"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.4}
      />
      <path d="M9.5 3v10" stroke="currentColor" strokeWidth={1.4} />
    </svg>
  );
}
