import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '~/sync/api';

import { SocialSignIn } from './SocialSignIn';
import { signInWithApple, mountGoogleButton } from './social';

vi.mock('~/sync/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/sync/api')>();
  return {
    ...actual,
    auth: { ...actual.auth, providers: vi.fn(), signInWithOIDC: vi.fn() },
  };
});

// The SDK boundary. Loading Google's and Apple's scripts is what `social.ts` is for; this
// file is about what the screen does with the assertions they produce.
vi.mock('./social', () => ({
  mountGoogleButton: vi.fn(),
  signInWithApple: vi.fn(),
}));

const providers = vi.mocked(auth.providers);
const exchange = vi.mocked(auth.signInWithOIDC);
const apple = vi.mocked(signInWithApple);
const google = vi.mocked(mountGoogleButton);

beforeEach(() => {
  vi.clearAllMocks();
});

function offering(names: ('google' | 'apple')[]) {
  providers.mockResolvedValue({
    providers: names,
    googleClientId: names.includes('google') ? 'google-client' : '',
    appleClientId: names.includes('apple') ? 'apple-services-id' : '',
    openSignup: true,
  });
}

describe('SocialSignIn', () => {
  /**
   * A deployment with nothing configured must render nothing at all — not a divider, not an
   * "or", not a disabled button. Anything else is a promise the server cannot keep.
   */
  it('renders nothing when the server offers no providers', async () => {
    offering([]);
    const { container } = render(<SocialSignIn onSignedIn={() => {}} />);
    await waitFor(() => expect(providers).toHaveBeenCalled());
    expect(container.textContent).toBe('');
  });

  it('signs in with Apple and reports it upward', async () => {
    offering(['apple']);
    apple.mockResolvedValue({ idToken: 'apple-token', nonce: 'n-1', displayName: 'Ada Lovelace' });
    exchange.mockResolvedValue({
      accessToken: 'a',
      expiresIn: 900,
      accountId: 'acct',
      workspaces: [],
    });
    const onSignedIn = vi.fn();

    render(<SocialSignIn onSignedIn={onSignedIn} />);
    await userEvent.click(await screen.findByRole('button', { name: /continue with apple/i }));

    await waitFor(() => expect(onSignedIn).toHaveBeenCalled());
    expect(apple).toHaveBeenCalledWith('apple-services-id');
    // The nonce goes back with the token, or the server cannot tell a fresh assertion from
    // a replayed one. The display name too: Apple sends it exactly once, ever.
    expect(exchange).toHaveBeenCalledWith('apple', {
      idToken: 'apple-token',
      nonce: 'n-1',
      displayName: 'Ada Lovelace',
    });
  });

  it('mounts Google button with the id the server advertised', async () => {
    offering(['google']);
    render(<SocialSignIn onSignedIn={() => {}} />);
    await waitFor(() => expect(google).toHaveBeenCalled());
    expect(google.mock.calls[0]?.[1]).toBe('google-client');
  });

  it('shows why a refused sign-in was refused', async () => {
    offering(['apple']);
    apple.mockResolvedValue({ idToken: 'apple-token', nonce: 'n-1' });
    const { ApiError } = await vi.importActual<typeof import('~/sync/api')>('~/sync/api');
    exchange.mockRejectedValue(new ApiError('FORBIDDEN', 'this server is invite-only'));

    render(<SocialSignIn onSignedIn={() => {}} />);
    await userEvent.click(await screen.findByRole('button', { name: /continue with apple/i }));

    expect((await screen.findByRole('alert')).textContent).toMatch(/invite-only/i);
  });

  /**
   * Closing Apple's popup is somebody changing their mind, and Apple reports it as an
   * error. Shouting about it would make an ordinary gesture look like a fault.
   */
  it('stays quiet when the popup is closed', async () => {
    offering(['apple']);
    apple.mockRejectedValue(new Error('popup_closed_by_user'));

    render(<SocialSignIn onSignedIn={() => {}} />);
    await userEvent.click(await screen.findByRole('button', { name: /continue with apple/i }));

    await waitFor(() => expect(apple).toHaveBeenCalled());
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('says nothing when the server cannot be asked', async () => {
    providers.mockRejectedValue(new Error('offline'));
    const { container } = render(<SocialSignIn onSignedIn={() => {}} />);
    await waitFor(() => expect(providers).toHaveBeenCalled());
    expect(container.textContent).toBe('');
  });
});
