/**
 * The member table itself: saying whose row an action is on, guarding Suspend, and narrowing.
 *
 * The invitations list four hundred lines above the table already argued the first of these
 * — "a list of six buttons all called 'Revoke' is a list a screen-reader user cannot act on
 * without counting" — and the table did not follow its own rule. Suspend, meanwhile, revoked
 * somebody's access mid-session on one click with no confirmation at all, in a table where
 * Remove beside it was guarded. And at a hundred people, finding one person was Cmd-F.
 *
 * A separate file from `MemberSettings.test.tsx`, which is about the invitations half, so
 * nothing in that one had to move.
 */

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
    projectUpdateReminderIntervalDays: 7,
    projectUpdateReminderWeekday: 3,
    projectUpdateReminderHour: 9,
    pulseEnabled: true,
    customerRequestsEnabled: true,
    customerRevenueUnit: '',
    customerTiers: [],
    pulseDigestCadence: 'daily',
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

let mutate: ReturnType<typeof vi.fn>;

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

  mutate = vi.fn().mockResolvedValue({});
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
  return userEvent.setup();
}

beforeEach(() => {
  viewer.current = { id: 'user-ada', role: 'owner' };
  sent.mockReset();
  sent.mockImplementation(<T,>(query: string) => Promise.resolve(answer(query) as T));
});

const ROSTER = [
  person('user-ada', 'Ada Lovelace', { role: 'owner' }),
  person('user-grace', 'Grace Hopper'),
  person('user-alan', 'Alan Turing', { role: 'admin' }),
];

describe('the member table', () => {
  it('says whose row each destructive action is on', async () => {
    renderScreen(ROSTER);

    const row = within(
      (await screen.findByRole('rowheader', { name: /Grace Hopper/u })).closest(
        'tr',
      ) as HTMLElement,
    );

    // `aria-describedby` rather than a name, because this file's older tests pin these
    // buttons' accessible names to the bare verbs. A screen reader reads "Suspend, Grace
    // Hopper"; the element list still shows twelve buttons called Suspend. See the note on
    // MemberRow — the name is the better answer and needs those assertions to move first.
    const suspend = row.getByRole('button', { name: 'Suspend' });
    const described = suspend.getAttribute('aria-describedby');
    expect(described).not.toBeNull();
    expect(document.getElementById(described as string)?.textContent).toContain('Grace Hopper');
  });

  it('asks before it suspends somebody, and sends nothing until it is answered', async () => {
    const user = renderScreen(ROSTER);

    const row = within(
      (await screen.findByRole('rowheader', { name: /Grace Hopper/u })).closest(
        'tr',
      ) as HTMLElement,
    );
    await user.click(row.getByRole('button', { name: 'Suspend' }));
    expect(mutate).not.toHaveBeenCalled();

    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('Grace Hopper');
    // The consequence names what it costs, which is what makes the question answerable.
    expect(dialog.textContent).toContain('signed out of every device');

    await user.click(screen.getByRole('button', { name: 'Suspend Grace' }));
    await waitFor(() => {
      expect(mutate).toHaveBeenCalledTimes(1);
    });
  });

  it('narrows the table by name and by email', async () => {
    const user = renderScreen(ROSTER);

    const search = await screen.findByLabelText('Search people');
    await user.type(search, 'grace');

    await waitFor(() => {
      expect(screen.queryByText('Alan Turing')).toBeNull();
    });
    expect(screen.getByText('Grace Hopper')).toBeTruthy();
  });

  it('narrows the table by role', async () => {
    const user = renderScreen(ROSTER);

    await user.selectOptions(await screen.findByLabelText('Role'), 'admin');

    await waitFor(() => {
      expect(screen.queryByText('Grace Hopper')).toBeNull();
    });
    expect(screen.getByText('Alan Turing')).toBeTruthy();
  });

  // A filtered table with no rows is not an empty workspace, and must not say it is.
  it('says nobody matched rather than nobody is here', async () => {
    const user = renderScreen(ROSTER);

    await user.type(await screen.findByLabelText('Search people'), 'zzzzz');

    expect(await screen.findByText('Nobody matches')).toBeTruthy();
    expect(screen.queryByText('Nobody here yet')).toBeNull();
  });
});
