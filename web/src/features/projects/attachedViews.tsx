/**
 * Attached view tabs on a project — create, reorder, and open saved filters.
 */

import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { NavLink, useNavigate } from 'react-router';

import { useEngine } from '~/app/context';
import { Button, IconButton, Input, Menu, Modal } from '~/components';
import {
  createView,
  deleteView,
  isFavorite,
  toggleFavorite,
  updateView,
} from '~/features/view/mutations';
import { EMPTY_FILTER } from '~/filter';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import { useViewerId } from '~/hooks/useViewer';
import type { Store, UUID, View } from '~/store';
import styles from './attachedViews.module.css';

function tabClass({ isActive }: { isActive: boolean }): string {
  const tab = styles.tab ?? '';
  const active = styles.tabActive ?? '';
  return isActive ? `${tab} ${active}`.trim() : tab;
}

export function attachedViewsForProject(store: Store, projectId: UUID): readonly View[] {
  return [...store.viewIdsForProject(projectId)]
    .map((id) => store.views.get(id))
    .filter((view): view is View => view !== undefined && view.archivedAt === undefined)
    .sort((a, b) => a.position.localeCompare(b.position) || a.name.localeCompare(b.name));
}

interface ProjectViewTabsProps {
  readonly projectId: UUID;
  readonly base: string;
}

export function ProjectViewTabs({ projectId, base }: ProjectViewTabsProps) {
  const engine = useEngine();
  const navigate = useNavigate();
  const menuTriggerRef = useRef<HTMLElement | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuViewId, setMenuViewId] = useState<UUID | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const nameRef = useRef<HTMLInputElement>(null);
  const [draggingId, setDraggingId] = useState<UUID | null>(null);

  const viewerId = useViewerId();

  const views = useLiveQuery(
    (store) => attachedViewsForProject(store, projectId),
    ['view'],
    [projectId],
  );

  const menuView = useMemo(
    () => (menuViewId === null ? null : (views.find((view) => view.id === menuViewId) ?? null)),
    [menuViewId, views],
  );

  const openCreate = useCallback(() => {
    setName('');
    setCreating(true);
  }, []);

  const submitCreate = useCallback(async () => {
    const trimmed = name.trim();
    if (trimmed === '') return;
    setCreating(false);
    const id = await createView(engine, {
      name: trimmed,
      projectId,
      filter: EMPTY_FILTER,
    });
    if (id !== '') void navigate(`${base}/view/${id}`);
  }, [base, engine, name, navigate, projectId]);

  const onDragStart = useCallback((id: UUID) => {
    setDraggingId(id);
  }, []);

  const onDragEnd = useCallback(() => {
    setDraggingId(null);
  }, []);

  const onDropAfter = useCallback(
    async (targetId: UUID) => {
      if (draggingId === null || draggingId === targetId) return;
      setDraggingId(null);
      await updateView(engine, draggingId, { afterViewId: targetId });
    },
    [draggingId, engine],
  );

  const onContextMenu = useCallback((event: ReactMouseEvent<HTMLElement>, viewId: UUID) => {
    event.preventDefault();
    menuTriggerRef.current = event.currentTarget;
    setMenuViewId(viewId);
    setMenuOpen(true);
  }, []);

  const closeMenu = useCallback(() => {
    setMenuOpen(false);
  }, []);

  const copyLink = useCallback(() => {
    if (menuView === null) return;
    const url = `${window.location.origin}/project/${projectId}/view/${menuView.id}`;
    void navigator.clipboard.writeText(url);
    closeMenu();
  }, [closeMenu, menuView, projectId]);

  const toggleStar = useCallback(async () => {
    if (menuView === null || viewerId === null) return;
    await toggleFavorite(engine, viewerId, 'view', menuView.id);
    closeMenu();
  }, [closeMenu, engine, menuView, viewerId]);

  const renameView = useCallback(async () => {
    if (menuView === null) return;
    const next = window.prompt('View name', menuView.name)?.trim();
    if (next === undefined || next === '' || next === menuView.name) {
      closeMenu();
      return;
    }
    await updateView(engine, menuView.id, { name: next });
    closeMenu();
  }, [closeMenu, engine, menuView]);

  const removeView = useCallback(async () => {
    if (menuView === null) return;
    if (!window.confirm(`Delete “${menuView.name}”?`)) return;
    await deleteView(engine, menuView.id);
    closeMenu();
    void navigate(`${base}/issues`);
  }, [base, closeMenu, engine, menuView, navigate]);

  const starred =
    menuView !== null &&
    viewerId !== null &&
    isFavorite(engine.store, viewerId, 'view', menuView.id);

  return (
    <>
      {views.map((view) => (
        <NavLink
          key={view.id}
          to={`${base}/view/${view.id}`}
          className={tabClass}
          draggable
          onDragStart={() => onDragStart(view.id)}
          onDragEnd={onDragEnd}
          onDragOver={(event) => event.preventDefault()}
          onDrop={() => void onDropAfter(view.id)}
          onContextMenu={(event) => onContextMenu(event, view.id)}
          data-dragging={draggingId === view.id ? true : undefined}
        >
          {view.name}
        </NavLink>
      ))}
      <IconButton
        aria-label="New view"
        className={styles.newTab}
        icon="+"
        onClick={openCreate}
      />

      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title="New view"
        description="A saved filter of this project's issues, shown as a tab."
        initialFocus={nameRef}
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreating(false)}>
              Cancel
            </Button>
            <Button onClick={() => void submitCreate()} disabled={name.trim() === ''}>
              Create
            </Button>
          </>
        }
      >
        <Input
          ref={nameRef}
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="View name"
          onKeyDown={(event) => {
            if (event.key === 'Enter') void submitCreate();
          }}
        />
      </Modal>

      <Menu
        open={menuOpen}
        onClose={closeMenu}
        trigger={menuTriggerRef}
        label="View options"
        items={[
          { id: 'copy', label: 'Copy link', onSelect: copyLink },
          ...(viewerId === null
            ? []
            : [
                {
                  id: 'favorite',
                  label: starred ? 'Unfavorite' : 'Favorite',
                  onSelect: () => void toggleStar(),
                },
              ]),
          { id: 'rename', label: 'Rename', onSelect: () => void renameView() },
          { id: 'delete', label: 'Delete', onSelect: () => void removeView(), danger: true },
        ]}
      />
    </>
  );
}
