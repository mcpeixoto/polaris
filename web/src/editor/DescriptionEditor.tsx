/**
 * Issue description with inline comment marks.
 *
 * The field is still markdown in a textarea — the overlay behind it paints the spans, and
 * a click on a caret inside a span opens the thread. Select text and ⌘⌥M (or the Comment
 * button) starts a thread; resolve lives on the root, same as an issue-thread comment.
 */

import { useCallback, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from 'react';

import { useActions, useKeyContext } from '~/app/keymap';
import { useEngine } from '~/app/context';
import { Button, Checkbox, Textarea } from '~/components';
import { postComment, report, resolveComment } from '~/features/issue/mutations';
import { maybeExpandEmoticons } from '~/features/prefs/emoticons';
import { exact, when } from '~/features/time';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import type { Comment, UUID } from '~/store';

import { hitTest, isInlineRoot, paint, placeAnchors, type CommentAnchor } from './marks';
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
  const [draft, setDraft] = useState<string | null>(null);
  const [selection, setSelection] = useState<Draft | null>(null);
  const [pending, setPending] = useState<Draft | null>(null);
  const [openId, setOpenId] = useState<UUID | null>(null);
  const [showResolved, setShowResolved] = useState(false);
  const [composer, setComposer] = useState('');
  const [composerFocused, setComposerFocused] = useState(false);

  const text = draft ?? description;

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
  }, []);

  useLayoutEffect(resize, [resize, text]);

  const readSelection = (): Draft | null => {
    const element = areaRef.current;
    if (element === null) return null;
    const start = element.selectionStart;
    const end = element.selectionEnd;
    if (end <= start) return null;
    return { start, end, quote: element.value.slice(start, end) };
  };

  const startComment = (span: Draft | null) => {
    if (span === null || span.quote.trim() === '') return;
    setPending(span);
    setOpenId(null);
    setComposer('');
    setSelection(null);
  };

  const closeThread = () => {
    setPending(null);
    setOpenId(null);
    setComposer('');
    setComposerFocused(false);
  };

  const submitComposer = () => {
    const body = maybeExpandEmoticons(composer.trim());
    if (body === '') return;
    if (pending !== null) {
      postComment(engine, {
        issueId,
        body,
        authorId: viewerId ?? undefined,
        anchorStart: pending.start,
        anchorEnd: pending.end,
        quote: pending.quote,
      }).catch(report);
      setPending(null);
      setComposer('');
      return;
    }
    if (open !== null) {
      postComment(engine, {
        issueId,
        body,
        parentId: open.id,
        authorId: viewerId ?? undefined,
      }).catch(report);
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
        <pre className={styles.backdrop} aria-hidden="true">
          {segments.map((segment, index) => {
            if (segment.commentIds.length === 0) return segment.text;
            const active = open !== null && segment.commentIds.includes(open.id);
            return (
              <mark
                key={`${segment.commentIds.join('-')}-${index}`}
                className={[
                  styles.mark,
                  segment.resolved ? styles.markResolved : null,
                  active ? styles.markActive : null,
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                {segment.text}
              </mark>
            );
          })}
        </pre>
        <textarea
          ref={areaRef}
          className={styles.input}
          aria-label="Description"
          placeholder="Add a description…"
          value={text}
          onFocus={() => setDraft(description)}
          onChange={(event) => setDraft(event.target.value)}
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
            const next = draft;
            setDraft(null);
            if (next !== null && next !== description) onSave(next);
          }}
        />
      </div>

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
            data-submit-chord={enterSubmits ? 'enter' : undefined}
            onFocus={() => setComposerFocused(true)}
            onBlur={() => setComposerFocused(false)}
            onChange={(event) => setComposer(event.target.value)}
          />
          <div className={styles.actions}>
            <Button onClick={closeThread}>Cancel</Button>
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
                <p className={styles.body}>{comment.body}</p>
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
            data-submit-chord={enterSubmits ? 'enter' : undefined}
            onFocus={() => setComposerFocused(true)}
            onBlur={() => setComposerFocused(false)}
            onChange={(event) => setComposer(event.target.value)}
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
