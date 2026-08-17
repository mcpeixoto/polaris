import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react';

import { Tooltip, type TooltipPlacement } from './Tooltip';
import styles from './IconButton.module.css';

export type IconButtonVariant = 'ghost' | 'secondary' | 'danger';
export type IconButtonSize = 'sm' | 'md';

export interface IconButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'aria-label' | 'children'
> {
  /**
   * Required, and required by the type system rather than by a lint rule or a review
   * comment, because there is no other name available: an icon button's content is a
   * drawing. Omitting it produces a control that a screen reader announces as "button",
   * and in a toolbar of six of them that is six buttons called "button".
   */
  'aria-label': string;
  icon: ReactNode;
  variant?: IconButtonVariant | undefined;
  size?: IconButtonSize | undefined;
  /**
   * Tooltip content, defaulting to the accessible name. Pass `null` for the rare control
   * whose meaning is already spelled out next to it.
   */
  tooltip?: ReactNode | undefined;
  /** A key spec, drawn in the tooltip. See Kbd. */
  keys?: string | undefined;
  tooltipPlacement?: TooltipPlacement | undefined;
  ref?: Ref<HTMLButtonElement> | undefined;
}

/**
 * IconButton is the toolbar and row-affordance control: square, unlabelled, and therefore
 * the component in this directory most able to become unusable by accident.
 *
 * Two things stop that. The accessible name is a required prop, so a nameless one cannot
 * be written. And it wears a tooltip by default, so a sighted user who does not recognise
 * the glyph is one hover — or one Tab — away from being told, rather than left guessing.
 *
 * When the tooltip is just the accessible name read aloud, it is not attached as a
 * description: the name is already announced, and hearing "Archive, Archive" is worse than
 * hearing it once.
 */
export function IconButton({
  icon,
  variant = 'ghost',
  size = 'md',
  tooltip,
  keys,
  tooltipPlacement = 'top',
  type = 'button',
  className,
  ...rest
}: IconButtonProps) {
  const label = rest['aria-label'];
  const button = (
    <button
      {...rest}
      type={type}
      className={[styles.button, styles[variant], styles[size], className]
        .filter(Boolean)
        .join(' ')}
    >
      <span className={styles.icon} aria-hidden="true">
        {icon}
      </span>
    </button>
  );

  if (tooltip === null) {
    return button;
  }

  return (
    <Tooltip
      label={tooltip ?? label}
      keys={keys}
      placement={tooltipPlacement}
      describe={tooltip !== undefined}
    >
      {button}
    </Tooltip>
  );
}
