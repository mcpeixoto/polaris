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

/**
 * The structure a PLAN_LIMIT refusal carries besides its sentence.
 *
 * The server has always known which feature was refused, which plan would permit it and
 * which ceiling was hit — `entitlement.Details` on the Go side — and both transports now
 * send it: GraphQL merges these keys into `extensions` beside `code`, and the REST handlers
 * flatten the same names into the 402 body. One shape, so a paywall reads the same whichever
 * endpoint answered.
 *
 * Every field is optional because the server omits what it does not know, and because a
 * deployment running an older API answers with none of them. A reader must treat all-absent
 * as "no structure offered" and fall back to the message, never as "no upgrade exists" —
 * guessing the second is how a paying customer gets told to buy the plan they are on.
 */
export interface PaywallDetails {
  /** The workspace's plan at the moment of refusal. */
  readonly plan?: string;
  /** The cheapest plan that would permit it. Absent when no plan would. */
  readonly needsPlan?: string;
  /** Set on a feature refusal. Exactly one of `feature` and `limit` is present. */
  readonly feature?: string;
  /** Set on a ceiling refusal: `seats`, `teams`, `history_days`. */
  readonly limit?: string;
  /** The ceiling that was hit. Meaningful only alongside `limit`, and 0 is a real value. */
  readonly cap?: number;
  /** Billing lapsed rather than the plan not including this. A different screen entirely. */
  readonly lapsed?: boolean;
}

/**
 * Picks the paywall fields out of a wire payload.
 *
 * Written defensively rather than cast, because this object came off the network: a
 * `cap` that arrived as a string would otherwise reach a template and render
 * "limited to [object Object]" at a customer. Anything of the wrong type is dropped, which
 * degrades to the plain message — the same place a client with no structure at all lands.
 */
function readPaywall(source: Record<string, unknown> | undefined): PaywallDetails | undefined {
  if (source === undefined) return undefined;
  const details: {
    plan?: string;
    needsPlan?: string;
    feature?: string;
    limit?: string;
    cap?: number;
    lapsed?: boolean;
  } = {};
  for (const key of ['plan', 'needsPlan', 'feature', 'limit'] as const) {
    const value = source[key];
    if (typeof value === 'string' && value !== '') details[key] = value;
  }
  if (typeof source.cap === 'number' && Number.isFinite(source.cap)) details.cap = source.cap;
  if (source.lapsed === true) details.lapsed = true;
  return Object.keys(details).length === 0 ? undefined : details;
}

/** A failure the UI can branch on without string-matching a message. */
export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly field?: string;
  /**
   * Present only on a PLAN_LIMIT refusal, and not on every one of those — see
   * `PaywallDetails`. `features/admin/entitlements.ts` turns it into an upgrade destination.
   */
  readonly paywall?: PaywallDetails;

  constructor(code: ErrorCode, message: string, field?: string, paywall?: PaywallDetails) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.field = field;
    this.paywall = paywall;
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

/**
 * A note to the next page load that this browser has a refresh cookie worth spending a
 * round trip on.
 *
 * The cookie itself is HttpOnly, which is the point of it — so the only way the app can
 * know whether asking `/auth/refresh` is a question or a formality is to remember that it
 * once had an answer. Without that, every cold boot asks, every first-ever visitor is
 * told 401, and the browser draws that in red: a console error on the sign-in page, where
 * it is *guaranteed*, teaching everybody who works here that red lines are background
 * noise. It also costs a request, which on the public ask form is half of an anonymous
 * IP's rate-limit budget spent learning nothing.
 *
 * This is a hint and never a credential. It grants nothing: the cookie is still the only
 * thing that mints a session, and a browser holding a forged hint gets the same 401 it
 * would have got anyway. The failure modes both point the safe way — a hint that outlives
 * its cookie costs exactly one honest 401, and a missing hint costs a sign-in form.
 */
const SESSION_HINT_KEY = 'polaris.session';

function rememberSessionExists(): void {
  try {
    localStorage.setItem(SESSION_HINT_KEY, '1');
  } catch {
    // Safari private mode and sandboxed iframes throw. See `sessionMayExist`.
  }
}

function forgetSession(): void {
  try {
    localStorage.removeItem(SESSION_HINT_KEY);
  } catch {
    /* see above */
  }
}

/**
 * Whether a session restore is worth attempting on this browser.
 *
 * Fails *open*: a browser that cannot read storage at all is told to go ahead and ask, so
 * the worst case of a locked-down profile is the console error we had before rather than a
 * user who can never stay signed in.
 */
export function sessionMayExist(): boolean {
  try {
    return localStorage.getItem(SESSION_HINT_KEY) !== null;
  } catch {
    return true;
  }
}

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
  rememberSessionExists();
  return session;
}

