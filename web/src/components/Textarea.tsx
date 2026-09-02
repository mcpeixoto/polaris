import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type Ref,
  type TextareaHTMLAttributes,
} from 'react';

import { Field, fieldDescribedBy, fieldInvalid, useFieldIds } from './Field';
import { useNativeValue } from './nativeValue';
import styles from './Textarea.module.css';

export interface TextareaProps extends Omit<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
  'rows' | 'style' | 'defaultValue' | 'children'
> {
  label?: string | undefined;
  hideLabel?: boolean | undefined;
  hint?: string | undefined;
  error?: string | undefined;
  /**
   * `plain` drops the boxed control surface, for a description that should read as a
   * document rather than as a form field.
   */
  surface?: 'boxed' | 'plain' | undefined;
  /** The height at rest, in lines. The box never shrinks below it. */
  minRows?: number | undefined;
  /** Where growing stops and scrolling starts, in lines. */
  maxRows?: number | undefined;
  /**
   * The text. Mirrored into the element by `useNativeValue` rather than handed to React as
   * a controlled `value`; from a caller's side it behaves the same, and the reason for the
   * difference is the browser's undo stack. See `nativeValue.ts`.
   */
  value?: string | undefined;
  className?: string | undefined;
  ref?: Ref<HTMLTextAreaElement> | undefined;
}

/**
 * Textarea grows with its content.
 *
 * A fixed box is the wrong shape for everything this product asks people to write: a
 * comment is usually one line and occasionally twenty, and both a three-line box that
 * scrolls a paragraph out of sight and a six-line box holding "lgtm" cost the reader
 * context. Growing means the text on screen is always all of the text.
 *
 * The height is measured, not calculated. `scrollHeight` after a reset to `auto` is the only
 * number that accounts for the font actually in use, the wrapping the browser actually did,
 * and a pasted block that arrived without a single keystroke — all of which a line count
 * multiplied by a line height gets wrong.
 *
 * `rows` and `style` are not accepted: the component writes the element's inline height on
 * every measurement, so anything a caller put there would survive exactly until the next
 * keystroke. Ask for `minRows` and `maxRows` instead.
 *
 * `defaultValue` and `children` are not accepted either, and that one is load-bearing rather
 * than tidy: both of them are the textarea's text content, and React rewrites the text
 * content of a textarea on every update it makes to one. Doing that to a field somebody is
 * typing in resets the browser's undo grouping, so ⌘Z walks back a character at a time
 * instead of undoing the sentence. `value` goes in through `useNativeValue`, which leaves the
 * element's text content untouched for the element's whole life; the long version of why is
 * in nativeValue.ts.
 */
export function Textarea({
  label,
  hideLabel,
  hint,
  error,
  surface = 'boxed',
  minRows = 1,
  maxRows,
  className,
  id,
  ref,
  onInput,
  value,
  ...rest
}: TextareaProps) {
  const ids = useFieldIds(id);
  const invalid = fieldInvalid({ error });
  const elementRef = useRef<HTMLTextAreaElement | null>(null);

  // Before the resize effect below, so the box is measured against the text it is about to
  // be showing rather than the text it was showing a moment ago.
  useNativeValue(elementRef, value);

  const attachRef = (node: HTMLTextAreaElement | null) => {
    elementRef.current = node;
    if (typeof ref === 'function') ref(node);
    else if (ref !== null && ref !== undefined) ref.current = node;
  };

  const resize = useCallback(() => {
    const element = elementRef.current;
    if (element === null) return;

    // Collapse first. Measuring scrollHeight while the box is already tall enough returns
    // the height it currently has, so without this the box can only ever grow.
    element.style.height = 'auto';

    const styling = window.getComputedStyle(element);
    const lineHeight = Number.parseFloat(styling.lineHeight);
    const insets =
      Number.parseFloat(styling.paddingTop) +
      Number.parseFloat(styling.paddingBottom) +
      Number.parseFloat(styling.borderTopWidth) +
      Number.parseFloat(styling.borderBottomWidth);

    let height = element.scrollHeight;
    if (Number.isFinite(lineHeight) && Number.isFinite(insets)) {
      height = Math.max(height, lineHeight * minRows + insets);
      if (maxRows !== undefined) {
        const ceiling = lineHeight * maxRows + insets;
        element.style.overflowY = height > ceiling ? 'auto' : 'hidden';
        height = Math.min(height, ceiling);
      }
    }
    element.style.height = `${height}px`;
  }, [minRows, maxRows]);

  // Before paint, so the box is never briefly the wrong height. `value` covers text arriving
  // from the owner — a remote delta, a switched entity, a cleared composer; the `onInput`
  // below covers typing, pasting and dropping. Measuring on every render instead would force
  // a layout each time a sync delta re-rendered the screen around this field, for an answer
  // that had not moved.
  useLayoutEffect(resize, [resize, value]);

  /**
   * And again whenever the box itself changes width, which is a different question from
   * whether the text changed.
   *
   * Narrowing the window re-wraps the same string onto more lines, and nothing above notices:
   * `value` has not moved and no input event fired, so an issue description clips or leaves a
   * gap until the next keystroke. A ResizeObserver on the element answers the whole family at
   * once — the window, the sidebar collapsing, a font finishing loading — rather than three
   * listeners that each cover one of them.
   *
   * Only a change of *width* re-measures. `resize` sets this element's height, which the
   * observer would otherwise see as a resize and answer with another measurement — the
   * classic observer loop. Width is the only input to how the text wraps, so ignoring the
   * height it just set is not a guard bolted on, it is the actual question.
   *
   * Guarded on the constructor because jsdom has none, and a textarea that cannot be
   * rendered in a test is a textarea whose autosizing rots.
   */
  useEffect(() => {
    const element = elementRef.current;
    if (element === null || window.ResizeObserver === undefined) return;
    let width = element.clientWidth;
    const observer = new window.ResizeObserver(() => {
      if (element.clientWidth === width) return;
      width = element.clientWidth;
      resize();
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [resize]);

  return (
    <Field
      ids={ids}
      label={label}
      hideLabel={hideLabel}
      hint={hint}
      error={error}
      className={className}
    >
      <textarea
        {...rest}
        ref={attachRef}
        id={ids.controlId}
        rows={minRows}
        className={[
          styles.textarea,
          surface === 'plain' ? styles.plain : null,
          invalid ? styles.invalid : null,
        ]
          .filter(Boolean)
          .join(' ')}
        aria-invalid={invalid ? true : undefined}
        aria-describedby={fieldDescribedBy(ids, { hint, error }, rest['aria-describedby'])}
        onInput={(event) => {
          resize();
          onInput?.(event);
        }}
      />
    </Field>
  );
}
