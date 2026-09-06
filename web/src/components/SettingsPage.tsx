import type { ReactNode } from 'react';

import styles from './SettingsPage.module.css';

export interface SettingsPageProps {
  /** The page name, sentence case: "Workspace", "Members", "API keys". */
  title: string;
  /** One line under the title saying what this page decides. Optional but usually right. */
  description?: string | undefined;
  /**
   * Controls that belong to the page rather than to a section — "New team", "Invite people".
   * A page has at most one primary here.
   */
  actions?: ReactNode | undefined;
  /**
   * A page-level failure, rendered once above the body as `role="alert"`.
   *
   * Section-level failures belong to the section, not here: a banner three sections away
   * from the form that produced it is a banner nobody connects to the thing they just did.
   */
  error?: string | undefined;
  /**
   * `wide` is for the pages whose content is a table with more columns than prose has
   * width — the audit log, the member list. It is a named variant precisely so those pages
   * stop inventing their own `ch` value.
   */
  width?: 'default' | 'wide' | undefined;
  children: ReactNode;
}

/**
 * The frame every settings screen wears.
 *
 * Before this existed, ten stylesheets hand-rolled `.screen/.header/.title/.body` and had
 * drifted into six different content measures, two horizontal paddings and three section
 * header sizes — so the settings area read as thirty pages rather than as one product.
 * The frame is deliberately not configurable beyond `width`: a page differs from its
 * siblings in what it says, never in how it is set.
 *
 * There is no header bar. The rest of the shell puts a 44px bar over every view because a
 * list needs its toolbar pinned while it scrolls; a settings page is a document, and a
 * document's title scrolls with it. The column is centred and capped so the page reads at
 * one measure whatever the window is, and the title sits well below the top edge — a
 * settings screen is arrived at deliberately, and the room above the title is what says
 * "you are somewhere else now" without a border saying it.
 */
export function SettingsPage({
  title,
  description,
  actions,
  error,
  width = 'default',
  children,
}: SettingsPageProps) {
  return (
    <div className={styles.screen}>
      <div className={width === 'wide' ? `${styles.body} ${styles.wide}` : styles.body}>
        <header className={styles.header}>
          <div className={styles.titleRow}>
            <h1 className={styles.title}>{title}</h1>
            {actions === undefined ? null : <div className={styles.actions}>{actions}</div>}
          </div>
          {description === undefined ? null : <p className={styles.description}>{description}</p>}
        </header>

        {error === undefined ? null : (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}

        <div className={styles.sections}>{children}</div>
      </div>
    </div>
  );
}
