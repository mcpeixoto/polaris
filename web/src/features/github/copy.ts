/**
 * Copy a git branch name onto the clipboard.
 *
 * The format comes from the replica's GitHub connection when one exists, otherwise the
 * default. That is what makes the shortcut work before GitHub is connected and after
 * the laptop goes offline.
 */

import type { Issue, Store } from '~/store';

import { DEFAULT_GIT_BRANCH_FORMAT, formatGitBranchName } from './branch';

export function gitBranchNameFor(store: Store, issue: Issue, user: string): string {
  const connection = [...store.githubConnections.values()][0];
  return formatGitBranchName(connection?.branchNameFormat ?? DEFAULT_GIT_BRANCH_FORMAT, {
    identifier: store.identifierOf(issue),
    title: issue.title,
    user,
  });
}

export async function copyText(value: string): Promise<boolean> {
  const clipboard: Clipboard | undefined = navigator.clipboard;
  if (clipboard === undefined) return false;
  try {
    await clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}
