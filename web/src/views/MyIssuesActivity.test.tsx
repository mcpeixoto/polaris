/**
 * My Issues Activity feed: routes through the shared tabs and renders rows that link
 * to the issue they belong to.
 */

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { Store } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { MY_ISSUES_TABS } from './MyIssues';
import { MyIssuesActivity } from './MyIssuesActivity';

const gql = vi.hoisted(() => vi.fn());

vi.mock('~/sync/api', () => ({
  gql: (...args: unknown[]) => gql(...args),
}));

function mount() {
  const engine = { store: new Store('w1'), mutate: vi.fn() } as unknown as SyncEngine;
  render(
    <MemoryRouter>
      <KeymapProvider>
        <EngineProvider
          engine={engine}
          status={{ phase: 'ready', connection: 'ready', pending: 0 }}
        >
          <MyIssuesActivity tabs={MY_ISSUES_TABS} />
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  gql.mockReset();
});

describe('MyIssuesActivity', () => {
  it('lists recent activity with links to the issue', async () => {
    gql.mockResolvedValue({
      myIssueActivity: [
        {
          id: 'h1',
          issueId: 'i1',
          identifier: 'ENG-1',
          title: 'Ship Activity',
          kind: 'created',
          fromValue: null,
          toValue: null,
          createdAt: '2026-09-13T12:00:00Z',
          actor: { type: 'user', id: 'u-ada' },
        },
      ],
    });

    mount();

    await waitFor(() => {
      expect(screen.getByText('ENG-1')).toBeTruthy();
    });
    expect(screen.getByText('Ship Activity')).toBeTruthy();
    expect(screen.getByText(/created the issue/)).toBeTruthy();
    const link = screen.getByRole('link', { name: /ENG-1/ });
    expect(link.getAttribute('href')).toBe('/issue/ENG-1');
    expect(screen.getByRole('navigation', { name: 'My issues tabs' })).toBeTruthy();
  });

  it('says so when there is nothing yet', async () => {
    gql.mockResolvedValue({ myIssueActivity: [] });
    mount();
    await waitFor(() => {
      expect(screen.getByText('No activity yet')).toBeTruthy();
    });
  });
});
