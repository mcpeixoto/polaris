/**
 * The last thing between a thrown render and a white page.
 *
 * This client renders directly off replica rows, and a missing or half-synced row is the
 * ordinary case rather than the exotic one: a delta arrives naming a project this browser has
 * not replicated yet, a screen reads `.name` off it, and React unmounts the *entire*
 * application — sidebar, keymap, sync engine and all — leaving a blank document whose only
 * recovery is the user knowing to press reload. Nothing in the tree caught that before.
 *
 * So there are two of these, at two different radii, and the difference is the point:
 *
 * - one around the routed view, which keeps the shell alive so the sidebar, the shortcuts
 *   and the connection indicator all still work while one pane says it crashed;
 * - one around the whole signed-in shell, for the failure that takes the chrome with it.
 *
 * The inner one resets on navigation. That is what makes the error card an incident rather
 * than a state: navigating away, or pressing the same key again, re-mounts the subtree and
 * the user is back at work without a reload. `resetKey` is how a caller says what "away"
 * means — the pathname, for the routed case.
 *
 * A class component, because `componentDidCatch` has no hook equivalent and React has said
 * it does not intend to add one.
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';

import { Button, EmptyState } from '~/components';
import styles from './ErrorBoundary.module.css';

export interface ErrorBoundaryProps {
  children: ReactNode;
  /**
   * Changing this clears the error and re-mounts the subtree. Pass the pathname for a
   * per-route boundary; leave it out for the outermost one, where there is nowhere to go.
   */
  resetKey?: string | undefined;
  /** "This screen crashed" vs "Polaris crashed" — the radius, in the user's words. */
  title?: string | undefined;
  /**
   * Offered instead of the reload button, for the boundary that has somewhere better to
   * send the user. Rendered beside "Reload", never instead of it.
   */
  action?: ReactNode | undefined;
}

interface ErrorBoundaryState {
  readonly error: Error | null;
  /** The key the current error was caught under, so a change to it is a reset. */
  readonly caughtAt: string | undefined;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null, caughtAt: undefined };

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error };
  }

  /**
   * Reset by derivation rather than by an effect, so the recovered subtree renders in the
   * same commit as the navigation. An effect would paint the error card once more on the new
   * route first, which reads as the new screen having crashed too.
   */
  static getDerivedStateFromProps(
    props: ErrorBoundaryProps,
    state: ErrorBoundaryState,
  ): Partial<ErrorBoundaryState> | null {
    if (state.error === null) return { caughtAt: props.resetKey };
    if (state.caughtAt === props.resetKey) return null;
    return { error: null, caughtAt: props.resetKey };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Kept, and kept first: the card below says what a user needs, and the console says what
    // a developer needs, and neither substitutes for the other. The component stack is the
    // half a stack trace does not carry.
    console.error('[polaris] a screen crashed', error, info.componentStack);
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (error === null) return this.props.children;

    return (
      <div className={styles.root} role="alert">
        <EmptyState
          title={this.props.title ?? 'This screen crashed'}
          // The exception's own sentence, which is frequently the only clue anybody has —
          // but under a written headline rather than as the whole message, because
          // "Cannot read properties of undefined" is not something to say to a person.
          description={error.message}
          action={
            <div className={styles.actions}>
              {this.props.action}
              <Button variant="secondary" onClick={() => location.reload()}>
                Reload
              </Button>
            </div>
          }
        />
      </div>
    );
  }
}
