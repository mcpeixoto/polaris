import type { ReactNode, Ref, SelectHTMLAttributes } from 'react';

import { Field, fieldDescribedBy, fieldInvalid, useFieldIds } from './Field';
import styles from './Select.module.css';

// `prefix` is omitted for the same reason Input omits it: React's HTMLAttributes carries the
// RDFa `prefix` attribute as a string, and the slot below takes a node.
export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'prefix'> {
  label?: string | undefined;
  hideLabel?: boolean | undefined;
  hint?: string | undefined;
  error?: string | undefined;
  /**
   * The selected value's icon, drawn inside the box at the leading edge: a `StateIcon` for a
   * workflow state, a `PriorityIcon` for a priority, an `Avatar` for a person. Decorative —
   * the chosen `<option>` is the accessible value, and this only repeats it in a glyph.
   */
  prefix?: ReactNode | undefined;
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
 *
 * `prefix` exists so that a select can carry its value's icon the way the detail rail's
 * triggers do. It is painted over the control rather than laid out beside it — see the
 * stylesheet — so nothing about the native popup, the platform type-ahead or the keyboard
 * handling changes: the `<select>` still fills the box and is still the only thing in it a
 * click can land on.
 */
export function Select({
  label,
  hideLabel,
  hint,
  error,
  prefix,
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
      <div
        className={[
          styles.box,
          prefix === undefined ? null : styles.hasPrefix,
          invalid ? styles.invalid : null,
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {prefix === undefined ? null : (
          <span className={styles.prefix} aria-hidden="true">
            {prefix}
          </span>
        )}
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
