/**
 * Pure half of the desktop Google sign-in flow.
 *
 * Kept free of Electron and Node HTTP so it can be exercised with `node --test` without
 * booting a BrowserWindow. The loopback listener and `shell.openExternal` live in
 * `googleOAuth.ts`, which is the only file that needs either.
 *
 * Mirrors `ios/PolarisCore/.../GoogleSignIn.swift`: same endpoints, same PKCE shape, same
 * claim that Polaris never sees an authorization code — only the ID token at the end.
 */

import { createHash, randomBytes } from 'node:crypto';

export const AUTHORIZATION_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
export const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
export const SCOPE = 'openid email profile';

/**
 * Fixed so the Google Cloud "Web application" client can name exactly one redirect URI.
 * Dynamic ports would each need their own console entry, which nobody configures.
 */
export const GOOGLE_OAUTH_LOOPBACK_PORT = 42773;

export const GOOGLE_OAUTH_REDIRECT_URI = `http://127.0.0.1:${String(GOOGLE_OAUTH_LOOPBACK_PORT)}/oauth2redirect`;

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
  clientId: string,
  redirectUri: string = GOOGLE_OAUTH_REDIRECT_URI,
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

export function readCallback(callbackUrl: URL, expectedState: string): CallbackRead {
  if (callbackUrl.searchParams.get('state') !== expectedState) {
    return { error: 'that sign-in could not be verified' };
  }
  const error = callbackUrl.searchParams.get('error');
  if (error !== null) {
    if (error === 'access_denied') return { cancelled: true };
    return { error: 'that sign-in could not be completed' };
  }
  const code = callbackUrl.searchParams.get('code');
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
  // encodeURIComponent rather than a hand-rolled allowlist: the values that matter here
  // (code, verifier, client id) are URL-safe already, and the standard encoder is what
  // Google's token endpoint expects for application/x-www-form-urlencoded.
  return pairs
    .map(([name, value]) => `${encodeURIComponent(name)}=${encodeURIComponent(value)}`)
    .join('&');
}
