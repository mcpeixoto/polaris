/**
 * The row menu on the member table: the ⋯ and the right-click.
 *
 * The point of these tests is that there is one menu and not two. The kebab and the
 * right-click are drawn from the same `itemsFor`, so the assertion that matters most here is
 * the boring one — the two lists are equal, item for item, in order — because that is the
 * thing a later edit to one of them silently breaks.
 *
 * Everything the menu offers is a write the row's own buttons already made, so each command
 * is followed through to the mutation it sends or the question it asks first. A menu that
 * looks right and sends the wrong variables is the failure this file exists to catch.
 */

import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { Store, type Change, type User, type Workspace } from '~/store';
import { gql } from '~/sync/api';
import type { SyncEngine } from '~/sync/engine';

import { MemberSettings } from './MemberSettings';

vi.mock('~/sync/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/sync/api')>();
  return { ...actual, gql: vi.fn() };
});

const viewer = vi.hoisted(() => ({ current: { id: 'user-ada', role: 'owner' } }));
vi.mock('~/hooks/useViewer', () => ({
  useViewerId: () => viewer.current.id,
  useViewer: () => viewer.current,
  useViewerRole: () => viewer.current.role,
}));

const sent = vi.mocked(gql);

const WORKSPACE = 'workspace-1';
const AT = '2026-01-01T00:00:00Z';

function person(id: string, name: string, over: Partial<User> = {}): User {
  return {
    id,
    workspaceId: WORKSPACE,
    name: name.toLowerCase(),
    displayName: name,
    email: `${name.split(' ')[0]?.toLowerCase() ?? name}@example.com`,
    timezone: 'Europe/Lisbon',
    role: 'member',
    status: 'active',
    kind: 'human',
    createdAt: AT,
    updatedAt: AT,
    ...over,
  } as User;
}

function workspace(): Workspace {
  return {
    id: WORKSPACE,
    name: 'Acme',
    urlKey: 'acme',
    plan: 'free',
    createdAt: AT,
    updatedAt: AT,
  } as unknown as Workspace;
}

function answer(query: string): unknown {
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
          seatsUsed: 3,
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
  if (query.includes('query Invites')) return { invites: [] };
  return {};
}

