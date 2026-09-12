/**
 * Pure half of the desktop Google sign-in flow.
 *
 * Kept free of Electron so it can be exercised with `node --test` without booting a
 * BrowserWindow. Opening the system browser and catching the redirect live in
 * `googleOAuth.ts`.
 *
 * Mirrors `ios/PolarisCore/.../GoogleSignIn.swift`: same endpoints, same PKCE shape, same
 * claim that Polaris never sees an authorization code — only the ID token at the end.
 *
 * Desktop reuses the **iOS** OAuth client (custom URL scheme), not the Web client. The Web
 * client is what GIS in the browser uses; it cannot accept a custom-scheme redirect, and
 * registering a loopback URI on it needs a Google Cloud Console edit every deployment.
 * The iOS client is already minted, already in `POLARIS_GOOGLE_CLIENT_IDS` on production
 * (iOS sign-in works), and already has its reverse-DNS redirect — so Windows can share it
 * without touching the Console.
 */

import { createHash, randomBytes } from 'node:crypto';

export const AUTHORIZATION_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
export const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
export const SCOPE = 'openid email profile';

/**
 * Same OAuth client the iOS app uses. Not a secret — it travels in every authorize URL —
 * but it must stay in lockstep with `ios/.../GoogleSignIn.swift` and with
 * `POLARIS_GOOGLE_CLIENT_IDS` on the server (the ID token's `aud` is this string).
 */
export const DESKTOP_GOOGLE_CLIENT_ID =
  '415057540542-s7an2kfcima1eqccpre0qq5o79et8s4f.apps.googleusercontent.com';

/** `a.b.c` → `c.b.a`. Google's "reversed client id" custom scheme. */
export function reversingComponents(value: string): string {
  return value.split('.').reverse().join('.');
}

/**
 * Custom scheme Google redirects through for this client: the client id with its
 * components reversed. Registered as a protocol handler in electron-builder and at runtime.
 */
export const DESKTOP_GOOGLE_REDIRECT_SCHEME = reversingComponents(DESKTOP_GOOGLE_CLIENT_ID);

/**
 * Google's documented redirect shape for an iOS / installed client: the reversed client id,
 * a single slash, and a path. A second slash would make `oauth2redirect` the *host*, which
 * the registered client does not match.
 */
export const DESKTOP_GOOGLE_REDIRECT_URI = `${DESKTOP_GOOGLE_REDIRECT_SCHEME}:/oauth2redirect`;

export interface GoogleAttempt {
  readonly url: string;
  readonly codeVerifier: string;
  readonly state: string;
  readonly nonce: string;
}

/** base64url without padding — RFC 7636's alphabet. */
export function base64URL(buffer: Buffer): string {
  return buffer.toString('base64').replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

/** PKCE S256 challenge: base64url of SHA-256 over the verifier's ASCII bytes. */
export function challengeFor(verifier: string): string {
  return base64URL(createHash('sha256').update(verifier, 'utf8').digest());
}

export function buildAttempt(
  clientId: string = DESKTOP_GOOGLE_CLIENT_ID,
  redirectUri: string = DESKTOP_GOOGLE_REDIRECT_URI,
  entropy: (bytes: number) => Buffer = (n) => randomBytes(n),
): GoogleAttempt {
  const codeVerifier = base64URL(entropy(32));
  const state = base64URL(entropy(16));
  const nonce = base64URL(entropy(16));

  const url = new URL(AUTHORIZATION_ENDPOINT);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', SCOPE);
  url.searchParams.set('code_challenge', challengeFor(codeVerifier));
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', state);
  url.searchParams.set('nonce', nonce);
  // Forces the account chooser when somebody is signed into several Google accounts in the
  // system browser — without it, Google silently reuses the last one and the wrong person
  // lands in Polaris.
  url.searchParams.set('prompt', 'select_account');

  return { url: url.href, codeVerifier, state, nonce };
}

export type CallbackRead =
  { readonly code: string } | { readonly cancelled: true } | { readonly error: string };

/**
 * Reads the authorization response out of a redirect URL.
 *
 * Accepts either a real `URL` or a raw string, because Windows hands custom-scheme
 * callbacks to Electron as `scheme:/path?query` — a form `new URL` accepts, but callers
 * often still have the argv string.
 */
export function readCallback(callbackUrl: URL | string, expectedState: string): CallbackRead {
  const url = typeof callbackUrl === 'string' ? new URL(callbackUrl) : callbackUrl;
  if (url.searchParams.get('state') !== expectedState) {
    return { error: 'that sign-in could not be verified' };
  }
  const error = url.searchParams.get('error');
  if (error !== null) {
    if (error === 'access_denied') return { cancelled: true };
    return { error: 'that sign-in could not be completed' };
  }
  const code = url.searchParams.get('code');
  if (code === null || code === '') {
    return { error: 'that sign-in could not be completed' };
  }
  return { code };
}

export function idTokenFromTokenResponse(body: unknown): string {
  if (typeof body !== 'object' || body === null) {
    throw new Error('Google did not return a sign-in.');
  }
  const record = body as { id_token?: unknown; error?: unknown };
  if (record.error !== undefined) {
    throw new Error('that sign-in could not be completed');
  }
  if (typeof record.id_token !== 'string' || record.id_token === '') {
    throw new Error('Google did not return a sign-in.');
  }
  return record.id_token;
}

export function formEncode(pairs: ReadonlyArray<readonly [string, string]>): string {
  return pairs
    .map(([name, value]) => `${encodeURIComponent(name)}=${encodeURIComponent(value)}`)
    .join('&');
}

/** True when `raw` is a Google OAuth redirect for this app's desktop client. */
export function isGoogleOAuthCallback(raw: string): boolean {
  return (
    raw.startsWith(`${DESKTOP_GOOGLE_REDIRECT_SCHEME}:`) ||
    raw.startsWith(`${DESKTOP_GOOGLE_REDIRECT_SCHEME}://`)
  );
}
