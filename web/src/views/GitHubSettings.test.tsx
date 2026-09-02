import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { Store } from '~/store';
import { ApiError, gql } from '~/sync/api';
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

/** Types a username and submits, which is the only save a non-admin viewer can run here. */
async function submitUsername(): Promise<HTMLElement> {
  const field = await screen.findByLabelText('GitHub username');
  fireEvent.change(field, { target: { value: 'octocat' } });
  const button = screen.getByRole('button', { name: 'Save username' });
  fireEvent.click(button);
  const section = button.closest('section');
  if (section === null) throw new Error('the login form is not inside a section');
  return section;
}

describe('GitHubSettings', () => {
  it('renders without GitHub App credentials and offers a typed username', async () => {
    renderScreen();
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'GitHub' })).toBeTruthy();
    });
    expect(screen.getByText(/Connect with GitHub stays off/i)).toBeTruthy();
    expect(screen.getByLabelText('GitHub username')).toBeTruthy();
  });

  it('puts a refused save beside the form that produced it, not in the page banner', async () => {
    sent.mockImplementation(async (query: string) => {
      if (query.includes('query GitHubSettings')) return answer(query) as never;
      throw new ApiError('VALIDATION', 'That GitHub account is already linked.');
    });

    renderScreen();
    const section = await submitUsername();

    const message = await screen.findByText('That GitHub account is already linked.');
    // The proof that it is section-level and not page-level: the alert and the button that
    // caused it are inside the same section.
    expect(section.contains(message)).toBe(true);
    expect(within(section).getByRole('button', { name: 'Save username' })).toBeTruthy();
  });

  it('announces a landed save through the section indicator', async () => {
    renderScreen();
    const section = await submitUsername();

    await waitFor(() => {
      expect(within(section).getByRole('status').textContent).toBe('Saved');
    });
  });
});
