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
  /**
   * Kept for callers written against the separator layout. Sections are cards now and no
   * longer draw a divider, so this changes nothing; it is accepted so that thirty screens
   * did not have to be edited in the same commit as the frame.
   */
  flush?: boolean | undefined;
  /**
   * `card` boxes the children: a raised surface whose contents are `SettingsRow`s, or a
   * table that wants the card's edge as its own. `plain` drops the box for content that
   * draws its own — a grid of integration tiles, a list of things that are each a card.
   */
  surface?: 'card' | 'plain' | undefined;
  children: ReactNode;
}

/**
 * One block of related settings inside a `SettingsPage`.
 *
 * The heading scale is fixed here on purpose. The same `<h2>` used to be `lg` on four
 * pages, `md` on three and `sm` on one, which is the kind of drift nobody notices on any
 * single screen and everybody feels across thirty of them.
 *
 * The children live on a card. A settings screen is a list of decisions, and a card with
 * one row per decision is what makes that list scannable: the label column lines up, the
 * control column lines up, and a hairline between rows says where one decision ends. The
 * old layout stacked labelled fields down the page with nothing but whitespace between
 * sections, which read as one long form rather than as a set of things to check.
 */
export function SettingsSection({
  title,
  description,
  actions,
  status,
  error,
  surface = 'card',
  children,
}: SettingsSectionProps) {
  const hasHeader = title !== undefined || actions !== undefined || status !== undefined;

  return (
    <section className={styles.section}>
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

      <div className={surface === 'card' ? styles.card : styles.plain}>{children}</div>
    </section>
  );
}

export interface SettingsRowProps {
  /**
   * What this row decides, as the control's visible name: "Display name", "Theme". The
   * control inside should carry the same name for the accessibility tree — `label` with
   * `hideLabel` on an `Input` or `Select`, `aria-label` on anything else — because the row's
   * label is drawn, not wired. Omit it for a row whose content is its own label: a table, a
   * list, a form with several fields.
   */
  label?: ReactNode | undefined;
  /** One line under the label: what the setting does, or what the value is used for. */
  description?: ReactNode | undefined;
  /**
   * The control takes a fixed share of the row — 280px, or half the row when that is less —
   * rather than its own width. For text inputs and selects, whose natural width is whatever
   * the browser felt like; not for a switch, a checkbox or a button, which are the size
   * they are and belong on the right edge.
   */
  wide?: boolean | undefined;
  /** The control, or the content when there is no label. */
  children?: ReactNode | undefined;
}

/**
 * One row on a settings card: the decision on the left, the control that makes it on the
 * right.
 *
 * The control column is sized to its content and capped at half the row, so a text input
 * is a text input's width and a switch is a switch's width — the label column takes what is
 * left. A row with no label is a padded slot: the content spans the card and the card's
 * hairline still separates it from its neighbours, which is what a member list, a key table
 * or a multi-field form wants from the card without pretending to be a label/control pair.
 */
export function SettingsRow({ label, description, wide = false, children }: SettingsRowProps) {
  if (label === undefined) {
    return <div className={styles.row}>{children}</div>;
  }
  return (
    <div className={`${styles.row} ${styles.split}`}>
      <div className={styles.rowText}>
        <div className={styles.rowLabel}>{label}</div>
        {description === undefined ? null : (
          <div className={styles.rowDescription}>{description}</div>
        )}
      </div>
      {children === undefined ? null : (
        <div className={wide ? `${styles.rowControl} ${styles.wide}` : styles.rowControl}>
          {children}
        </div>
      )}
    </div>
  );
}
