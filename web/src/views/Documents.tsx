/**
 * Documents: the workspace's, a team's, or a project's.
 *
 * One screen serves three scopes, because they are the same list asked a narrower question.
 * `/documents` is everything the reader can see, grouped by the team or project it was filed
 * under; `/team/:key/documents` and `/project/:id/documents` are that same list with the
 * grouping already decided for them. Before this the screen only existed in the two narrow
 * forms, was in no sidebar, and could be reached only by typing a URL — so a document filed
 * on Tuesday was, for most of this product's surface area, gone.
 *
 * It is a scan, and a scan needs three things the bare `<ul>` here did not have. Columns, so
 * "which team is this one in" is answered by looking rather than by opening. A sort and a
 * search, because the answer to "where is the runbook" is a word, not a scroll. And the
 * keyboard, through `useListCursor`, so `j`/`k`/Enter work here exactly as they do on the
 * issue list — a list that answers the arrow keys everywhere except one screen is worse than
 * one that never did.
 *
 * Creating is not an input in the header any more. It was a text field beside a button that
 * went disabled instead of saying what was wrong, on a screen with no way to pick which team
 * the document belonged to — which is why it only worked at all on the two scoped routes.
 * The `document.create` action owns it now, so ⌘K offers it from anywhere, and the dialog
 * asks the one question the API requires.
 */

import { useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';

import { useEngine } from '~/app/context';
import { useKeyContext, useKeymap } from '~/app/keymap';
import {
  Button,
  ConfirmDialog,
  EmptyState,
  IconButton,
  Input,
  ListGroup,
  Menu,
  type MenuNode,
} from '~/components';
import { archiveDocument, deleteDocument } from '~/features/documents/mutations';
import { copyText } from '~/features/github/copy';
import { EntityLoading, useStoreSettled } from '~/features/entity-gate/EntityGate';
import { DotsGlyph } from '~/features/issue/glyphs';
import { report } from '~/features/issue/mutations';
import { exact, when } from '~/features/time';
import { entityRowMenuItems } from '~/features/entity/entityRowMenu';
import { useContextMenu } from '~/hooks/useContextMenu';
import { isFavorite, toggleFavorite } from '~/features/view/mutations';
import { useViewerId } from '~/hooks/useViewer';
import { useMenuTrigger } from '~/hooks/useMenuTrigger';
import { listRowDomId, useListCursor } from '~/hooks/useListCursor';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import { ApiError } from '~/sync/api';
import { compareOrderKeys } from '~/store';
import type { Document, Store, UUID } from '~/store';

import styles from './Documents.module.css';

/** How the list is ordered. Kept in component state: it is a preference, not a place. */
export type DocumentSort = 'updated' | 'created' | 'title';

const SORTS: readonly { readonly value: DocumentSort; readonly label: string }[] = [
  { value: 'updated', label: 'Last updated' },
  { value: 'created', label: 'Recently created' },
  { value: 'title', label: 'Title' },
];

interface DocumentRow {
  readonly id: UUID;
  readonly title: string;
  readonly updatedAt: string;
  readonly createdAt: string;
  readonly sortOrder: string;
  /** The group this row is filed in, and the words that name it in the scope column. */
  readonly groupKey: string;
  readonly groupName: string;
  readonly scope: string;
}

interface DocumentGroup {
  readonly key: string;
  readonly name: string;
  readonly rows: readonly DocumentRow[];
}

const PREFERENCE_KEY = 'documents';

export function Documents() {
  const navigate = useNavigate();
  const engine = useEngine();
  const viewerId = useViewerId();
  const { teamKey, projectId } = useParams<{ teamKey?: string; projectId?: string }>();
  const { registry, context } = useKeymap();
  const settled = useStoreSettled();

  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<DocumentSort>('updated');
  const [failure, setFailure] = useState<string | null>(null);
  /** Which destructive answer is outstanding, and whether its request is in flight. */
  const [confirming, setConfirming] = useState<{
    readonly kind: 'archive' | 'delete';
    readonly id: UUID;
    readonly title: string;
  } | null>(null);
  const [removing, setRemoving] = useState(false);

  const sortTrigger = useMenuTrigger();
  // The ⋯ menu is one menu shared by every row, anchored to whichever button opened it —
  // a trigger ref per row would be a ref per document, rebuilt on every delta.
  const [rowMenuId, setRowMenuId] = useState<UUID | null>(null);
  const [rowMenuOpen, setRowMenuOpen] = useState(false);
  const rowMenuTrigger = useRef<HTMLButtonElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);

  const team = useLiveQuery(
    (store) =>
      teamKey === undefined
        ? null
        : ([...store.teams.values()].find((candidate) => candidate.key === teamKey) ?? null),
    ['team'],
    [teamKey ?? ''],
  );

  const project = useLiveQuery(
    (store) => (projectId === undefined ? null : (store.projects.get(projectId) ?? null)),
    ['project'],
    [projectId ?? ''],
  );

  const rows = useLiveQuery(
    (store) => listDocuments(store, team?.id, project?.id),
    ['document', 'team', 'project'],
    [team?.id ?? '', project?.id ?? ''],
  );

  const groups = useMemo(() => groupRows(rows, query, sort), [rows, query, sort]);
  const visible = useMemo(() => groups.flatMap((group) => group.rows), [groups]);
  const ids = useMemo(() => visible.map((row) => row.id), [visible]);

  useKeyContext('list');
  const cursor = useListCursor({
    ids,
    prefix: 'documentList',
    noun: 'document',
    onOpen: (id) => void navigate(`/document/${id}`),
  });

  const contextMenu = useContextMenu<UUID>({
    onOpen: (id) => cursor.setCursor(id),
    returnFocusTo: scrollerRef,
  });

  const create = () => registry.invoke('document.create', { source: 'menu', context });

  const heading =
    project !== null
      ? `${project.name} documents`
      : team !== null
        ? `${team.name} documents`
        : 'Documents';

  const closeMenus = () => {
    setRowMenuOpen(false);
    setRowMenuId(null);
    contextMenu.close();
  };

  const itemsFor = (row: DocumentRow): MenuNode[] => {
    const favorited = viewerId !== null && isFavorite(engine.store, viewerId, 'document', row.id);
    return entityRowMenuItems(
      { noun: 'document', name: row.title, favorited },
      {
        open: () => {
          closeMenus();
          void navigate(`/document/${row.id}`);
        },
        copyLink: () => {
          closeMenus();
          void copyText(`${window.location.origin}/document/${row.id}`);
        },
        ...(viewerId === null
          ? {}
          : {
              toggleFavorite: () => {
                closeMenus();
                toggleFavorite(engine, viewerId, 'document', row.id).catch(report);
              },
            }),
        archive: () => {
          closeMenus();
          setFailure(null);
          setConfirming({ kind: 'archive', id: row.id, title: row.title });
        },
        archiveLabel: 'Archive document',
        askDelete: () => {
          closeMenus();
          setFailure(null);
          setConfirming({ kind: 'delete', id: row.id, title: row.title });
        },
        deleteLabel: 'Delete document',
      },
    );
  };

  const confirmRemoval = () => {
    if (confirming === null) return;
    const archiving = confirming.kind === 'archive';
    setRemoving(true);
    setFailure(null);
    const work = archiving
      ? archiveDocument(engine, confirming.id, true)
      : deleteDocument(engine, confirming.id);
    void work
      .then(() => setConfirming(null))
      .catch((error: unknown) =>
        setFailure(
          error instanceof ApiError && error.message !== ''
            ? error.message
            : archiving
              ? 'That could not be archived.'
              : 'That could not be deleted.',
        ),
      )
      .finally(() => setRemoving(false));
  };

  const menuRow = visible.find((row) => row.id === rowMenuId) ?? null;
  const contextRow = visible.find((row) => row.id === contextMenu.id) ?? null;

  return (
    <div className={styles.screen}>
      <header className={styles.header}>
        <h1 className={styles.title}>{heading}</h1>
        <Input
          label="Search documents"
          hideLabel
          surface="plain"
          className={styles.search}
          placeholder="Search documents…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <Button {...sortTrigger.props} variant="ghost">
          {SORTS.find((option) => option.value === sort)?.label ?? 'Last updated'}
        </Button>
        <Menu
          open={sortTrigger.open}
          onClose={sortTrigger.hide}
          trigger={sortTrigger.ref}
          label="Sort documents"
          items={SORTS.map((option) => ({
            id: option.value,
            label: option.label,
            selected: option.value === sort,
            onSelect: () => setSort(option.value),
          }))}
        />
        <Button variant="primary" onClick={create}>
          New document
        </Button>
      </header>

      {/* A refusal that has nowhere else to go. While the confirmation is up it is shown
          inside the dialog instead, beside the button that was refused. */}
      {failure === null || confirming !== null ? null : (
        <p className={styles.error} role="alert">
          {failure}
        </p>
      )}

      {rows.length === 0 && !settled ? (
        <EntityLoading label="Loading documents…" lines={5} />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No documents yet"
          description="Team runbooks, project specs and meeting notes live here as markdown until collaborative editing lands."
          action={
            <Button variant="primary" onClick={create}>
              Create a document
            </Button>
          }
        />
      ) : visible.length === 0 ? (
        <EmptyState
          title={`No documents match “${query.trim()}”`}
          description="Titles only, for now — the body is not searched from here."
        />
      ) : (
        <div
          ref={scrollerRef}
          className={styles.list}
          role="listbox"
          aria-label={heading}
          aria-activedescendant={
            cursor.cursorId === null ? undefined : listRowDomId('documentList', cursor.cursorId)
          }
          tabIndex={0}
        >
          {groups.map((group) => (
            <ListGroup
              key={group.key}
              groupKey={group.key}
              preferenceKey={PREFERENCE_KEY}
              name={group.name}
              count={group.rows.length}
            >
              <ul role="presentation" className={styles.groupList}>
                {group.rows.map((row) => (
                  <li
                    key={row.id}
                    {...cursor.rowProps(row.id)}
                    role="option"
                    className={[styles.item, row.id === cursor.cursorId ? styles.cursorItem : null]
                      .filter(Boolean)
                      .join(' ')}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      contextMenu.openAt(event.clientX, event.clientY, row.id);
                    }}
                  >
                    <Link
                      to={`/document/${row.id}`}
                      className={styles.row}
                      onClick={() => cursor.setCursor(row.id)}
                    >
                      <span className={styles.name}>{row.title}</span>
                      <span className={styles.scope}>{row.scope}</span>
                      <time
                        className={styles.meta}
                        dateTime={row.updatedAt}
                        title={exact(row.updatedAt)}
                      >
                        {when(row.updatedAt)}
                      </time>
                    </Link>
                    <IconButton
                      aria-label={`Options for ${row.title}`}
                      size="sm"
                      className={styles.menuButton}
                      icon={<DotsGlyph />}
                      onClick={(event) => {
                        event.preventDefault();
                        rowMenuTrigger.current = event.currentTarget;
                        setRowMenuId(row.id);
                        cursor.setCursor(row.id);
                        setRowMenuOpen(true);
                      }}
                    />
                  </li>
                ))}
              </ul>
            </ListGroup>
          ))}
        </div>
      )}

      <Menu
        open={rowMenuOpen && menuRow !== null}
        onClose={closeMenus}
        trigger={rowMenuTrigger}
        label={menuRow === null ? 'Document options' : `Options for ${menuRow.title}`}
        keysPresentation="kbd"
        density="compact"
        items={menuRow === null ? [] : itemsFor(menuRow)}
      />

      {contextMenu.at === null ? null : <div {...contextMenu.anchorProps} />}
      <Menu
        open={contextMenu.at !== null && contextRow !== null}
        onClose={contextMenu.close}
        trigger={contextMenu.anchorRef}
        label={contextRow === null ? 'Document options' : `Options for ${contextRow.title}`}
        keysPresentation="kbd"
        density="compact"
        items={contextRow === null ? [] : itemsFor(contextRow)}
      />

      <ConfirmDialog
        open={confirming !== null}
        title={confirming?.kind === 'archive' ? 'Archive this document?' : 'Delete this document?'}
        consequence={
          confirming === null
            ? ''
            : confirming.kind === 'archive'
              ? `“${confirming.title}” leaves this list and stays in the archive, where it can be restored.`
              : `“${confirming.title}” and everything written in it go for good. There is no undo.`
        }
        confirmLabel={confirming?.kind === 'archive' ? 'Archive' : 'Delete'}
        destructive={confirming?.kind === 'delete'}
        busy={removing}
        error={confirming === null ? undefined : (failure ?? undefined)}
        onConfirm={confirmRemoval}
        onClose={() => {
          setConfirming(null);
          setFailure(null);
        }}
      />
    </div>
  );
}