/**
 * Drops the in-memory access token and tells the app the session is gone.
 *
 * `forgetHint` is separate because the two failures look identical at the call site and cost
 * wildly different things. A refresh that failed because the API was unreachable — wifi off,
 * or the API container restarting behind the proxy — says nothing about whether the refresh
 * cookie is still good. Forgetting the hint on that is what strands the user: `Boot` reads a
 * missing hint as "this browser has never held a session" and stops asking, so the session is
 * unrecoverable even after the network comes back and they have to type their password again.
 *
 * The asymmetry decides the default. Keeping a hint whose cookie really did die costs exactly
 * one honest 401 on the next boot. Dropping a hint whose cookie is still valid costs a
 * re-login. So the hint is forgotten only when the server actually said the credential is no
 * good, never merely because the answer did not arrive.
 */
function clearSession({ forgetHint = true }: { forgetHint?: boolean } = {}): void {
  session = null;
  if (forgetHint) forgetSession();
  for (const fn of onAuthLostCallbacks) fn();
}

async function parseError(res: Response): Promise<ApiError> {
  let code: ErrorCode = 'INTERNAL';
  let message = res.statusText || 'request failed';
  let field: string | undefined;
  let paywall: PaywallDetails | undefined;

  try {
    const body = (await res.json()) as {
      error?: { code?: string; message?: string; field?: string } & Record<string, unknown>;
    };
    if (body.error) {
      code = (body.error.code as ErrorCode) ?? code;
      message = body.error.message ?? message;
      field = body.error.field;
      // Read on every failure rather than only on a 402: the status and the code are the
      // server's classification, and gating this on one of them would mean a refusal that
      // arrived with a status the proxy rewrote quietly lost its upgrade destination.
      paywall = readPaywall(body.error);
    }
  } catch {
    // A non-JSON body means the proxy answered, not the app. The status is all there is.
    if (res.status === 401) code = 'UNAUTHENTICATED';
    else if (res.status === 403) code = 'FORBIDDEN';
    else if (res.status === 404) code = 'NOT_FOUND';
    else if (res.status === 429) code = 'RATELIMITED';
  }

  return new ApiError(code, message, field, paywall);
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
      } catch (error) {
        // Only an UNAUTHENTICATED answer proves the cookie is spent. A network error or a
        // 5xx means the question never got an answer, and the hint has to survive it.
        const credentialRefused = error instanceof ApiError && error.isAuthFailure;
        clearSession({ forgetHint: credentialRefused });
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

/**
 * Billing.
 *
 * REST and not GraphQL, deliberately: none of it is workspace data on the replica. A
 * checkout URL is a one-shot redirect that must never be cached, and the config flag is read
 * by the marketing pages, which have no session, no workspace header and no sync engine.
 */
export interface BillingState {
  /** Whether this deployment can sell anything at all. False on every self-host. */
  enabled: boolean;
  plan: string;
  status: string;
  seatsUsed: number;
  seatsPaid: number | null;
  currentPeriodEnd: string | null;
  lapsed: boolean;
  hasSubscription: boolean;
  /** Whether there is a Stripe customer to open the portal for. */
  canManage: boolean;
}

export const billing = {
  /**
   * Whether checkout exists on this server. Read without a session, because the pricing
   * page is rendered for people who do not have one.
   */
  async configured(): Promise<boolean> {
    const body = await request<{ enabled: boolean }>('/billing/config', {
      method: 'GET',
      skipAuth: true,
    });
    return body.enabled;
  },

  state() {
    return request<BillingState>('/billing', { method: 'GET' });
  },

  /** Opens a Stripe Checkout session and returns the URL to send the browser to. */
  async checkout(interval: 'monthly' | 'yearly') {
    const body = await post<{ url: string }>('/billing/checkout', { interval });
    return body.url;
  },

  /** Opens Stripe's billing portal, where the card and the cancellation live. */
  async portal() {
    const body = await post<{ url: string }>('/billing/portal', {});
    return body.url;
  },
};

export const asks = {
  get(token: string) {
    return request<{ name: string; description: string; teamName: string }>(`/asks/${token}`, {
      method: 'GET',
      skipAuth: true,
    });
  },

  submit(
    token: string,
    body: {
      title: string;
      description: string;
      requesterName: string;
      requesterEmail: string;
    },
  ) {
    return post<{ ok: string }>(`/asks/${token}`, body, { skipAuth: true });
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
  /**
   * `code` and `field` are the contract every client branches on. A PLAN_LIMIT error also
   * carries the paywall's structure here — see `PaywallDetails` — merged in flat beside
   * them by the server's presenter, which is why this is an open record rather than the
   * two named keys it used to be.
   */
  extensions?: { code?: string; field?: string } & Record<string, unknown>;
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
      readPaywall(first.extensions),
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
