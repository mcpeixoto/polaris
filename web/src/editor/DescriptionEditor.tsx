/**
 * Issue description with inline comment marks.
 *
 * The field is still markdown in a textarea — the overlay behind it paints the spans, and
 * a click on a caret inside a span opens the thread. Select text and ⌘⌥M (or the Comment
 * button) starts a thread; resolve lives on the root, same as an issue-thread comment.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';

import { useActions, useKeyContext } from '~/app/keymap';
import { useEngine } from '~/app/context';
import { Button, Checkbox, Textarea, useNativeValue } from '~/components';
import { postComment, report, resolveComment } from '~/features/issue/mutations';
import { maybeExpandEmoticons } from '~/features/prefs/emoticons';
import { exact, when } from '~/features/time';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import type { Comment, UUID } from '~/store';
import { ApiError } from '~/sync/api';

import { insertBlock, type BlockKind } from './blocks';
import { applyEnterRule, applySpaceRule, type EditorState } from './inputRules';
import { Markdown } from './Markdown';
import {
  hitTest,
  isInlineRoot,
  paint,
  placeAnchors,
  type CommentAnchor,
  type TextSegment,
} from './marks';
import { SlashMenu } from './SlashMenu';
import styles from './DescriptionEditor.module.css';

interface DescriptionEditorProps {
  readonly issueId: UUID;
  readonly description: string;
  readonly onSave: (description: string) => void;
  readonly names: Record<string, string>;
  readonly viewerId: UUID | null;
  readonly enterSubmits: boolean;
}

interface Draft {
  readonly start: number;
  readonly end: number;
  readonly quote: string;
}

export function DescriptionEditor({
  issueId,
  description,
  onSave,
  names,
  viewerId,
  enterSubmits,
}: DescriptionEditorProps) {
  const engine = useEngine();
  const areaRef = useRef<HTMLTextAreaElement | null>(null);
  const backdropRef = useRef<HTMLPreElement | null>(null);
  const slashAnchorRef = useRef<HTMLSpanElement | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [selection, setSelection] = useState<Draft | null>(null);
  const [pending, setPending] = useState<Draft | null>(null);
  const [openId, setOpenId] = useState<UUID | null>(null);
  const [showResolved, setShowResolved] = useState(false);
  const [composer, setComposer] = useState('');
  const [composerFocused, setComposerFocused] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  /** Offset of the `/` that opened the block menu, or null when it is closed. */
  const [slashAt, setSlashAt] = useState<number | null>(null);

  const text = draft ?? description;

  /**
   * The edit in flight, for the exits that are not a blur.
   *
   * Saving on blur is the model, and it holds for every way of leaving the field that moves
   * focus first — clicking a link, tabbing out, opening the command menu. It does not hold
   * for the ways that take the whole screen away without focusing anything else: the back
   * button, a reload, closing the tab. Those left a typed description in a textarea that
   * React then dropped, and the writer got no hint that anything was gone.
   *
   * The pending edit carries the save callback captured at the keystroke rather than the one
   * this component happens to hold when the flush runs, so a flush triggered by a route
   * change cannot write one issue's description onto the next one's.
   */
  const flight = useRef<{ text: string; base: string; save: (next: string) => void } | null>(null);

  useEffect(() => {
    const flush = () => {
      const edit = flight.current;
      flight.current = null;
      if (edit !== null && edit.text !== edit.base) edit.save(edit.text);
    };
    // `hidden` fires on tab switch and, in every browser that matters, on the way out of the
    // page — while the document is still alive enough to enqueue the write.
    const onHidden = () => {
      if (globalThis.document.visibilityState === 'hidden') flush();
    };
    globalThis.document.addEventListener('visibilitychange', onHidden);
    return () => {
      globalThis.document.removeEventListener('visibilitychange', onHidden);
      flush();
    };
  }, []);

  const comments = useLiveQuery(
    (store) =>
      [...store.commentIdsFor(issueId)]
        .map((id) => store.get('comment', id))
        .filter((comment): comment is Comment => comment !== undefined),
    ['comment'],
    [issueId],
  );

  const roots = useMemo(() => comments.filter(isInlineRoot), [comments]);
  const resolvedCount = roots.filter((comment) => comment.resolvedAt !== undefined).length;
  const visibleRoots = showResolved
    ? roots
    : roots.filter((comment) => comment.resolvedAt === undefined);

  const placed = useMemo(() => {
    const anchors: CommentAnchor[] = [];
    for (const comment of visibleRoots) {
      if (
        comment.anchorStart === undefined ||
        comment.anchorEnd === undefined ||
        comment.quote === undefined
      ) {
        continue;
      }
      anchors.push({
        id: comment.id,
        start: comment.anchorStart,
        end: comment.anchorEnd,
        quote: comment.quote,
        resolved: comment.resolvedAt !== undefined,
      });
    }
    return placeAnchors(text, anchors);
  }, [text, visibleRoots]);

  const segments = useMemo(() => paint(text, placed), [text, placed]);
  const open = visibleRoots.find((comment) => comment.id === openId) ?? null;
  const replies = useMemo(
    () =>
      open === null
        ? []
        : comments
            .filter((comment) => comment.parentId === open.id)
            .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)),
    [comments, open],
  );

  // The text goes in through the element rather than through a `value` prop, for the reason
  // spelled out in components/nativeValue.ts: React rewrites a controlled textarea's text
  // content on every commit, and that resets the browser's undo grouping to one keystroke per
  // entry. A description is the longest thing anybody types in this product and the one where
  // undoing a sentence matters most.
  useNativeValue(areaRef, text);

  /**
   * Puts the paint layer where the text is.
   *
   * Past the 30-line ceiling the textarea scrolls inside itself while `.backdrop` is
   * `inset: 0` with `overflow: hidden`, so without this the highlights stay pinned to the
   * top of the field and every mark lands on the wrong words — and `hitTest`, which reads a
   * caret offset the reader chose by clicking on the *painted* span, then opens the wrong
   * thread. It is called from the scroll event and again from the resize layout effect,
   * because a re-render resets the `<pre>`'s own scroll position to zero while the textarea
   * keeps its own.
   */
  const syncScroll = useCallback(() => {
    const element = areaRef.current;
    const backdrop = backdropRef.current;
    if (element === null || backdrop === null) return;
    backdrop.scrollTop = element.scrollTop;
    backdrop.scrollLeft = element.scrollLeft;
  }, []);

  const resize = useCallback(() => {
    const element = areaRef.current;
    if (element === null) return;
    element.style.height = 'auto';
    const styling = window.getComputedStyle(element);
    const lineHeight = Number.parseFloat(styling.lineHeight);
    const insets = Number.parseFloat(styling.paddingTop) + Number.parseFloat(styling.paddingBottom);
    let height = element.scrollHeight;
    if (Number.isFinite(lineHeight) && Number.isFinite(insets)) {
      height = Math.max(height, lineHeight * 3 + insets);
      const ceiling = lineHeight * 30 + insets;
      element.style.overflowY = height > ceiling ? 'auto' : 'hidden';
      height = Math.min(height, ceiling);
    }
    element.style.height = `${height}px`;
    syncScroll();
  }, [syncScroll]);

  useLayoutEffect(resize, [resize, text]);

  const readSelection = (): Draft | null => {
    const element = areaRef.current;
    if (element === null) return null;
    const start = element.selectionStart;
    const end = element.selectionEnd;
    if (end <= start) return null;
    return { start, end, quote: element.value.slice(start, end) };
  };

  /**
   * Write an edit the browser did not make.
   *
   * The element is written first and the state second, so that `useNativeValue` finds the
   * DOM already holding what the prop says and leaves it alone — which is what keeps the
   * caret where this puts it rather than where the last commit left it. The cost is one
   * undo entry per rule, which is the right grain anyway: ⌘Z after Enter-continues-a-list
   * should take back the bullet, not the paragraph above it.
   */
  const applyEdit = (next: EditorState) => {
    const element = areaRef.current;
    if (element === null) return;
    element.value = next.text;
    element.setSelectionRange(next.caret, next.caret);
    setDraft(next.text);
    flight.current = { text: next.text, base: description, save: onSave };
  };

  const stateOf = (): EditorState | null => {
    const element = areaRef.current;
    if (element === null || element.selectionStart !== element.selectionEnd) return null;
    return { text: element.value, caret: element.selectionStart };
  };

  const closeSlash = () => {
    setSlashAt(null);
    // Focus is handed back here rather than left to `Menu`'s own restore, because the menu
    // is anchored to a marker span in the aria-hidden paint layer: a span cannot take focus,
    // so the restore would drop the writer onto `<body>` mid-sentence.
    areaRef.current?.focus();
  };

  const chooseBlock = (kind: BlockKind) => {
    const from = slashAt;
    const state = stateOf();
    setSlashAt(null);
    if (from === null || state === null) return;
    applyEdit(insertBlock(state, from, kind));
    areaRef.current?.focus();
  };

  /**
   * The three keystrokes that are typing rather than commands.
   *
   * Local, and deliberately so: the keymap registry is for actions that belong in the
   * command menu and the help overlay, and "the space that turns `*` into a bullet" is
   * neither — it is an input rule, meaningful only at one caret position in one field, and
   * `app/keymap.tsx` returns early for a TEXTAREA target precisely so ordinary typing
   * reaches the element. `web/src/editor/` is on the allowlist in scripts/lint-keymap.sh for
   * this category. Everything here that *is* a command — commenting on a selection, posting,
   * closing a thread — is registered below.
   */
  const onKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const state = stateOf();
    if (state === null) return;

    if (event.key === '/') {
      // Only a `/` that starts a word opens the menu, so `and/or` and a URL path stay text.
      const before = state.text.slice(state.caret - 1, state.caret);
      if (state.caret !== 0 && before !== '' && !/\s/.test(before)) return;
      event.preventDefault();
      applyEdit({
        text: `${state.text.slice(0, state.caret)}/${state.text.slice(state.caret)}`,
        caret: state.caret + 1,
      });
      setSlashAt(state.caret);
      return;
    }

    if (event.key === 'Enter' && !event.shiftKey) {
      const next = applyEnterRule(state);
      if (next === null) return;
      event.preventDefault();
      applyEdit(next);
      return;
    }

    if (event.key === ' ') {
      const next = applySpaceRule(state);
      if (next === null) return;
      event.preventDefault();
      applyEdit(next);
    }
  };

  const startComment = (span: Draft | null) => {
    if (span === null || span.quote.trim() === '') return;
    setPending(span);
    setOpenId(null);
    setComposer('');
    setSelection(null);
    setRefusal(null);
  };

  const closeThread = () => {
    setPending(null);
    setOpenId(null);
    setComposer('');
    setComposerFocused(false);
    setRefusal(null);
  };

  /**
   * Follows an open thread onto its root's real id.
   *
   * An inline thread started here is drawn under an id this client invented, and that id
   * stops naming anything the moment the server's own row lands. The panel is keyed on it,
   * so without this the whole thread — and whatever reply was half typed into it — vanishes
   * off the screen a beat after it was opened.
   */
  useEffect(() => {
    if (openId === null) return;
    const real = engine.succession(openId);
    if (real !== openId) setOpenId(real);
    // `comments` is the dependency that matters: it changes when the stand-in is retired.
  }, [engine, openId, comments]);

  /**
   * Puts a refused comment back in the box it was typed in.
   *
   * Same bargain as the issue thread's composer (see `Comments` in views/IssueDetail.tsx):
   * clearing on submit is right because the comment is on screen the same frame, and it is
   * only right as long as a refusal undoes it. A reply to a thread whose root was opened a
   * moment ago is the case that makes this more than housekeeping — the root's id is still
   * one this client invented, the API refuses a parent it has never seen, and the reply used
   * to end as a console line with the text nowhere at all.
   */
  const refuse = (typed: string, error: unknown) => {
    report(error);
    setComposer((since) => (since === '' ? typed : `${typed}\n\n${since}`));
    setRefusal(
      error instanceof ApiError && error.message !== ''
        ? error.message
        : 'That comment could not be posted.',
    );
  };

  const submitComposer = () => {
    const typed = composer;
    const body = maybeExpandEmoticons(typed.trim());
    if (body === '') return;
    setRefusal(null);
    if (pending !== null) {
      const span = pending;
      postComment(engine, {
        issueId,
        body,
        authorId: viewerId ?? undefined,
        anchorStart: span.start,
        anchorEnd: span.end,
        quote: span.quote,
      }).catch((error: unknown) => {
        setPending(span);
        refuse(typed, error);
      });
      setPending(null);
      setComposer('');
      return;
    }
    if (open !== null) {
      const root = open;
      postComment(engine, {
        issueId,
        body,
        parentId: root.id,
        authorId: viewerId ?? undefined,
      }).catch((error: unknown) => {
        setOpenId(engine.succession(root.id));
        refuse(typed, error);
      });
      setComposer('');
    }
  };

  useKeyContext('editor', composerFocused);

  useActions(
    [
      {
        id: 'editor.comment',
        title: 'Comment on selection',
        keys: ['mod+alt+m'],
        when: 'detail',
        group: 'Editor',
        run: () => startComment(readSelection()),
      },
      {
        id: 'editor.submitInlineComment',
        title: 'Post inline comment',
        keys: enterSubmits ? ['mod+Enter', 'Enter'] : ['mod+Enter'],
        when: 'editor',
        group: 'Editor',
        hidden: true,
        run: () => submitComposer(),
      },
      {
        id: 'editor.closeCommentThread',
        title: 'Close comment thread',
        keys: ['Escape'],
        when: ['detail', 'editor'],
        group: 'Editor',
        hidden: true,
        enabled: () => pending !== null || open !== null,
        run: () => closeThread(),
      },
    ],
    [enterSubmits, pending, open, composer, issueId, viewerId],
  );

  /**
   * The paint layer, with a zero-width marker spliced in at the `/` that opened the block
   * menu.
   *
   * The menu belongs at the caret rather than at the foot of a thirty-line field, and this
   * `<pre>` is already a character-exact mirror of the textarea — same font, same padding,
   * same wrapping — so an empty inline-block at the right offset is a caret rectangle for
   * free, with no second measurement pass and no font metrics in this file.
   */
  const painted = useMemo(() => {
    const renderSegment = (segment: TextSegment, body: string, key: string): ReactNode => {
      if (segment.commentIds.length === 0) return body;
      const active = open !== null && segment.commentIds.includes(open.id);
      return (
        <mark
          key={key}
          className={[
            styles.mark,
            segment.resolved ? styles.markResolved : null,
            active ? styles.markActive : null,
          ]
            .filter(Boolean)
            .join(' ')}
        >
          {body}
        </mark>
      );
    };

    const marker = <span key="slash-anchor" ref={slashAnchorRef} className={styles.slashAnchor} />;
    const nodes: ReactNode[] = [];
    let at = 0;
    let placed = slashAt === null;
    segments.forEach((segment, index) => {
      const end = at + segment.text.length;
      if (!placed && slashAt !== null && slashAt > at && slashAt < end) {
        nodes.push(renderSegment(segment, segment.text.slice(0, slashAt - at), `${index}-a`));
        nodes.push(marker);
        nodes.push(renderSegment(segment, segment.text.slice(slashAt - at), `${index}-b`));
        placed = true;
      } else {
        if (!placed && slashAt === at) {
          nodes.push(marker);
          placed = true;
        }
        nodes.push(renderSegment(segment, segment.text, `${index}`));
      }
      at = end;
    });
    if (!placed) nodes.push(marker);
    return nodes;
  }, [segments, open, slashAt]);

  return (
    <div className={styles.wrap}>
      {resolvedCount > 0 ? (
        <div className={styles.bar}>
          <Checkbox
            label="Show resolved"
            checked={showResolved}
            onChange={(event) => setShowResolved(event.target.checked)}
          />
        </div>
      ) : null}

      <div className={styles.frame}>
        <pre ref={backdropRef} className={styles.backdrop} aria-hidden="true">
          {painted}
        </pre>
        <textarea
          ref={areaRef}
          className={styles.input}
          aria-label="Description"
          placeholder="Add a description…"
          // Seeded only when there is no draft yet. Refocusing a field that is already being
          // edited — coming back from the block menu, for one — must not throw the typing
          // away and reinstate the last saved text.
          onFocus={() => setDraft((current) => current ?? description)}
          onChange={(event) => {
            const next = event.target.value;
            setDraft(next);
            flight.current = { text: next, base: description, save: onSave };
          }}
          onKeyDown={onKeyDown}
          onScroll={syncScroll}
          onSelect={() => setSelection(readSelection())}
          onMouseUp={() => {
            const span = readSelection();
            setSelection(span);
            if (span !== null) return;
            const element = areaRef.current;
            if (element === null) return;
            const id = hitTest(element.selectionStart, placed);
            if (id !== null) {
              setOpenId(id);
              setPending(null);
            }
          }}
          onBlur={() => {
            // The block menu takes focus for as long as it is open, and that is not the
            // writer leaving the field. Saving here would also hand `useNativeValue` the
            // last *saved* description while the caret is still in the typed one, which puts
            // the text back a paragraph the moment a block is chosen.
            if (slashAt !== null) return;
            const next = draft;
            setDraft(null);
            flight.current = null;
            if (next !== null && next !== description) onSave(next);
          }}
        />
      </div>

      <SlashMenu
        open={slashAt !== null}
        onClose={closeSlash}
        trigger={slashAnchorRef}
        onInsert={chooseBlock}
      />

      {selection !== null && pending === null ? (
        <div className={styles.toolbar}>
          <Button size="sm" onClick={() => startComment(selection)}>
            Comment
          </Button>
        </div>
      ) : null}

      {pending !== null ? (
        <form
          className={styles.thread}
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            submitComposer();
          }}
        >
          <p className={styles.quote}>{pending.quote}</p>
          <Textarea
            label="Inline comment"
            hideLabel
            placeholder="Comment"
            minRows={2}
            maxRows={8}
            autoFocus
            value={composer}
            error={refusal ?? undefined}
            data-submit-chord={enterSubmits ? 'enter' : undefined}
            onFocus={() => setComposerFocused(true)}
            onBlur={() => setComposerFocused(false)}
            onChange={(event) => {
              setComposer(event.target.value);
              setRefusal(null);
            }}
          />
          {/* One primary and a ghost cancel, as in every dialog footer: abandoning a comment
              nobody has written yet is not a second command to weigh against posting it. */}
          <div className={styles.actions}>
            <Button variant="ghost" onClick={closeThread}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={composer.trim() === ''}>
              Comment
            </Button>
          </div>
        </form>
      ) : null}

      {open !== null && pending === null ? (
        <div className={styles.thread} role="dialog" aria-label="Comment thread">
          <p className={styles.quote}>{open.quote}</p>
          <ol className={styles.posts}>
            {[open, ...replies].map((comment) => (
              <li key={comment.id}>
                <div className={styles.postHead}>
                  <span className={styles.author}>
                    {names[comment.actor.id ?? ''] ?? 'Somebody'}
                  </span>
                  <time
                    className={styles.when}
                    dateTime={comment.createdAt}
                    title={exact(comment.createdAt)}
                  >
                    {when(comment.createdAt)}
                  </time>
                </div>
                <Markdown className={styles.body} text={comment.body} />
              </li>
            ))}
          </ol>
          <Textarea
            label="Reply"
            hideLabel
            placeholder="Reply"
            minRows={2}
            maxRows={8}
            value={composer}
            error={refusal ?? undefined}
            data-submit-chord={enterSubmits ? 'enter' : undefined}
            onFocus={() => setComposerFocused(true)}
            onBlur={() => setComposerFocused(false)}
            onChange={(event) => {
              setComposer(event.target.value);
              setRefusal(null);
            }}
          />
          <div className={styles.actions}>
            <Button
              onClick={() =>
                resolveComment(
                  engine,
                  open.id,
                  open.resolvedAt === undefined,
                  viewerId ?? undefined,
                ).catch(report)
              }
            >
              {open.resolvedAt === undefined ? 'Resolve' : 'Reopen'}
            </Button>
            <Button
              variant="primary"
              disabled={composer.trim() === ''}
              onClick={() => submitComposer()}
            >
              Reply
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
