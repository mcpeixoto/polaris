import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { Store } from '~/store';
import { gql } from '~/sync/api';
import type { SyncEngine } from '~/sync/engine';

import { GitHubSettings } from './GitHubSettings';

vi.mock('~/sync/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/sync/api')>();
  return { ...actual, gql: vi.fn() };
});

vi.mock('~/hooks/useViewer', () => ({
  useViewerId: () => null,
  useViewer: () => null,
}));

const sent = vi.mocked(gql);

function answer(query: string): unknown {
  if (query.includes('query GitHubSettings')) {
    return { githubOAuthConfigured: false, githubCommitWebhook: null };
  }
  return {};
}

beforeEach(() => {
  sent.mockReset();
  sent.mockImplementation(async (query: string) => answer(query) as never);
});

function renderScreen() {
  const store = new Store('w');
  const engine = { store } as unknown as SyncEngine;
  return render(
    <MemoryRouter initialEntries={['/settings/github']}>
      <KeymapProvider>
        <EngineProvider engine={engine} status={{ phase: 'idle' }}>
          <GitHubSettings />
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );
}

describe('GitHubSettings', () => {
  it('renders without GitHub App credentials and offers a typed username', async () => {
    renderScreen();
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'GitHub' })).toBeTruthy();
    });
    expect(
      screen.getByText(/Connect with GitHub stays off/i),
    ).toBeTruthy();
    expect(screen.getByLabelText('GitHub username')).toBeTruthy();
  });
});
