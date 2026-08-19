import { useCallback, useLayoutEffect, useRef, type Ref, type TextareaHTMLAttributes } from 'react';

import { Field, fieldDescribedBy, fieldInvalid, useFieldIds } from './Field';
import styles from './Textarea.module.css';

export interface TextareaProps extends Omit<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
  'rows' | 'style'
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

  // Before paint, so the box is never briefly the wrong height. `value` covers the
  // controlled case; the `onInput` below covers typing, pasting and dropping into an
  // uncontrolled one. Measuring on every render instead would force a layout each time a
  // sync delta re-rendered the screen around this field, for an answer that had not moved.
  useLayoutEffect(resize, [resize, value]);

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
        value={value}
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
