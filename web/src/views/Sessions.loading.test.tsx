/**
 * Sessions while the listing is still in flight: placeholder rows in the shape of the table
 * that is coming, and one live region naming what is loading.
 */

import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { Store } from '~/store';
import { gql } from '~/sync/api';
import type { SyncEngine } from '~/sync/engine';

import { Sessions } from './Sessions';

vi.mock('~/sync/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/sync/api')>();
  return {
    ...actual,
    gql: vi.fn(),
    auth: { ...actual.auth, logout: vi.fn().mockResolvedValue(undefined) },
  };
});

const sent = vi.mocked(gql);

beforeEach(() => {
  sent.mockReset();
  // Never resolves, so the screen stays in the state this file is about.
  sent.mockImplementation(() => new Promise(() => {}));
});

function renderScreen() {
  const engine = { store: new Store('workspace-1'), mutate: vi.fn() } as unknown as SyncEngine;
  return render(
    <MemoryRouter>
      <KeymapProvider>
        <EngineProvider engine={engine} status={{ phase: 'idle' }}>
          <Sessions />
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );
}

describe('Sessions while loading', () => {
  it('shows placeholder rows and one live region for them', () => {
    const { container } = renderScreen();

    const regions = screen.getAllByRole('status');
    expect(regions).toHaveLength(1);
    expect(regions[0]?.getAttribute('aria-busy')).toBe('true');
    expect(regions[0]?.textContent).toBe('Loading your sessions');
    expect(container.querySelectorAll('span[aria-hidden="true"]')).toHaveLength(3);
    expect(screen.queryByRole('table')).toBeNull();
  });
});
