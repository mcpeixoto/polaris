import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import type { ApiKeySummary } from '~/features/apikeys/mutations';
import { Store } from '~/store';
import { ApiError, gql } from '~/sync/api';
import type { SyncEngine } from '~/sync/engine';

import { ApiKeys } from './ApiKeys';

/**
 * `gql` is mocked, and that is this screen's whole distinguishing feature restated as a test
 * fixture.
 *
 * Every other view in the product is exercised against a seeded `Store`, because that is
 * where its data comes from. This one has no store entity — keys are not replicated — so
 * seeding a store would prove nothing and stubbing `engine.mutate` would intercept a call the
 * screen never makes. The network client is the screen's only data path, so the network
 * client is what stands in.
 *
 * `ApiError` is deliberately kept real. It is not a value the tests fabricate, it is the type
 * the screen branches on to tell "you are offline" from "that was refused", and a stubbed
 * class would let that branch rot unnoticed.
 */
vi.mock('~/sync/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/sync/api')>();
  return { ...actual, gql: vi.fn() };
});

const sent = vi.mocked(gql);

const WORKSPACE = 'workspace-1';
const AT = '2026-01-01T00:00:00Z';

/** Fabricated, and shaped like the real thing only so the assertions read honestly. */
const TOKEN = 'plk_9f2c1a4bTHISISNOTAREALTOKEN0000000000000';

/** The keys the fake server currently holds. Rewritten by the writes, re-read by the query. */
let listing: ApiKeySummary[] = [];

function key(id: string, name: string, over: Partial<ApiKeySummary> = {}): ApiKeySummary {
  return {
    id,
    userId: 'user-ada',
    name,
    prefix: `plk_${id}`,
    scopes: [],
    lastUsedAt: null,
    expiresAt: null,
    revokedAt: null,
    createdAt: AT,
    ...over,
  };
}

/**
 * The server, as far as this screen can tell.
 *
 * Documents are matched on their operation name rather than by call order, because the screen
 * legitimately re-reads the list after every write and a positional fixture would encode that
 * as a rule the screen is not allowed to change.
 */
function answer(query: string, variables?: Record<string, unknown>): unknown {
  if (query.includes('query ApiKeys')) {
    return { apiKeys: listing };
  }
  if (query.includes('mutation CreateApiKey')) {
    const input = (variables?.input ?? {}) as { name: string };
    const made = key('key-new', input.name, { prefix: 'plk_9f2c1a4b', createdAt: AT });
    listing = [made, ...listing];
    return { createApiKey: { version: 2, created: { token: TOKEN, apiKey: made } } };
  }
  if (query.includes('mutation RevokeApiKey')) {
    listing = listing.map((held) =>
      held.id === variables?.id ? { ...held, revokedAt: '2026-02-01T00:00:00Z' } : held,
    );
    return { revokeApiKey: { version: 3, id: variables?.id } };
  }
  throw new Error(`the screen sent a document these tests do not answer: ${query.slice(0, 60)}`);
}

/** The variables of every call that carried the named operation, in order. */
function callsTo(operation: string): (Record<string, unknown> | undefined)[] {
  return sent.mock.calls
    .filter(([query]) => query.includes(operation))
    .map(([, variables]) => variables);
}

beforeEach(() => {
  listing = [];
  sent.mockReset();
  sent.mockImplementation(<T,>(query: string, variables?: Record<string, unknown>) =>
    Promise.resolve(answer(query, variables) as T),
  );
});

function renderScreen() {
  // The engine is present because the provider tree is, not because the screen wants it:
  // nothing here reads the store or calls `mutate`, which is exactly the claim the header of
  // ApiKeys.tsx makes. Keeping the stub in place is what would make a future `useLiveQuery`
  // on this screen visible — it would start passing through an engine nobody seeded.
  const store = new Store(WORKSPACE);
  const mutate = vi.fn().mockResolvedValue({});
  const engine = { store, mutate } as unknown as SyncEngine;

  render(
    <MemoryRouter>
      <KeymapProvider>
        <EngineProvider engine={engine} status={{ phase: 'idle' }}>
          <ApiKeys />
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );

  return { mutate, user: userEvent.setup() };
}

/** The row for a named key, found through its row header rather than through the DOM. */
function rowFor(name: string): HTMLElement {
  const header = screen.getByRole('rowheader', {
    name: (accessible: string) => accessible.startsWith(name),
  });
  const row = header.closest('tr');
  if (row === null) throw new Error(`the "${name}" row header is not inside a row`);
  return row;
}

/**
 * The listing itself: the half of the screen that is only a table, and the only place the
 * ordering, the empty cells and the revoked state can be observed together.
 *
 * The individual facts are simple enough to be obvious in isolation — that a null timestamp
 * renders as a word, that a revoked key sorts last — and each of them has been wrong in a
 * shipped product, because they are only ever wrong in combination with a table that has
 * already drawn six other columns correctly.
 */
