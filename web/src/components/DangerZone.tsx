import type { ReactNode } from 'react';

import styles from './DangerZone.module.css';

export interface DangerZoneProps {
  /** Defaults to "Danger zone". Override where the subject needs naming. */
  title?: string | undefined;
  /** What class of thing lives here. One sentence. */
  description?: string | undefined;
  /** A failure from one of the actions, as `role="alert"`. */
  error?: string | undefined;
  /** The irreversible actions, one row each: label, consequence, button. */
  children: ReactNode;
}

/**
 * The last block on a settings page: the things that cannot be undone by pressing the same
 * button again.
 *
 * The border is the whole point. These actions used to sit in an ordinary section, styled
 * exactly like "Rename this team", separated from it by nothing but the word "Delete" —
 * and a red button is not a boundary, it is a colour. Grouping them behind a visible edge
 * says *before* the click that this part of the page is different.
 *
 * A row inside is expected to name its own consequence. `DangerZoneRow` draws that shape;
 * it is not enforced, because some destructive actions need a form rather than a sentence.
 */
export function DangerZone({
  title = 'Danger zone',
  description,
  error,
  children,
}: DangerZoneProps) {
  return (
    <section className={styles.zone}>
      <h2 className={styles.heading}>{title}</h2>
      {description === undefined ? null : <p className={styles.hint}>{description}</p>}
      {error === undefined ? null : (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      <div className={styles.rows}>{children}</div>
    </section>
  );
}

export interface DangerZoneRowProps {
  /** The action, as a noun phrase: "Delete this team". */
  title: string;
  /** What it takes away, in sentences. The reader decides from this, not from the button. */
  consequence: string;
  /** The button. Exactly one per row, so no row asks two questions at once. */
  action: ReactNode;
}

/** One irreversible action: what it is, what it costs, and the control that does it. */
export function DangerZoneRow({ title, consequence, action }: DangerZoneRowProps) {
  return (
    <div className={styles.row}>
      <div className={styles.rowText}>
        <p className={styles.rowTitle}>{title}</p>
        <p className={styles.rowConsequence}>{consequence}</p>
      </div>
      <div className={styles.rowAction}>{action}</div>
    </div>
  );
}
