/**
 * End-to-end fixtures.
 *
 * Every test gets its own workspace, created through the real API. Sharing one workspace
 * across tests would make them order-dependent and would hide exactly the bugs this suite
 * is for: a test that only passes because a previous test happened to leave an issue lying
 * around is not testing the sync engine, it is testing the test order.
 */

import { test as base, type BrowserContext, type Page } from '@playwright/test';

const API = process.env.POLARIS_E2E_API ?? 'http://localhost:8088';

export interface Account {
  email: string;
  password: string;
  accessToken: string;
  accountId: string;
}

export interface SeededWorkspace {
  account: Account;
  workspaceId: string;
  teamId: string;
  teamKey: string;
  /** The team's five default statuses, keyed by category. */
  states: Record<string, { id: string; name: string }>;
}

/** A password long enough for the server's minimum, and obviously not a real one. */
const PASSWORD = 'e2e-placeholder-password';

async function post<T>(path: string, body: unknown, token?: string): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    // Named rather than left as a bare 403, because it is the one failure here that is a
    // deployment question and not a bug. POLARIS_REGISTRATION_MODE defaults to `invite`, and
    // under it exactly two people may register: somebody holding an invitation, and the very
    // first account on an empty install. This fixture needs one account per test, so a server
    // started on the default refuses every test after the first — with a message about
    // invitations that reads like an application fault rather than a missing variable.
    if (res.status === 403 && text.includes('invite-only')) {
      throw new Error(
        `${path} → 403: this server is invite-only.\n` +
          '  The suite creates an account per test, so the API under test has to be started ' +
          'with POLARIS_REGISTRATION_MODE=open.\n' +
          `  Raw: ${text}`,
      );
    }
    throw new Error(`${path} → ${res.status}: ${text}`);
  }
  return (await res.json()) as T;
}

async function graphql<T>(
  query: string,
  variables: Record<string, unknown>,
  token: string,
  workspaceId: string,
): Promise<T> {
  const res = await fetch(`${API}/graphql`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'X-Polaris-Workspace': workspaceId,
    },
    body: JSON.stringify({ query, variables }),
  });
  const body = (await res.json()) as { data?: T; errors?: { message: string }[] };
  if (body.errors?.length) throw new Error(body.errors[0]!.message);
  if (!body.data) throw new Error('no data');
  return body.data;
}

/** Creates an account and a workspace, and returns everything a test needs to drive it. */
export async function seedWorkspace(label: string): Promise<SeededWorkspace> {
  // One nonce, used for both the email and the workspace address.
  //
  // BOTH have to be unique per run, and forgetting the address is a trap worth naming: the
  // label comes from the test title, which is stable by design, so a suite that randomises
  // only the email passes the first time and then fails every re-run with "that address is
  // already taken" — which reads like an application bug rather than a fixture that cannot
  // be run twice.
  const nonce = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
  const email = `e2e+${label}-${nonce}@polaris.test`;

  const registered = await post<{ accessToken: string; accountId: string }>('/auth/register', {
    email,
    password: PASSWORD,
  });

  const created = await post<{
    Workspace: { id: string };
    Team: { id: string; key: string };
    States: { id: string; name: string; category: string }[];
  }>(
    '/auth/workspaces',
    {
      name: `E2E ${label}`,
      urlKey: `e2e-${nonce}`,
      userName: 'E2E',
      firstTeamKey: 'ENG',
      firstTeamName: 'Engineering',
    },
    registered.accessToken,
  );

  const states: SeededWorkspace['states'] = {};
  for (const s of created.States) {
    states[s.category] = { id: s.id, name: s.name };
  }

  return {
    account: {
      email,
      password: PASSWORD,
      accessToken: registered.accessToken,
      accountId: registered.accountId,
    },
    workspaceId: created.Workspace.id,
    teamId: created.Team.id,
    teamKey: created.Team.key,
    states,
  };
}

