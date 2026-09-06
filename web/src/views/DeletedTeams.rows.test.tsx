/**
 * Recently deleted teams on the settings frame: the count beside the title, the intro on
 * the card, the table under it, and the restore confirmation in a live region that is in
 * the document before it has anything to say.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import type { DeletedTeamRow } from '~/features/team-lifecycle/mutations';
import { Store } from '~/store';
import { gql } from '~/sync/api';
import type { SyncEngine } from '~/sync/engine';

import { DeletedTeams } from './DeletedTeams';

vi.mock('~/sync/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/sync/api')>();
  return { ...actual, gql: vi.fn() };
});

const sent = vi.mocked(gql);

let listing: DeletedTeamRow[] = [];

function answer(query: string): unknown {
  if (query.includes('deletedTeams')) return { deletedTeams: listing };
  return {};
}

function renderScreen() {
  const store = new Store('w1');
  const engine = { store, mutate: vi.fn().mockResolvedValue({}) } as unknown as SyncEngine;
  render(
    <MemoryRouter initialEntries={['/settings/deleted-teams']}>
      <KeymapProvider>
        <EngineProvider engine={engine} status={{ phase: 'idle' }}>
          <DeletedTeams />
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );
  return userEvent.setup();
}

beforeEach(() => {
  listing = [
    { id: 't-old', key: 'OLD', name: 'Old team', deletedAt: '2026-01-01T00:00:00Z' },
    { id: 't-ops', key: 'OPS', name: 'Operations', deletedAt: '2026-01-02T00:00:00Z' },
  ];
  sent.mockReset();
  sent.mockImplementation(async (query: string) => answer(query) as never);
});

describe('DeletedTeams rows', () => {
  it('draws the title, the count, the intro and the table on one card', async () => {
    renderScreen();

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Recently deleted teams' }),
    ).toBeTruthy();
    expect(await screen.findByText('2 teams')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'issue trash' })).toBeTruthy();

    const table = screen.getByRole('table');
    expect(table.closest('section')?.textContent).toContain('kept for 30 days');
    expect(screen.getAllByRole('row')).toHaveLength(3);
    expect(screen.getByRole('columnheader', { name: 'Restore' })).toBeTruthy();
  });

  it('keeps the restore confirmation in a live region that exists before the restore', async () => {
    const user = renderScreen();
    await screen.findByText('2 teams');

    const status = screen.getByRole('status');
    expect(status.textContent).toBe('');

    await user.click(screen.getAllByRole('button', { name: 'Restore' })[0] as HTMLElement);
    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toBe('OLD is back as Old team.');
    });
    expect(screen.getByText('1 team')).toBeTruthy();
  });
});
