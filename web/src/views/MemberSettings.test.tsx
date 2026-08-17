/**
 * Members, and the invitations that are not members yet.
 *
 * Almost everything here is about the invitations half, because it is the half that is unlike
 * the rest of the product. The member table renders from the replica, so it is either
 * instantaneous or it is empty and there is no third answer; an invitation is not a replicated
 * entity, so this screen is the one place in Members that asks a server, waits, and can be
 * told no. Loading, failure, retry and "you may not see this" are four states that only exist
 * on that path, and none of them can be observed except by rendering the screen.
 *
 * So `gql` is what stands in, not the store. Mocking the feature's own `fetchInvites` would
 * put the document the screen actually sends out of the test's reach, and an empty list of
 * invitations and a list nobody asked for look identical from the outside.
 *
 * `ApiError` is deliberately kept real: it is not a value these tests fabricate, it is the
 * type the screen branches on to tell "you are not an admin" from "that request failed" from
 * "somebody accepted it while you were reading", and a stubbed class would let those branches
 * rot without a single failing assertion.
 */

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { Store, type Change, type Team, type User, type Workspace } from '~/store';
import { ApiError, gql } from '~/sync/api';
import type { SyncEngine } from '~/sync/engine';

import { MemberSettings } from './MemberSettings';

vi.mock('~/sync/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/sync/api')>();
  return { ...actual, gql: vi.fn() };
});

/**
 * Who is at the keyboard, which is session state and not store state.
 *
 * Mocked the way `AppShell.test` and `NotificationSettings.test` mock it, and here it carries
 * a role as well as an id because the role is what decides whether the invite controls exist
 * at all. The screen restates the server's rule — owner or admin — and a test that could only
 * ever be an owner would never find out.
 */
const viewer = vi.hoisted(() => ({
  current: null as null | { readonly id: string; readonly role: string },
}));

vi.mock('~/hooks/useViewer', () => ({
  useViewerId: () => viewer.current?.id ?? null,
  useViewer: () => viewer.current,
}));

const sent = vi.mocked(gql);

const WORKSPACE = 'workspace-1';
const TEAM = 'team-eng';
const ADA = 'user-ada';
const GRACE = 'user-grace';
const AT = '2026-01-01T00:00:00Z';

/** Fabricated, and shaped like the real thing only so the assertions read honestly. */
const TOKEN = 'plv_9f2c1a4bTHISISNOTAREALTOKEN0000000000000';

/** An invitation exactly as the wire carries one: the role in GraphQL's spelling. */
interface InviteWire {
  id: string;
  email: string;
  role: 'OWNER' | 'ADMIN' | 'MEMBER' | 'GUEST';
  invitedBy: string | null;
  teamIds: string[];
  expiresAt: string;
  createdAt: string;
}

/** Fourteen days out, which is what the server's `inviteTTL` makes it. */
function inFourteenDays(): string {
  return new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
}

function invite(id: string, email: string, over: Partial<InviteWire> = {}): InviteWire {
  return {
    id,
    email,
    role: 'MEMBER',
    invitedBy: ADA,
    teamIds: [],
    expiresAt: inFourteenDays(),
    createdAt: AT,
    ...over,
  };
}

/** What the fake server currently holds. Rewritten by the writes, re-read by the query. */
let pending: InviteWire[] = [];

/**
 * How the fake server refuses `query Invites`, one answer at a time.
 *
 * Queued against that operation rather than against the next call, because the screen also
 * sends the entitlements query and which of the two lands first is not something a test
 * should be asserting by accident.
 */
let inviteFailures: ApiError[] = [];

function person(id: string, name: string, over: Partial<User> = {}): User {
  return {
    id,
    workspaceId: WORKSPACE,
    name: name.toLowerCase(),
    displayName: name,
    timezone: 'Europe/Lisbon',
    role: 'member',
    status: 'active',
    kind: 'human',
    createdAt: AT,
    updatedAt: AT,
    ...over,
  };
}

function workspace(): Workspace {
  return {
    id: WORKSPACE,
    name: 'Acme',
    urlKey: 'acme',
    plan: 'free',
    createdAt: AT,
    updatedAt: AT,
  };
}

function team(): Team {
  return {
    id: TEAM,
    workspaceId: WORKSPACE,
    key: 'ENG',
    name: 'Engineering',
    timezone: 'Europe/Lisbon',
    private: false,
    estimateScale: 'none',
    estimateAllowZero: false,
    estimateExtended: false,
    createdAt: AT,
    updatedAt: AT,
  };
}

type Seeded = Workspace | Team | User;

