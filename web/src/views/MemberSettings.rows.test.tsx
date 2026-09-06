/**
 * Members on the settings frame: the count and the invite button beside the title, Seats
 * and Pending invitations as named sections, the invitations still a landmark region, and
 * the filters on the roster's own card above its table.
 */

import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { Store, type Change, type Team, type User, type Workspace } from '~/store';
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
  if (query.includes('query Invites')) return { invites: [] };
  return {};
}

function renderScreen(users: readonly User[]) {
  const store = new Store(WORKSPACE);
  const rows: [string, Workspace | Team | User][] = [
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
  const engine = { store, mutate: vi.fn().mockResolvedValue({}) } as unknown as SyncEngine;
  render(
    <MemoryRouter initialEntries={['/settings/members']}>
      <KeymapProvider>
        <EngineProvider engine={engine} status={{ phase: 'idle' }}>
          <MemberSettings />
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  viewer.current = { id: 'user-ada', role: 'owner' };
  sent.mockReset();
  sent.mockImplementation(<T,>(query: string) => Promise.resolve(answer(query) as T));
});

describe('MemberSettings rows', () => {
  it('names the sections and keeps the invitations a landmark', async () => {
    renderScreen([
      person('user-ada', 'Ada Lovelace', { role: 'owner' }),
      person('user-grace', 'Grace Hopper'),
    ]);

    expect(await screen.findByRole('heading', { level: 1, name: 'Members' })).toBeTruthy();
    expect(screen.getByText('2 people')).toBeTruthy();
    expect(await screen.findByRole('button', { name: 'Invite people' })).toBeTruthy();

    expect(screen.getByRole('heading', { level: 2, name: 'Seats' })).toBeTruthy();
    const invitations = screen.getByRole('region', { name: 'Pending invitations' });
    expect(
      within(invitations).getByRole('heading', { level: 2, name: 'Pending invitations' }),
    ).toBeTruthy();
    expect(
      await within(invitations).findByText('Nobody is waiting on an invitation.'),
    ).toBeTruthy();
    // The revoke confirmation is a live region that exists before it says anything.
    expect(within(invitations).getByRole('status').textContent).toBe('');
  });

  it('puts the filters and the table on the same card', async () => {
    renderScreen([
      person('user-ada', 'Ada Lovelace', { role: 'owner' }),
      person('user-grace', 'Grace Hopper'),
    ]);

    const search = await screen.findByRole('search');
    const table = screen.getByRole('table');
    expect(search.closest('section')).toBe(table.closest('section'));
    expect(within(search).getByLabelText('Search people')).toBeTruthy();
    expect(within(search).getByRole('combobox', { name: 'Role' })).toBeTruthy();
    expect(within(search).getByRole('combobox', { name: 'Status' })).toBeTruthy();
  });
});
