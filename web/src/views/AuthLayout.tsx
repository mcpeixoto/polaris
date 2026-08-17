/**
 * The frame around the four screens a person sees before they are inside a workspace: sign
 * in, sign up, create a workspace, accept an invitation.
 *
 * They share a frame because they are one journey with three possible entrances, and a
 * person bounced between them — sign in, no workspace, create one — should feel like they are
 * moving through a single thing rather than between three products.
 *
 * These screens render outside the sync engine. There is no replica yet, and nothing here may
 * reach for `useStore` or `useQuery`: at this point in the boot sequence there is no store to
 * read. Everything they need comes from the auth client in `~/sync/api`.
 */

import type { FormEvent, ReactNode } from 'react';

import styles from './AuthLayout.module.css';

export interface AuthLayoutProps {
  title: string;
  /** One line under the title. What this screen is for, not a marketing sentence. */
  subtitle?: string | undefined;
  /** The sign-in/sign-up cross-link, or whatever else this screen offers as a way out. */
  footer?: ReactNode | undefined;
  /** Optional, because a screen whose whole message is its title has nothing to put here. */
  children?: ReactNode | undefined;
}

export function AuthLayout({ title, subtitle, footer, children }: AuthLayoutProps) {
  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <p className={styles.wordmark}>Polaris</p>
        <h1 className={styles.title}>{title}</h1>
        {subtitle === undefined ? null : <p className={styles.subtitle}>{subtitle}</p>}
        {children}
      </div>
      {footer === undefined ? null : <div className={styles.footer}>{footer}</div>}
    </main>
  );
}

/**
 * The form itself, so the four screens share one rhythm and one validation decision.
 *
 * `noValidate` turns off the browser's own bubbles. They appear over the field, in the
 * browser's wording rather than the product's, and they disappear on the next keystroke —
 * which makes them exactly the wrong shape for the errors that matter here, all of which come
 * back from the server. `required` stays on the fields, because it is also what tells
 * assistive technology that a field is not optional.
 */
export function AuthForm({
  onSubmit,
  children,
}: {
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  children: ReactNode;
}) {
  return (
    <form className={styles.form} onSubmit={onSubmit} noValidate>
      {children}
    </form>
  );
}

/**
 * Two fields that are one decision: a workspace name and its address, a team's name and its
 * key. Side by side where there is room, stacked where there is not.
 */
export function AuthFieldPair({ children }: { children: ReactNode }) {
  return <div className={styles.pair}>{children}</div>;
}

/**
 * A failure from the server, said once and announced.
 *
 * `role="alert"` because a form that has just been submitted is the moment a keyboard user
 * has no idea what happened: focus is still in the field they left, the button has stopped
 * spinning, and without the announcement the only evidence is a red line they cannot see.
 */
export function AuthError({ message }: { message: string | null }) {
  if (message === null) return null;
  return (
    <p className={styles.error} role="alert">
      {message}
    </p>
  );
}