function seeded(users: readonly User[]): Store {
  const store = new Store(WORKSPACE);
  const rows: [string, Seeded][] = [
    ['workspace', workspace()],
    ['team', team()],
    ...users.map((user): [string, Seeded] => ['user', user]),
  ];
  store.applyChanges(
    rows.map(([type, payload], index) => ({
      v: index + 1,
      type,
      id: payload.id,
      op: 'upsert' as const,
      actor: { type: 'system' as const },
      payload,
    })) as Change[],
  );
  return store;
}

/**
 * The server, as far as this screen can tell.
 *
 * Matched on operation name rather than call order, because the screen legitimately re-reads
 * the list after every write and a positional fixture would encode that as a rule the screen
 * is not allowed to change.
 */
function answer(query: string, variables?: Record<string, unknown>): unknown {
  if (query.includes('query Entitlements')) {
    return {
      workspace: {
        id: WORKSPACE,
        name: 'Acme',
        plan: 'free',
        planExpiresAt: null,
        planLapsedAt: null,
        seatLimit: null,
        entitlements: {
          plan: 'free',
          seatLimit: null,
          seatsUsed: 2,
          teamLimit: null,
          historyDays: null,
          privateTeams: false,
          customViews: false,
          apiKeys: false,
          sso: false,
          auditLog: false,
          lapsed: false,
        },
      },
    };
  }
  if (query.includes('query Invites')) {
    const refusal = inviteFailures.shift();
    if (refusal !== undefined) throw refusal;
    return { invites: pending };
  }
  if (query.includes('mutation InviteToWorkspace')) {
    const input = (variables?.input ?? {}) as { email: string; role: InviteWire['role'] };
    // The server revokes any outstanding invitation to this address inside the same
    // transaction, so a re-invite replaces rather than accumulates. The fake does the same,
    // because the screen says so out loud and would otherwise be saying it about nothing.
    pending = pending.filter((held) => held.email.toLowerCase() !== input.email.toLowerCase());
    const made = invite('invite-new', input.email, { role: input.role });
    pending = [made, ...pending];
    return { inviteToWorkspace: { ...made, token: TOKEN } };
  }
  if (query.includes('mutation RevokeInvite')) {
    pending = pending.filter((held) => held.id !== variables?.id);
    return { revokeInvite: { version: 3, id: variables?.id } };
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
  pending = [];
  inviteFailures = [];
  viewer.current = { id: ADA, role: 'owner' };
  sent.mockReset();
  sent.mockImplementation(<T,>(query: string, variables?: Record<string, unknown>) =>
    Promise.resolve(answer(query, variables) as T),
  );
});

function renderScreen(users: readonly User[] = [person(ADA, 'Ada Lovelace')]) {
  const store = seeded(users);
  const mutate = vi.fn().mockResolvedValue({});
  const engine = { store, mutate } as unknown as SyncEngine;

  render(
    <MemoryRouter initialEntries={['/settings/members']}>
      <KeymapProvider>
        <EngineProvider engine={engine} status={{ phase: 'idle' }}>
          <MemberSettings />
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );

  return { store, mutate, user: userEvent.setup() };
}

/** The invitations section, found by its heading rather than by a class name. */
function invitations(): HTMLElement {
  return screen.getByRole('region', { name: 'Pending invitations' });
}

