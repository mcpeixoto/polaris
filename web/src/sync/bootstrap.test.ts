/**
 * Reading the snapshot stream.
 *
 * The line splitter is the one piece of this client that runs tens of thousands of times
 * during the single moment a user is watching a progress bar, and the two ways it can go
 * wrong are both silent: a line reassembled incorrectly across a chunk boundary, and a
 * response that is not NDJSON at all accumulating in memory until the tab dies. The stall
 * is the third: a 200 has already been sent, so a connection that stops producing bytes
 * cannot be reported with a status code and `fetch` will never reject on it.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from './api';
import { streamBootstrap, type BootstrapEntity } from './bootstrap';

const fetchMock = vi.fn();

/** A response whose body yields exactly these chunks, then ends. */
function streaming(chunks: readonly string[]): unknown {
  const encoder = new TextEncoder();
  let i = 0;
  return {
    ok: true,
    status: 200,
    headers: new Headers(),
    body: {
      getReader: () => ({
        read: () =>
          Promise.resolve(
            i < chunks.length
              ? { done: false, value: encoder.encode(chunks[i++]!) }
              : { done: true, value: undefined },
          ),
        cancel: () => Promise.resolve(),
      }),
    },
  };
}

function line(entity: Record<string, unknown>): string {
  return `${JSON.stringify(entity)}\n`;
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('splitting the stream into lines', () => {
  it('reassembles a row that straddles a chunk boundary', async () => {
    const body =
      line({ kind: 'meta', version: 9, clientSchema: 3 }) +
      line({ kind: 'entity', type: 'issue', id: 'i1', payload: { id: 'i1', title: 'One' } }) +
      line({ kind: 'entity', type: 'issue', id: 'i2', payload: { id: 'i2', title: 'Two' } }) +
      line({ kind: 'end', count: 2 });
    // Cut into pieces that fall inside JSON objects and inside the newline runs alike.
    const chunks: string[] = [];
    for (let at = 0; at < body.length; at += 7) chunks.push(body.slice(at, at + 7));
    fetchMock.mockResolvedValue(streaming(chunks));

    const seen: BootstrapEntity[] = [];
    const result = await streamBootstrap('ws-1', {
      onMeta: () => undefined,
      onBatch: (entities) => {
        seen.push(...entities);
      },
    });

    expect(result).toEqual({ version: 9, clientSchema: 3, count: 2 });
    expect(seen.map((e) => e.id)).toEqual(['i1', 'i2']);
  });

  it('handles many lines arriving in one chunk', async () => {
    const rows = Array.from({ length: 1_200 }, (_v, n) =>
      line({ kind: 'entity', type: 'issue', id: `i${n}`, payload: { id: `i${n}` } }),
    ).join('');
    fetchMock.mockResolvedValue(
      streaming([
        line({ kind: 'meta', version: 1, clientSchema: 3 }) +
          rows +
          line({ kind: 'end', count: 1_200 }),
      ]),
    );

    let received = 0;
    const result = await streamBootstrap('ws-1', {
      onMeta: () => undefined,
      onBatch: (entities) => {
        received += entities.length;
      },
    });

    expect(result.count).toBe(1_200);
    expect(received).toBe(1_200);
  });

  it('refuses a response that is not newline-delimited at all', async () => {
    // An HTML error page from a proxy. Accumulating the whole thing to find that out is how
    // a bad gateway becomes an out-of-memory crash on a phone.
    fetchMock.mockResolvedValue(streaming(['<html>' + 'x'.repeat(9 * 1024 * 1024)]));

    await expect(
      streamBootstrap('ws-1', { onMeta: () => undefined, onBatch: () => undefined }),
    ).rejects.toThrow(/never ended/);
  });
});

describe('a stream that stops arriving', () => {
  it('gives up rather than sitting on the progress bar forever', async () => {
    vi.useFakeTimers();
    const cancel = vi.fn().mockResolvedValue(undefined);
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      body: { getReader: () => ({ read: () => new Promise(() => undefined), cancel }) },
    });

    const pending = streamBootstrap('ws-1', {
      onMeta: () => undefined,
      onBatch: () => undefined,
    }).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(60_000);
    const err = (await pending) as ApiError;

    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe('NETWORK');
    // The reader is cancelled, which is what releases the connection the abandoned read
    // would otherwise pin for the life of the tab.
    expect(cancel).toHaveBeenCalled();
  });
});

describe('a snapshot that ends early', () => {
  it('is refused rather than committed, terminator or nothing', async () => {
    fetchMock.mockResolvedValue(
      streaming([
        line({ kind: 'meta', version: 4, clientSchema: 3 }),
        line({ kind: 'entity', type: 'issue', id: 'i1', payload: { id: 'i1' } }),
      ]),
    );

    await expect(
      streamBootstrap('ws-1', { onMeta: () => undefined, onBatch: () => undefined }),
    ).rejects.toThrow(/ended early/);
  });
});
