/**
 * The audit log screen, in the COMMUNITY edition.
 *
 * Which is the point of this file. `@ee/audit` resolves to the stub here — vitest reads the
 * same alias the bundler does, from web/edition.ts — so these tests assert what a
 * self-hosted AGPL build actually shows somebody who opens the page. The commercial panel's
 * own tests live beside it in ee/web and only run under POLARIS_EDITION=ee.
 *
 * The two facts worth pinning down are both about what the screen refuses to imply: that the
 * page exists at all on a plan without the feature, and that a build with no audit log says
 * so rather than rendering an empty table.
 */

import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { Store } from '~/store';
import { gql } from '~/sync/api';
import type { SyncEngine } from '~/sync/engine';

import { isEnterprise } from '../../edition';
import { AuditLog } from './AuditLog';

const WORKSPACE = '00000000-0000-7000-8000-0000000000ff';

// The network client is the screen's only data path, so the network client is what stands
// in. ApiError is left real: it is the type the code branches on, and a stub class would let
// that branch rot unnoticed.
vi.mock('~/sync/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/sync/api')>();
  return { ...actual, gql: vi.fn() };
});

const sent = vi.mocked(gql);

/** Which plan the fake server reports. Set per test. */
let plan: 'free' | 'enterprise' = 'free';

function answer(query: string): unknown {
  if (query.includes('query Entitlements')) {
    return {
      workspace: {
        id: WORKSPACE,
        name: 'Acme',
        plan,
        planExpiresAt: null,
        planLapsedAt: null,
        seatLimit: null,
        entitlements: {
          plan,
          seatLimit: null,
          seatsUsed: 2,
          teamLimit: null,
          historyDays: null,
          privateTeams: plan === 'enterprise',
          subTeams: plan === 'enterprise',
          multiLevelSubTeams: plan === 'enterprise',
          customViews: true,
          apiKeys: true,
          sso: plan === 'enterprise',
          auditLog: plan === 'enterprise',
          slas: plan === 'enterprise',
          slack: true,
          lapsed: false,
        },
      },
    };
  }
  throw new Error(`the screen sent a document these tests do not answer: ${query.slice(0, 60)}`);
}

/** The variables of every call that carried the named operation, in order. */
function callsTo(operation: string): (Record<string, unknown> | undefined)[] {
  return sent.mock.calls
    .filter(([query]) => query.includes(operation))
    .map(([, variables]) => variables);
}

function renderScreen() {
  const store = new Store(WORKSPACE);
  const engine = { store, mutate: vi.fn().mockResolvedValue({}) } as unknown as SyncEngine;

  render(
    <MemoryRouter>
      <KeymapProvider>
        <EngineProvider engine={engine} status={{ phase: 'idle' }}>
          <AuditLog />
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );
}

// Skipped in an enterprise run, and the skip is the honest thing rather than a convenience.
//
// Two of these assertions are about the ABSENCE of the commercial module — no query sent, a
// message where the table would be. Under POLARIS_EDITION=ee `@ee/audit` is the real panel,
// so both are false, and they should be: the enterprise behaviour is asserted in
// ee/web/audit/panel.test.tsx. Making them pass in both editions would mean weakening them
// until they no longer said anything about either.
describe.skipIf(isEnterprise)('AuditLog (community edition)', () => {
  beforeEach(() => {
    plan = 'free';
    sent.mockReset();
    sent.mockImplementation(<T,>(query: string) => Promise.resolve(answer(query) as T));
  });

  it('is reachable on a plan without the feature, and explains what it would record', async () => {
    renderScreen();

    // Disabled with a reason, never hidden. An admin who cannot use the audit log should
    // still be able to find out that the product has one and what goes in it — the
    // alternative is that they assume they have an audit trail until an incident proves
    // otherwise.
    expect(await screen.findByRole('heading', { name: 'Audit log' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'What is recorded' })).toBeTruthy();
  });

  it('never sends the audit query from a build that has no audit log', async () => {
    plan = 'enterprise';
    renderScreen();

    await screen.findByRole('heading', { name: 'Audit log' });
    // The stub does not fetch. This is the bundle-level half of the licence boundary
    // restated as a test: a community build has no audit query in it to send, so if this
    // ever fails, the commercial module has leaked into the core bundle.
    expect(callsTo('query EnterpriseAuditLog')).toHaveLength(0);
  });

  it('says the build does not contain the feature, rather than showing an empty log', async () => {
    // An entitled plan, so nothing is gating the screen — the only thing missing is the
    // code. An empty table here would read as "nothing has happened in this workspace",
    // which on this one screen is the answer somebody would act on.
    plan = 'enterprise';
    renderScreen();

    expect(await screen.findByText('Not included in this build')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });
});
