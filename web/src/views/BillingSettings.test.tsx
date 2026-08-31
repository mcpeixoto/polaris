import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { billing } from '~/sync/api';
import { useViewer } from '~/hooks/useViewer';
import { openExternalUrl } from '~/platform/runtime';

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
const leave = vi.mocked(openExternalUrl);

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
  viewer.mockReturnValue({ id: 'u1', role: 'owner' } as any);
});

describe('BillingSettings', () => {
  it('sends an admin to Stripe when they upgrade', async () => {
    api.state.mockResolvedValue(state());
    api.checkout.mockResolvedValue('https://checkout.stripe.com/c/pay/cs_1');

    render(<BillingSettings />);
    const upgrade = await screen.findByRole('button', { name: 'Upgrade to Pro' });
    await userEvent.click(upgrade);

    await waitFor(() =>
      expect(leave).toHaveBeenCalledWith('https://checkout.stripe.com/c/pay/cs_1'),
    );
    expect(api.checkout).toHaveBeenCalledWith('monthly');
  });

  it('opens the annual price from its own button', async () => {
    api.state.mockResolvedValue(state());
    api.checkout.mockResolvedValue('https://checkout.stripe.com/c/pay/cs_2');

    render(<BillingSettings />);
    await userEvent.click(await screen.findByRole('button', { name: 'Pay yearly' }));

    await waitFor(() => expect(api.checkout).toHaveBeenCalledWith('yearly'));
  });

  /**
   * A workspace already on Pro must not be offered a second subscription — buying twice is
   * two invoices for one product and a support conversation nobody wants to have.
   */
  it('offers management rather than a second checkout once a plan is live', async () => {
    api.state.mockResolvedValue(
      state({
        plan: 'pro',
        status: 'active',
        seatsPaid: 4,
        hasSubscription: true,
        canManage: true,
      }),
    );
    api.portal.mockResolvedValue('https://billing.stripe.com/p/session/x');

    render(<BillingSettings />);
    const manage = await screen.findByRole('button', { name: 'Manage billing' });
    expect(screen.queryByRole('button', { name: 'Upgrade to Pro' })).toBeNull();

    await userEvent.click(manage);
    await waitFor(() =>
      expect(leave).toHaveBeenCalledWith('https://billing.stripe.com/p/session/x'),
    );
  });

  it('says a lapsed plan is readable and paused, not gone', async () => {
    api.state.mockResolvedValue(
      state({
        plan: 'pro',
        status: 'past_due',
        hasSubscription: true,
        canManage: true,
        lapsed: true,
      }),
    );

    render(<BillingSettings />);
    expect((await screen.findByRole('alert')).textContent).toMatch(/still readable/i);
  });

  /**
   * Every self-host. There is nothing to buy, and a button that 400s would be worse than
   * the sentence.
   */
  it('says so when the server has no payment provider', async () => {
    api.state.mockResolvedValue(state({ enabled: false }));

    render(<BillingSettings />);
    expect(await screen.findByText(/no payment provider configured/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Upgrade to Pro' })).toBeNull();
  });

  it('refuses a member without asking the server', async () => {
    viewer.mockReturnValue({ id: 'u2', role: 'member' } as any);

    render(<BillingSettings />);
    expect(await screen.findByText(/only a workspace administrator/i)).toBeTruthy();
    expect(api.state).not.toHaveBeenCalled();
  });

  it('reports a failed checkout instead of a blank screen', async () => {
    api.state.mockResolvedValue(state());
    api.checkout.mockRejectedValue(new Error('network'));

    render(<BillingSettings />);
    await userEvent.click(await screen.findByRole('button', { name: 'Upgrade to Pro' }));

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(leave).not.toHaveBeenCalled();
  });
});
