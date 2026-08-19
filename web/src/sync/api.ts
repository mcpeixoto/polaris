/**
 * The API client: one place that talks HTTP.
 *
 * Everything the app does over the network goes through here — GraphQL queries and
 * mutations, the auth endpoints, and the bootstrap stream. Concentrating it means access
 * token refresh, the workspace header and error normalisation are implemented once
 * instead of being reinvented per feature.
 */

import { apiUrl, credentialsMode } from './endpoint';

export type ErrorCode =
  | 'VALIDATION'
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'UNAUTHENTICATED'
  | 'CONFLICT'
  | 'RATELIMITED'
  | 'PLAN_LIMIT'
  | 'INTERNAL'
  | 'NETWORK';

/** A failure the UI can branch on without string-matching a message. */
export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly field?: string;

  constructor(code: ErrorCode, message: string, field?: string) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.field = field;
  }

  /**
   * True when the request never reached the server, so the caller should keep the
   * mutation queued rather than roll it back. Distinguishing this from a rejection is
   * the whole difference between "you are offline" and "that was not allowed".
   */
  get isOffline(): boolean {
    return this.code === 'NETWORK';
  }

  get isAuthFailure(): boolean {
    return this.code === 'UNAUTHENTICATED';
  }
}

interface Session {
  accessToken: string;
  expiresAt: number;
  accountId: string;
}

/**
 * Auth state lives in memory, not localStorage.
 *
 * The refresh token is an HttpOnly cookie the page cannot read; the access token is
 * short-lived and deliberately not persisted, so a stored XSS cannot lift a credential
 * out of storage on a later visit. The cost is one refresh call per page load, which
 * happens during boot anyway.
 */
let session: Session | null = null;
let workspaceId: string | null = null;
let refreshInFlight: Promise<Session | null> | null = null;

const onAuthLostCallbacks = new Set<() => void>();

export function onAuthLost(fn: () => void): () => void {
  onAuthLostCallbacks.add(fn);
  return () => onAuthLostCallbacks.delete(fn);
}

export function setWorkspace(id: string | null): void {
  workspaceId = id;
}

export function currentWorkspace(): string | null {
  return workspaceId;
}

export function currentAccessToken(): string | null {
  return session?.accessToken ?? null;
}

export function isSignedIn(): boolean {
  return session !== null;
}

function storeSession(body: {
  accessToken: string;
  expiresIn: number;
  accountId: string;
}): Session {
  session = {
    accessToken: body.accessToken,
    // Refresh a minute early. Racing the expiry means a request occasionally goes out
    // with a token that expires in transit, and the user sees a spurious sign-out.
    expiresAt: Date.now() + (body.expiresIn - 60) * 1000,
    accountId: body.accountId,
  };
  return session;
}

function clearSession(): void {
  session = null;
  for (const fn of onAuthLostCallbacks) fn();
}

async function parseError(res: Response): Promise<ApiError> {
  let code: ErrorCode = 'INTERNAL';
  let message = res.statusText || 'request failed';
  let field: string | undefined;

  try {
    const body = (await res.json()) as {
      error?: { code?: string; message?: string; field?: string };
    };
    if (body.error) {
      code = (body.error.code as ErrorCode) ?? code;
      message = body.error.message ?? message;
      field = body.error.field;
    }
  } catch {
    // A non-JSON body means the proxy answered, not the app. The status is all there is.
    if (res.status === 401) code = 'UNAUTHENTICATED';
    else if (res.status === 403) code = 'FORBIDDEN';
    else if (res.status === 404) code = 'NOT_FOUND';
    else if (res.status === 429) code = 'RATELIMITED';
  }

  return new ApiError(code, message, field);
}

/** What a registration may carry besides the credentials. */
export interface RegisterOptions {
  /**
   * The invitation this registration redeems.
   *
   * On a default install it is what admits the caller at all: `POLARIS_REGISTRATION_MODE`
   * is `invite`, and registration without a token is refused for everybody except the very
   * first account on an empty server.
   *
   * It travels ON the register call rather than being exchanged first, and the server
   * creates the account and the workspace membership in one transaction. That is why the
   * caller must NOT follow this with `acceptInvite`: the membership already exists, and the
   * token has been spent.
   */
  readonly inviteToken?: string | undefined;
  /** The name the invited person takes in the workspace. Ignored without an invitation. */
  readonly displayName?: string | undefined;
}

