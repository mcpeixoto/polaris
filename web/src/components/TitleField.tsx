/**
 * A title, edited in place: the issue's, the project's.
 *
 * The draft only exists while the field has focus. That is what lets a title changed by
 * somebody else appear here immediately when you are not editing, and lets your own typing
 * survive their change while you are — a controlled input holding a permanent draft would do
 * the first badly and a permanently uncontrolled one would do the second.
 *
 * `key` belongs at the *call site*, and this is the whole of the reset. A `key` on the form
 * inside remounts the DOM element and leaves this component's state exactly where it was, so
 * for as long as it was written that way a half-typed title followed the route onto the next
 * issue and the next commit renamed that one.
 *
 * A textarea and not an input. A title is a sentence, the reading column is 72 characters
 * wide, and a long one scrolled sideways out of sight in a single-line box. Enter still
 * commits, so the wrapping is the only thing that changed.
 *
 * The draft is mirrored into a ref because `commit` runs from a blur that can be dispatched
 * between a `setDraft` and the render that follows it — which is exactly what `revert` does.
 * Reading the state there would let Escape save the edit it was pressed to abandon.
 *
 * It lives here rather than on the issue screen because the project screen needs the same
 * three properties — the focus-scoped draft, the flush on the way out, and the commit on
 * blur — and a second implementation of them would be a second one to get wrong. The
 * project's title used to be a static heading with no rename at all.
 */

import { useEffect, useRef, useState, type FormEvent, type RefObject } from 'react';

import { Textarea } from './Textarea';
import styles from './TitleField.module.css';

/**
 * What a screen can ask of the field.
 *
 * A handle rather than props, because both callers are registered keyboard actions whose
 * `run` was captured when the screen mounted. Escape is registered by the screen rather than
 * by this component: `useActions` needs the provider above it, and the field is rendered on
 * its own in tests.
 */
export interface TitleHandle {
  focus(): void;
  /** Whether an uncommitted draft exists. What makes Escape live, and nothing else. */
  editing(): boolean;
  /** Drops the draft and leaves the field, saving nothing. */
  revert(): void;
}

export interface TitleFieldProps {
  /**
   * What is being renamed. Not read for anything but the flush below, which is keyed on it
   * so that moving between two subjects writes the first one's edit as it leaves the screen.
   */
  subjectId: string;
  /** The stored title. Shown whenever the field is not being typed into. */
  value: string;
  /** The accessible name — "Issue title", "Project name". Hidden, like the rest of the row. */
  label: string;
  handle?: RefObject<TitleHandle | null> | undefined;
  onSave: (title: string) => void;
  /**
   * `lg` is the document title the issue and the project screens open with. `md` is the
   * same field at the size of the row it sits in — a breadcrumb's last crumb, where the
   * name is a place rather than a headline.
   */
  size?: 'lg' | 'md' | undefined;
  className?: string | undefined;
}

export function TitleField({
  subjectId,
  value,
  label,
  handle,
  onSave,
  size = 'lg',
  className,
}: TitleFieldProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const draftRef = useRef<string | null>(null);
  const fieldRef = useRef<HTMLTextAreaElement | null>(null);

  const write = (next: string | null) => {
    draftRef.current = next;
    setDraft(next);
  };

  /**
   * The edit in flight, for the exits that are not a blur.
   *
   * Committing on blur is the model and it holds for every way of leaving the field that
   * moves focus first — tabbing out, clicking anywhere else on the page, opening the command
   * menu. It does not hold for the ways that take the whole screen away without focusing
   * anything: the back button, a reload, a closed tab. React drops the input, no blur is
   * ever dispatched, and a renamed row silently still has its old name. This is the same
   * hole the description had, and the same shape of fix.
   *
   * The save callback is captured at the keystroke rather than read at flush time, so a
   * flush that happens to run during a route change writes this subject's title and not the
   * next one's.
   */
  const flight = useRef<{ text: string; base: string; save: (next: string) => void } | null>(null);

  useEffect(() => {
    const flush = () => {
      const edit = flight.current;
      flight.current = null;
      if (edit === null) return;
      const next = edit.text.trim();
      if (next === '' || next === edit.base) return;
      edit.save(next);
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
  }, [subjectId]);

  const commit = () => {
    const next = draftRef.current?.trim();
    write(null);
    flight.current = null;
    // An empty title is a mistake rather than an intention, so the field reverts to what the
    // row actually says instead of saving something with no name.
    if (next === undefined || next === '' || next === value) return;
    onSave(next);
  };

  useEffect(() => {
    if (handle === undefined) return;
    handle.current = {
      focus: () => fieldRef.current?.focus(),
      editing: () => draftRef.current !== null,
      revert: () => {
        // Cleared before the blur, because the blur is what calls `commit` and `commit`
        // reads the ref. Doing it the other way round saves the edit Escape abandoned.
        write(null);
        flight.current = null;
        fieldRef.current?.blur();
      },
    };
    return () => {
      handle.current = null;
    };
  }, [handle]);

  return (
    <form
      className={styles.form}
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        // Blurring is what commits, so Enter and clicking away cannot disagree about what
        // was saved.
        fieldRef.current?.blur();
      }}
    >
      <Textarea
        ref={fieldRef}
        className={[styles.title, size === 'md' ? styles.md : null, className]
          .filter(Boolean)
          .join(' ')}
        label={label}
        hideLabel
        minRows={1}
        value={draft ?? value}
        onFocus={() => write(value)}
        onChange={(event) => {
          write(event.target.value);
          flight.current = { text: event.target.value, base: value, save: onSave };
        }}
        onBlur={commit}
        onKeyDown={
          /* keymap-lint-allow: supplies the submit a single-line input gave for free — a
             textarea takes Enter as a newline, and a title is one line. */ (event) => {
            if (event.key !== 'Enter' || event.shiftKey) return;
            event.preventDefault();
            event.currentTarget.blur();
          }
        }
        autoComplete="off"
        spellCheck
      />
    </form>
  );
}
