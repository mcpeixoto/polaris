/**
 * Sign in with Google for the Electron shell.
 *
 * The renderer cannot host Google Identity Services: the packaged app runs under
 * `polaris-app://`, which is not an origin Google will initialise, and the shell's CSP
 * deliberately refuses third-party scripts so a hostile server cannot get code into the
 * window. iOS already solved the same problem with an authorization-code + PKCE flow in the
 * system browser; this is that flow for the desktop shell.
 *
 * Desktop reuses the iOS OAuth client and its reverse-DNS redirect scheme, rather than the
 * Web client + loopback. The Web client is what the browser GIS button uses; adding a
 * loopback redirect to it needs a Google Cloud Console edit per deployment, and this
 * environment cannot sign into that Console. The iOS client is already configured on
 * production (`POLARIS_GOOGLE_CLIENT_IDS` includes it — iOS Google sign-in works), so
 * Windows inherits a working audience with no Console step.
 *
 * What reaches Polaris at the end is the same ID token the browser GIS button sends, on
 * `POST /auth/oidc/google`. The authorization-code exchange happens here, against Google,
 * and never against Polaris — matching the product rule that Polaris holds no client secret.
 */

import { shell } from 'electron';

import {
  buildAttempt,
  DESKTOP_GOOGLE_CLIENT_ID,
  DESKTOP_GOOGLE_REDIRECT_SCHEME,
  DESKTOP_GOOGLE_REDIRECT_URI,
  formEncode,
  idTokenFromTokenResponse,
  isGoogleOAuthCallback,
  readCallback,
  TOKEN_ENDPOINT,
} from './googleOAuthCore.js';

export {
  DESKTOP_GOOGLE_CLIENT_ID,
  DESKTOP_GOOGLE_REDIRECT_SCHEME,
  DESKTOP_GOOGLE_REDIRECT_URI,
  isGoogleOAuthCallback,
} from './googleOAuthCore.js';

/** How long we wait for the browser to come back before calling the attempt abandoned. */
const CALLBACK_TIMEOUT_MS = 5 * 60 * 1000;

export type GoogleSignInResult =
  | { readonly ok: true; readonly idToken: string; readonly nonce: string }
  | { readonly ok: false; readonly reason: string; readonly cancelled?: boolean };

interface PendingAttempt {
  readonly codeVerifier: string;
  readonly state: string;
  readonly nonce: string;
  readonly resolve: (url: string) => void;
  readonly reject: (error: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

let pending: PendingAttempt | null = null;

async function exchangeCode(
  code: string,
  codeVerifier: string,
  clientId: string,
  redirectUri: string,
): Promise<string> {
  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: formEncode([
      ['client_id', clientId],
      ['code', code],
      ['code_verifier', codeVerifier],
      ['grant_type', 'authorization_code'],
      ['redirect_uri', redirectUri],
    ]),
  });
  const body: unknown = await response.json().catch(() => null);
  return idTokenFromTokenResponse(body);
}

/**
 * Consumes a custom-scheme redirect if a Google sign-in is waiting for one.
 *
 * Called from the deep-link path (cold start argv, second-instance, macOS open-url). Returns
 * true when the URL was an OAuth callback — whether or not an attempt was pending — so the
 * caller does not also try to route it as an app path.
 */
export function deliverGoogleOAuthCallback(raw: string): boolean {
  if (!isGoogleOAuthCallback(raw)) return false;
  if (pending === null) {
    // A callback with nobody waiting is a leftover from a killed attempt or a pasted URL.
    // Drop it rather than navigating somewhere meaningless.
    return true;
  }
  const current = pending;
  pending = null;
  clearTimeout(current.timer);
  current.resolve(raw);
  return true;
}

/**
 * Opens the system browser and waits for the custom-scheme redirect, then exchanges the
 * code. One attempt at a time — a second call while the first is open would leave two
 * browsers racing one waiter.
 *
 * The `clientId` argument from the renderer is ignored on purpose: desktop always uses the
 * installed-app client above. The renderer still only offers the button when the server
 * lists Google as a provider (the Web client id being non-empty is that signal).
 */
export async function signInWithGoogle(_clientId?: string): Promise<GoogleSignInResult> {
  if (pending !== null) {
    return {
      ok: false,
      reason: 'A Google sign-in is already open in your browser. Finish or cancel it first.',
    };
  }

  const clientId = DESKTOP_GOOGLE_CLIENT_ID;
  const redirectUri = DESKTOP_GOOGLE_REDIRECT_URI;
  const attempt = buildAttempt(clientId, redirectUri);

  const holder: { current: PendingAttempt | null } = { current: null };
  const callback = new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (pending !== null) {
        pending = null;
        holder.current = null;
        reject(new Error('timed out waiting for Google sign-in'));
      }
    }, CALLBACK_TIMEOUT_MS);
    holder.current = {
      codeVerifier: attempt.codeVerifier,
      state: attempt.state,
      nonce: attempt.nonce,
      resolve,
      reject,
      timer,
    };
    pending = holder.current;
  });

  try {
    // shell.openExternal rather than the renderer's window.open: we are already in main, and
    // this URL is one we built for accounts.google.com.
    await shell.openExternal(attempt.url);
    const callbackUrl = await callback;
    const parsed = readCallback(callbackUrl, attempt.state);
    if ('cancelled' in parsed) {
      return { ok: false, reason: 'Sign-in was cancelled.', cancelled: true };
    }
    if ('error' in parsed) {
      return { ok: false, reason: parsed.error };
    }

    const idToken = await exchangeCode(parsed.code, attempt.codeVerifier, clientId, redirectUri);
    return { ok: true, idToken, nonce: attempt.nonce };
  } catch (error) {
    const leftover = holder.current;
    if (leftover !== null) {
      clearTimeout(leftover.timer);
      if (pending === leftover) pending = null;
      holder.current = null;
    }
    const message = error instanceof Error ? error.message : 'Google sign-in failed.';
    if (message.includes('timed out')) {
      return {
        ok: false,
        reason: 'Google sign-in timed out. Complete it in the browser window, then try again.',
      };
    }
    return { ok: false, reason: 'Google sign-in failed.' };
  }
}

/** Protocol scheme to claim with `app.setAsDefaultProtocolClient`. */
export function googleOAuthProtocolScheme(): string {
  return DESKTOP_GOOGLE_REDIRECT_SCHEME;
}
