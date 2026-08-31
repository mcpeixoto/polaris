import { beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '~/sync/api';

import { fetchAuthProviders } from './providers';

vi.mock('~/sync/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/sync/api')>();
  return { ...actual, auth: { ...actual.auth, providers: vi.fn() } };
});

const providers = vi.mocked(auth.providers);

const answer = {
  providers: ['google' as const],
  googleClientId: 'google-client',
  appleClientId: '',
  openSignup: true,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('fetchAuthProviders', () => {
  /**
   * Strict mode double-invokes effects, and the sign-in and sign-up screens both ask. Two
   * identical requests on the one screen whose job is to be fast and quiet is worth removing,
   * and `boot-console.spec.ts` counts them.
   */
  it('asks once when two callers ask together', async () => {
    providers.mockResolvedValue(answer);

    const [first, second] = await Promise.all([fetchAuthProviders(), fetchAuthProviders()]);

    expect(providers).toHaveBeenCalledTimes(1);
    expect(first).toEqual(answer);
    expect(second).toEqual(answer);
  });

  /**
   * And the sharing ends when the request does. Holding the resolved value would mean a
   * deployment that gains a provider keeps saying it has none for as long as the tab is open.
   */
  it('asks again after the first answer has arrived', async () => {
    providers.mockResolvedValue(answer);

    await fetchAuthProviders();
    await fetchAuthProviders();

    expect(providers).toHaveBeenCalledTimes(2);
  });

  /** A failure must not poison the retry. */
  it('lets a later caller retry after a failure', async () => {
    providers.mockRejectedValueOnce(new Error('offline'));
    await expect(fetchAuthProviders()).rejects.toThrow('offline');

    providers.mockResolvedValue(answer);
    await expect(fetchAuthProviders()).resolves.toEqual(answer);
    expect(providers).toHaveBeenCalledTimes(2);
  });
});
