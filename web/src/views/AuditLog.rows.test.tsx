/**
 * The audit log page on the settings frame: the explanation sits on the first card, and
 * the plan block keeps its way out.
 */

import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { Store } from '~/store';
import { gql } from '~/sync/api';
import type { SyncEngine } from '~/sync/engine';

import { AuditLog } from './AuditLog';

const WORKSPACE = '00000000-0000-7000-8000-0000000000ff';

vi.mock('~/sync/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/sync/api')>();
  return { ...actual, gql: vi.fn() };
});

const sent = vi.mocked(gql);

function answer(query: string): unknown {
  if (query.includes('query Entitlements')) {
    return {
      workspace: {
        id: WORKSPACE,
        name: 'Acme',
        plan: 'free',
        planExpiresAt: null,
        planLapsedAt: null,
        seatLimit: null,
        entitlements: {
          plan: 'free',
          seatLimit: null,
          seatsUsed: 2,
          teamLimit: null,
          historyDays: null,
          privateTeams: false,
          subTeams: false,
          multiLevelSubTeams: false,
          customViews: true,
          apiKeys: true,
          sso: false,
          auditLog: false,
          slas: false,
          slack: true,
          lapsed: false,
        },
      },
    };
  }
  return {};
}

beforeEach(() => {
  sent.mockReset();
  sent.mockImplementation(<T,>(query: string) => Promise.resolve(answer(query) as T));
});

describe('AuditLog rows', () => {
  it('explains what is recorded on the first card, and says which plan has it', async () => {
    const engine = { store: new Store(WORKSPACE), mutate: vi.fn() } as unknown as SyncEngine;
    render(
      <MemoryRouter>
        <KeymapProvider>
          <EngineProvider engine={engine} status={{ phase: 'idle' }}>
            <AuditLog />
          </EngineProvider>
        </KeymapProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { level: 1, name: 'Audit log' })).toBeTruthy();
    const heading = screen.getByRole('heading', { level: 2, name: 'What is recorded' });
    expect(heading.closest('section')?.textContent).toContain(
      'Payloads never contain a credential',
    );
    // The gate is a status, not an alert, and it keeps its link out.
    const block = await screen.findByRole('status');
    expect(block.textContent).toMatch(/plan/iu);
  });
});
