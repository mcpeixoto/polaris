/**
 * One document: where it lives, what it is called, and the markdown it holds.
 *
 * The body is a textarea, deliberately — collaborative editing is a later slice and the
 * field currently holds plain markdown, same as issue descriptions. It reads as a rendered
 * document until somebody puts the caret in it.
 *
 * Three things about this screen were the last of their kind in the product.
 *
 * It had a back link where every other detail screen has a breadcrumb, and that link was
 * built out of a team key with an `'unknown'` fallback — so a document whose team had not
 * arrived in the replica yet offered a link to `/team/unknown/documents`, a page that cannot
 * exist. The trail is now built from the team when there is one and from the workspace list
 * when there is not, and the record itself is behind `EntityGate` like every other detail
 * route, which is what makes "not here yet" and "not here" different answers.
 *
 * It had a Save button standing beside an autosave that already fired on blur, on unmount
 * and on the tab being hidden — two mechanisms for one job, with nothing on screen saying
 * which of them had just happened. The autosave stays and is now *visible*, through
 * `SaveIndicator`; the explicit save stays too, as `document.save` on ⌘S, because "send it
 * now" is a real thing to want and a keystroke does not compete with the automatic one for
 * space or for attention.
 *
 * And its title was a single-line `Input`, so a long one scrolled sideways out of sight.
 * `TitleField` wraps, commits on blur, and flushes on the way out — the same field the issue
 * and project screens rename themselves from.
 */

import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router';

import { useEngine } from '~/app/context';
import { useActions, useKeyContext } from '~/app/keymap';
import {
  Breadcrumb,
  Button,
  ConfirmDialog,
  EmptyState,
  IconButton,
  Menu,
  SaveIndicator,
  Textarea,
  TitleField,
  useSaveState,
  type MenuNode,
  type TitleHandle,
} from '~/components';
import { archiveDocument, deleteDocument, updateDocument } from '~/features/documents/mutations';
import { EntityGate } from '~/features/entity-gate/EntityGate';
import { entityRowMenuItems } from '~/features/entity/entityRowMenu';
import { copyText } from '~/features/github/copy';
import { DotsGlyph, StarGlyph } from '~/features/issue/glyphs';
import { Markdown } from '~/features/markdown/Markdown';
import { report } from '~/features/subscriptions/mutations';
import { isFavorite, toggleFavorite } from '~/features/view/mutations';
import { useContextMenu } from '~/hooks/useContextMenu';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import { useMenuTrigger } from '~/hooks/useMenuTrigger';
import { useViewerId } from '~/hooks/useViewer';
import { ApiError } from '~/sync/api';
import styles from './DocumentDetail.module.css';

