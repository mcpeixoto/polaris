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
 * How long the stream may deliver nothing before it is treated as dead.
 *
 * A snapshot is a 200 that has already been sent, so a connection that stops producing bytes
 * halfway through cannot be signalled with a status code and cannot be noticed by `fetch`:
 * the read promise simply never settles and the progress bar sits on "0 received" for as long
 * as the tab is open. The server writes a row at a time and never pauses for a minute, so a
 * minute of silence is a stall rather than a slow workspace.
 */
const STALL_MS = 60_000;

/**
 * A ceiling on the unterminated tail held in memory.
 *
 * Lines are short — one entity each. A buffer past this size means nothing on the wire is
 * newline-delimited NDJSON at all (an HTML error page from a proxy is the usual one), and
 * accumulating the entire response to discover that is how a bad gateway turns into an
 * out-of-memory crash.
 */
const MAX_LINE_BYTES = 8 * 1024 * 1024;

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

  let res: Response;
  try {
    res = await fetch(apiUrl(`/sync/bootstrap?workspace=${encodeURIComponent(workspaceId)}`), {
      headers: { ...authHeaders(), Accept: 'application/x-ndjson' },
      credentials: credentialsMode(),
      ...(signal ? { signal } : null),
    });
  } catch (err) {
    // Including an abort: the caller cancelled, or the request never connected. Either way
    // nothing was learned about the workspace, which is what NETWORK means here.
    throw new ApiError('NETWORK', err instanceof Error ? err.message : 'could not reach the API');
  }

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

  /**
   * One read, or a stall.
   *
   * `reader.read()` on a connection that died without a FIN never settles. Racing it against
   * a timer is the only thing that can notice, and cancelling the reader is what unblocks the
   * abandoned promise so the stream's resources are released rather than pinned for the life
   * of the tab.
   */
  const readOrStall = async (): Promise<ReadableStreamReadResult<Uint8Array>> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stalled = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () => reject(new ApiError('NETWORK', 'the snapshot stopped arriving')),
        STALL_MS,
      );
    });
    try {
      return await Promise.race([reader.read(), stalled]);
    } finally {
      clearTimeout(timer);
    }
  };

  try {
    for (;;) {
      const { done, value } = await readOrStall();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Scanned with an offset and sliced once per chunk rather than once per line. The old
      // `buffer = buffer.slice(newline + 1)` per line reallocated the remaining buffer tens
      // of thousands of times on a real snapshot, on the main thread, during the one moment
      // the user is watching a progress bar.
      let start = 0;
      let newline = buffer.indexOf('\n', start);
      while (newline !== -1) {
        await handleLine(buffer.slice(start, newline));
        start = newline + 1;
        newline = buffer.indexOf('\n', start);
      }
      buffer = start === 0 ? buffer : buffer.slice(start);

      if (buffer.length > MAX_LINE_BYTES) {
        throw new ApiError('INTERNAL', 'the snapshot contained a line that never ended');
      }
    }
  } catch (err) {
    // Releases the socket. Without it an abandoned stream keeps its connection — and the
    // whole buffered response behind it — until the tab is closed.
    await reader.cancel().catch(() => undefined);
    if (err instanceof ApiError) throw err;
    throw new ApiError('NETWORK', err instanceof Error ? err.message : 'the snapshot failed');
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
