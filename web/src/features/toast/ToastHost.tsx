/**
 * The toast stack's one host, and the plain functions that put things in it.
 *
 * Mounted **once**, at the top of the shell, and never rendered by the screens that raise
 * toasts — for the same reason `UndoToast` is: a failure raised by a mutation on a screen the
 * user is navigating away from has to outlive that screen, or the message unmounts with the
 * thing it was about. The store is a module-level value rather than React state so that
 * `showToast` can be called from a `.catch`, a registered action or a mutation wrapper,
 * none of which are inside a component.
 *
 * ## What it announces, and how
 *
 * The host is two live regions, not one. `role="status"` (polite) carries confirmations and
 * `role="alert"` (assertive) carries failures, because an assertive region interrupts
 * whatever the screen reader was saying — which is right for "that change was refused" and
 * rude for "copied". Both regions are always in the document and only their contents change:
 * a live region inserted already populated is frequently never announced at all.
 *
 * ## Auto-dismissal pauses under the pointer
 *
 * One timer for the whole stack, armed on the soonest deadline. Hovering the host stops it
 * and, on leaving, hands every entry back the time it spent being read (`extend`). Without
 * that, the toast a user moved the mouse towards in order to read — or to press Retry on —
 * expires under their cursor, which is the single most common complaint about this pattern.
 * Focus inside the host does the same thing, so the keyboard path gets the same grace.
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { Button, IconButton } from '~/components';
import { usePresence } from '~/hooks/usePresence';
import styles from './ToastHost.module.css';
import {
  dismiss,
  EMPTY_TOAST_STACK,
  expire,
  nextDeadline,
  extend,
  push,
  type Toast,
  type ToastStack,
  type ToastTone,
} from './toast';

let stack: ToastStack = EMPTY_TOAST_STACK;
let sequence = 0;
const listeners = new Set<() => void>();

function publish(next: ToastStack): void {
  // Identity, not equality: `expire` and `extend` return the same object when there was
  // nothing to do, and notifying on that would put the host's timer into a loop with itself.
  if (next === stack) return;
  stack = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function snapshot(): ToastStack {
  return stack;
}

export interface ToastRequest {
  /** The headline, in the user's words. Sentence case, no trailing period. */
  readonly title: string;
  readonly description?: string | undefined;
  readonly tone?: ToastTone | undefined;
  /** Offered as a button. Omit when there is nothing useful to press. */
  readonly retry?: (() => void) | undefined;
  /**
   * Identifies the message, so re-raising it refreshes the window rather than stacking a
   * second copy. Defaults to a fresh id, which is right for anything not repeatable.
   */
  readonly id?: string | undefined;
}

/** Raises a toast. Returns its id, so a caller that can resolve the problem can dismiss it. */
export function showToast(request: ToastRequest): string {
  sequence += 1;
  const id = request.id ?? `toast-${sequence}`;
  publish(
    push(
      stack,
      {
        id,
        title: request.title,
        description: request.description,
        tone: request.tone ?? 'info',
        retry: request.retry,
      },
      Date.now(),
    ),
  );
  return id;
}

/**
 * Raises a failure.
 *
 * Separate from `showToast` because the shape of an error message is a decision the product
 * makes once — a written headline, the server's sentence beneath it, and a retry when the
 * caller knows how — rather than something each of seventy-seven call sites re-invents.
 */
export function offerError(request: Omit<ToastRequest, 'tone'>): string {
  return showToast({ ...request, tone: 'error' });
}

/** Takes one down early. */
export function dismissToast(id: string): void {
  publish(dismiss(stack, id));
}

/**
 * Forgets everything outstanding.
 *
 * For the moments when the messages stop meaning anything rather than merely getting old:
 * signing out, or switching workspace, where a retry closure holds an engine for a replica
 * this client has closed.
 */
export function clearToasts(): void {
  publish(EMPTY_TOAST_STACK);
}

export function ToastHost() {
  const current = useSyncExternalStore(subscribe, snapshot, snapshot);
  const [paused, setPaused] = useState(false);
  const pausedAtRef = useRef(0);

  const pause = useCallback(() => {
    if (pausedAtRef.current === 0) pausedAtRef.current = Date.now();
    setPaused(true);
  }, []);

  const resume = useCallback(() => {
    const since = pausedAtRef.current;
    pausedAtRef.current = 0;
    setPaused(false);
    if (since !== 0) publish(extend(snapshot(), Date.now() - since));
  }, []);

  // One timer for the whole stack, armed on the soonest deadline rather than one per entry:
  // pruning is a single pass and re-arming after it is a single subtraction.
  useEffect(() => {
    if (paused) return;
    const deadline = nextDeadline(current);
    if (deadline === null) return;
    const timer = window.setTimeout(
      () => publish(expire(snapshot(), Date.now())),
      Math.max(deadline - Date.now(), 0),
    );
    return () => window.clearTimeout(timer);
  }, [current, paused]);

  const alerts = current.entries.filter((entry) => entry.tone === 'error');
  const statuses = current.entries.filter((entry) => entry.tone !== 'error');

  return (
    <div
      className={styles.host}
      onMouseEnter={pause}
      onMouseLeave={resume}
      onFocusCapture={pause}
      onBlurCapture={resume}
    >
      {/* Two regions rather than one, and both permanently mounted — see the note above.

        `aria-live` is what does the announcing, and it is unconditional: the node has to be
        in the document before the message lands in it. The `role`, which only names the node
        for anything reading the accessibility tree, is not — an empty region carrying
        `role="alert"` is an alert that says nothing, and it is one a screen-reader user can
        land on and one that answers "is anything wrong on this screen?" with yes. So the
        role appears with the first message and leaves with the last. */}
      <div
        className={styles.region}
        role={statuses.length === 0 ? undefined : 'status'}
        aria-live="polite"
      >
        {statuses.map((toast) => (
          <ToastCard key={toast.id} toast={toast} />
        ))}
      </div>
      <div
        className={styles.region}
        role={alerts.length === 0 ? undefined : 'alert'}
        aria-live="assertive"
      >
        {alerts.map((toast) => (
          <ToastCard key={toast.id} toast={toast} />
        ))}
      </div>
    </div>
  );
}

/**
 * One toast, including its own departure.
 *
 * Presence is per-card rather than per-stack because the cards leave independently: an error
 * dismissed by hand while an older confirmation is still counting down must fall on its own,
 * and a stack-level exit would take the survivor with it. `open` is a local flag flipped by
 * the close button before the store is told, so the fall runs before the row is gone.
 */
function ToastCard({ toast }: { toast: Toast }) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(true);
  const { present, exitProps } = usePresence(open, cardRef);

  const close = () => {
    setOpen(false);
    dismissToast(toast.id);
  };

  if (!present) return null;

  return (
    <div
      ref={cardRef}
      className={[styles.toast, toast.tone === 'error' ? styles.error : null]
        .filter(Boolean)
        .join(' ')}
      {...exitProps}
    >
      <div className={styles.text}>
        <span className={styles.title}>{toast.title}</span>
        {toast.description === undefined ? null : (
          <span className={styles.description}>{toast.description}</span>
        )}
      </div>
      {toast.retry === undefined ? null : (
        <Button
          size="sm"
          onClick={() => {
            close();
            toast.retry?.();
          }}
        >
          Retry
        </Button>
      )}
      <IconButton
        size="sm"
        variant="ghost"
        aria-label="Dismiss"
        onClick={close}
        icon={
          <svg viewBox="0 0 16 16" fill="none">
            <path d="m4.5 4.5 7 7m0-7-7 7" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        }
      />
    </div>
  );
}
