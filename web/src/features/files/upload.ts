/**
 * Upload an image to POST /files/upload and return the capability URL for markdown.
 */

import { ApiError, authHeaders, currentWorkspace } from '~/sync/api';
import { apiUrl, credentialsMode } from '~/sync/endpoint';
import type { UUID } from '~/store';

export interface UploadedImage {
  readonly id: string;
  readonly url: string;
  readonly absoluteUrl: string;
  readonly contentType: string;
  readonly byteSize: number;
  readonly name: string;
}

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

export function isImageFile(file: File): boolean {
  if (IMAGE_TYPES.has(file.type)) return true;
  // Some OS clipboard pastes omit type; fall back to the extension.
  return /\.(png|jpe?g|gif|webp)$/i.test(file.name);
}

export async function uploadImage(file: File, issueId?: UUID): Promise<UploadedImage> {
  if (!isImageFile(file)) {
    throw new ApiError('VALIDATION', 'Only PNG, JPEG, GIF and WebP images can be uploaded.');
  }
  if (currentWorkspace() === null) {
    throw new ApiError('UNAUTHENTICATED', 'Open a workspace to upload images.');
  }

  const body = new FormData();
  body.append('file', file, file.name || 'image.png');
  if (issueId !== undefined) body.append('issueId', issueId);

  const res = await fetch(apiUrl('/files/upload'), {
    method: 'POST',
    body,
    credentials: credentialsMode(),
    headers: authHeaders(),
  });

  if (!res.ok) {
    let message = 'The image could not be uploaded.';
    try {
      const payload = (await res.json()) as { error?: { message?: string; code?: string } };
      if (payload.error?.message) message = payload.error.message;
      throw new ApiError((payload.error?.code as ApiError['code']) ?? 'INTERNAL', message);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(res.status === 401 ? 'UNAUTHENTICATED' : 'INTERNAL', message);
    }
  }

  const payload = (await res.json()) as {
    id: string;
    url: string;
    absoluteUrl: string;
    contentType: string;
    byteSize: number;
    name: string;
  };
  return {
    id: payload.id,
    url: payload.url,
    absoluteUrl: payload.absoluteUrl,
    contentType: payload.contentType,
    byteSize: payload.byteSize,
    name: payload.name,
  };
}

/** Markdown image line inserted at the caret after a successful upload. */
export function markdownImage(name: string, url: string): string {
  const alt = name.replace(/[[\]]/g, '') || 'image';
  return `![${alt}](${url})`;
}

/**
 * Pull image files out of a paste or drop event.
 *
 * Prefers `items` of kind file (clipboard screenshots) and falls back to `files`.
 */
export function imageFilesFromDataTransfer(data: DataTransfer | null): File[] {
  if (data === null) return [];
  const out: File[] = [];
  if (data.items !== undefined && data.items.length > 0) {
    for (const item of data.items) {
      if (item.kind !== 'file') continue;
      const file = item.getAsFile();
      if (file !== null && isImageFile(file)) out.push(file);
    }
    if (out.length > 0) return out;
  }
  for (const file of data.files) {
    if (isImageFile(file)) out.push(file);
  }
  return out;
}