/** Creates an issue over the API — the "somebody else did this" half of a sync test. */
export async function createIssueViaApi(
  ws: SeededWorkspace,
  title: string,
): Promise<{ id: string; identifier: string }> {
  const data = await graphql<{ createIssue: { issue: { id: string; identifier: string } } }>(
    `
      mutation ($i: CreateIssueInput!) {
        createIssue(input: $i) {
          issue {
            id
            identifier
          }
        }
      }
    `,
    { i: { teamId: ws.teamId, title } },
    ws.account.accessToken,
    ws.workspaceId,
  );
  return data.createIssue.issue;
}

/**
 * Invites somebody, and hands back the token the link carries.
 *
 * The token is returned exactly once, by this mutation, and is not recoverable from anywhere
 * afterwards — which is the product's rule and not a limitation of the fixture. A test that
 * wants to follow an invitation has to hold what this returns.
 */
export async function inviteToWorkspace(
  ws: SeededWorkspace,
  email: string,
  role: 'ADMIN' | 'MEMBER' | 'GUEST' = 'MEMBER',
): Promise<{ id: string; token: string }> {
  const data = await graphql<{ inviteToWorkspace: { id: string; token: string } }>(
    `
      mutation ($i: InviteInput!) {
        inviteToWorkspace(input: $i) {
          id
          token
        }
      }
    `,
    { i: { email, role, teamIds: [ws.teamId] } },
    ws.account.accessToken,
    ws.workspaceId,
  );
  return data.inviteToWorkspace;
}

/** An address nobody else in the run will use. */
export function uniqueEmail(label: string): string {
  const nonce = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
  return `e2e+${label}-${nonce}@polaris.test`;
}

/** Registers an account with no invitation — the open-signup path. */
export async function registerAccount(email: string): Promise<Account> {
  const body = await post<{ accessToken: string; accountId: string }>('/auth/register', {
    email,
    password: PASSWORD,
  });
  return { email, password: PASSWORD, accessToken: body.accessToken, accountId: body.accountId };
}

/** Signs a browser context in by driving the real form, not by injecting a token. */
export async function signIn(page: Page, account: Account): Promise<void> {
  // Anonymous `/` is the marketing page; the form lives here.
  await page.goto('/signin');
  await page.getByLabel(/email/i).fill(account.email);
  await page.getByLabel(/password/i).fill(account.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  // The shell is rendered once the replica is open; waiting for it rather than for a URL
  // means the assertion that follows is not racing the bootstrap.
  await page.getByRole('navigation', { name: /workspace/i }).waitFor();
}

/**
 * Opens a team's issue list and waits for it to be a list.
 *
 * `page.goto` resolves on `load`, which for this client is the moment the module graph has
 * finished downloading and several frames before the replica is open, the route has
 * rendered and the keymap has registered `C`. A test that navigates and immediately presses
 * a key is therefore racing the boot, and loses often enough to be a mystery: the keystroke
 * lands on a document with no handler for it, the dialogue never opens, and the failure
 * names the dialogue rather than the race. Waiting for the listbox is waiting for the thing
 * every one of these tests then acts on.
 */
export async function openTeamList(page: Page, teamKey: string): Promise<void> {
  await page.goto(`/team/${teamKey}`);
  await page.getByRole('listbox', { name: /issues/i }).waitFor();
}

/**
 * Clears the origin's IndexedDB, simulating a browser evicting the replica under storage
 * pressure — which happens in the wild and must be survivable.
 */
export async function clearLocalReplica(context: BrowserContext): Promise<void> {
  const page = context.pages()[0] ?? (await context.newPage());
  await page.evaluate(async () => {
    const dbs = await indexedDB.databases();
    await Promise.all(
      dbs.map(
        (db) =>
          new Promise<void>((resolve) => {
            if (!db.name) return resolve();
            const req = indexedDB.deleteDatabase(db.name);
            req.onsuccess = req.onerror = req.onblocked = () => resolve();
          }),
      ),
    );
  });
}

export const test = base.extend<{ workspace: SeededWorkspace }>({
  workspace: async ({}, use, testInfo) => {
    const ws = await seedWorkspace(testInfo.title.slice(0, 20).replace(/\W+/g, '-'));
    await use(ws);
  },
});

export { expect } from '@playwright/test';
