/**
 * The catalogue's two jobs: being scannable, and telling the truth about the proposals list.
 *
 * Seventeen rows in one flat list is a list nobody scans, and the `category` every entry
 * already carried was going nowhere. The proposals list, meanwhile, rendered only when it had
 * rows — so a member who had just proposed something watched the form clear and nothing else
 * happen, which is indistinguishable from a post that went nowhere.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { fetchIntegrationSubmissions } from '~/features/integrations/submit';
import { Store } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { IntegrationDirectory } from './IntegrationDirectory';

const WORKSPACE = 'w1';
const AT = '2026-01-01T00:00:00.000Z';

vi.mock('~/hooks/useViewer', () => ({
  useViewerId: () => 'u1',
  useViewer: () => ({
    id: 'u1',
    workspaceId: WORKSPACE,
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
  const store = new Store(WORKSPACE);
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
  return userEvent.setup();
}

describe('IntegrationDirectory', () => {
  beforeEach(() => {
    vi.mocked(fetchIntegrationSubmissions).mockReset();
    vi.mocked(fetchIntegrationSubmissions).mockResolvedValue([]);
  });

  it('groups the catalogue by category instead of listing seventeen rows flat', async () => {
    renderDirectory();
    expect(await screen.findByRole('heading', { name: 'Source control' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Chat' })).toBeTruthy();
    // Both source-control entries sit under the one heading.
    expect(screen.getByRole('link', { name: /GitHub/ })).toBeTruthy();
    expect(screen.getByRole('link', { name: /GitLab/ })).toBeTruthy();
  });

  it('filters by name and by category, and says so when nothing matches', async () => {
    const user = renderDirectory();
    const filter = await screen.findByLabelText('Filter integrations');

    await user.type(filter, 'gitlab');
    await waitFor(() => expect(screen.queryByText('GitHub')).toBeNull());
    expect(screen.getByText('GitLab')).toBeTruthy();

    await user.clear(filter);
    await user.type(filter, 'chat');
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Chat' })).toBeTruthy());
    expect(screen.queryByRole('heading', { name: 'Source control' })).toBeNull();

    await user.clear(filter);
    await user.type(filter, 'zzz');
    expect(await screen.findByText('No integration matches')).toBeTruthy();
  });

  it('says the proposals list is empty rather than rendering nothing at all', async () => {
    renderDirectory();
    expect(await screen.findByText('No proposals yet')).toBeTruthy();
  });

  it('offers a retry when the proposals fetch is refused', async () => {
    vi.mocked(fetchIntegrationSubmissions).mockRejectedValue(new Error('offline'));
    const user = renderDirectory();

    expect(await screen.findByText('Proposals could not be loaded')).toBeTruthy();

    vi.mocked(fetchIntegrationSubmissions).mockResolvedValue([]);
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('No proposals yet')).toBeTruthy();
  });

  it('names its outcome rather than saying Submit', async () => {
    renderDirectory();
    expect(await screen.findByRole('button', { name: 'Propose integration' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Submit' })).toBeNull();
  });
});
