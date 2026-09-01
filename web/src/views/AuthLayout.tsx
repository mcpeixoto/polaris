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

import { Logo } from '~/components';

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
      {/* The same accent wash the marketing page opens with, so the step from the poster
          into the product is not a step onto a blank grey field. Decorative and inert:
          it is behind everything, it takes no pointer events, and a browser that renders
          none of it leaves the page exactly as it was. */}
      <div className={styles.aurora} aria-hidden="true" />
      <div className={styles.grid} aria-hidden="true" />
      <div className={styles.card}>
        <Logo className={styles.wordmark} />
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
 *
 * ## The wrapper is the animation, and it is the only reason it exists
 *
 * This message is the one element on these screens that changes the layout: it mounts as the
 * form's first child and pushes the fields, the hint and the button down by its own height
 * plus the form's gap, in a single frame. `.errorSlot` is a one-row grid whose row grows from
 * 0fr, which is the only way to animate to a height nothing has measured — and that trick
 * needs the message to be the *item* in the row rather than the box around it, so there has
 * to be a box around it. The alert is still one element with one role and one string in it;
 * assistive technology sees exactly what it saw before.
 *
 * ## Why there is no attempt counter keying this node
 *
 * The obvious complaint about an announced-once error is that submitting the same wrong
 * password twice leaves an identical string sitting there, saying nothing and moving not at
 * all. The usual fix is to key the node on a counter so React remounts it. It is not needed
 * here, and adding it would cost more than it buys:
 *
 *  - Every screen that submits already clears the message first — SignIn, SignUp,
 *    AcceptInvite, CreateWorkspace and OAuthAuthorize all `setError(null)` before the
 *    request. So this component genuinely unmounts on submit and mounts again when the
 *    failure comes back, which re-fires `role="alert"` and replays the reveal below without
 *    anybody keying anything. The re-announcement is a property of the flow, not a trick.
 *  - A counter would have to come from the screen that owns the submit, and a remount driven
 *    by anything looser — a parent re-render, a `busy` flip — would tear down and rebuild a
 *    live region while the request is still in flight, announcing the *previous* failure as
 *    though it were the answer to the attempt just made.
 *
 * The one case that used to be left inert was ConnectServer's client-side address check,
 * which set the same sentence twice without clearing it. "Clear, then set" was the suggested
 * fix here and it would not have worked: both calls land in one event, React batches them
 * into a single render, and this node never unmounts. That message has moved onto its own
 * field, where `Input` can clear it on the next keystroke — which does unmount it — and where
 * it is wired to the control it is about. This component is for failures that came back from
 * somewhere else, and every one of those clears before its request.
 */
export function AuthError({ message }: { message: string | null }) {
  if (message === null) return null;
  return (
    <div className={styles.errorSlot}>
      <p className={styles.error} role="alert">
        {message}
      </p>
    </div>
  );
}