/**
 * The rows this screen can see, narrowed to whichever scope its route names.
 *
 * The team route keeps its old rule — a team's own documents, not its projects' — because
 * that is the list a team home links to. The workspace route takes everything, and lets the
 * grouping say where each row lives.
 */
function listDocuments(store: Store, teamId?: UUID, projectId?: UUID): readonly DocumentRow[] {
  const documents =
    projectId !== undefined
      ? idsToDocuments(store, store.documentIdsForProject(projectId))
      : teamId !== undefined
        ? idsToDocuments(store, store.documentIdsForTeam(teamId)).filter(
            (row) => row.projectId === undefined,
          )
        : [...store.documents.values()];

  return documents
    .sort((a, b) => compareOrderKeys(a.sortOrder, b.sortOrder) || a.title.localeCompare(b.title))
    .map((row) => {
      const project = row.projectId === undefined ? undefined : store.projects.get(row.projectId);
      const team = store.get('team', row.teamId);
      const teamName = team?.name ?? 'Unknown team';
      return {
        id: row.id,
        title: row.title,
        updatedAt: row.updatedAt,
        createdAt: row.createdAt,
        sortOrder: row.sortOrder,
        groupKey: project === undefined ? `team:${row.teamId}` : `project:${project.id}`,
        groupName: project === undefined ? teamName : `${teamName} › ${project.name}`,
        scope: project === undefined ? teamName : project.name,
      };
    });
}

