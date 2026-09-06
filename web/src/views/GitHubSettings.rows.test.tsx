/**
 * GitHub settings as rows, seen by an admin with a connection: the row draws the label and
 * the control keeps the name, and the danger zone's own button opens the confirm dialog.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { Store, type Change } from '~/store';
import { gql } from '~/sync/api';
import type { SyncEngine } from '~/sync/engine';

import { GitHubSettings } from './GitHubSettings';

const CONNECTION = '00000000-0000-4000-8000-000000000001';
const VIEWER = '00000000-0000-4000-8000-000000000002';
const AT = '2024-01-01T00:00:00.000Z';

vi.mock('~/sync/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/sync/api')>();
  return { ...actual, gql: vi.fn() };
});

vi.mock('~/hooks/useViewer', () => ({
  useViewerId: () => VIEWER,
  useViewer: () => ({ id: VIEWER, role: 'admin' }),
}));

const sent = vi.mocked(gql);

beforeEach(() => {
  sent.mockReset();
  sent.mockImplementation(
    async (query: string) =>
      (query.includes('query GitHubSettings')
        ? {
            githubOAuthConfigured: false,
            githubCommitWebhook: { url: 'https://polaris.example/github/hook', secret: 's3cret' },
          }
        : {}) as never,
  );
});

function renderConnected() {
  const store = new Store('w');
  store.applyChanges([
    {
      v: 1,
      type: 'githubConnection',
      id: CONNECTION,
      op: 'upsert',
      actor: { type: 'system' },
      payload: {
        id: CONNECTION,
        workspaceId: 'w',
        creatorId: VIEWER,
        enabled: true,
        orgLogin: 'acme',
        branchNameFormat: '{identifier}-{title}',
        linkCommits: true,
        linkbacks: true,
        createdAt: AT,
        updatedAt: AT,
      },
    } as Change,
  ]);
  const engine = { store } as unknown as SyncEngine;
  render(
    <MemoryRouter initialEntries={['/settings/github']}>
      <KeymapProvider>
        <EngineProvider engine={engine} status={{ phase: 'idle' }}>
          <GitHubSettings />
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );
  return userEvent.setup();
}

describe('GitHubSettings rows', () => {
  it('keeps the workspace fields named after their rows, with the hint in the row', async () => {
    renderConnected();
    const org = await screen.findByRole<HTMLInputElement>('textbox', { name: 'Organisation' });
    expect(org.value).toBe('acme');
    expect(screen.getByRole('textbox', { name: 'Branch name format' })).toBeTruthy();
    expect(screen.getByText('GitHub org login, if this workspace maps to one.')).toBeTruthy();
    expect(screen.getByText('Enabled')).toBeTruthy();
  });

  it('names the toggles without a visible label of their own', async () => {
    renderConnected();
    expect(
      await screen.findByRole('checkbox', { name: 'Link commits to issues with magic words' }),
    ).toBeTruthy();
    expect(
      screen.getByRole('checkbox', {
        name: 'Post a comment on the pull request or commit when it links to an issue',
      }),
    ).toBeTruthy();
  });

  it('shows the webhook URL and secret once commits are linked', async () => {
    renderConnected();
    expect(await screen.findByText('https://polaris.example/github/hook')).toBeTruthy();
    expect(screen.getByLabelText('Webhook secret')).toBeTruthy();
  });

  it('opens the confirm dialog from the danger zone row', async () => {
    const user = renderConnected();
    await user.click(await screen.findByRole('button', { name: 'Disconnect GitHub' }));
    expect(screen.getByRole('heading', { name: 'Disconnect GitHub?' })).toBeTruthy();
  });
});
