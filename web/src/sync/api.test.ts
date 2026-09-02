/**
 * What the API client makes of an answer it did not expect.
 *
 * Three of the failures pinned here are the same shape: something true arrived, and the
 * client threw it away. A 401 whose body happened to be well-formed JSON was read as an
 * internal error, so the session was never cleared and the user sat signed-out but not
 * signed out. A 200 carrying most of a result plus one field error was discarded whole —
 * and on a mutation that meant reverting an optimistic patch for a write the server had
 * already performed. And a request that simply never came back never came back.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError, gql, gqlDetailed, onAuthLost, retryAfterMs } from './api';

/** A response, in the shape `request()` actually reads. */
function answer(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): {
  ok: boolean;
  status: number;
  statusText: string;
  headers: Headers;
  json: () => Promise<unknown>;
} {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: `status ${status}`,
    headers: new Headers(headers),
    json: () =>
      body === undefined ? Promise.reject(new Error('not json')) : Promise.resolve(body),
  };
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('retryAfterMs', () => {
  it('reads the delta-seconds form', () => {
    expect(retryAfterMs('30')).toBe(30_000);
    expect(retryAfterMs('0')).toBe(0);
  });

  it('reads the HTTP-date form', () => {
    const at = new Date(Date.now() + 5_000).toUTCString();
    expect(retryAfterMs(at)).toBeGreaterThan(3_000);
  });

  it('gives up rather than guessing', () => {
    // A NaN here would become `setTimeout(fn, NaN)`, which fires immediately — the client
    // answering a rate limit by asking again at once.
    expect(retryAfterMs(null)).toBeUndefined();
    expect(retryAfterMs('soon')).toBeUndefined();
    expect(retryAfterMs('-4')).toBeUndefined();
  });
});

describe('classifying a failure', () => {
  it('reads the status even when the body is well-formed JSON with no error key', async () => {
    const lost = vi.fn();
    const unsubscribe = onAuthLost(lost);
    // Both calls: the 401 costs a refresh attempt, which is answered the same way.
    fetchMock.mockResolvedValue(answer(401, { message: 'nope' }));

    const err = await gql('query Q { me { id } }').catch((e: unknown) => e);
    unsubscribe();

    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe('UNAUTHENTICATED');
    expect((err as ApiError).isAuthFailure).toBe(true);
    // The point of getting the code right: this is what signs the user out rather than
    // leaving them in an app where nothing works and nothing says why.
    expect(lost).toHaveBeenCalled();
  });

  it('lets the application refine the status, and never lets it erase one', async () => {
    fetchMock.mockResolvedValue(answer(403, { error: { code: 'PLAN_LIMIT', message: 'upgrade' } }));

    const err = (await gql('query Q { me { id } }').catch((e: unknown) => e)) as ApiError;

    expect(err.code).toBe('PLAN_LIMIT');
    expect(err.message).toBe('upgrade');
  });

  it('carries Retry-After off a rate limit', async () => {
    fetchMock.mockResolvedValue(
      answer(429, { error: { code: 'RATELIMITED' } }, { 'Retry-After': '12' }),
    );

    const err = (await gql('query Q { me { id } }').catch((e: unknown) => e)) as ApiError;

    expect(err.code).toBe('RATELIMITED');
    expect(err.retryAfterMs).toBe(12_000);
  });
});

describe('a partially successful GraphQL response', () => {
  const QUERY = 'query Issue { issue { id title } }';

  it('keeps the data when only a field failed', async () => {
    fetchMock.mockResolvedValue(
      answer(200, {
        data: { issue: { id: 'i1', title: 'Ship it' } },
        errors: [{ message: 'could not resolve the assignee', path: ['issue', 'assignee'] }],
      }),
    );

    const result = await gqlDetailed<{ issue: { id: string } }>(QUERY);

    expect(result.data.issue.id).toBe('i1');
    // Exposed rather than swallowed: a caller that renders the field can say so.
    expect(result.errors).toHaveLength(1);
  });

  it('does not revert a mutation the server performed', async () => {
    fetchMock.mockResolvedValue(
      answer(200, {
        data: { updateIssue: { issue: { id: 'i1' } } },
        errors: [{ message: 'the activity feed timed out', path: ['updateIssue', 'activity'] }],
      }),
    );

    // Throwing here is what made the user watch their own change undo itself: the engine's
    // catch treats a rejection as a refusal and rolls the optimistic patch back.
    await expect(gql(QUERY)).resolves.toEqual({ updateIssue: { issue: { id: 'i1' } } });
  });

  it('throws when an error names no field, because the operation did not happen', async () => {
    fetchMock.mockResolvedValue(
      answer(200, {
        data: null,
        errors: [{ message: 'not your team', extensions: { code: 'FORBIDDEN' } }],
      }),
    );

    const err = (await gql(QUERY).catch((e: unknown) => e)) as ApiError;

    expect(err.code).toBe('FORBIDDEN');
  });

  it('throws a top-level error even when some data came with it', async () => {
    fetchMock.mockResolvedValue(
      answer(200, {
        data: { issue: null },
        errors: [{ message: 'you are not signed in', extensions: { code: 'UNAUTHENTICATED' } }],
      }),
    );

    const err = (await gql(QUERY).catch((e: unknown) => e)) as ApiError;

    expect(err.code).toBe('UNAUTHENTICATED');
    expect(err.partial).toHaveLength(1);
  });

  it('throws when there is no data at all', async () => {
    fetchMock.mockResolvedValue(answer(200, {}));

    await expect(gql(QUERY)).rejects.toThrow(/no data/);
  });
});

describe('a request that never comes back', () => {
  it('gives up and reports it as a network failure, so the op stays queued', async () => {
    vi.useFakeTimers();
    // A captive portal or a dead load balancer: the connection is accepted and nothing is
    // ever written back. Without a timeout the promise stays pending for the life of the
    // tab, and the mutation behind it is neither retried nor rolled back.
    fetchMock.mockImplementation(
      (_url: string, init: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );

    const pending = gql('query Q { me { id } }').catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(30_000);
    const err = (await pending) as ApiError;

    expect(err).toBeInstanceOf(ApiError);
    // NETWORK, not a refusal: nothing was learned about the mutation, so it must stay in
    // the outbox rather than be rolled back off the user's screen.
    expect(err.code).toBe('NETWORK');
    expect(err.isOffline).toBe(true);
  });
});
