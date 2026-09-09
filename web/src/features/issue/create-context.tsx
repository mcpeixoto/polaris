/**
 * Opens the create-issue composer from anywhere that is not the `C` binding.
 *
 * Creation URLs, the Drafts page and "copy create URL" all need to hand the composer a
 * seed without the shell importing those screens. The shell owns the overlay; this
 * context is the request pipe.
 */

import { createContext, useContext, type ReactNode } from 'react';

import type { UUID } from '~/store';

import type { IssueComposerSeed } from './create-url';

export interface CreateIssueHandle {
  /**
   * Ask the shell for a composer.
   *
   * Returns false when one was already up and the request was dropped — the shell will not
   * throw away a half-written issue for a second `C`. A screen that opens this on the user's
   * behalf has to know, because otherwise it stands there claiming a composer it did not get.
   *
   * `onClosed` fires when that composer shuts, for whatever reason. The Drafts page uses it
   * to re-read its rows: filing a resumed draft deletes it, and the page that offered it has
   * no other way to find out.
   *
   * `onCreated` fires with the new issue's id the moment the server takes it, which is a
   * different event and earlier: the composer stays open for "create more", and a caller that
   * has to attach something to the issue it just asked for — a blocking relation, a parent —
   * cannot wait for a close that may never name the right issue.
   */
  open(
    seed?: IssueComposerSeed,
    options?: { onClosed?: () => void; onCreated?: (issueId: UUID) => void },
  ): boolean;
}

const CreateIssueContext = createContext<CreateIssueHandle | null>(null);

export function CreateIssueProvider({
  value,
  children,
}: {
  value: CreateIssueHandle;
  children: ReactNode;
}) {
  return <CreateIssueContext.Provider value={value}>{children}</CreateIssueContext.Provider>;
}

/**
 * The handle, or null where there is no shell above.
 *
 * Every screen in the running product is inside one, so `useCreateIssue` throwing is the
 * right default — a screen that silently could not open a composer would be a menu item that
 * does nothing. The row context menu is the exception: it is rendered by six surfaces, several
 * of which are mounted on their own in tests, and its "Create related" items are worth
 * omitting rather than worth taking the screen down for.
 */
export function useOptionalCreateIssue(): CreateIssueHandle | null {
  return useContext(CreateIssueContext);
}

export function useCreateIssue(): CreateIssueHandle {
  const handle = useContext(CreateIssueContext);
  if (handle === null) {
    throw new Error('useCreateIssue must be used inside the application shell');
  }
  return handle;
}
