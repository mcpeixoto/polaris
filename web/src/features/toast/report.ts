/**
 * What the product says when a write came back refused.
 *
 * It lived in `features/issue/mutations.ts`, which is where it was first needed and where it
 * should not have stayed: forty-one modules import it, and a shared error reporter reached
 * through the issue feature is a dependency every one of them pays for a reason none of them
 * has. Nothing about it is issue-shaped. `features/issue/mutations.ts` re-exports it so that
 * forty-one import lines did not have to move in the same change; new code imports it here.
 */

import { offerError } from './ToastHost';
import { ApiError } from '~/sync/api';

export interface ReportOptions {
  /**
   * The headline the user reads, in the words of what they were doing: "Couldn't move
   * issue". The default is deliberately vague, because a generic sentence is better than a
   * wrong specific one — but a caller that knows should say.
   */
  readonly title?: string | undefined;
  /**
   * Runs the same write again, offered as a button on the toast. Omit it when there is
   * nothing useful to press: a retry that cannot work is worse than no retry, because the
   * user presses it and learns nothing new.
   */
  readonly retry?: (() => void) | undefined;
}

/**
 * Reports a mutation that failed and returns.
 *
 * Exported because the screens call these helpers from click handlers and registered
 * actions, neither of which can await — and a floating promise that rejects is an unhandled
 * rejection in the console rather than a message anybody reads.
 *
 * It does two things, and both are load bearing. The console line is for whoever is reading
 * a support ticket. The toast is for the person the refusal happened to: the optimistic value
 * has already been reverted by `engine.mutate`, and a value that silently snaps back to what
 * it was is indistinguishable from a click that never landed.
 *
 * Offline is still the exception and still says nothing. The write is queued in the outbox
 * and will go out when the connection returns, so it has not failed — and `ConnectionIndicator`
 * is already saying the one true thing about that state, once, rather than once per write.
 *
 * Written to be passable straight to `.catch`, which is how all seventy-seven call sites use
 * it: the second parameter is optional and `Promise.catch` only ever supplies the first.
 */
export function report(error: unknown, options: ReportOptions = {}): void {
  if (error instanceof ApiError && error.isOffline) return;
  console.error('[polaris] a change could not be saved', error);
  offerError({
    title: options.title ?? "Couldn't save that change",
    // The server's own sentence, which for an ApiError is written for a human and is
    // frequently the only thing that says *why*. Anything else is a programming fault, and
    // its message is not something to put in front of a user.
    description: error instanceof ApiError ? error.message : undefined,
    retry: options.retry,
  });
}
