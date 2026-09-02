/**
 * The FAQ used to ask "Can I pay for Cloud Pro today?" twice — once from `answers()`, which
 * knows whether this deployment has a checkout, and once from the static list, which said
 * "Not yet" regardless. On a server with billing live the page answered itself "Yes" and, three
 * questions later, "No", and React logged a duplicate key on every render besides.
 *
 * So the invariant is not "that one entry is gone", it is "no question is asked twice" — which
 * holds for both deployments and survives the next question somebody adds.
 */

import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { billing } from '~/sync/api';

import { Pricing } from './Pricing';

vi.mock('~/sync/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/sync/api')>();
  return { ...actual, billing: { ...actual.billing, configured: vi.fn() } };
});

const billingConfigured = vi.mocked(billing.configured);

beforeEach(() => {
  vi.clearAllMocks();
});

function questions(): string[] {
  return Array.from(document.querySelectorAll('dt')).map((dt) => dt.textContent ?? '');
}

describe('Pricing FAQ', () => {
  for (const live of [false, true]) {
    it(`asks each question once when billing is ${live ? 'live' : 'unconfigured'}`, async () => {
      billingConfigured.mockResolvedValue(live);
      render(
        <MemoryRouter>
          <Pricing />
        </MemoryRouter>,
      );
      await screen.findByRole('heading', { name: 'Common questions.' });

      const asked = questions();
      expect(asked.length).toBeGreaterThan(3);
      expect(new Set(asked).size).toBe(asked.length);
      expect(asked.filter((q) => q.includes('Cloud Pro today'))).toHaveLength(1);
    });
  }

  /** And the surviving answer is the deployment-aware one, not the static "not yet". */
  it('answers the payment question from the deployment', async () => {
    billingConfigured.mockResolvedValue(true);
    render(
      <MemoryRouter>
        <Pricing />
      </MemoryRouter>,
    );
    expect(await screen.findByText(/^Yes\. Make an account/)).toBeTruthy();
    expect(screen.queryByText(/still being built/)).toBeNull();
  });
});