describe('ApiKeys', () => {
  it('reads "Never" for a key that has never been used, rather than leaving the cell empty', async () => {
    listing = [key('key-1', 'CI deploy bot')];
    renderScreen();

    await screen.findByRole('table');
    const row = rowFor('CI deploy bot');

    expect(within(row).getByText('Never')).toBeTruthy();
    // The two absences are different absences and must not read the same: a key that has
    // never been used is suspicious, a key that never expires is a choice.
    expect(within(row).getByText('Does not expire')).toBeTruthy();
  });

  it('keeps revoked keys in the list, at the bottom, and offers no way to revoke them twice', async () => {
    listing = [
      key('key-old', 'Retired importer', {
        createdAt: '2025-06-01T00:00:00Z',
        revokedAt: '2025-09-01T00:00:00Z',
      }),
      key('key-live', 'CI deploy bot', { createdAt: '2026-01-01T00:00:00Z' }),
    ];
    renderScreen();

    await screen.findByRole('table');
    // The header row is the first; the body follows it in draw order.
    const [, first, second] = screen.getAllByRole('row');

    expect(first?.textContent).toContain('CI deploy bot');
    expect(second?.textContent).toContain('Retired importer');
    expect(within(rowFor('Retired importer')).getByText('Revoked')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Revoke Retired importer' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Revoke CI deploy bot' })).toBeTruthy();
  });

  it('asks before revoking, says what breaks, and sends nothing until it is answered', async () => {
    listing = [key('key-1', 'CI deploy bot', { prefix: 'plk_a1b2c3d4' })];
    const { user } = renderScreen();

    await user.click(await screen.findByRole('button', { name: 'Revoke CI deploy bot' }));

    const dialog = screen.getByRole('dialog', { name: 'Revoke CI deploy bot?' });
    // Not "are you sure": the sentence has to name what stops working, or there is nothing to
    // be sure about.
    expect(dialog.textContent).toContain('stops working on its very next request');
    expect(dialog.textContent).toContain('plk_a1b2c3d4');
    expect(callsTo('mutation RevokeApiKey')).toEqual([]);

    await user.click(within(dialog).getByRole('button', { name: 'Revoke this key' }));

    await waitFor(() => expect(callsTo('mutation RevokeApiKey')).toEqual([{ id: 'key-1' }]));
    // Re-read rather than spliced out locally: the row comes back marked, because somebody
    // auditing this screen is asking when the key stopped working, not whether it ever existed.
    expect(await screen.findByText('Revoked')).toBeTruthy();
  });

  it('says so when the keys cannot be fetched, and asks again when told to', async () => {
    listing = [key('key-1', 'CI deploy bot')];
    sent.mockImplementationOnce(() => Promise.reject(new ApiError('INTERNAL', 'nope')));
    const { user } = renderScreen();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('could not be fetched');
    // No stale table beside the failure. A list of credentials somebody is about to act on is
    // the wrong thing to leave on screen next to "this could not be refreshed".
    expect(screen.queryByRole('table')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByRole('table')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

/**
 * The created token: the one thing on this screen that cannot be fetched again.
 *
 * Only a rendered dialog can prove these. That the token reaches the screen at all is a claim
 * about the response's nesting — it arrives under `created`, not on the payload — and that it
 * is gone afterwards is a claim about component state, which no unit test of the mutation
 * wrapper can make. Both are one refactor away from being false and neither would fail a
 * typecheck.
 */
describe('ApiKeys · the one-time token', () => {
  async function createKey(user: ReturnType<typeof userEvent.setup>) {
    await user.click(await screen.findByRole('button', { name: 'New key' }));
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'CI deploy bot');
    await user.click(screen.getByRole('button', { name: 'Create key' }));
    return screen.findByRole('textbox', { name: /^Token for CI deploy bot/ });
  }

  it('shows the token once and has nothing left to show once the dialog is closed', async () => {
    const { user } = renderScreen();

    const field = await createKey(user);
    expect((field as HTMLInputElement).value).toBe(TOKEN);

    await user.click(screen.getByRole('button', { name: 'I have saved it — close' }));

    expect(screen.queryByRole('textbox', { name: /^Token for/ })).toBeNull();
    // Nowhere else either. The listing has no column that could hold one, and this is the
    // assertion that would fail if somebody ever gave it one.
    expect(document.body.textContent).not.toContain(TOKEN);

    // And opening the dialog again offers a fresh form, not the last token.
    await user.click(screen.getByRole('button', { name: 'New key' }));
    expect(screen.queryByRole('textbox', { name: /^Token for/ })).toBeNull();
    expect(screen.getByRole('textbox', { name: 'Name' })).toBeTruthy();
  });

  it('refuses to be dismissed by accident while the token is on screen', async () => {
    const { user } = renderScreen();

    await createKey(user);

    // Escape is the reflex that closes every other dialog in the product, which is precisely
    // why it must not close this one: the cost of the reflex here is a credential.
    await user.keyboard('{Escape}');

    expect(screen.getByRole('textbox', { name: /^Token for CI deploy bot/ })).toBeTruthy();
    // Queried by its words rather than by `role="status"`: SecretField keeps a live region of
    // its own for the copy confirmation, and there are legitimately two on this dialog.
    expect(screen.getByText(/Nothing is lost yet/)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'I have saved it — close' }));
    expect(screen.queryByRole('textbox', { name: /^Token for/ })).toBeNull();
  });
});
