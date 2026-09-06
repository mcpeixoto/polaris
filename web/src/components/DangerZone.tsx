import type { ReactNode } from 'react';

import { Spinner } from './Spinner';
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
 * It is drawn as one more section — heading, card, rows — and not as the red-bordered,
 * red-tinted box it used to be. That box was an argument that colour alone is not a
 * boundary, and it was right about that and wrong about the remedy: a tinted region on an
 * otherwise quiet page shouts on every visit, including the thousands where nobody is about
 * to delete anything. What marks these rows now is the same thing that marks a destructive
 * command everywhere else in the product — the action's own text is red, and the row spells
 * out what it costs. The card edge is the boundary; the heading is the warning.
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
      <div className={styles.card}>{children}</div>
    </section>
  );
}

export interface DangerZoneRowProps {
  /** The action, as a noun phrase: "Delete this team". */
  title: string;
  /** What it takes away, in sentences. The reader decides from this, not from the button. */
  consequence: string;
  /**
   * The button, when the row needs one this component cannot draw — a menu, a form. Most
   * rows want `actionLabel` and `onAction` instead, which draw the red text button.
   */
  action?: ReactNode | undefined;
  /** The verb on the red text button: "Leave workspace", "Delete team". */
  actionLabel?: string | undefined;
  onAction?: (() => void) | undefined;
  /** The action is in flight; the button keeps its place and stops responding. */
  busy?: boolean | undefined;
  disabled?: boolean | undefined;
}

/** One irreversible action: what it is, what it costs, and the control that does it. */
export function DangerZoneRow({
  title,
  consequence,
  action,
  actionLabel,
  onAction,
  busy = false,
  disabled = false,
}: DangerZoneRowProps) {
  return (
    <div className={styles.row}>
      <div className={styles.rowText}>
        <p className={styles.rowTitle}>{title}</p>
        <p className={styles.rowConsequence}>{consequence}</p>
      </div>
      <div className={styles.rowAction}>
        {action}
        {actionLabel === undefined ? null : (
          // Not `Button`: its `danger` variant is a filled red, which is the right weight for
          // the confirm inside a dialog and the wrong one for the row that opens it. The row
          // has already said what the action costs; the button only has to be findable, and
          // red text on a quiet card is findable without being loud. Busy is `aria-disabled`
          // rather than `disabled` for the reason Button gives: a disabled element drops
          // focus, and the person who just clicked should keep their place.
          <button
            type="button"
            className={styles.actionButton}
            aria-disabled={busy || disabled ? true : undefined}
            onClick={busy || disabled ? undefined : onAction}
          >
            {busy ? <Spinner size="sm" /> : null}
            {actionLabel}
          </button>
        )}
      </div>
    </div>
  );
}
