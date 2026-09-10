/**
 * The access token field is the one place in the product where a long-lived, api-scoped
 * credential is typed in. It must not end up in the browser's autofill store or be sent to
 * a spellchecker, on either the connect form or the connected workspace form.
 */

import { render, screen } from '@testing-library/react';
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

function renderSettings(connected: boolean) {
  const store = new Store('w');
  if (connected) {
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
  }
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
}

describe('GitLab access token field', () => {
  it('keeps the token out of autofill and the spellchecker once connected', async () => {
    renderSettings(true);
    const token = await screen.findByRole<HTMLInputElement>('textbox', { name: 'Access token' });
    expect(token.getAttribute('autocomplete')).toBe('off');
    expect(token.getAttribute('spellcheck')).toBe('false');
  });

  it('does the same on the connect form', async () => {
    renderSettings(false);
    const token = await screen.findByRole<HTMLInputElement>('textbox', { name: 'Access token' });
    expect(token.getAttribute('autocomplete')).toBe('off');
    expect(token.getAttribute('spellcheck')).toBe('false');
  });
});
