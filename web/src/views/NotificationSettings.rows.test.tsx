/**
 * The notifications screen on the settings frame: a section per concern, every type on a
 * row that names it and says what it means, and the "you follow" cards saying so when
 * there is nothing in them.
 *
 * A separate file from `NotificationSettings.test.tsx` so nothing in that one had to move.
 */

import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { Store, type Change, type Entity } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { NotificationSettings } from './NotificationSettings';

const WORKSPACE = '01900000-0000-7000-8000-000000000001';
const VIEWER = '01900000-0000-7000-8000-000000000002';
const VIEW = '01900000-0000-7000-8000-000000000003';
const SUBSCRIPTION = '01900000-0000-7000-8000-000000000004';
const AT = '2026-01-01T00:00:00.000Z';

vi.mock('~/hooks/useViewer', () => ({
  useViewerId: () => VIEWER,
  useViewer: () => null,
}));

vi.mock('~/platform/runtime', () => ({
  requestNotificationPermission: () => Promise.resolve(true),
}));

function upsert(v: number, type: Change['type'], entity: Entity): Change {
  return { v, type, id: entity.id, op: 'upsert', actor: { type: 'system' }, payload: entity };
}

function seeded(prefs: unknown, watching = false): Store {
  const store = new Store(WORKSPACE);
  const user = {
    id: VIEWER,
    workspaceId: WORKSPACE,
    name: 'Ana',
    displayName: 'Ana',
    role: 'member',
    status: 'active',
    kind: 'human',
    notificationPrefs: prefs,
    createdAt: AT,
    updatedAt: AT,
  } as unknown as Entity;
  const changes: Change[] = [upsert(1, 'user', user)];

  if (watching) {
    changes.push(
      upsert(2, 'view', {
        id: VIEW,
        workspaceId: WORKSPACE,
        name: 'Bugs this week',
        filter: { op: 'and', children: [] },
        display: {},
        position: 'a',
        createdAt: AT,
        updatedAt: AT,
      } as unknown as Entity),
      upsert(3, 'viewSubscription', {
        id: SUBSCRIPTION,
        workspaceId: WORKSPACE,
        viewId: VIEW,
        userId: VIEWER,
        added: true,
        completed: false,
        createdAt: AT,
        updatedAt: AT,
      }),
    );
  }

  store.applyChanges(changes);
  return store;
}

function renderScreen(prefs: unknown, watching = false) {
  const store = seeded(prefs, watching);
  const engine = { store, mutate: vi.fn().mockResolvedValue({}) } as unknown as SyncEngine;
  render(
    <MemoryRouter>
      <KeymapProvider>
        <EngineProvider engine={engine} status={{ phase: 'idle' }}>
          <NotificationSettings />
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );
}

describe('NotificationSettings rows', () => {
  it('sets the page as one h1 with a section per concern', () => {
    renderScreen({});

    expect(screen.getByRole('heading', { level: 1, name: 'Notifications' })).toBeTruthy();
    expect(screen.getAllByRole('heading', { level: 2 }).map((node) => node.textContent)).toEqual([
      'Desktop',
      'Email',
      'What to notify me about',
      'Saved views you follow',
      'Projects you follow',
      'Initiatives you follow',
      'Customers you follow',
    ]);
  });

  // The type's plain-words hint moved from under the checkbox onto the row. It has to still
  // be there: the label says what the type is, the hint is what says when it fires.
  it('draws every type as a named switch with its hint beside it', () => {
    renderScreen({});

    expect(screen.getByRole('checkbox', { name: 'Priority raised' })).toBeTruthy();
    expect(
      screen.getByText('Only when it goes up. A de-prioritised issue is not news.'),
    ).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: 'Pulse digest' })).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: 'Email me for every notification' })).toBeTruthy();
    expect(
      screen.getByText('One message per event. On a busy team this is a great deal of mail.'),
    ).toBeTruthy();
  });

  // The sentence about system notifications is only true once the switch is on, so it is
  // the row's description only then.
  it('mentions system notifications only while desktop notifications are on', () => {
    renderScreen({ desktop: true });
    expect(screen.getByText(/also appear as a system notification/)).toBeTruthy();
  });

  it('keeps quiet about system notifications while desktop notifications are off', () => {
    renderScreen({});
    expect(screen.queryByText(/also appear as a system notification/)).toBeNull();
  });

  it('says so in each card when nothing is followed', () => {
    renderScreen({});

    expect(screen.getByText('You are not watching any saved views.')).toBeTruthy();
    expect(screen.getByText('You are not watching any projects.')).toBeTruthy();
    expect(screen.getByText('You are not watching any initiatives.')).toBeTruthy();
    expect(screen.getByText('You are not watching any customers.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Unsubscribe' })).toBeNull();
  });

  it('draws a followed view as a row named for it, with what it sends and a way out', () => {
    renderScreen({}, true);

    expect(screen.getByText('Bugs this week')).toBeTruthy();
    expect(screen.getByText('issues added')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Unsubscribe' })).toBeTruthy();
    expect(screen.queryByText('You are not watching any saved views.')).toBeNull();
  });
});
