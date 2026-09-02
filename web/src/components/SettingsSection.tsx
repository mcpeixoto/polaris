import type { ReactNode } from 'react';

import styles from './SettingsSection.module.css';

export interface SettingsSectionProps {
  /** The section heading, sentence case. Renders as an `<h2>` inside the page's `<h1>`. */
  title?: string | undefined;
  /** One sentence explaining what the controls below decide. */
  description?: string | undefined;
  /** Controls for the section as a whole — "Add label", a filter, a scope select. */
  actions?: ReactNode | undefined;
  /**
   * The save/status slot beside the heading. Usually a `SaveIndicator`; a section that
   * confirms its own writes keeps success and failure in one place rather than letting
   * failure own a page-top banner while success says nothing.
   */
  status?: ReactNode | undefined;
  /** A failure that belongs to this section's controls, as `role="alert"`. */
  error?: string | undefined;
  /** Drops the separator, for the last section on a page or one inside a DangerZone. */
  flush?: boolean | undefined;
  children: ReactNode;
}

/**
 * One block of related settings inside a `SettingsPage`.
 *
 * The heading scale is fixed here on purpose. The same `<h2>` used to be `lg` on four
 * pages, `md` on three and `sm` on one, which is the kind of drift nobody notices on any
 * single screen and everybody feels across thirty of them.
 */
export function SettingsSection({
  title,
  description,
  actions,
  status,
  error,
  flush = false,
  children,
}: SettingsSectionProps) {
  const hasHeader = title !== undefined || actions !== undefined || status !== undefined;

  return (
    <section className={flush ? `${styles.section} ${styles.flush}` : styles.section}>
      {hasHeader ? (
        <div className={styles.head}>
          {title === undefined ? null : <h2 className={styles.heading}>{title}</h2>}
          {status === undefined ? null : <div className={styles.status}>{status}</div>}
          {actions === undefined ? null : <div className={styles.actions}>{actions}</div>}
        </div>
      ) : null}

      {description === undefined ? null : <p className={styles.hint}>{description}</p>}

      {error === undefined ? null : (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      <div className={styles.content}>{children}</div>
    </section>
  );
}
