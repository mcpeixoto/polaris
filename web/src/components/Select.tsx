import type { ReactNode, Ref, SelectHTMLAttributes } from 'react';

import { Field, fieldDescribedBy, fieldInvalid, useFieldIds } from './Field';
import styles from './Select.module.css';

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string | undefined;
  hideLabel?: boolean | undefined;
  hint?: string | undefined;
  error?: string | undefined;
  className?: string | undefined;
  /** `<option>` and `<optgroup>` elements, as for a plain select. */
  children?: ReactNode | undefined;
  ref?: Ref<HTMLSelectElement> | undefined;
}

/**
 * Select is the native `<select>`, restyled and left alone.
 *
 * It is deliberately not the Menu. A menu that renders its own list has to reimplement
 * type-ahead, the platform's scrolling behaviour, and the mobile picker — and would still
 * be worse at all three. The native control is used wherever the choice is a plain
 * settings-form value: the workflow-state category, a member's role, a team's key.
 *
 * Where the choice is part of the keyboard flow — assignee, status, priority, opened with
 * `A`, `S`, `P` from the issue list — the Menu is the right component, because those are
 * commands with shortcuts and a filter, not form fields.
 */
export function Select({
  label,
  hideLabel,
  hint,
  error,
  className,
  id,
  children,
  ...rest
}: SelectProps) {
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
        <select
          {...rest}
          id={ids.controlId}
          className={styles.select}
          aria-invalid={invalid ? true : undefined}
          aria-describedby={fieldDescribedBy(ids, { hint, error }, rest['aria-describedby'])}
        >
          {children}
        </select>
        <span className={styles.chevron} aria-hidden="true">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path
              d="M3 4.75 6 7.75l3-3"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </div>
    </Field>
  );
}
