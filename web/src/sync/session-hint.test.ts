import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { auth, isSignedIn, onAuthLost, sessionMayExist } from './api';

/**
 * The session hint is the flag `Boot` reads to decide whether asking `/auth/refresh` is worth
 * a round trip. Its failure mode is asymmetric and neither direction had a test.
 *
 * Losing the hint while the cookie is still valid is the expensive one: `Boot` reads its
 * absence as "this browser has never held a session", stops asking, and the user has to sign
 * in again even though the credential in their cookie jar would have worked. A refresh that
 * failed because the API was unreachable must therefore leave it alone — the question never
 * got an answer, so it proved nothing about the cookie.
 */
describe('the session hint across a failed refresh', () => {
  const HINT = 'polaris.session';
  let store: Map<string, string>;

  beforeEach(() => {
    // This environment's `localStorage` is a bare object with no methods, so every call
    // throws — and `api.ts` wraps all three in try/catch for Safari private mode, which means
    // an unstubbed run would swallow the throws and pass vacuously. The stub is what makes
    // these assertions mean anything.
    store = new Map();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    });
    // Stand in for a browser that has held a session before — the only state in which any of
    // this matters.
    store.set(HINT, '1');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('survives an unreachable API', async () => {
    // What `fetch` does when the network is off or the container is restarting behind the
    // proxy: it rejects rather than answering.
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
    );

    expect(await auth.refresh()).toBeNull();
    expect(sessionMayExist()).toBe(true);
  });

  it('survives a 5xx', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ error: { code: 'INTERNAL', message: 'internal error' } }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          }),
        ),
      ),
    );

    expect(await auth.refresh()).toBeNull();
    // A server that fell over says nothing about the credential in the cookie jar.
    expect(sessionMayExist()).toBe(true);
  });

  it('is forgotten when the server actually refuses the credential', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              error: { code: 'UNAUTHENTICATED', message: 'invalid refresh token' },
            }),
            { status: 401, headers: { 'Content-Type': 'application/json' } },
          ),
        ),
      ),
    );

    expect(await auth.refresh()).toBeNull();
    // The other direction still has to work, or the hint would outlive every dead cookie and
    // every boot would spend a pointless request.
    expect(sessionMayExist()).toBe(false);
  });

  /**
   * The hint surviving is not enough if Boot has already been told the session is gone.
   * `clearSession` always fires `onAuthLost`, and that callback is what flips a running
   * app onto the sign-in card. An unanswered refresh must not fire it — that is the
   * sleep-wake sign-out: access JWT dead, network still coming back, cookie still valid.
   */
  it('does not tell the app the session is gone when the API is unreachable', async () => {
    const lost = vi.fn();
    const unsubscribe = onAuthLost(lost);
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
    );

    expect(await auth.refresh()).toBeNull();
    expect(lost).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('does not tell the app the session is gone on a 5xx', async () => {
    const lost = vi.fn();
    const unsubscribe = onAuthLost(lost);
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ error: { code: 'INTERNAL', message: 'internal error' } }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          }),
        ),
      ),
    );

    expect(await auth.refresh()).toBeNull();
    expect(lost).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('does tell the app the session is gone when the credential is refused', async () => {
    const lost = vi.fn();
    const unsubscribe = onAuthLost(lost);
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              error: { code: 'UNAUTHENTICATED', message: 'invalid refresh token' },
            }),
            { status: 401, headers: { 'Content-Type': 'application/json' } },
          ),
        ),
      ),
    );

    expect(await auth.refresh()).toBeNull();
    expect(lost).toHaveBeenCalled();
    unsubscribe();
  });

  /**
   * Dropping the in-memory access token on an unanswered refresh is what stopped the
   * sync socket reconnecting after sleep (`ensureFreshToken` returned null and `open`
   * bailed without scheduling another attempt). The expired JWT can stay; the next
   * successful refresh replaces it.
   */
  it('keeps an in-memory session when refresh cannot be answered', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              accessToken: 'tok',
              expiresIn: 900,
              accountId: 'acct',
              workspaces: [],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        )
        .mockRejectedValueOnce(new TypeError('Failed to fetch')),
    );

    await auth.login('ada@example.com', 'password');
    expect(isSignedIn()).toBe(true);

    expect(await auth.refresh()).toBeNull();
    expect(isSignedIn()).toBe(true);
    expect(sessionMayExist()).toBe(true);
  });
});
