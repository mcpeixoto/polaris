/**
 * The browser half of Sign in with Google and Sign in with Apple.
 *
 * Both providers are used in their ID-token form: the SDK returns a signed assertion and the
 * server verifies it against the issuer's published keys. Neither flow needs a client secret,
 * a redirect endpoint of ours, or any state kept between two requests — which is why there is
 * no callback route in this application and nothing to clean up when somebody abandons a
 * sign-in halfway.
 *
 * The SDKs are loaded on demand rather than in `index.html`. They are third-party scripts on
 * a page most people reach while signed out; loading them for every visitor — including the
 * ones going straight to a workspace they are already signed in to — would put two more
 * origins on the critical path of the whole application to serve one screen.
 */

/** A nonce the provider binds into the token, so a captured assertion cannot be replayed. */
export function newNonce(): string {
  // `randomUUID` is in every browser this product supports and does not need a polyfill;
  // `Math.random` is not a nonce, and a nonce that is guessable is decoration.
  return crypto.randomUUID();
}

const GOOGLE_SDK = 'https://accounts.google.com/gsi/client';
const APPLE_SDK =
  'https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js';

/** Scripts already requested, so two buttons on one page do not load the SDK twice. */
const loading = new Map<string, Promise<void>>();

export function loadScript(src: string): Promise<void> {
  const existing = loading.get(src);
  if (existing !== undefined) return existing;

  const started = new Promise<void>((resolve, reject) => {
    const el = document.createElement('script');
    el.src = src;
    el.async = true;
    el.onload = () => resolve();
    el.onerror = () => {
      // Dropped from the cache so a later attempt can retry: a network blip on the sign-in
      // page must not disable the button for the rest of the session.
      loading.delete(src);
      reject(new Error(`could not load ${src}`));
    };
    document.head.append(el);
  });
  loading.set(src, started);
  return started;
}

interface GoogleCredentialResponse {
  credential?: string;
}

interface GoogleIdentity {
  accounts: {
    id: {
      initialize(config: {
        client_id: string;
        callback: (response: GoogleCredentialResponse) => void;
        nonce?: string;
        auto_select?: boolean;
        cancel_on_tap_outside?: boolean;
      }): void;
      renderButton(parent: HTMLElement, options: Record<string, unknown>): void;
    };
  };
}

interface AppleAuth {
  auth: {
    init(config: {
      clientId: string;
      scope: string;
      redirectURI: string;
      usePopup: boolean;
      nonce?: string;
    }): void;
    signIn(): Promise<{
      authorization?: { id_token?: string };
      user?: { name?: { firstName?: string; lastName?: string } };
    }>;
  };
}

declare global {
  interface Window {
    google?: GoogleIdentity;
    AppleID?: AppleAuth;
  }
}

/** What a completed provider flow hands back, whichever provider it was. */
export interface Assertion {
  idToken: string;
  nonce: string;
  /**
   * Apple sends the person's name on the very first authorisation and never again. If the
   * client drops it there, it is gone for good — which is why it travels with the assertion
   * rather than being read from a later profile call that will always come back empty.
   */
  displayName?: string;
}

/**
 * Renders Google's own button into `parent` and resolves each time somebody completes a
 * sign-in with it.
 *
 * Google's button rather than one of ours because their terms require their button, and
 * because One Tap's prompt is unreliable to trigger from a click — `renderButton` is the
 * form that works the same way every time.
 */
export async function mountGoogleButton(
  parent: HTMLElement,
  clientId: string,
  onAssertion: (assertion: Assertion) => void,
  onError: (message: string) => void,
): Promise<void> {
  await loadScript(GOOGLE_SDK);
  const google = window.google;
  if (google === undefined) {
    onError('Google sign-in is unavailable right now.');
    return;
  }

  const nonce = newNonce();
  google.accounts.id.initialize({
    client_id: clientId,
    nonce,
    // No automatic sign-in. Somebody who has just signed out and landed here would be
    // signed straight back in by a prompt they did not ask for.
    auto_select: false,
    cancel_on_tap_outside: true,
    callback: (response) => {
      if (response.credential === undefined || response.credential === '') {
        onError('Google did not return a sign-in.');
        return;
      }
      onAssertion({ idToken: response.credential, nonce });
    },
  });
  google.accounts.id.renderButton(parent, {
    type: 'standard',
    theme: 'outline',
    size: 'large',
    text: 'continue_with',
    width: 320,
  });
}

/** The nonce the SDK was last initialised with, and therefore the one Apple will echo. */
let appleNonce: string | null = null;

/**
 * Loads and initialises Apple's SDK ahead of the click.
 *
 * This is not an optimisation. `AppleID.auth.signIn()` opens a popup, and a browser only
 * allows that while it can still see the user gesture that led to it — so awaiting a script
 * download inside the click handler is the difference between a sign-in window and
 * `{"error":"popup_blocked_by_browser"}` with nothing on screen to explain it. Preparing on
 * mount leaves the click synchronous into the SDK.
 *
 * `usePopup` keeps the exchange in one page: the redirect form would have Apple POST back to
 * a route of ours, which a static SPA does not have. The redirect URI still has to be
 * registered with Apple and still has to match — it is the origin they hand the token to.
 */
export async function prepareApple(clientId: string): Promise<void> {
  await loadScript(APPLE_SDK);
  const apple = window.AppleID;
  if (apple === undefined) {
    throw new Error('Apple sign-in is unavailable right now.');
  }

  const nonce = newNonce();
  apple.auth.init({
    clientId,
    scope: 'name email',
    redirectURI: `${window.location.origin}/signin`,
    usePopup: true,
    nonce,
  });
  appleNonce = nonce;
}

/**
 * Opens Apple's popup. Call straight from a click — nothing may be awaited first.
 *
 * Deliberately not `async`: an async function's first await already yields, and the point of
 * this one is that `signIn()` is reached in the same task as the gesture.
 */
export function signInWithApple(): Promise<Assertion> {
  const apple = window.AppleID;
  const nonce = appleNonce;
  if (apple === undefined || nonce === null) {
    return Promise.reject(new Error('Apple sign-in is not ready yet. Try again in a moment.'));
  }

  return apple.auth.signIn().then((result) => {
    const idToken = result.authorization?.id_token;
    if (idToken === undefined || idToken === '') {
      throw new Error('Apple did not return a sign-in.');
    }

    const first = result.user?.name?.firstName ?? '';
    const last = result.user?.name?.lastName ?? '';
    const displayName = `${first} ${last}`.trim();
    return { idToken, nonce, ...(displayName === '' ? null : { displayName }) };
  });
}

/**
 * What to show for a failed Apple sign-in, or null to stay quiet.
 *
 * Apple rejects with a plain object — `{"error":"popup_closed_by_user"}` — and not an Error.
 * Rendering that with `String()` produces "[object Object]" on the sign-in page, which is
 * what it did: a message that tells the reader nothing and looks like a broken product.
 */
export function appleFailureMessage(failure: unknown): string | null {
  const code =
    typeof failure === 'object' && failure !== null && 'error' in failure
      ? String((failure as { error?: unknown }).error)
      : '';

  switch (code) {
    // Somebody changed their mind. Not a fault, and not worth a red line.
    case 'popup_closed_by_user':
    case 'user_cancelled_authorize':
      return null;
    case 'popup_blocked_by_browser':
      return 'Your browser blocked the Apple sign-in window. Allow pop-ups for this site and try again.';
    case '':
      return failure instanceof Error ? failure.message : 'That sign-in did not work. Try again.';
    default:
      return 'Apple could not complete that sign-in. Try again.';
  }
}
