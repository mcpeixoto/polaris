/**
 * The row layout: each field is a labelled row on the General card, and the field keeps its
 * accessible name while the row draws the visible one.
 */

import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { Store, type Change, type Entity } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { WorkspaceSettings } from './WorkspaceSettings';

const WORKSPACE = '01900000-0000-7000-8000-000000000001';
const AT = '2026-01-01T00:00:00.000Z';

function renderScreen() {
  const store = new Store(WORKSPACE);
  store.applyChanges([
    {
      v: 1,
      type: 'workspace',
      id: WORKSPACE,
      op: 'upsert',
      actor: { type: 'system' },
      payload: {
        id: WORKSPACE,
        name: 'Acme',
        urlKey: 'acme',
        plan: 'free',
        createdAt: AT,
        updatedAt: AT,
      } as unknown as Entity,
    },
  ] as Change[]);
  const engine = { store, mutate: vi.fn().mockResolvedValue({}) } as unknown as SyncEngine;
  render(
    <MemoryRouter>
      <KeymapProvider>
        <EngineProvider engine={engine} status={{ phase: 'idle' }}>
          <WorkspaceSettings />
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );
}

describe('WorkspaceSettings rows', () => {
  it('draws the page title, the section heading and one labelled row per field', async () => {
    renderScreen();

    expect(await screen.findByRole('heading', { level: 1, name: 'Workspace' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'General' })).toBeTruthy();

    // The control keeps its name; the row's label is drawn, not wired.
    for (const name of ['Name', 'URL key', 'Logo URL']) {
      const input = screen.getByLabelText(name) as HTMLInputElement;
      expect(input.tagName).toBe('INPUT');
    }
    // The hint moved to the row's description and is still on screen.
    expect(screen.getByText('A public image. Blank keeps the letter mark.')).toBeTruthy();
    expect(screen.getByText(/The previous address keeps working/u)).toBeTruthy();
  });
});
