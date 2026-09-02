/**
 * Attached view tabs on a project — create, reorder, and open saved filters.
 *
 * Rename and delete are the product's own dialogs rather than `window.prompt` and
 * `window.confirm`: the native pair cannot be themed, cannot be reached by the keymap, and
 * on delete asks a yes/no question without naming what is lost. The "New view" modal below
 * was already the right shape, so rename reuses it and delete uses `ConfirmDialog`.
 *
 * Every write here goes through `run`, because a tab bar that silently drops a failed
 * reorder or a failed delete looks like it worked until the next reload disagrees.
 */

import { useCallback, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { NavLink, useNavigate } from 'react-router';

import { useEngine } from '~/app/context';
import { Button, ConfirmDialog, IconButton, Input, Menu, Modal } from '~/components';
import { report } from '~/features/issue/mutations';
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
import { byOrderKeyThen } from '~/store';
import type { Store, UUID, View } from '~/store';
import { ApiError } from '~/sync/api';
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
    .sort(byOrderKeyThen('position', 'name'));
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
  const [renaming, setRenaming] = useState(false);
  const [renameName, setRenameName] = useState('');
  const renameRef = useRef<HTMLInputElement>(null);
  const [removing, setRemoving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
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

  /**
   * One place a write can fail loudly. `fallback` is what to say when the server did not
   * send words of its own — an offline outbox rejection carries none.
   */
  const run = useCallback(async (fallback: string, write: () => Promise<unknown>) => {
    setError(null);
    setBusy(true);
    try {
      await write();
      return true;
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : fallback);
      report(failure);
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  const openCreate = useCallback(() => {
    setName('');
    setError(null);
    setCreating(true);
  }, []);

  const submitCreate = useCallback(async () => {
    const trimmed = name.trim();
    if (trimmed === '') return;
    setCreating(false);
    let id = '';
    const ok = await run('That view could not be created.', async () => {
      id = await createView(engine, { name: trimmed, projectId, filter: EMPTY_FILTER });
    });
    if (ok && id !== '') void navigate(`${base}/view/${id}`);
  }, [base, engine, name, navigate, projectId, run]);

  const onDragStart = useCallback((id: UUID) => {
    setDraggingId(id);
  }, []);

  const onDragEnd = useCallback(() => {
    setDraggingId(null);
  }, []);

  const onDropAfter = useCallback(
    async (targetId: UUID) => {
      if (draggingId === null || draggingId === targetId) return;
      const movingId = draggingId;
      setDraggingId(null);
      await run('That view could not be moved.', () =>
        updateView(engine, movingId, { afterViewId: targetId }),
      );
    },
    [draggingId, engine, run],
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
    const id = menuView.id;
    closeMenu();
    await run('That view could not be favourited.', () =>
      toggleFavorite(engine, viewerId, 'view', id),
    );
  }, [closeMenu, engine, menuView, run, viewerId]);

  const openRename = useCallback(() => {
    if (menuView === null) return;
    setRenameName(menuView.name);
    setError(null);
    closeMenu();
    setRenaming(true);
  }, [closeMenu, menuView]);

  const submitRename = useCallback(async () => {
    if (menuView === null) return;
    const next = renameName.trim();
    if (next === '' || next === menuView.name) {
      setRenaming(false);
      return;
    }
    setRenaming(false);
    await run('That view could not be renamed.', () =>
      updateView(engine, menuView.id, { name: next }),
    );
  }, [engine, menuView, renameName, run]);

  const openRemove = useCallback(() => {
    if (menuView === null) return;
    setError(null);
    closeMenu();
    setRemoving(true);
  }, [closeMenu, menuView]);

  const confirmRemove = useCallback(async () => {
    if (menuView === null) return;
    const ok = await run('That view could not be deleted.', () => deleteView(engine, menuView.id));
    if (!ok) return;
    setRemoving(false);
    void navigate(`${base}/issues`);
  }, [base, engine, menuView, navigate, run]);

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
      <IconButton aria-label="New view" className={styles.newTab} icon="+" onClick={openCreate} />

      {/* Beside the tabs rather than in a toast: the failure belongs to the row of tabs the
          reader is looking at, and a toast is gone before a reorder is retried. Suppressed
          while the delete dialog is up, which shows the same message in its own alert. */}
      {error === null || removing ? null : (
        <span className={styles.error} role="alert">
          {error}
        </span>
      )}

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
            <Button
              variant="primary"
              onClick={() => void submitCreate()}
              disabled={name.trim() === ''}
            >
              Create view
            </Button>
          </>
        }
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (name.trim() !== '') void submitCreate();
          }}
        >
          <Input
            ref={nameRef}
            label="View name"
            hideLabel
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="View name"
          />
        </form>
      </Modal>

      <Modal
        open={renaming}
        onClose={() => setRenaming(false)}
        title="Rename view"
        description="Everyone with access to this project sees the new name."
        initialFocus={renameRef}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRenaming(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => void submitRename()}
              disabled={renameName.trim() === ''}
            >
              Rename view
            </Button>
          </>
        }
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (renameName.trim() !== '') void submitRename();
          }}
        >
          <Input
            ref={renameRef}
            label="View name"
            value={renameName}
            onChange={(event) => setRenameName(event.target.value)}
          />
        </form>
      </Modal>

      <ConfirmDialog
        open={removing}
        title={menuView === null ? 'Delete view' : `Delete ${menuView.name}?`}
        consequence="The tab goes away for everyone on this project. The issues it filtered are untouched."
        confirmLabel="Delete view"
        destructive
        busy={busy}
        error={error ?? undefined}
        onConfirm={() => void confirmRemove()}
        onClose={() => setRemoving(false)}
      />

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
          { id: 'rename', label: 'Rename', onSelect: openRename },
          { id: 'delete', label: 'Delete', onSelect: openRemove, danger: true },
        ]}
      />
    </>
  );
}
