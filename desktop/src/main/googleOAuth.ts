/**
 * Sign in with Google for the Electron shell.
 *
 * The renderer cannot host Google Identity Services: the packaged app runs under
 * `polaris-app://`, which is not an origin Google will initialise, and the shell's CSP
 * deliberately refuses third-party scripts so a hostile server cannot get code into the
 * window. iOS already solved the same problem with an authorization-code + PKCE flow in the
 * system browser; this is that flow for the desktop shell.
 *
 * A loopback redirect on 127.0.0.1 rather than a custom URL scheme, because Google's desktop
 * guidance is loopback, and because claiming the iOS client's reversed-id scheme would fight
 * the iOS app for it on a Mac that has both. The port is fixed so a Web application OAuth
 * client can list one Authorized redirect URI; see docs/05-infrastructure/11-self-hosting.md.
 *
 * What reaches Polaris at the end is the same ID token the browser GIS button sends, on
 * `POST /auth/oidc/google`. The authorization-code exchange happens here, against Google,
 * and never against Polaris — matching the product rule that Polaris holds no client secret.
 */

import { createServer, type Server } from 'node:http';
import { shell } from 'electron';

import {
  buildAttempt,
  formEncode,
  GOOGLE_OAUTH_LOOPBACK_PORT,
  GOOGLE_OAUTH_REDIRECT_URI,
  idTokenFromTokenResponse,
  readCallback,
  TOKEN_ENDPOINT,
} from './googleOAuthCore.js';

export {
  GOOGLE_OAUTH_LOOPBACK_PORT,
  GOOGLE_OAUTH_REDIRECT_URI,
} from './googleOAuthCore.js';

/** How long we wait for the browser to come back before calling the attempt abandoned. */
const CALLBACK_TIMEOUT_MS = 5 * 60 * 1000;

export type GoogleSignInResult =
  | { readonly ok: true; readonly idToken: string; readonly nonce: string }
  | { readonly ok: false; readonly reason: string; readonly cancelled?: boolean };

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
 * Serves one OAuth redirect and then shuts down.
 *
 * Bound to 127.0.0.1 only: the authorization code is a bearer credential for a few seconds,
 * and listening on every interface would let anything on the LAN race us for it.
 */
function waitForLoopbackCallback(expectedPath: string): {
  server: Server;
  callback: Promise<URL>;
} {
  let settle: ((url: URL) => void) | undefined;
  let fail: ((error: Error) => void) | undefined;
  const callback = new Promise<URL>((resolve, reject) => {
    settle = resolve;
    fail = reject;
  });

  const server = createServer((req, res) => {
    const host = req.headers.host ?? `127.0.0.1:${String(GOOGLE_OAUTH_LOOPBACK_PORT)}`;
    let url: URL;
    try {
      url = new URL(req.url ?? '/', `http://${host}`);
    } catch {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Bad request');
      return;
    }

    if (url.pathname !== expectedPath) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(
      '<!doctype html><meta charset="utf-8"><title>Polaris</title>' +
        '<p style="font:16px/1.4 system-ui;margin:3rem;text-align:center">' +
        'You can close this tab and return to Polaris.' +
        '</p>',
    );
    settle?.(url);
  });

  server.on('error', (error) => {
    fail?.(error instanceof Error ? error : new Error(String(error)));
  });

  return { server, callback };
}

function listen(server: Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, '127.0.0.1');
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

/**
 * Opens the system browser, catches the loopback redirect, exchanges the code, returns the
 * ID token. One attempt at a time — a second call while the first is open would race two
 * browsers for one port, so the IPC handler refuses overlapping calls.
 */
export async function signInWithGoogle(clientId: string): Promise<GoogleSignInResult> {
  if (clientId.trim() === '') {
    return { ok: false, reason: 'Google sign-in is not configured on this server.' };
  }

  const redirectUri = GOOGLE_OAUTH_REDIRECT_URI;
  const redirectPath = new URL(redirectUri).pathname;
  const attempt = buildAttempt(clientId, redirectUri);
  const { server, callback } = waitForLoopbackCallback(redirectPath);

  try {
    await listen(server, GOOGLE_OAUTH_LOOPBACK_PORT);
  } catch (error) {
    await closeServer(server);
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code?: unknown }).code)
        : '';
    if (code === 'EADDRINUSE') {
      return {
        ok: false,
        reason: `Port ${String(GOOGLE_OAUTH_LOOPBACK_PORT)} is already in use, so Google sign-in cannot listen for the browser to return. Free that port and try again.`,
      };
    }
    return { ok: false, reason: 'Google sign-in could not start.' };
  }

  try {
    // shell.openExternal rather than the renderer's window.open: we are already in main, and
    // this URL is one we built for accounts.google.com.
    await shell.openExternal(attempt.url);

    const timedOut = new Promise<never>((_, reject) => {
      setTimeout(
        () => reject(new Error('timed out waiting for Google sign-in')),
        CALLBACK_TIMEOUT_MS,
      );
    });

    const callbackUrl = await Promise.race([callback, timedOut]);
    const parsed = readCallback(callbackUrl, attempt.state);
    if ('cancelled' in parsed) {
      return { ok: false, reason: 'Sign-in was cancelled.', cancelled: true };
    }
    if ('error' in parsed) {
      return { ok: false, reason: parsed.error };
    }

    const idToken = await exchangeCode(
      parsed.code,
      attempt.codeVerifier,
      clientId,
      redirectUri,
    );
    return { ok: true, idToken, nonce: attempt.nonce };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Google sign-in failed.';
    if (message.includes('timed out')) {
      return {
        ok: false,
        reason: 'Google sign-in timed out. Complete it in the browser window, then try again.',
      };
    }
    return { ok: false, reason: 'Google sign-in failed.' };
  } finally {
    await closeServer(server);
  }
}
