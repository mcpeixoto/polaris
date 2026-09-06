/**
 * GitLab settings as rows, seen by an admin with a connection: the row draws the label and
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

import { GitLabSettings } from './GitLabSettings';

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
      (query.includes('query GitLabSettings')
        ? { gitlabWebhook: { url: 'https://polaris.example/gitlab/hook', secret: 't0ken' } }
        : {}) as never,
  );
});

function renderConnected() {
  const store = new Store('w');
  store.applyChanges([
    {
      v: 1,
      type: 'gitlabConnection',
      id: CONNECTION,
      op: 'upsert',
      actor: { type: 'system' },
      payload: {
        id: CONNECTION,
        workspaceId: 'w',
        creatorId: VIEWER,
        enabled: true,
        instanceUrl: 'https://gitlab.example',
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
    <MemoryRouter initialEntries={['/settings/gitlab']}>
      <KeymapProvider>
        <EngineProvider engine={engine} status={{ phase: 'idle' }}>
          <GitLabSettings />
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );
  return userEvent.setup();
}

describe('GitLabSettings rows', () => {
  it('keeps the workspace fields named after their rows, with the hint in the row', async () => {
    renderConnected();
    const url = await screen.findByRole<HTMLInputElement>('textbox', { name: 'Instance URL' });
    expect(url.value).toBe('https://gitlab.example');
    expect(screen.getByRole('textbox', { name: 'Access token' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Branch name format' })).toBeTruthy();
    expect(
      screen.getByText('Leave blank to keep the current token. Saving a new one replaces it.'),
    ).toBeTruthy();
  });

  it('names the toggles and puts their explanation in the row', async () => {
    renderConnected();
    expect(
      await screen.findByRole('checkbox', { name: 'Link commits to issues with magic words' }),
    ).toBeTruthy();
    expect(screen.getByText(/Requires Push events on the webhook/)).toBeTruthy();
    expect(
      screen.getByRole('checkbox', {
        name: 'Post a note on the merge request or commit when it links to an issue',
      }),
    ).toBeTruthy();
  });

  it('shows the webhook URL and token', async () => {
    renderConnected();
    expect(await screen.findByText('https://polaris.example/gitlab/hook')).toBeTruthy();
    expect(screen.getByLabelText('Webhook token')).toBeTruthy();
  });

  it('opens the confirm dialog from the danger zone row', async () => {
    const user = renderConnected();
    await user.click(await screen.findByRole('button', { name: 'Disconnect GitLab' }));
    expect(screen.getByRole('heading', { name: 'Disconnect GitLab?' })).toBeTruthy();
  });
});
