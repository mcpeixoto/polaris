/**
 * The team index on the section card: one row per team, and the empty state in a row of
 * its own rather than loose against the card edge.
 */

import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { Store, type Change, type Entity } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { TeamsSettings } from './TeamsSettings';

const WORKSPACE = '01900000-0000-7000-8000-000000000001';
const AT = '2026-01-01T00:00:00.000Z';

function team(id: string, key: string, name: string): Entity {
  return {
    id,
    workspaceId: WORKSPACE,
    key,
    name,
    timezone: 'Europe/Lisbon',
    private: false,
    estimateScale: 'none',
    cyclesEnabled: false,
    triageEnabled: false,
    createdAt: AT,
    updatedAt: AT,
  } as unknown as Entity;
}

function renderScreen(teams: readonly Entity[]) {
  const store = new Store(WORKSPACE);
  store.applyChanges(
    teams.map((payload, index): Change => ({
      v: index + 1,
      type: 'team',
      id: (payload as { id: string }).id,
      op: 'upsert',
      actor: { type: 'system' },
      payload,
    })),
  );
  const engine = { store, mutate: vi.fn().mockResolvedValue({}) } as unknown as SyncEngine;
  render(
    <MemoryRouter initialEntries={['/settings/teams']}>
      <KeymapProvider>
        <EngineProvider engine={engine} status={{ phase: 'idle' }}>
          <TeamsSettings />
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );
}

describe('TeamsSettings rows', () => {
  it('lists every team as one row that links to its settings', async () => {
    renderScreen([team('t-eng', 'ENG', 'Engineering'), team('t-des', 'DES', 'Design')]);

    expect(await screen.findByRole('heading', { level: 1, name: 'Teams' })).toBeTruthy();
    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    // Sorted by key, so Design leads.
    expect(within(rows[0] as HTMLElement).getByRole('link', { name: 'Design' })).toBeTruthy();
    expect(within(rows[0] as HTMLElement).getByText('0 members')).toBeTruthy();
  });

  it('offers the page action beside the title and again from the empty state', async () => {
    renderScreen([]);
    // One in the page header, one as the empty state's way out — the same command twice.
    expect(await screen.findAllByRole('button', { name: 'New team' })).toHaveLength(2);
    expect(screen.getByText('No teams yet')).toBeTruthy();
  });
});
