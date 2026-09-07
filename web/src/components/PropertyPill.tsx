/**
 * One property trigger: a pill named by its value, described by its property, and dimmed
 * while it holds nothing.
 *
 * It lives here rather than inside the issue composer because every creation dialogue in
 * the product is the same shape — a title, a body, and a row of properties you set before
 * you commit — and the row is the part a second copy gets subtly wrong. The description is
 * off the page and on the accessibility tree, the same arrangement the detail rail's
 * triggers use, because Linear's row carries no visible property names and a pill that
 * reads "In Progress" still has to say it is the status.
 */

import { Button, type ButtonProps } from './Button';

import styles from './PropertyPill.module.css';

export interface PropertyPillProps extends Omit<ButtonProps, 'variant' | 'size'> {
  /** The property — "Status", "Project". Read after the value, as the pill's description. */
  name: string;
  /** The id of the hidden element carrying `name`; unique per pill within the form. */
  describe: string;
  /**
   * The accessible name while the pill holds nothing — "No project", "No labels" — because
   * its visible text is then the property's name, and "Project, button" would leave a
   * screen-reader user to guess whether one is set. Absent when the pill holds a value.
   */
  empty?: string | undefined;
}

export function PropertyPill({
  name,
  describe,
  empty,
  className,
  children,
  ...rest
}: PropertyPillProps) {
  return (
    <>
      <Button
        {...rest}
        variant="pill"
        className={[empty === undefined ? null : styles.unset, className].filter(Boolean).join(' ')}
        aria-label={empty}
        aria-describedby={describe}
      >
        {children}
      </Button>
      <span id={describe} className={styles.srOnly}>
        {name}
      </span>
    </>
  );
}
