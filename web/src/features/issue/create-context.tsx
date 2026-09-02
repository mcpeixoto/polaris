/**
 * Opens the create-issue composer from anywhere that is not the `C` binding.
 *
 * Creation URLs, the Drafts page and "copy create URL" all need to hand the composer a
 * seed without the shell importing those screens. The shell owns the overlay; this
 * context is the request pipe.
 */

import { createContext, useContext, type ReactNode } from 'react';

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
   */
  open(seed?: IssueComposerSeed, options?: { onClosed?: () => void }): boolean;
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

export function useCreateIssue(): CreateIssueHandle {
  const handle = useContext(CreateIssueContext);
  if (handle === null) {
    throw new Error('useCreateIssue must be used inside the application shell');
  }
  return handle;
}
