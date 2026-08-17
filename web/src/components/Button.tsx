import type { ButtonHTMLAttributes, MouseEvent, ReactNode, Ref } from 'react';

import { Spinner } from './Spinner';
import styles from './Button.module.css';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant | undefined;
  size?: ButtonSize | undefined;
  /**
   * A mutation is in flight. The button keeps its size and its focus and stops responding
   * to clicks; see the note in the component on why it is not `disabled`.
   */
  loading?: boolean | undefined;
  /** Leading glyph. Decorative — the label is the accessible name. */
  icon?: ReactNode | undefined;
  fullWidth?: boolean | undefined;
  ref?: Ref<HTMLButtonElement> | undefined;
}

/**
 * Button is the product's explicit affordance, used where a command has to be visible:
 * form submits, modal footers, the action on an empty state.
 *
 * `type` defaults to `button`, not to the HTML default of `submit`. A submit button that
 * nobody asked for is how a "Cancel" in a form ends up saving the form, and in a product
 * where Enter is a submit gesture that mistake fires constantly.
 *
 * While `loading`, the button is marked `aria-disabled` rather than `disabled`. A disabled
 * element cannot hold focus, so the browser drops focus to the body the moment a save
 * begins, and a keyboard user is returned to the top of the document for their trouble.
 * Marking it busy keeps focus where the user put it, keeps the button in the tab order,
 * and blocks activation in the click handler instead.
 */
export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  icon,
  fullWidth = false,
  type = 'button',
  className,
  children,
  onClick,
  ...rest
}: ButtonProps) {
  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (loading) {
      // Also stops the implicit form submission that Enter on a submit button would
      // otherwise perform while the previous submission is still in flight.
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    onClick?.(event);
  };

  return (
    <button
      {...rest}
      type={type}
      className={[
        styles.button,
        styles[variant],
        styles[size],
        fullWidth ? styles.fullWidth : null,
        loading ? styles.loading : null,
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      onClick={handleClick}
      aria-busy={loading ? true : undefined}
      aria-disabled={loading ? true : undefined}
    >
      {icon === undefined ? null : (
        <span className={styles.icon} aria-hidden="true">
          {icon}
        </span>
      )}
      <span className={styles.label}>{children}</span>
      {loading ? (
        <span className={styles.spinner}>
          <Spinner size="sm" />
        </span>
      ) : null}
    </button>
  );
}
