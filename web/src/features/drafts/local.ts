/**
 * Local drafts: the composer restore, and unsent comments that have not been saved
 * across devices yet.
 *
 * Navigating away from the create dialog hides it and keeps the title here. Logout,
 * reset and a restart wipe it — that is the documented contract, and the reason this
 * lives in sessionStorage rather than localStorage. Saved drafts (the kind that
 * survive logout) go to the server; see mutations.ts.
 *
 * Comment composers write here too, so the Drafts page can show unsent replies that
 * would otherwise only exist in a component's useState until the tab closed.
 */

import { currentWorkspace } from '~/sync/api';
import type { UUID } from '~/store';

export interface LocalIssueDraft {
  readonly kind: 'issue';
  readonly title: string;
  readonly description: string;
  readonly teamId?: UUID;
  readonly stateId?: UUID;
  readonly assigneeId?: UUID;
  readonly priority?: number;
  readonly projectId?: UUID;
  readonly cycleId?: UUID;
  readonly estimate?: number;
  readonly updatedAt: string;
}

export interface LocalCommentDraft {
  readonly kind: 'comment';
  readonly issueId: UUID;
  readonly parentId?: UUID;
  readonly identifier?: string;
  readonly body: string;
  readonly updatedAt: string;
}

export type LocalDraft = LocalIssueDraft | LocalCommentDraft;

const ISSUE_KEY = (workspaceId: string) => `polaris.draft.issue.${workspaceId}`;
const COMMENTS_KEY = (workspaceId: string) => `polaris.draft.comments.${workspaceId}`;

function workspaceId(): string | null {
  return currentWorkspace();
}

function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = sessionStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJSON(key: string, value: unknown): void {
  try {
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode, quota. Losing a local draft is annoying; throwing out of a keystroke
    // is worse.
  }
}

export function readIssueComposerDraft(ws: string | null = workspaceId()): LocalIssueDraft | null {
  if (ws === null) return null;
  const draft = readJSON<LocalIssueDraft | null>(ISSUE_KEY(ws), null);
  if (draft === null || draft.kind !== 'issue') return null;
  if (draft.title.trim() === '' && draft.description.trim() === '') return null;
  return draft;
}

export function writeIssueComposerDraft(
  draft: LocalIssueDraft | null,
  ws: string | null = workspaceId(),
): void {
  if (ws === null) return;
  if (draft === null || (draft.title.trim() === '' && draft.description.trim() === '')) {
    writeJSON(ISSUE_KEY(ws), null);
    return;
  }
  writeJSON(ISSUE_KEY(ws), { ...draft, kind: 'issue', updatedAt: new Date().toISOString() });
}

export function readCommentDrafts(ws: string | null = workspaceId()): readonly LocalCommentDraft[] {
  if (ws === null) return [];
  const rows = readJSON<LocalCommentDraft[]>(COMMENTS_KEY(ws), []);
  return rows.filter((row) => row.kind === 'comment' && row.body.trim() !== '');
}

export function writeCommentDraft(
  draft: Omit<LocalCommentDraft, 'kind' | 'updatedAt'> | LocalCommentDraft,
  ws: string | null = workspaceId(),
): void {
  if (ws === null) return;
  const existing = readJSON<LocalCommentDraft[]>(COMMENTS_KEY(ws), []);
  const keyOf = (row: { issueId: string; parentId?: string }) =>
    `${row.issueId}:${row.parentId ?? ''}`;
  const next = existing.filter((row) => keyOf(row) !== keyOf(draft));
  if (draft.body.trim() !== '') {
    next.push({
      kind: 'comment',
      issueId: draft.issueId,
      ...(draft.parentId === undefined ? null : { parentId: draft.parentId }),
      ...(draft.identifier === undefined ? null : { identifier: draft.identifier }),
      body: draft.body,
      updatedAt: new Date().toISOString(),
    });
  }
  writeJSON(COMMENTS_KEY(ws), next);
}

export function clearCommentDraft(
  issueId: UUID,
  parentId: UUID | undefined,
  ws: string | null = workspaceId(),
): void {
  writeCommentDraft({ issueId, parentId, body: '' }, ws);
}

/** Every local draft, issue composer first, then comments newest-first. */
export function listLocalDrafts(ws: string | null = workspaceId()): readonly LocalDraft[] {
  const issue = readIssueComposerDraft(ws);
  const comments = [...readCommentDrafts(ws)].sort((a, b) =>
    a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0,
  );
  return issue === null ? comments : [issue, ...comments];
}

export function clearAllLocalDrafts(ws: string | null = workspaceId()): void {
  if (ws === null) return;
  writeJSON(ISSUE_KEY(ws), null);
  writeJSON(COMMENTS_KEY(ws), null);
}