/** Auth endpoints. These are the only calls that work without an access token. */
export const auth = {
  async register(email: string, password: string, opts: RegisterOptions = {}) {
    return post<{
      accessToken: string;
      expiresIn: number;
      accountId: string;
      workspaces: Workspace[];
    }>('/auth/register', {
      email,
      password,
      // Spread rather than passed as `inviteToken: opts.inviteToken`: the handler decodes
      // with DisallowUnknownFields, and while `JSON.stringify` does drop an `undefined`
      // value, writing the keys unconditionally is one refactor away from sending `null` —
      // which is a present field of the wrong type and a 400 on the one call somebody makes
      // once, from an email link, with no obvious way to retry.
      ...(opts.inviteToken === undefined ? null : { inviteToken: opts.inviteToken }),
      ...(opts.displayName === undefined ? null : { displayName: opts.displayName }),
    }).then((body) => {
      storeSession(body);
      return body;
    });
  },

  async login(email: string, password: string) {
    return post<{
      accessToken: string;
      expiresIn: number;
      accountId: string;
      workspaces: Workspace[];
    }>('/auth/login', { email, password }).then((body) => {
      storeSession(body);
      return body;
    });
  },

  async logout() {
    try {
      await post('/auth/logout', {});
    } finally {
      clearSession();
    }
  },

  /**
   * Exchanges the refresh cookie for a new access token.
   *
   * Concurrent callers share one in-flight request. Without that, a page load firing five
   * queries at once sends five refreshes, and since the server rotates the refresh token
   * on every use, four of them would be rejected and the user would be signed out on boot.
   */
  async refresh(): Promise<Session | null> {
    if (refreshInFlight) return refreshInFlight;

    refreshInFlight = (async () => {
      try {
        const body = await post<{ accessToken: string; expiresIn: number; accountId: string }>(
          '/auth/refresh',
          {},
          { skipAuth: true },
        );
        return storeSession(body);
      } catch {
        clearSession();
        return null;
      } finally {
        refreshInFlight = null;
      }
    })();

    return refreshInFlight;
  },

  /**
   * Asks the API to mint a local-dev session cookie, the same shape as refresh.
   *
   * Only the server decides whether this is allowed. Callers that are not on
   * loopback should not hit it; when they do, the response is a 404 and this
   * returns null the same way a missing refresh cookie does.
   */
  async devSession(): Promise<Session | null> {
    try {
      const body = await post<{ accessToken: string; expiresIn: number; accountId: string }>(
        '/auth/dev-session',
        {},
        { skipAuth: true },
      );
      return storeSession(body);
    } catch {
      return null;
    }
  },

  async listWorkspaces(): Promise<Workspace[]> {
    const body = await request<{ workspaces: Workspace[] }>('/auth/workspaces', { method: 'GET' });
    return body.workspaces;
  },

  async createWorkspace(input: CreateWorkspaceInput) {
    return post<CreateWorkspaceResult>('/auth/workspaces', input);
  },

  async acceptInvite(token: string, displayName?: string) {
    return post<{ user: unknown; workspaceId: string }>('/auth/invites/accept', {
      token,
      displayName,
    });
  },
};

export interface Workspace {
  id: string;
  name: string;
  urlKey: string;
  logoUrl?: string | null;
  plan: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateWorkspaceInput {
  name: string;
  urlKey?: string;
  userName: string;
  userDisplayName?: string;
  userTimezone?: string;
  firstTeamKey?: string;
  firstTeamName?: string;
}

export interface CreateWorkspaceResult {
  Workspace: Workspace;
  User: unknown;
  Team: unknown;
  States: unknown[];
  Version: number;
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  skipAuth?: boolean;
  /** Set internally to stop a refresh loop. */
  isRetry?: boolean;
  signal?: AbortSignal;
}

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  if (!opts.skipAuth) {
    // Refresh proactively when the token is about to expire, rather than reactively on a
    // 401. Reacting means every request has a chance of costing two round trips.
    if (session && session.expiresAt <= Date.now()) {
      await auth.refresh();
    }
    if (session) headers.Authorization = `Bearer ${session.accessToken}`;
  }
  if (workspaceId) headers['X-Polaris-Workspace'] = workspaceId;

  let res: Response;
  try {
    res = await fetch(apiUrl(path), {
      method: opts.method ?? 'POST',
      headers,
      // The refresh token is an HttpOnly cookie, so credentials must be sent. Which mode
      // that takes depends on where the server is: same-origin on the web, and `include`
      // in the desktop app, which is cross-origin to its server by construction.
      credentials: credentialsMode(),
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: opts.signal,
    });
  } catch (err) {
    // fetch rejects only on a network-level failure. Everything else is a status code,
    // and conflating the two is how an offline client throws away a queued mutation.
    throw new ApiError('NETWORK', err instanceof Error ? err.message : 'network unavailable');
  }

  if (res.status === 401 && !opts.skipAuth && !opts.isRetry) {
    // The token expired sooner than expected — a clock skew, or it was revoked. One
    // refresh and one retry; a second failure is a real sign-out.
    const refreshed = await auth.refresh();
    if (refreshed) return request<T>(path, { ...opts, isRetry: true });
  }

  if (!res.ok) {
    const err = await parseError(res);
    if (err.isAuthFailure) clearSession();
    throw err;
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

function post<T>(path: string, body: unknown, opts: RequestOptions = {}): Promise<T> {
  return request<T>(path, { ...opts, method: 'POST', body });
}

/** A GraphQL error as the server's presenter emits it. */
interface GraphQLError {
  message: string;
  extensions?: { code?: string; field?: string };
}

/**
 * Executes a GraphQL operation.
 *
 * Mutations carry clientId and opId so that a retry after a dropped response returns the
 * original result instead of applying the write a second time. That pairing is what makes
 * the offline outbox safe to replay.
 */
export async function gql<T>(
  query: string,
  variables?: Record<string, unknown>,
  opts: { signal?: AbortSignal } = {},
): Promise<T> {
  const body = await request<{ data?: T; errors?: GraphQLError[] }>('/graphql', {
    method: 'POST',
    body: { query, variables },
    signal: opts.signal,
  });

  if (body.errors?.length) {
    const first = body.errors[0]!;
    throw new ApiError(
      (first.extensions?.code as ErrorCode) ?? 'INTERNAL',
      first.message,
      first.extensions?.field,
    );
  }
  if (body.data === undefined) {
    throw new ApiError('INTERNAL', 'the server returned no data');
  }
  return body.data;
}

/** Exposed for the bootstrap stream, which needs the raw headers rather than JSON. */
export function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  if (session) headers.Authorization = `Bearer ${session.accessToken}`;
  if (workspaceId) headers['X-Polaris-Workspace'] = workspaceId;
  return headers;
}

/** Ensures a valid access token before a long-lived operation such as the socket handshake. */
export async function ensureFreshToken(): Promise<string | null> {
  if (session && session.expiresAt <= Date.now()) await auth.refresh();
  return session?.accessToken ?? null;
}
