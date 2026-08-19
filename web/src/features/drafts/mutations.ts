/**
 * Saved drafts. Plain `gql`, not `engine.mutate`: there is no replica entity, and a draft
 * is personal. The listing is the read path; optimistic patches against a store that does
 * not hold drafts would be fiction.
 */

import type { UUID } from '~/store';
import { gql } from '~/sync/api';
import { CREATE_DRAFT, DELETE_DRAFT, DRAFTS_QUERY, UPDATE_DRAFT } from './operations';

export type DraftKind = 'issue' | 'comment';

export interface SavedDraft {
  readonly id: UUID;
  readonly workspaceId: UUID;
  readonly userId: UUID;
  readonly kind: DraftKind;
  readonly payload: Record<string, unknown>;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface IssueDraftPayload {
  readonly title?: string;
  readonly description?: string;
  readonly teamId?: UUID;
  readonly stateId?: UUID;
  readonly assigneeId?: UUID;
  readonly priority?: number;
  readonly projectId?: UUID;
  readonly cycleId?: UUID;
  readonly estimate?: number;
}

export interface CommentDraftPayload {
  readonly issueId: UUID;
  readonly parentId?: UUID;
  readonly identifier?: string;
  readonly body: string;
}

interface WireDraft {
  readonly id: UUID;
  readonly workspaceId: UUID;
  readonly userId: UUID;
  readonly kind: string;
  readonly payload: unknown;
  readonly createdAt: string;
  readonly updatedAt: string;
}

function fromWire(row: WireDraft): SavedDraft {
  const payload =
    row.payload !== null && typeof row.payload === 'object' && !Array.isArray(row.payload)
      ? (row.payload as Record<string, unknown>)
      : {};
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    userId: row.userId,
    kind: row.kind === 'COMMENT' || row.kind === 'comment' ? 'comment' : 'issue',
    payload,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function fetchDrafts(signal?: AbortSignal): Promise<readonly SavedDraft[]> {
  const data = await gql<{ drafts: readonly WireDraft[] }>(DRAFTS_QUERY, undefined, { signal });
  return data.drafts.map(fromWire);
}

export async function createDraft(input: {
  readonly kind: DraftKind;
  readonly payload: Record<string, unknown>;
}): Promise<SavedDraft> {
  const data = await gql<{ createDraft: { draft: WireDraft } }>(CREATE_DRAFT, {
    input: {
      kind: input.kind === 'comment' ? 'COMMENT' : 'ISSUE',
      payload: input.payload,
    },
  });
  return fromWire(data.createDraft.draft);
}

export async function updateDraft(id: UUID, payload: Record<string, unknown>): Promise<SavedDraft> {
  const data = await gql<{ updateDraft: { draft: WireDraft } }>(UPDATE_DRAFT, {
    input: { id, payload },
  });
  return fromWire(data.updateDraft.draft);
}

export async function deleteDraft(id: UUID): Promise<void> {
  await gql(DELETE_DRAFT, { id });
}

export function issuePayloadOf(draft: SavedDraft): IssueDraftPayload {
  const p = draft.payload;
  return {
    ...(typeof p.title === 'string' ? { title: p.title } : null),
    ...(typeof p.description === 'string' ? { description: p.description } : null),
    ...(typeof p.teamId === 'string' ? { teamId: p.teamId } : null),
    ...(typeof p.stateId === 'string' ? { stateId: p.stateId } : null),
    ...(typeof p.assigneeId === 'string' ? { assigneeId: p.assigneeId } : null),
    ...(typeof p.priority === 'number' ? { priority: p.priority } : null),
    ...(typeof p.projectId === 'string' ? { projectId: p.projectId } : null),
    ...(typeof p.cycleId === 'string' ? { cycleId: p.cycleId } : null),
    ...(typeof p.estimate === 'number' ? { estimate: p.estimate } : null),
  };
}

export function commentPayloadOf(draft: SavedDraft): CommentDraftPayload | null {
  const body = draft.payload.body;
  const issueId = draft.payload.issueId;
  if (typeof body !== 'string' || typeof issueId !== 'string') return null;
  return {
    issueId,
    body,
    ...(typeof draft.payload.parentId === 'string' ? { parentId: draft.payload.parentId } : null),
    ...(typeof draft.payload.identifier === 'string'
      ? { identifier: draft.payload.identifier }
      : null),
  };
}

export function draftTitle(draft: SavedDraft): string {
  if (draft.kind === 'comment') {
    const body = typeof draft.payload.body === 'string' ? draft.payload.body.trim() : '';
    return body === '' ? 'Comment draft' : (body.split('\n')[0] ?? 'Comment draft');
  }
  const title = typeof draft.payload.title === 'string' ? draft.payload.title.trim() : '';
  return title === '' ? 'Untitled issue' : title;
}
