import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '~/sync/api';

import { SocialSignIn } from './SocialSignIn';
import { appleFailureMessage, mountGoogleButton, prepareApple, signInWithApple } from './social';

vi.mock('~/sync/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/sync/api')>();
  return {
    ...actual,
    auth: { ...actual.auth, providers: vi.fn(), signInWithOIDC: vi.fn() },
  };
});

// The SDK boundary. Loading Google's and Apple's scripts is what `social.ts` is for; this
// file is about what the screen does with the assertions they produce.
vi.mock('./social', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./social')>();
  return {
    // Resolved, not bare: the component chains a .catch onto this to report a script that
    // never loaded, and a mock returning undefined would fail on the chain rather than on
    // the behaviour under test.
    mountGoogleButton: vi.fn().mockResolvedValue(undefined),
    signInWithApple: vi.fn(),
    prepareApple: vi.fn().mockResolvedValue(undefined),
    // The real one: turning Apple's rejection into a sentence is the thing under test in
    // the cases below, not something to stub out.
    appleFailureMessage: actual.appleFailureMessage,
  };
});

const providers = vi.mocked(auth.providers);
const exchange = vi.mocked(auth.signInWithOIDC);
const apple = vi.mocked(signInWithApple);
const google = vi.mocked(mountGoogleButton);
const prepare = vi.mocked(prepareApple);

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
    // The SDK is prepared with the Services ID on mount, and the click carries nothing:
    // opening the popup has to happen in the same task as the gesture.
    expect(prepare).toHaveBeenCalledWith('apple-services-id');
    expect(apple).toHaveBeenCalledWith();
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
    // Apple's real rejection shape: a plain object, not an Error. Rendering it with
    // String() produced "[object Object]" on the live sign-in page.
    apple.mockRejectedValue({ error: 'popup_closed_by_user' });

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

  /**
   * The failure the preloading exists to prevent, and the one a reader can act on: a blocked
   * popup has to say so rather than render Apple's rejection object as "[object Object]".
   */
  it('explains a blocked popup instead of printing an object', async () => {
    offering(['apple']);
    apple.mockRejectedValue({ error: 'popup_blocked_by_browser' });

    render(<SocialSignIn onSignedIn={() => {}} />);
    await userEvent.click(await screen.findByRole('button', { name: /continue with apple/i }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/blocked/i);
    expect(alert.textContent).not.toContain('[object Object]');
  });
});

describe('appleFailureMessage', () => {
  it('is silent for the cases that are somebody changing their mind', () => {
    expect(appleFailureMessage({ error: 'popup_closed_by_user' })).toBeNull();
    expect(appleFailureMessage({ error: 'user_cancelled_authorize' })).toBeNull();
  });

  it('never renders an object', () => {
    for (const failure of [
      { error: 'popup_blocked_by_browser' },
      { error: 'invalid_client' },
      {},
      new Error('the SDK never loaded'),
      'a bare string',
    ]) {
      const message = appleFailureMessage(failure);
      if (message !== null) expect(message).not.toContain('[object Object]');
    }
  });
});
