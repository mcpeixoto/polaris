/**
 * The proposal form as rows: the row draws the label, so the field has to carry the same
 * name itself for anyone who cannot see the row.
 */

import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { fetchIntegrationSubmissions } from '~/features/integrations/submit';
import { Store } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { IntegrationDirectory } from './IntegrationDirectory';

const AT = '2026-01-01T00:00:00.000Z';

vi.mock('~/hooks/useViewer', () => ({
  useViewerId: () => 'u1',
  useViewer: () => ({
    id: 'u1',
    workspaceId: 'w1',
    name: 'ada',
    displayName: 'Ada Lovelace',
    timezone: 'UTC',
    role: 'admin',
    status: 'active',
    kind: 'human',
    createdAt: AT,
    updatedAt: AT,
  }),
}));

vi.mock('~/features/integrations/submit', () => ({
  fetchIntegrationSubmissions: vi.fn(),
  submitIntegration: vi.fn(),
}));

function renderDirectory() {
  const store = new Store('w1');
  const engine = { store, mutate: vi.fn() } as unknown as SyncEngine;
  render(
    <MemoryRouter>
      <KeymapProvider>
        <EngineProvider engine={engine} status={{ phase: 'idle' }}>
          <IntegrationDirectory />
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );
}

describe('IntegrationDirectory rows', () => {
  beforeEach(() => {
    vi.mocked(fetchIntegrationSubmissions).mockReset();
    vi.mocked(fetchIntegrationSubmissions).mockResolvedValue([]);
  });

  it('keeps the proposal fields named after their rows', async () => {
    renderDirectory();
    expect(await screen.findByRole('textbox', { name: 'Name' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Website' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'What it does' })).toBeTruthy();
  });

  it('keeps the category headings one level under the section heading', async () => {
    renderDirectory();
    const chat = await screen.findByRole('heading', { name: 'Chat' });
    expect(chat.tagName).toBe('H3');
    expect(screen.getByRole('heading', { level: 2, name: 'Propose an integration' })).toBeTruthy();
  });

  it('lists a proposal with its website as a link', async () => {
    vi.mocked(fetchIntegrationSubmissions).mockResolvedValue([
      {
        id: 'p1',
        name: 'Zapier',
        website: 'https://zapier.com',
        summary: 'Glue',
        createdAt: AT,
      } as never,
    ]);
    renderDirectory();
    const link = await screen.findByRole('link', { name: 'Zapier' });
    expect(link.getAttribute('href')).toBe('https://zapier.com');
  });
});
