import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { Store } from '~/store';
import { gql } from '~/sync/api';
import type { SyncEngine } from '~/sync/engine';

import { SlackSettings } from './SlackSettings';

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
  if (query.includes('query SlackInbound')) {
    return { slackInbound: null };
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
    <MemoryRouter initialEntries={['/settings/slack']}>
      <KeymapProvider>
        <EngineProvider engine={engine} status={{ phase: 'idle' }}>
          <SlackSettings />
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );
}

describe('SlackSettings', () => {
  it('renders the Slack heading', async () => {
    renderScreen();
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Slack' })).toBeTruthy();
    });
  });
});
