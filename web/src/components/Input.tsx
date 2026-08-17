import type { InputHTMLAttributes, ReactNode, Ref } from 'react';

import { Field, fieldDescribedBy, fieldInvalid, useFieldIds } from './Field';
import styles from './Input.module.css';

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'prefix'> {
  label?: string | undefined;
  hideLabel?: boolean | undefined;
  hint?: string | undefined;
  /** Present means invalid: the text, the red edge and `aria-invalid` are one decision. */
  error?: string | undefined;
  /** Inside the box, before the text. A currency mark, a search glyph, a URL scheme. */
  prefix?: ReactNode | undefined;
  /** Inside the box, after the text. A unit, a counter, a clear button. */
  suffix?: ReactNode | undefined;
  /** Applies to the field — label, control and message — not to the input element. */
  className?: string | undefined;
  ref?: Ref<HTMLInputElement> | undefined;
}

/**
 * Input is a single-line text field with its label, its help and its error already wired
 * together.
 *
 * Wiring them here rather than at each call site is the point of the component. An
 * `aria-describedby` that has to be written by hand is one that is written once, correctly,
 * and then copied into a form that has no hint — leaving a description pointing at an
 * element that does not exist. Passing the error text in is all a caller has to get right.
 *
 * The prefix and suffix slots live inside the bordered box, so the affix is part of the
 * field rather than a thing sitting next to it, and clicking one does not miss the input.
 */
export function Input({
  label,
  hideLabel,
  hint,
  error,
  prefix,
  suffix,
  className,
  id,
  ...rest
}: InputProps) {
  const ids = useFieldIds(id);
  const invalid = fieldInvalid({ error });

  return (
    <Field
      ids={ids}
      label={label}
      hideLabel={hideLabel}
      hint={hint}
      error={error}
      className={className}
    >
      <div className={[styles.box, invalid ? styles.invalid : null].filter(Boolean).join(' ')}>
        {prefix === undefined ? null : <span className={styles.affix}>{prefix}</span>}
        <input
          {...rest}
          id={ids.controlId}
          className={styles.input}
          aria-invalid={invalid ? true : undefined}
          aria-describedby={fieldDescribedBy(ids, { hint, error }, rest['aria-describedby'])}
        />
        {suffix === undefined ? null : <span className={styles.affix}>{suffix}</span>}
      </div>
    </Field>
  );
}
