/**
 * Where the server is.
 *
 * On the web this is a non-question: the app is served by the same origin as its API, so
 * `/graphql` is a relative path and nothing here does any work. The whole module exists for
 * the desktop build, where it turns out to be the difference between an app that runs and
 * one that opens and can never reach anything.
 *
 * A packaged Electron app loads its renderer from `file://`. Under that origin a relative
 * fetch to `/graphql` resolves to a file on disk, `location.host` is the empty string, and
 * a WebSocket URL built from it is malformed. Every request fails, and it fails only in the
 * packaged build — in development the renderer is a dev server on http://localhost, where
 * all of it works. That is the worst shape a bug can have: invisible until you ship.
 *
 * So the desktop shell holds a server URL, the user sets it once, and every path in the
 * client goes through here. The web build passes an empty base and behaves exactly as it
 * did before.
 *
 * Deliberately NOT an environment variable baked in at build time. Polaris is self-hosted:
 * the same binary has to point at whichever server the person running it has, and a URL
 * compiled into the bundle would mean a build per customer.
 */

import { desktopServerUrl, isDesktop } from '~/platform/runtime';

/** Thrown when a desktop client is asked for a URL before anybody has said where the server is. */
export class NoServerConfigured extends Error {
  constructor() {
    super('no Polaris server has been configured for this desktop app');
    this.name = 'NoServerConfigured';
  }
}

/**
 * The origin every request is made against. Empty on the web, which makes every path below
 * relative and identical to what a browser would have done anyway.
 */
export function apiOrigin(): string {
  if (!isDesktop) return '';
  return desktopServerUrl() ?? '';
}

/** Whether this client knows where to talk to. Always true on the web. */
export function hasServer(): boolean {
  return !isDesktop || (desktopServerUrl() ?? '') !== '';
}

/**
 * An absolute URL for an API path.
 *
 * `path` always starts with a slash and is never a full URL: callers name endpoints, not
 * hosts. Keeping that rule means a bug can only ever produce a wrong path on the configured
 * server, never a request to somebody else's.
 */
export function apiUrl(path: string): string {
  const origin = apiOrigin();
  if (origin === '') return path;
  if (!hasServer()) throw new NoServerConfigured();
  return origin.replace(/\/+$/, '') + path;
}

/**
 * The WebSocket URL for the sync stream.
 *
 * http maps to ws and https to wss. Deriving the scheme rather than storing it separately
 * is what stops a configuration where the API is TLS and the socket is not — which browsers
 * refuse anyway, but only after the user has spent an afternoon wondering why sync is the
 * one thing that does not work.
 */
export function socketUrl(path: string): string {
  const origin = apiOrigin();
  if (origin === '') {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${location.host}${path}`;
  }
  if (!hasServer()) throw new NoServerConfigured();
  const url = new URL(origin);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = path;
  url.search = '';
  return url.toString();
}

/**
 * What `fetch` should do with cookies.
 *
 * `same-origin` on the web, which is the safe default and the one that was there before.
 * The desktop app is by definition cross-origin to its server, so it has to send
 * credentials explicitly — and that is only safe because the origin is one the user typed
 * in themselves rather than one a page could influence.
 */
export function credentialsMode(): RequestCredentials {
  return apiOrigin() === '' ? 'same-origin' : 'include';
}

/**
 * Whether this client is talking to a loopback Host, and so may ask the API to
 * mint a local-dev session instead of showing the sign-in form.
 *
 * The API is the authority — a 404 here is a no-op and the form appears. This
 * only skips the extra round trip when the page (or the desktop server URL) is
 * not localhost / 127.0.0.1 / [::1]. A production install on a real domain
 * never sends the request.
 */
export function shouldAttemptDevSession(): boolean {
  return isLoopbackHostname(clientHostname()) && !isAnonymousAuthPath(currentPathname());
}

/**
 * Surfaces that must stay signed-out even on loopback.
 *
 * Laptop auto-login is for a reload of the tracker, not for `/signin`, `/signup`,
 * or an invitation link. Minting a session there hides the form Playwright (and
 * a person following an email) is about to fill.
 */
export function isAnonymousAuthPath(pathname: string): boolean {
  return (
    pathname === '/signin' ||
    pathname === '/signup' ||
    pathname === '/welcome' ||
    pathname.startsWith('/invite/') ||
    pathname.startsWith('/ask/')
  );
}

/**
 * Whether this page has any use for a session at all.
 *
 * The public ask form carries its own credential in the URL — the token *is* the
 * authorisation — and renders identically whether or not a session exists, because the
 * routes for both branches point at the same component. So restoring one is not merely
 * unnecessary, it is the wrong thing to spend a stranger's rate-limit budget on: the
 * anonymous bucket is per IP, and a boot-time `/auth/refresh` made a form load cost two
 * tokens instead of one.
 *
 * Deliberately narrower than `isAnonymousAuthPath`. `/signin` and `/invite/:token` also
 * render signed out, but a browser that *does* hold a session must still be recognised
 * there — an invitation is very often opened in the browser somebody already works in, and
 * `/signin` on a live session belongs on the issue list.
 */
export function isSessionlessPath(pathname: string): boolean {
  return pathname.startsWith('/ask/');
}

/** `isSessionlessPath` asked of the page this client is actually on. */
export function pageNeedsNoSession(): boolean {
  return isSessionlessPath(currentPathname());
}

export function isLoopbackHostname(host: string): boolean {
  const h = host.trim().toLowerCase().replace(/\.$/, '');
  return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '[::1]';
}

function clientHostname(): string {
  if (isDesktop) {
    const origin = desktopServerUrl();
    if (!origin) return '';
    try {
      return new URL(origin).hostname;
    } catch {
      return '';
    }
  }
  if (typeof location === 'undefined') return '';
  return location.hostname;
}

function currentPathname(): string {
  if (typeof location === 'undefined') return '';
  return location.pathname;
}

/**
 * Normalises what somebody types into the "connect to your server" field.
 *
 * People type `polaris.acme.com`, `https://polaris.acme.com/`, and occasionally
 * `https://polaris.acme.com/team/ENG` because they copied it out of the address bar. All
 * three mean the same server, and refusing two of them teaches the user that the field is
 * fussy rather than that they made a mistake.
 *
 * Returns null for anything that is not a usable http(s) origin.
 */
export function normaliseServerUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;

  // Default to https rather than http. A self-hosted tracker reached over plain http is
  // one where every session token crosses the network in clear, and defaulting to the safe
  // scheme costs a user who genuinely wants http exactly five characters.
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.hostname === '') return null;

  // Origin only: the path, query and fragment are whatever page they happened to copy.
  return url.origin;
}
