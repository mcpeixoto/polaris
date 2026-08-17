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
    throw new Error(`${path} → ${res.status}: ${await res.text()}`);
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

/** Signs a browser context in by driving the real form, not by injecting a token. */
export async function signIn(page: Page, account: Account): Promise<void> {
  await page.goto('/');
  await page.getByLabel(/email/i).fill(account.email);
  await page.getByLabel(/password/i).fill(account.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  // The shell is rendered once the replica is open; waiting for it rather than for a URL
  // means the assertion that follows is not racing the bootstrap.
  await page.getByRole('navigation', { name: /workspace/i }).waitFor();
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