describe('MemberSettings · pending invitations', () => {
  it('lists them, with the role in the spelling a person reads and not the wire’s', async () => {
    pending = [invite('invite-1', 'ada@example.com', { role: 'ADMIN' })];
    renderScreen();

    expect(
      await screen.findByRole('button', { name: 'Revoke the invitation to ada@example.com' }),
    ).toBeTruthy();
    // "ADMIN" is what the server sends and "admin" is what the store's `UserRole` says. A
    // lookup with the wrong one is a blank badge and no error anywhere, which is the whole
    // reason gql/enums exists.
    expect(within(invitations()).getByText('Admin')).toBeTruthy();
  });

  it('waits visibly rather than claiming nobody is waiting', async () => {
    let release: (() => void) | undefined;
    sent.mockImplementation(<T,>(query: string, variables?: Record<string, unknown>) => {
      if (!query.includes('query Invites')) return Promise.resolve(answer(query, variables) as T);
      return new Promise<T>((resolve) => {
        release = () => resolve(answer(query, variables) as T);
      });
    });
    renderScreen();

    expect(await screen.findByRole('status', { name: 'Loading pending invitations' })).toBeTruthy();
    // The one sentence this screen must never say while it does not know.
    expect(screen.queryByText('Nobody is waiting on an invitation.')).toBeNull();

    release?.();
    expect(await screen.findByText('Nobody is waiting on an invitation.')).toBeTruthy();
  });

  it('says an empty list is empty, which is a different thing from a failed one', async () => {
    renderScreen();

    expect(await screen.findByText('Nobody is waiting on an invitation.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('says so when the list cannot be fetched, and asks again when told to', async () => {
    pending = [invite('invite-1', 'ada@example.com')];
    inviteFailures = [new ApiError('INTERNAL', 'nope')];
    const { user } = renderScreen();

    expect(await screen.findByText('Pending invitations could not be loaded')).toBeTruthy();
    // Not an empty state pretending nobody was invited, which is the one thing this section
    // must not say when it does not know.
    expect(screen.queryByText('Nobody is waiting on an invitation.')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Try again' }));

    expect(
      await screen.findByRole('button', { name: 'Revoke the invitation to ada@example.com' }),
    ).toBeTruthy();
    expect(screen.queryByText('Pending invitations could not be loaded')).toBeNull();
  });

  it('marks an invitation that ran out while the page was open, and still lets it be revoked', async () => {
    // The server never *lists* an expired invitation, so this row can only exist on a screen
    // that has been open since before the window closed. The link in that inbox is dead.
    pending = [
      invite('invite-1', 'ada@example.com', {
        expiresAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
      }),
    ];
    renderScreen();

    const row = await screen.findByRole('listitem');
    expect(within(row).getByText('Expired')).toBeTruthy();
    expect(row.textContent).toContain('ran out');
    // Live, because the server still accepts it: the revoke statement constrains accepted and
    // revoked and says nothing about expiry. Disabling it would be an invented refusal.
    const revoke = within(row).getByRole('button', {
      name: 'Revoke the invitation to ada@example.com',
    }) as HTMLButtonElement;
    expect(revoke.disabled).toBe(false);
  });
});

describe('MemberSettings · revoking', () => {
  it('revokes, takes the row away, and says so out loud', async () => {
    pending = [invite('invite-1', 'ada@example.com'), invite('invite-2', 'grace@example.com')];
    const { user } = renderScreen();

    await user.click(
      await screen.findByRole('button', { name: 'Revoke the invitation to ada@example.com' }),
    );

    await waitFor(() => expect(callsTo('mutation RevokeInvite')).toEqual([{ id: 'invite-1' }]));
    // A live region, because the proof of success is a row disappearing — which is proof of
    // nothing to somebody who was not watching that row.
    expect(
      await screen.findByText(
        'The invitation to ada@example.com has been revoked. Its link no longer works.',
      ),
    ).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: 'Revoke the invitation to ada@example.com' }),
    ).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Revoke the invitation to grace@example.com' }),
    ).toBeTruthy();
  });

  it('tells the truth when somebody accepted it first, rather than repeating "not found"', async () => {
    pending = [invite('invite-1', 'ada@example.com')];
    const { user } = renderScreen();
    await screen.findByRole('button', { name: 'Revoke the invitation to ada@example.com' });

    // Exactly what the server does when another admin's accept lands first: the statement
    // requires `accepted_at IS NULL`, so it matches no row and answers NOT_FOUND — the same
    // answer an invented id gets, deliberately, because distinguishing them would confirm an
    // invitation exists in a workspace the caller cannot see.
    sent.mockImplementationOnce(() =>
      Promise.reject(new ApiError('NOT_FOUND', 'invitation not found')),
    );
    pending = [];

    await user.click(
      screen.getByRole('button', { name: 'Revoke the invitation to ada@example.com' }),
    );

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('somebody has accepted it, or another admin has already');
    // Not the server's own words. "invitation not found" is a lie by omission to an admin
    // looking straight at the row.
    expect(alert.textContent).not.toContain('not found');
    // And the list is re-read, because a failure here means this client's copy is stale.
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'Revoke the invitation to ada@example.com' }),
      ).toBeNull(),
    );
  });
});

/**
 * The permission gate.
 *
 * Only admins may list pending invitations, because the list is a set of email addresses of
 * people who do not work here yet. Both halves are tested: the section is absent when the
 * server refuses, and the controls that would send a doomed request are absent before it is
 * asked, from the role the replica already holds.
 */