function renderScreen(users: readonly User[]) {
  const store = new Store(WORKSPACE);
  const rows: [string, Workspace | User][] = [
    ['workspace', workspace()],
    ...users.map((user): [string, User] => ['user', user]),
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
  return { mutate, user: userEvent.setup() };
}

beforeEach(() => {
  viewer.current = { id: 'user-ada', role: 'owner' };
  sent.mockReset();
  sent.mockImplementation(<T,>(query: string) => Promise.resolve(answer(query) as T));
});

/** The `<tr>` a person is on, found by the name in its row header. */
async function rowFor(name: string): Promise<HTMLElement> {
  const header = await screen.findByRole('rowheader', { name: new RegExp(name, 'u') });
  return header.closest('tr') as HTMLElement;
}

/** What one menu offers, top level only, in the order it draws them. */
function labels(menu: HTMLElement): string[] {
  return within(menu)
    .getAllByRole('menuitem')
    .map((item) => item.textContent?.trim() ?? '');
}

const ROSTER = [
  person('user-ada', 'Ada Lovelace', { role: 'owner' }),
  person('user-grace', 'Grace Hopper'),
  person('user-alan', 'Alan Turing', { role: 'admin', status: 'suspended' }),
];

/** The variables of the one mutation that was sent. */
function variablesOf(mutate: ReturnType<typeof vi.fn>): Record<string, unknown> {
  expect(mutate).toHaveBeenCalledTimes(1);
  const [request] = mutate.mock.calls[0] as [{ variables: Record<string, unknown> }];
  return request.variables;
}

describe('the member row menu', () => {
  it('opens on a right-click on the row', async () => {
    renderScreen(ROSTER);
    const row = await rowFor('Grace Hopper');

    fireEvent.contextMenu(row, { button: 2, buttons: 2, clientX: 120, clientY: 240 });

    const menu = await screen.findByRole('menu', { name: 'Options for Grace Hopper' });
    expect(labels(menu)).toEqual(['Change role', 'Suspend', 'Remove Grace']);
  });

  it('offers the same commands from the ⋯ as from the right-click', async () => {
    const { user } = renderScreen(ROSTER);
    const row = await rowFor('Grace Hopper');

    await user.click(within(row).getByRole('button', { name: 'Options for Grace Hopper' }));
    const fromKebab = labels(await screen.findByRole('menu', { name: 'Options for Grace Hopper' }));
    await user.keyboard('{Escape}');

    fireEvent.contextMenu(row, { button: 2, buttons: 2, clientX: 120, clientY: 240 });
    const fromRightClick = labels(
      await screen.findByRole('menu', { name: 'Options for Grace Hopper' }),
    );

    expect(fromRightClick).toEqual(fromKebab);
  });

  it('says Restore access on somebody who is suspended, and restores without asking', async () => {
    const { mutate, user } = renderScreen(ROSTER);
    const row = await rowFor('Alan Turing');

    await user.click(within(row).getByRole('button', { name: 'Options for Alan Turing' }));
    const menu = await screen.findByRole('menu', { name: 'Options for Alan Turing' });
    expect(labels(menu)).toEqual(['Change role', 'Restore access', 'Remove Alan']);

    await user.click(within(menu).getByRole('menuitem', { name: 'Restore access' }));

    // Giving access back takes nothing away, so it is the one command here that just goes.
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(variablesOf(mutate)).toEqual({ userId: 'user-alan', suspended: false });
  });

  it('changes a role from the submenu, in the spelling the server wants', async () => {
    const { mutate, user } = renderScreen(ROSTER);
    const row = await rowFor('Grace Hopper');

    await user.click(within(row).getByRole('button', { name: 'Options for Grace Hopper' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Change role' }));

    const submenu = await screen.findByRole('menu', { name: 'Change role' });
    // The role already held is marked rather than hidden: the submenu is where you look to
    // find out what somebody is, as well as to change it.
    expect(
      within(submenu).getByRole('menuitem', { name: 'Member' }).getAttribute('aria-current'),
    ).toBe('true');

    await user.click(within(submenu).getByRole('menuitem', { name: 'Admin' }));

    expect(variablesOf(mutate)).toEqual({ userId: 'user-grace', role: 'ADMIN' });
  });

  it('asks before it suspends, and sends nothing until it is answered', async () => {
    const { mutate, user } = renderScreen(ROSTER);
    const row = await rowFor('Grace Hopper');

    await user.click(within(row).getByRole('button', { name: 'Options for Grace Hopper' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Suspend' }));

    expect(mutate).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('Grace Hopper');
    expect(dialog.textContent).toContain('signed out of every device');
  });

  it('asks before it removes somebody, and sends nothing until it is answered', async () => {
    const { mutate, user } = renderScreen(ROSTER);
    const row = await rowFor('Grace Hopper');

    await user.click(within(row).getByRole('button', { name: 'Options for Grace Hopper' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Remove Grace' }));

    expect(mutate).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('Remove Grace Hopper from Acme?');
  });

  it('gives no menu to the row you are on, or to anybody when you are not an admin', async () => {
    renderScreen(ROSTER);

    const own = await rowFor('Ada Lovelace');
    expect(within(own).queryByRole('button', { name: 'Options for Ada Lovelace' })).toBeNull();
    // A row with nothing to offer keeps the browser's own context menu.
    fireEvent.contextMenu(own, { button: 2, buttons: 2, clientX: 10, clientY: 10 });
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('gives a plain member no menu on anybody', async () => {
    viewer.current = { id: 'user-grace', role: 'member' };
    renderScreen(ROSTER);

    const row = await rowFor('Alan Turing');
    expect(within(row).queryByRole('button', { name: 'Options for Alan Turing' })).toBeNull();
    fireEvent.contextMenu(row, { button: 2, buttons: 2, clientX: 10, clientY: 10 });
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