export function DocumentDetail() {
  const navigate = useNavigate();
  const engine = useEngine();
  const location = useLocation();
  const viewerId = useViewerId();
  const { documentId = '' } = useParams<{ documentId: string }>();
  const titleRef = useRef<TitleHandle | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const more = useMenuTrigger();
  const contextMenu = useContextMenu<string>();

  const document = useLiveQuery(
    (store) => store.documents.get(documentId) ?? null,
    ['document'],
    [documentId],
  );

  const team = useLiveQuery(
    (store) => (document === null ? null : (store.get('team', document.teamId) ?? null)),
    ['team'],
    [document?.teamId ?? ''],
  );

  const favourite = useLiveQuery(
    (store) => viewerId !== null && isFavorite(store, viewerId, 'document', documentId),
    ['favorite'],
    [documentId, viewerId],
  );

  // Seeded from the replica rather than from an empty string. Filling it a frame later is a
  // frame in which the screen claims the document has no body — and a frame in which
  // anything typed is thrown away by the very first run of the effect below, because a
  // document nobody has loaded yet counts as switched.
  const [body, setBody] = useState(document?.body ?? '');
  const [bodyDirty, setBodyDirty] = useState(false);
  // Which of the two destructive actions is waiting on an answer, and whether its request is
  // in flight. Both used to be one ghost button away from happening by accident.
  const [confirming, setConfirming] = useState<'archive' | 'delete' | null>(null);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  // The body is read as rendered markdown until somebody puts the caret in it. `editing` is
  // what swaps the two; the textarea itself never leaves the DOM, because it is the field's
  // accessible representation and the value every other effect on this screen reads.
  const [editing, setEditing] = useState(false);

  const saving = useSaveState((failure) =>
    failure instanceof ApiError && failure.message !== ''
      ? failure.message
      : 'That could not be saved just now.',
  );

  // The body as it stands *now*, readable from a callback that has been waiting on the
  // network. A save closes over the value it sent, which is not necessarily the value on the
  // screen by the time the server answers.
  const showing = useRef(body);
  useEffect(() => {
    showing.current = body;
  }, [body]);

  /**
   * The edit as it stands, for the exits that do not blur the field.
   *
   * Saving on blur alone made this screen inconsistent in a way no mental model survives.
   * Clicking the breadcrumb saved, because the click moves focus out of the textarea first.
   * Browser Back did not. Reloading did not. So the rule was neither "an explicit save is
   * the only thing that counts" nor "your work is kept" — it was "clicking away saves and
   * everything else throws it out", which cannot be learned and cannot be relied on.
   *
   * Resolved towards keeping the work, because that is what the rest of the product already
   * does, and a document is the surface where somebody is most likely to have written
   * something that exists nowhere else.
   */
  const pending = useRef<{ id: string; body: string; dirty: boolean } | null>(null);
  useEffect(() => {
    pending.current = document === null ? null : { id: document.id, body, dirty: bodyDirty };
  }, [document, body, bodyDirty]);

  useEffect(() => {
    const flush = () => {
      const edit = pending.current;
      pending.current = null;
      if (edit === null || !edit.dirty) return;
      updateDocument(engine, { id: edit.id, body: edit.body }).catch(() => {
        // The screen is going. A refusal here has nowhere to be shown, and the write is in
        // the outbox if it was merely the network.
      });
    };
    const onHidden = () => {
      if (globalThis.document.visibilityState === 'hidden') flush();
    };
    globalThis.document.addEventListener('visibilitychange', onHidden);
    return () => {
      globalThis.document.removeEventListener('visibilitychange', onHidden);
      flush();
    };
  }, [engine]);

  // Adopt what the store says — but never over the top of an unsaved edit. Any change to
  // this document re-runs the effect, including one that touches the title, and a teammate
  // renaming the document used to wipe a half-written body out of the textarea mid-sentence
  // with no way to get it back.
  //
  // Moving to a *different* document reloads unconditionally: the field belongs to whatever
  // the route points at, and carrying one document's draft onto another would save it there.
  const loaded = useRef<string | null>(document?.id ?? null);
  useEffect(() => {
    if (document === null) return;
    const switched = loaded.current !== document.id;
    loaded.current = document.id;
    if (switched) {
      setBody(document.body);
      setBodyDirty(false);
      return;
    }
    if (!bodyDirty) setBody(document.body);
  }, [document?.id, document?.body, document, bodyDirty]);

  /**
   * Send the body, and say so.
   *
   * Only a field that has not moved since the request left is clean. Typing does not stop
   * while a save is in flight — a slow connection is when it is most likely to carry on —
   * and clearing the flag for a body that did move hands the effect above permission to
   * replace those keystrokes with the value that was sent.
   */
  const saveBody = async () => {
    if (document === null || !bodyDirty) return;
    const sent = body;
    const ok = await saving.run(() => updateDocument(engine, { id: document.id, body: sent }));
    if (ok && showing.current === sent) setBodyDirty(false);
  };

  const rename = (title: string) => {
    if (document === null) return;
    void saving.run(() => updateDocument(engine, { id: document.id, title }));
  };

  const copyLink = () => {
    if (document !== null) void copyText(`${window.location.origin}/document/${document.id}`);
  };

  const toggleFavourite = () => {
    if (viewerId === null || document === null) return;
    toggleFavorite(engine, viewerId, 'document', document.id).catch(report);
  };

  // Landed here straight from the create dialog: the point of making a document is writing
  // in it, and the old flow left the caret nowhere.
  const focusBody = (location.state as { focusBody?: boolean } | null)?.focusBody === true;
  // Once, and only for the document that was just made: the effect re-runs on every delta
  // this document receives, and a version without the latch would drag the caret back into
  // the body each time somebody else touched the row.
  const focused = useRef(false);
  useEffect(() => {
    if (!focusBody || document === null || focused.current) return;
    focused.current = true;
    bodyRef.current?.focus();
    setEditing(true);
  }, [focusBody, document]);

  useKeyContext('detail');
  useActions(
    [
      {
        id: 'document.rename',
        title: 'Rename document',
        keys: ['e'],
        when: 'detail',
        group: 'Documents',
        enabled: () => document !== null,
        run: () => titleRef.current?.focus(),
      },
      {
        // Escape while the title is being typed abandons the edit. Registered here rather
        // than inside the field for the reason every other one is: the registry lives above
        // it, and an unfocused field must not hold Escape hostage from the rest of the page.
        id: 'document.rename.cancel',
        title: 'Stop renaming the document',
        keys: ['Escape'],
        when: 'detail',
        group: 'Documents',
        enabled: () => titleRef.current?.editing() === true,
        run: () => titleRef.current?.revert(),
      },
      {
        // The body saves itself; this is "send it now". It is a keystroke rather than a
        // button because a button beside a working autosave reads as the thing that does
        // the saving, which is how this screen came to have two of them.
        id: 'document.save',
        title: 'Save document',
        keys: ['mod+s'],
        when: 'detail',
        group: 'Documents',
        enabled: () => document !== null,
        run: () => void saveBody(),
      },
      {
        id: 'document.copyLink',
        title: 'Copy link to document',
        when: 'detail',
        group: 'Documents',
        enabled: () => document !== null,
        run: copyLink,
      },
      {
        id: 'document.favorite',
        title: 'Favourite document',
        when: 'detail',
        group: 'Documents',
        enabled: () => viewerId !== null && document !== null,
        run: toggleFavourite,
      },
      {
        id: 'document.delete',
        title: 'Delete document',
        when: 'detail',
        group: 'Documents',
        enabled: () => document !== null,
        run: () => setConfirming('delete'),
      },
    ],
    [document, viewerId, body, bodyDirty],
  );

  const confirmRemoval = () => {
    if (confirming === null || document === null) return;
    const archiving = confirming === 'archive';
    setRemoving(true);
    setRemoveError(null);
    const work = archiving
      ? archiveDocument(engine, document.id, true)
      : deleteDocument(engine, document.id);
    void work
      .then(() => {
        setConfirming(null);
        void navigate(listPath);
      })
      .catch((error: unknown) =>
        setRemoveError(
          error instanceof ApiError && error.message !== ''
            ? error.message
            : archiving
              ? 'That could not be archived.'
              : 'That could not be deleted.',
        ),
      )
      .finally(() => setRemoving(false));
  };

  /**
   * Where the trail goes back to.
   *
   * A project's documents when it has one, its team's when the team is in the replica, and
   * the workspace list otherwise. That last branch is the point: the old code wrote the
   * team's key into the URL with `'unknown'` as its fallback, which is a link to a page that
   * cannot exist.
   */
  const listPath =
    document?.projectId !== undefined
      ? `/project/${document.projectId}/documents`
      : team !== null
        ? `/team/${team.key}/documents`
        : '/documents';

  const closeMenus = () => {
    more.hide();
    contextMenu.close();
  };

  /**
   * `Documents.tsx`'s menu, from the same builder, less `Open document` — this is the document
   * it would open. Everything else, wording and order, is the list's.
   */
  const menuItems = (): MenuNode[] =>
    entityRowMenuItems(
      { noun: 'document', name: document?.title, favorited: favourite },
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
        archive: () => {
          closeMenus();
          setConfirming('archive');
        },
        archiveLabel: 'Archive document',
        askDelete: () => {
          closeMenus();
          setConfirming('delete');
        },
        deleteLabel: 'Delete document',
      },
    );

  return (
    <EntityGate
      entity={document}
      label="Loading document…"
      lines={8}
      missing={
        <EmptyState
          title="No such document"
          description="It may have been deleted or archived, or it may belong to a team you cannot see."
          action={<Button onClick={() => navigate(-1)}>Go back</Button>}
        />
      }
    >
      {() => {
        if (document === null) return null;

        return (
          <article className={styles.screen}>
            <header
              className={styles.header}
              onContextMenu={(event) => {
                event.preventDefault();
                contextMenu.openAt(event.clientX, event.clientY, document.id);
              }}
            >
              <Breadcrumb
                className={styles.crumbs}
                items={[
                  // The team, then this document's list, then the document. The first crumb
                  // goes to the team rather than to its documents, so the two steps are two
                  // destinations — a trail whose crumbs are the same link is one crumb.
                  ...(team === null ? [] : [{ label: team.name, to: `/team/${team.key}` }]),
                  { label: 'Documents', to: listPath },
                  { label: document.title },
                ]}
              />
              <SaveIndicator state={saving.state} className={styles.indicator} />
              <div className={styles.actions}>
                {viewerId === null ? null : (
                  <IconButton
                    icon={<StarGlyph on={favourite} />}
                    aria-label={favourite ? 'Remove from favourites' : 'Add to favourites'}
                    aria-pressed={favourite}
                    onClick={toggleFavourite}
                  />
                )}
                <IconButton
                  {...more.props}
                  icon={<DotsGlyph />}
                  aria-label="Document options"
                  onClick={more.toggle}
                />
                <Menu
                  open={more.open}
                  onClose={more.hide}
                  trigger={more.ref}
                  label="Document options"
                  items={menuItems()}
                />
              </div>
            </header>

            {contextMenu.at === null ? null : <div {...contextMenu.anchorProps} />}
            <Menu
              open={contextMenu.at !== null}
              onClose={contextMenu.close}
              trigger={contextMenu.anchorRef}
              label={`Options for ${document.title}`}
              items={menuItems()}
            />

            {saving.error === undefined ? null : (
              <p className={styles.error} role="alert">
                {saving.error}
              </p>
            )}

            <TitleField
              key={`document-title-${document.id}`}
              subjectId={document.id}
              value={document.title}
              label="Title"
              handle={titleRef}
              className={styles.title}
              onSave={rename}
            />

            <div className={styles.bodyWrap}>
              <Textarea
                ref={bodyRef}
                label="Body"
                hideLabel
                surface="plain"
                className={styles.body}
                value={body}
                minRows={16}
                onFocus={() => setEditing(true)}
                onChange={(event) => {
                  setBody(event.target.value);
                  setBodyDirty(true);
                }}
                onBlur={() => {
                  setEditing(false);
                  void saveBody();
                }}
              />
              {editing ? null : (
                /*
                 * The document as it reads, laid over the field that holds its source.
                 *
                 * A document was stored as markdown and shown as markdown, so every reader
                 * saw `## Heading` where a heading belonged. This is the read side of that:
                 * it is `aria-hidden`, carries no focus stops of its own and is transparent
                 * to the pointer, so the textarea underneath is still the field in every
                 * sense — a click lands on it and focuses it natively, which is what swaps
                 * this layer away. Duplicating the body in the accessibility tree would
                 * announce it twice.
                 */
                <div className={styles.reader} aria-hidden="true">
                  {body.trim() === '' ? (
                    <p className={styles.placeholder}>Empty. Click to write.</p>
                  ) : (
                    <Markdown source={body} interactive={false} />
                  )}
                </div>
              )}
            </div>

            <ConfirmDialog
              open={confirming !== null}
              title={confirming === 'archive' ? 'Archive this document?' : 'Delete this document?'}
              consequence={
                confirming === 'archive'
                  ? `“${document.title}” leaves the documents list and stays in the archive, where it can be restored.`
                  : `“${document.title}” and everything written in it go for good. There is no undo.`
              }
              confirmLabel={confirming === 'archive' ? 'Archive' : 'Delete'}
              destructive={confirming === 'delete'}
              busy={removing}
              error={removeError ?? undefined}
              onConfirm={confirmRemoval}
              onClose={() => {
                setConfirming(null);
                setRemoveError(null);
              }}
            />
          </article>
        );
      }}
    </EntityGate>
  );
}
