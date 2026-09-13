/**
 * My Issues tabs: Assigned / Created / Subscribed / Activity.
 *
 * Assigned / Created / Subscribed pick the right IssueList source; Activity renders its
 * own feed. The loading / identity cases stay in MyIssues.test.tsx; this file is the
 * tab → source mapping and that the tab row is handed down.
 */

import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { Store } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { MyIssues, myIssuesSource, myIssuesTabFromPath } from './MyIssues';

const captured = vi.hoisted(() => ({
  source: null as { kind: string; userId?: string } | null,
  tabs: null as readonly { id: string; to?: string }[] | null,
  activityTabs: null as readonly { id: string; to?: string }[] | null,
}));

vi.mock('./IssueList', () => ({
  IssueList: ({
    source,
    tabs,
    heading,
  }: {
    source: { kind: string; userId?: string };
    tabs?: readonly { id: string; to?: string }[];
    heading?: string;
  }) => {
    captured.source = source;
    captured.tabs = tabs ?? null;
    return <p>list for {heading}</p>;
  },
}));

vi.mock('./MyIssuesActivity', () => ({
  MyIssuesActivity: ({ tabs }: { tabs: readonly { id: string; to?: string }[] }) => {
    captured.activityTabs = tabs;
    return <p>activity feed</p>;
  },
}));

vi.mock('~/hooks/useViewer', () => ({
  useViewerId: () => 'user-ada',
  useViewerRole: () => 'member',
}));

function mount(path: string) {
  const engine = { store: new Store('w1'), mutate: vi.fn() } as unknown as SyncEngine;
  render(
    <MemoryRouter initialEntries={[path]}>
      <KeymapProvider>
        <EngineProvider
          engine={engine}
          status={{ phase: 'ready', connection: 'ready', pending: 0 }}
        >
          <Routes>
            <Route path="/my-issues" element={<MyIssues />} />
            <Route path="/my-issues/created" element={<MyIssues />} />
            <Route path="/my-issues/subscribed" element={<MyIssues />} />
            <Route path="/my-issues/activity" element={<MyIssues />} />
          </Routes>
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  captured.source = null;
  captured.tabs = null;
  captured.activityTabs = null;
});

describe('myIssuesTabFromPath', () => {
  it('reads Assigned, Created, Subscribed and Activity from the path', () => {
    expect(myIssuesTabFromPath('/my-issues')).toBe('assigned');
    expect(myIssuesTabFromPath('/my-issues/created')).toBe('created');
    expect(myIssuesTabFromPath('/my-issues/subscribed')).toBe('subscribed');
    expect(myIssuesTabFromPath('/my-issues/activity')).toBe('activity');
  });
});

describe('myIssuesSource', () => {
  it('maps each list tab to the matching list source', () => {
    expect(myIssuesSource('assigned', 'u1')).toEqual({ kind: 'assignee', userId: 'u1' });
    expect(myIssuesSource('created', 'u1')).toEqual({ kind: 'creator', userId: 'u1' });
    expect(myIssuesSource('subscribed', 'u1')).toEqual({ kind: 'subscriber', userId: 'u1' });
  });
});

describe('MyIssues tabs', () => {
  it('hands the Assigned source to the list on /my-issues', () => {
    mount('/my-issues');
    expect(screen.getByText('list for My issues')).toBeTruthy();
    expect(captured.source).toEqual({ kind: 'assignee', userId: 'user-ada' });
  });

  it('hands the Created source to the list on /my-issues/created', () => {
    mount('/my-issues/created');
    expect(captured.source).toEqual({ kind: 'creator', userId: 'user-ada' });
  });

  it('hands the Subscribed source to the list on /my-issues/subscribed', () => {
    mount('/my-issues/subscribed');
    expect(captured.source).toEqual({ kind: 'subscriber', userId: 'user-ada' });
  });

  it('renders the Activity feed on /my-issues/activity', () => {
    mount('/my-issues/activity');
    expect(screen.getByText('activity feed')).toBeTruthy();
    expect(captured.source).toBeNull();
    expect(captured.activityTabs?.map((tab) => tab.id)).toEqual([
      'assigned',
      'created',
      'subscribed',
      'activity',
    ]);
  });

  it('offers link tabs for Assigned, Created, Subscribed and Activity', () => {
    mount('/my-issues');
    expect(captured.tabs?.map((tab) => tab.id)).toEqual([
      'assigned',
      'created',
      'subscribed',
      'activity',
    ]);
    expect(captured.tabs?.map((tab) => tab.to)).toEqual([
      '/my-issues',
      '/my-issues/created',
      '/my-issues/subscribed',
      '/my-issues/activity',
    ]);
  });
});
