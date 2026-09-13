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

const desktopState = vi.hoisted(() => ({
  isDesktop: false,
  signInWithGoogleDesktop: vi.fn(),
}));

vi.mock('~/platform/runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/platform/runtime')>();
  return {
    ...actual,
    get isDesktop() {
      return desktopState.isDesktop;
    },
    signInWithGoogleDesktop: desktopState.signInWithGoogleDesktop,
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
  desktopState.isDesktop = false;
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
    const { container, unmount } = render(<SocialSignIn onSignedIn={() => {}} />);
    await waitFor(() => expect(providers).toHaveBeenCalled());
    expect(container.textContent).toBe('');
    // Pending backoff retries would otherwise keep calling after the assertion; the
    // interesting claim is that a failure draws nothing, not that it never asks again.
    unmount();
  });

  /**
   * The sleep-wake shape: the session is gone, the sign-in screen mounts, and the first
   * `/auth/providers` ask fails because the network is not back yet. Without a retry the
   * password form sat alone until a full reload — Google and Apple had been offered, just
   * not heard. Coming online must ask again and draw the buttons.
   */
  it('draws the providers once the network returns after a failed ask', async () => {
    providers.mockRejectedValueOnce(new Error('offline'));
    render(<SocialSignIn onSignedIn={() => {}} />);
    await waitFor(() => expect(providers).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('button', { name: /continue with apple/i })).toBeNull();

    offering(['apple']);
    window.dispatchEvent(new Event('online'));

    expect(await screen.findByRole('button', { name: /continue with apple/i })).toBeTruthy();
    expect(providers).toHaveBeenCalledTimes(2);
  });

  /**
   * Laptop lid: the browser never flips `navigator.onLine`, the API was simply unreachable
   * for a moment, and the tab becomes visible again with an empty provider list. Same
   * recovery as `online`, keyed off visibility so a wake without a network event still
   * gets its buttons.
   */
  it('asks again when the tab becomes visible after a failed ask', async () => {
    providers.mockRejectedValueOnce(new Error('offline'));
    render(<SocialSignIn onSignedIn={() => {}} />);
    await waitFor(() => expect(providers).toHaveBeenCalledTimes(1));

    offering(['google', 'apple']);
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });
    document.dispatchEvent(new Event('visibilitychange'));

    expect(await screen.findByRole('button', { name: /continue with apple/i })).toBeTruthy();
    expect(providers).toHaveBeenCalledTimes(2);
  });

  it('retries on its own after a transient failure', async () => {
    offering(['apple']);
    providers.mockRejectedValueOnce(new Error('offline'));

    render(<SocialSignIn onSignedIn={() => {}} />);
    // First ask fails; the 500ms backoff asks again and the buttons appear without a
    // reload or a network event — the sleep-wake case where `navigator.onLine` never flipped.
    expect(await screen.findByRole('button', { name: /continue with apple/i })).toBeTruthy();
    expect(providers).toHaveBeenCalledTimes(2);
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

describe('SocialSignIn on desktop', () => {
  beforeEach(() => {
    desktopState.isDesktop = true;
  });

  it('opens Google through the shell instead of mounting GIS', async () => {
    offering(['google']);
    desktopState.signInWithGoogleDesktop.mockResolvedValue({
      ok: true,
      idToken: 'g-token',
      nonce: 'n-g',
    });
    exchange.mockResolvedValue({
      accessToken: 'a',
      expiresIn: 900,
      accountId: 'acct',
      workspaces: [],
    });
    const onSignedIn = vi.fn();

    render(<SocialSignIn onSignedIn={onSignedIn} />);
    await userEvent.click(await screen.findByRole('button', { name: /continue with google/i }));

    await waitFor(() => expect(onSignedIn).toHaveBeenCalled());
    expect(google).not.toHaveBeenCalled();
    expect(desktopState.signInWithGoogleDesktop).toHaveBeenCalledWith('google-client');
    expect(exchange).toHaveBeenCalledWith('google', { idToken: 'g-token', nonce: 'n-g' });
  });

  it('stays quiet when the browser sign-in is cancelled', async () => {
    offering(['google']);
    desktopState.signInWithGoogleDesktop.mockResolvedValue({
      ok: false,
      reason: 'Sign-in was cancelled.',
      cancelled: true,
    });

    render(<SocialSignIn onSignedIn={() => {}} />);
    await userEvent.click(await screen.findByRole('button', { name: /continue with google/i }));

    await waitFor(() => expect(desktopState.signInWithGoogleDesktop).toHaveBeenCalled());
    expect(screen.queryByRole('alert')).toBeNull();
    expect(exchange).not.toHaveBeenCalled();
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
