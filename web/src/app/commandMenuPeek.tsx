/**
 * Opt-in for the command menu's issue glance.
 *
 * The palette mounts Peek only when this provider wraps it. AppShell does that in
 * production; the palette's existing unit tests do not, so a thin `~/app/context` mock
 * never has to satisfy Peek's live store — and those tests keep asserting what they
 * always asserted, without being rewritten for a feature they are not about.
 */

import { createContext, useContext, type ReactNode } from 'react';

import { Peek } from '~/features/peek/Peek';
import type { UUID } from '~/store';

const Enabled = createContext(false);

export function CommandMenuPeekEnabled({ children }: { children: ReactNode }) {
  return <Enabled.Provider value={true}>{children}</Enabled.Provider>;
}

export function useCommandMenuPeekEnabled(): boolean {
  return useContext(Enabled);
}

/** Floating Peek for the issue under the command-menu cursor. */
export function CommandMenuIssuePeek({ issueId }: { issueId: UUID }) {
  return <Peek open issueId={issueId} placement="float" registerActions={false} />;
}