describe('MemberSettings · somebody who is not an admin', () => {
  it('is shown no invitation section and no way to invite when the server refuses the list', async () => {
    viewer.current = { id: GRACE, role: 'member' };
    inviteFailures = [new ApiError('FORBIDDEN', 'only admins can see pending invitations')];
    renderScreen([person(ADA, 'Ada Lovelace', { role: 'owner' }), person(GRACE, 'Grace Hopper')]);

    // The members table is theirs to read; the invitations are not.
    expect(await screen.findByText('Grace Hopper')).toBeTruthy();
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Pending invitations' })).toBeNull(),
    );
    // Absent, not an error message about a permission they were never going to have.
    expect(screen.queryByText(/only admins/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Invite people' })).toBeNull();
  });

  it('does not offer the invite shortcut to somebody who cannot use it', async () => {
    viewer.current = { id: GRACE, role: 'member' };
    inviteFailures = [new ApiError('FORBIDDEN', 'only admins can see pending invitations')];
    const { user } = renderScreen([person(GRACE, 'Grace Hopper')]);
    await screen.findByText('Grace Hopper');

    await user.keyboard('i');

    // A command that fails when chosen is worse than a command that is not offered.
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('offers both to an admin', async () => {
    viewer.current = { id: ADA, role: 'admin' };
    renderScreen([person(ADA, 'Ada Lovelace', { role: 'admin' })]);

    expect(await screen.findByRole('button', { name: 'Invite people' })).toBeTruthy();
    expect(invitations()).toBeTruthy();
  });
});

describe('MemberSettings · creating an invitation', () => {
  async function openDialog(user: ReturnType<typeof userEvent.setup>) {
    await user.click(await screen.findByRole('button', { name: 'Invite people' }));
    return screen.getByRole('dialog', { name: 'Invite somebody' });
  }

  it('sends the role in the spelling GraphQL wants and shows the link exactly once', async () => {
    const { user } = renderScreen();
    const dialog = await openDialog(user);

    await user.type(
      within(dialog).getByRole('textbox', { name: 'Email address' }),
      'new@example.com',
    );
    await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Role' }), 'admin');
    await user.click(within(dialog).getByRole('button', { name: 'Create invitation' }));

    const field = await screen.findByRole('textbox', { name: 'Invitation link' });
    expect((field as HTMLInputElement).value).toContain(TOKEN);
    // SCREAMING_SNAKE on the wire. Sending `"admin"` is a mutation that succeeds and changes
    // nothing, because a GraphQL enum value is case-sensitive.
    expect(callsTo('mutation InviteToWorkspace')).toEqual([
      { input: { email: 'new@example.com', role: 'ADMIN', teamIds: [] } },
    ]);

    await user.click(screen.getByRole('button', { name: 'Done' }));

    // Gone, and gone everywhere: the server keeps only a SHA-256, so this dialog was the only
    // copy that will ever exist.
    expect(screen.queryByRole('textbox', { name: 'Invitation link' })).toBeNull();
    expect(document.body.textContent).not.toContain(TOKEN);
    // And the list behind it has re-read itself.
    expect(
      await screen.findByRole('button', { name: 'Revoke the invitation to new@example.com' }),
    ).toBeTruthy();
  });

  it('warns that an address already in the workspace will get an invitation that does nothing', async () => {
    // Stored with capitals, because that is what the server stores: `normaliseEmail` trims
    // and validates and deliberately does not lower-case, so a member's address carries
    // whatever case they signed up with.
    const { user } = renderScreen([
      person(ADA, 'Ada Lovelace', { email: 'ada@example.com' }),
      person(GRACE, 'Grace Hopper', { email: 'Grace.Hopper@Example.com' }),
    ]);
    const dialog = await openDialog(user);

    // Typed in a third case, so that *both* sides of the comparison have to be folded. With
    // either one left alone this warning appears only when somebody happens to type an
    // address exactly the way it was stored — which is to say, almost never, and untraceably.
    await user.type(
      within(dialog).getByRole('textbox', { name: 'Email address' }),
      'GRACE.hopper@example.COM',
    );

    expect(within(dialog).getByText(/Grace Hopper is already in this workspace/)).toBeTruthy();
    // A warning and never a refusal: the server creates the invitation happily — nothing in
    // `InviteToWorkspace` asks whether that person is already a member — so refusing here
    // would be this screen inventing a rule the product does not have.
    const create = within(dialog).getByRole('button', {
      name: 'Create invitation',
    }) as HTMLButtonElement;
    expect(create.disabled).toBe(false);
  });

  it('warns that inviting the same address again kills the link already sent', async () => {
    // Stored and typed in different cases for the same reason as above: the address on the
    // invite row is whatever was typed when it was created, un-folded, because the server's
    // `normaliseEmail` trims and validates and does not lower-case.
    pending = [invite('invite-1', 'Ada@Example.com')];
    const { user } = renderScreen();
    await screen.findByRole('button', { name: 'Revoke the invitation to Ada@Example.com' });

    const dialog = await openDialog(user);
    await user.type(
      within(dialog).getByRole('textbox', { name: 'Email address' }),
      'ada@EXAMPLE.com',
    );

    // `RevokePendingInvitesForEmail` runs inside the same transaction as the insert, so this
    // is not a duplicate, it is a replacement — and the first link stops working silently,
    // which is the kind of thing to be told before rather than after.
    expect(within(dialog).getByText(/There is already an invitation to this address/)).toBeTruthy();
    expect(within(dialog).getByText(/earlier link stops working/)).toBeTruthy();
  });
});
