/**
 * Reads the initial snapshot.
 *
 * The server streams NDJSON — one JSON object per line — so rows can be written to
 * IndexedDB as they arrive and the progress bar reflects real work. Waiting for a
 * complete JSON document would mean a blank screen for the whole download and then a
 * single parse of tens of megabytes on the main thread.
 */

import { authHeaders, ApiError, ensureFreshToken } from './api';
import { apiUrl, credentialsMode } from './endpoint';

export interface BootstrapMeta {
  kind: 'meta';
  version: number;
  clientSchema: number;
}

export interface BootstrapEntity {
  kind: 'entity';
  type: string;
  id: string;
  payload: unknown;
}

export interface BootstrapEnd {
  kind: 'end';
  count: number;
  error?: string;
}

type BootstrapLine = BootstrapMeta | BootstrapEntity | BootstrapEnd;

export interface BootstrapHandlers {
  /** Called once, before any entity. */
  onMeta(meta: BootstrapMeta): void | Promise<void>;
  /**
   * Called with a batch of entities. Batching is the caller's lever on write cost: one
   * IndexedDB transaction per batch instead of one per row turns a ten-thousand-row
   * snapshot from minutes into seconds.
   */
  onBatch(entities: BootstrapEntity[]): void | Promise<void>;
  onProgress?(received: number): void;
}

/** Rows buffered before handing a batch to the caller. */
const BATCH_SIZE = 500;

/**
 * Streams a workspace snapshot.
 *
 * Returns the version the snapshot is consistent as of. That value is what the client
 * then presents as `resume` on the sync socket, which is the whole reason the server
 * emits it inside the same transaction as the rows: it is neither ahead of nor behind
 * what was streamed.
 */
export async function streamBootstrap(
  workspaceId: string,
  handlers: BootstrapHandlers,
  signal?: AbortSignal,
): Promise<{ version: number; clientSchema: number; count: number }> {
  await ensureFreshToken();

  const res = await fetch(apiUrl(`/sync/bootstrap?workspace=${encodeURIComponent(workspaceId)}`), {
    headers: { ...authHeaders(), Accept: 'application/x-ndjson' },
    credentials: credentialsMode(),
    signal,
  });

  if (!res.ok) {
    let code = 'INTERNAL';
    let message = 'could not load the workspace';
    try {
      const body = (await res.json()) as { error?: { code?: string; message?: string } };
      code = body.error?.code ?? code;
      message = body.error?.message ?? message;
    } catch {
      /* the proxy answered, not the app */
    }
    throw new ApiError(code as ApiError['code'], message);
  }
  if (!res.body) {
    throw new ApiError('INTERNAL', 'the snapshot response had no body');
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();

  // Annotated rather than inferred: TypeScript narrows a `let` assigned only inside a
  // closure to `never` at the point it is read, and the resulting error is confusing.
  let meta: BootstrapMeta | null = null;
  const setMeta = (m: BootstrapMeta) => {
    meta = m;
  };
  let buffer = '';
  let received = 0;
  let batch: BootstrapEntity[] = [];
  let sawEnd = false;
  let endError: string | undefined;

  const flush = async () => {
    if (batch.length === 0) return;
    await handlers.onBatch(batch);
    batch = [];
  };

  const handleLine = async (line: string) => {
    if (!line) return;
    let parsed: BootstrapLine;
    try {
      parsed = JSON.parse(line) as BootstrapLine;
    } catch {
      throw new ApiError('INTERNAL', 'the snapshot contained a malformed line');
    }

    switch (parsed.kind) {
      case 'meta':
        setMeta(parsed);
        await handlers.onMeta(parsed);
        break;
      case 'entity':
        batch.push(parsed);
        received++;
        if (batch.length >= BATCH_SIZE) {
          await flush();
          handlers.onProgress?.(received);
        }
        break;
      case 'end':
        sawEnd = true;
        endError = parsed.error;
        break;
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    // The last fragment is almost never a whole line; hold it until more arrives.
    let newline = buffer.indexOf('\n');
    while (newline !== -1) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      await handleLine(line);
      newline = buffer.indexOf('\n');
    }
  }

  if (buffer.trim()) await handleLine(buffer.trim());
  await flush();
  handlers.onProgress?.(received);

  // The response status went out as 200 before the first row, so a mid-stream failure
  // cannot be signalled with a status code. The terminator is the only way to tell a
  // complete snapshot from a truncated one — and committing a truncated snapshot would
  // leave the client silently missing data with no way to notice.
  if (!sawEnd) {
    throw new ApiError('NETWORK', 'the snapshot ended early — no terminator was received');
  }
  if (endError) {
    throw new ApiError('INTERNAL', 'the server could not finish the snapshot');
  }
  if (!meta) {
    throw new ApiError('INTERNAL', 'the snapshot did not start with its version');
  }

  const settled: BootstrapMeta = meta;
  return { version: settled.version, clientSchema: settled.clientSchema, count: received };
}
