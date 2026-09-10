/**
 * My Issues tabs: Assigned / Created / Subscribed pick the right IssueList source.
 *
 * Activity is intentionally absent — see the screen module. The loading / identity
 * cases stay in MyIssues.test.tsx; this file is only the tab → source mapping and that
 * the tab row is handed to the list.
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
});

describe('myIssuesTabFromPath', () => {
  it('reads Assigned, Created and Subscribed from the path', () => {
    expect(myIssuesTabFromPath('/my-issues')).toBe('assigned');
    expect(myIssuesTabFromPath('/my-issues/created')).toBe('created');
    expect(myIssuesTabFromPath('/my-issues/subscribed')).toBe('subscribed');
  });
});

describe('myIssuesSource', () => {
  it('maps each tab to the matching list source', () => {
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

  it('offers link tabs for Assigned, Created and Subscribed', () => {
    mount('/my-issues');
    expect(captured.tabs?.map((tab) => tab.id)).toEqual(['assigned', 'created', 'subscribed']);
    expect(captured.tabs?.map((tab) => tab.to)).toEqual([
      '/my-issues',
      '/my-issues/created',
      '/my-issues/subscribed',
    ]);
  });
});
