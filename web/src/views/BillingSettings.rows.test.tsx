/**
 * Billing on the settings frame: the plan's facts are rows on one card, the portal button
 * sits beside that card's heading, and a lapse is that section's own alert.
 */

import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { billing } from '~/sync/api';
import { useViewer } from '~/hooks/useViewer';

import { BillingSettings } from './BillingSettings';

vi.mock('~/sync/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/sync/api')>();
  return {
    ...actual,
    billing: { state: vi.fn(), checkout: vi.fn(), portal: vi.fn(), configured: vi.fn() },
  };
});
vi.mock('~/hooks/useViewer', () => ({ useViewer: vi.fn() }));
vi.mock('~/platform/runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/platform/runtime')>();
  return { ...actual, openExternalUrl: vi.fn() };
});

const api = vi.mocked(billing);
const viewer = vi.mocked(useViewer);

function state(over: Partial<Awaited<ReturnType<typeof billing.state>>> = {}) {
  return {
    enabled: true,
    plan: 'free',
    status: 'canceled',
    seatsUsed: 4,
    seatsPaid: null,
    currentPeriodEnd: null,
    lapsed: false,
    hasSubscription: false,
    canManage: false,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  viewer.mockReturnValue({ id: 'u1', role: 'owner' } as never);
});

describe('BillingSettings rows', () => {
  it('draws the plan facts as rows and the upgrade under its price', async () => {
    api.state.mockResolvedValue(state());
    render(<BillingSettings />);

    expect(await screen.findByRole('heading', { level: 1, name: 'Billing' })).toBeTruthy();
    const plan = screen.getByRole('heading', { level: 2, name: 'Plan' }).closest('section');
    expect(plan).not.toBeNull();
    expect(within(plan as HTMLElement).getByText('Free')).toBeTruthy();
    expect(within(plan as HTMLElement).getByText('4')).toBeTruthy();

    const upgrade = screen.getByRole('heading', { level: 2, name: 'Upgrade' }).closest('section');
    expect(upgrade?.textContent).toMatch(/per person per month/u);
    expect(
      within(upgrade as HTMLElement).getByRole('button', { name: 'Upgrade to Pro' }),
    ).toBeTruthy();
    expect(within(upgrade as HTMLElement).getByRole('button', { name: 'Pay yearly' })).toBeTruthy();
  });

  it('keeps the portal beside the plan heading and the lapse as that section’s alert', async () => {
    api.state.mockResolvedValue(
      state({
        plan: 'pro',
        status: 'past_due',
        seatsPaid: 4,
        hasSubscription: true,
        canManage: true,
        lapsed: true,
        currentPeriodEnd: '2026-02-01T00:00:00Z',
      }),
    );
    render(<BillingSettings />);

    const plan = (await screen.findByRole('heading', { level: 2, name: 'Plan' })).closest(
      'section',
    ) as HTMLElement;
    expect(within(plan).getByRole('button', { name: 'Manage billing' })).toBeTruthy();
    expect(within(plan).getByRole('alert').textContent).toMatch(/still readable/u);
    expect(within(plan).getByText('Payment failed')).toBeTruthy();
    expect(within(plan).getByText('4 of 4 billed')).toBeTruthy();
    expect(within(plan).getByText('Renews')).toBeTruthy();
    expect(screen.queryByRole('heading', { level: 2, name: 'Upgrade' })).toBeNull();
  });

  it('keeps the page title over the refusal and the no-provider note', async () => {
    viewer.mockReturnValue({ id: 'u2', role: 'member' } as never);
    render(<BillingSettings />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Billing' })).toBeTruthy();
    expect(screen.getByText(/only a workspace administrator/iu)).toBeTruthy();
  });
});