function idsToDocuments(store: Store, ids: ReadonlySet<UUID>): Document[] {
  return [...ids]
    .map((id) => store.get('document', id))
    .filter((row): row is Document => row !== undefined);
}

/**
 * The search, the sort and the grouping, in that order.
 *
 * Groups are kept in the order their first row arrives in, which after the sort means the
 * team with the most recent document is at the top — the same rule the rows inside them
 * follow, so the screen reads consistently rather than alphabetically by accident.
 */
export function groupRows(
  rows: readonly DocumentRow[],
  query: string,
  sort: DocumentSort,
): readonly DocumentGroup[] {
  const needle = query.trim().toLowerCase();
  const matched =
    needle === '' ? rows : rows.filter((row) => row.title.toLowerCase().includes(needle));

  const ordered = [...matched].sort((a, b) => {
    if (sort === 'title') return a.title.localeCompare(b.title);
    if (sort === 'created') return b.createdAt.localeCompare(a.createdAt);
    return b.updatedAt.localeCompare(a.updatedAt);
  });

  const groups = new Map<string, DocumentRow[]>();
  const names = new Map<string, string>();
  for (const row of ordered) {
    names.set(row.groupKey, row.groupName);
    const held = groups.get(row.groupKey);
    if (held === undefined) groups.set(row.groupKey, [row]);
    else held.push(row);
  }

  return [...groups.entries()].map(([key, groupRows]) => ({
    key,
    name: names.get(key) ?? '',
    rows: groupRows,
  }));
}
