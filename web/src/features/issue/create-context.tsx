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
  open(seed?: IssueComposerSeed): void;
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
