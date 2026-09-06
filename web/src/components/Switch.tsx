import { useId, type Ref } from 'react';

import styles from './Switch.module.css';

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /**
   * The visible label, to the right of the track, and the control's accessible name. A
   * string rather than a node because a switch is a single yes/no question and its name
   * should be readable in one breath — "Create more", "Auto-assign", "Private".
   */
  label: string;
  disabled?: boolean | undefined;
  id?: string | undefined;
  className?: string | undefined;
  ref?: Ref<HTMLButtonElement> | undefined;
}

/**
 * Switch is the two-state toggle: on or off, taking effect the moment it is flipped.
 *
 * It is not a checkbox, and the distinction is the reason it exists as its own component.
 * A checkbox is a value in a form that a submit will read later; a switch is a setting that
 * is already true by the time the thumb has finished moving. "Create more" in the composer
 * is the specimen — flipping it changes what the primary button does, right now, and a box
 * that merely ticks does not say that.
 *
 * A `<button role="switch">` rather than a styled `<input type="checkbox">`. The button gives
 * Space and Enter for free and keeps focus where the user put it; the role tells assistive
 * technology the two states are on and off rather than checked and unchecked, which is what
 * it will announce. The label is a real `<label for>`, so clicking the words flips the
 * switch and the name is the DOM's answer rather than an aria attribute's.
 *
 * Unavailable is `aria-disabled` rather than `disabled`, for the reason Button and IconButton
 * give: a disabled element cannot hold focus or explain itself.
 */
export function Switch({
  checked,
  onChange,
  label,
  disabled = false,
  id,
  className,
  ref,
}: SwitchProps) {
  const generated = useId();
  const controlId = id ?? generated;

  return (
    <span className={[styles.root, className].filter(Boolean).join(' ')}>
      <button
        ref={ref}
        id={controlId}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-disabled={disabled ? true : undefined}
        className={styles.control}
        onClick={() => {
          if (disabled) return;
          onChange(!checked);
        }}
      >
        <span className={styles.track} aria-hidden="true">
          <span className={styles.thumb} />
        </span>
      </button>
      <label htmlFor={controlId} className={styles.label}>
        {label}
      </label>
    </span>
  );
}
