import { useEffect, useRef, type InputHTMLAttributes, type ReactNode, type Ref } from 'react';

import styles from './Checkbox.module.css';

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  /**
   * The visible label, rendered inside the same `<label>` as the box so the text is part of
   * the hit target. A checkbox with no label — the select-all in a list header — must carry
   * an `aria-label` instead; a nameless checkbox is announced as "checkbox" and nothing else.
   */
  label?: ReactNode | undefined;
  /**
   * The third state: some of the things this checkbox stands for are selected. It exists
   * only as a DOM property, never as an attribute, so React cannot set it from JSX and this
   * component writes it directly.
   */
  indeterminate?: boolean | undefined;
  className?: string | undefined;
  ref?: Ref<HTMLInputElement> | undefined;
}

/**
 * Checkbox is the list's multi-select control and the settings pages' toggle.
 *
 * It keeps a real `<input type="checkbox">` and paints over it rather than building a
 * `role="checkbox"` out of divs. Everything that makes a checkbox a checkbox — focus, the
 * space bar, form participation, the indeterminate state, how a screen reader announces the
 * change — is behaviour the platform already has and a reimplementation would have to earn
 * back one bug at a time.
 */
export function Checkbox({ label, indeterminate = false, className, ref, ...rest }: CheckboxProps) {
  const elementRef = useRef<HTMLInputElement | null>(null);

  const attachRef = (node: HTMLInputElement | null) => {
    elementRef.current = node;
    if (typeof ref === 'function') ref(node);
    else if (ref !== null && ref !== undefined) ref.current = node;
  };

  useEffect(() => {
    if (elementRef.current !== null) elementRef.current.indeterminate = indeterminate;
  }, [indeterminate]);

  return (
    <label className={[styles.root, className].filter(Boolean).join(' ')}>
      <span className={styles.control}>
        <input {...rest} ref={attachRef} type="checkbox" className={styles.input} />
        <span className={styles.box} aria-hidden="true">
          <svg viewBox="0 0 16 16" width="16" height="16" fill="none">
            <path
              className={[styles.mark, styles.check].filter(Boolean).join(' ')}
              d="M3.5 8.25 6.5 11l6-6.5"
              // pathLength normalises the tick to a length of one, which is what lets the
              // stylesheet draw it on as `stroke-dashoffset: 1 → 0` without this path's
              // measured length being copied into the CSS, where it would go stale the
              // moment anybody nudged the geometry here.
              pathLength={1}
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              className={[styles.mark, styles.dash].filter(Boolean).join(' ')}
              d="M4 8h8"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </span>
      </span>
      {label === undefined ? null : <span className={styles.label}>{label}</span>}
    </label>
  );
}
