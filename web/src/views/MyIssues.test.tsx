/**
 * My Issues while the viewer is still arriving.
 *
 * The screen is thin on purpose — it is the issue list with a different source — so the only
 * decision it makes is what to draw before the viewer's own row lands. That used to be an
 * `EmptyState` titled "Loading your work": a wait dressed as an answer, which is the idiom
 * `EntityGate` exists to retire.
 */

import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { Store } from '~/store';
import type { EngineStatus, SyncEngine } from '~/sync/engine';

import { MyIssues } from './MyIssues';

vi.mock('./IssueList', () => ({
  IssueList: ({ heading }: { heading?: string }) => <p>list for {heading}</p>,
}));

const viewerId = vi.hoisted(() => ({ current: null as string | null }));
vi.mock('~/hooks/useViewer', () => ({
  useViewerId: () => viewerId.current,
  useViewerRole: () => 'member',
}));

function mount(status: EngineStatus) {
  const engine = { store: new Store('w1'), mutate: vi.fn() } as unknown as SyncEngine;
  render(
    <MemoryRouter>
      <KeymapProvider>
        <EngineProvider engine={engine} status={status}>
          <MyIssues />
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  viewerId.current = null;
});

describe('MyIssues', () => {
  it('waits with the shared loading treatment while the replica is filling', () => {
    mount({ phase: 'hydrating' });

    expect(screen.queryByText('Loading your work')).toBeNull();
    expect(screen.getByRole('status').textContent).toContain('Loading your issues');
  });

  it('says the viewer could not be identified once the store has settled', () => {
    mount({ phase: 'ready', connection: 'ready', pending: 0 });

    expect(screen.getByText('We cannot tell who you are')).toBeTruthy();
  });

  it('hands over to the issue list as soon as the viewer is known', () => {
    viewerId.current = 'u1';
    mount({ phase: 'hydrating' });

    expect(screen.getByText('list for My issues')).toBeTruthy();
  });
});
