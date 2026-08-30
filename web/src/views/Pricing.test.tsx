import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { billing } from '~/sync/api';

import { Pricing } from './Pricing';

/**
 * The page asks the server whether it can take a payment. Unmocked that is a fetch to
 * nowhere, and the default here — cannot sell — is the state the static copy is written for.
 */
vi.mock('~/sync/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/sync/api')>();
  return { ...actual, billing: { ...actual.billing, configured: vi.fn() } };
});

const billingConfigured = vi.mocked(billing.configured);

beforeEach(() => {
  vi.clearAllMocks();
  billingConfigured.mockResolvedValue(false);
});

function renderPricing() {
  return render(
    <MemoryRouter>
      <Pricing />
    </MemoryRouter>,
  );
}

describe('Pricing', () => {
  it('has a heading a screen reader can find', () => {
    renderPricing();
    expect(screen.getByRole('heading', { level: 1 })).toBeTruthy();
  });

  it('names all four plans and their prices', () => {
    renderPricing();
    for (const name of ['Self-hosted', 'Cloud Free', 'Cloud Pro', 'Cloud Enterprise']) {
      expect(screen.getAllByText(name).length, name).toBeGreaterThan(0);
    }
    // €4 monthly and €3.20 annual both appear, so nobody has to do the arithmetic.
    expect(screen.getAllByText(/€4/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/€3\.20/).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Contact us').length).toBeGreaterThan(0);
  });

  /**
   * The comparison is a real table.
   *
   * A grid of divs reads as a wall of ticks with nothing saying which plan each belongs to.
   * `getByRole('table')` and the header queries below are the same associations a screen
   * reader relies on, so if they resolve here they resolve there.
   */
  it('compares plans in a table with real headers', () => {
    renderPricing();
    const table = screen.getByRole('table');

    const columns = within(table).getAllByRole('columnheader');
    expect(columns.map((cell) => cell.textContent)).toEqual([
      'Capability',
      'Self-hosted',
      'Cloud Free',
      'Cloud Pro',
      'Cloud Enterprise',
    ]);

    // Every body row is headed by the capability it is about, so a cell four columns along
    // is still attached to the thing it is answering.
    const rows = within(table).getAllByRole('rowheader');
    expect(rows.length).toBeGreaterThan(5);
    for (const header of rows) {
      expect(header.getAttribute('scope')).toBe('row');
    }
  });

  it('quotes the Free caps the server enforces', () => {
    renderPricing();
    const table = screen.getByRole('table');
    expect(within(table).getByText('Up to 5')).toBeTruthy();
    expect(within(table).getByText('90 days')).toBeTruthy();
  });

  /**
   * A tick is announced as "check mark", "tick" or nothing at all depending on the reader.
   * The word beside it is what makes the row mean something, so it has to be in the
   * accessibility tree even though it is not on the page.
   */
  it('spells out every tick and dash for a screen reader', () => {
    renderPricing();
    const table = screen.getByRole('table');
    expect(within(table).getAllByText('Included').length).toBeGreaterThan(0);
    expect(within(table).getAllByText('Not included').length).toBeGreaterThan(0);
  });

  it('marks the unshipped Enterprise features as coming rather than ticking them', () => {
    renderPricing();
    const table = screen.getByRole('table');
    // Three rows — SSO, SCIM, audit log — and a tick on any of them is a promise somebody
    // pays against.
    expect(within(table).getAllByText('Coming')).toHaveLength(3);
  });

  /**
   * The table scrolls sideways below about 720px, and a scroll container with no tab stop is
   * content a keyboard user cannot reach at all. Named as well as focusable: an unlabelled
   * region is announced as "region" and nothing else.
   */
  it('makes the scrolling table reachable by keyboard', () => {
    renderPricing();
    const region = screen.getByRole('region', { name: 'Plan comparison table' });
    expect(region.getAttribute('tabindex')).toBe('0');
    expect(region.contains(screen.getByRole('table'))).toBe(true);
  });

  it('offers sign-up rather than a sign-in form to an anonymous reader', () => {
    renderPricing();
    const started = screen.getAllByRole('link', { name: 'Get started' });
    expect(started[0]?.getAttribute('href')).toBe('/signup');
    expect(screen.getAllByRole('link', { name: 'Sign in' })[0]?.getAttribute('href')).toBe(
      '/signin',
    );
  });

  /**
   * Cloud Pro is priced and enforced, but no code takes a payment for it, so the column
   * must not carry the same "Get started" button as the plans somebody can actually start.
   */
  it('sends Cloud Pro to a conversation rather than a sign-up', () => {
    renderPricing();
    const talk = screen.getByRole('link', { name: 'Talk to us' });
    expect(talk.getAttribute('href')?.startsWith('mailto:')).toBe(true);
    expect(screen.getByText(/Checkout is not open yet/)).toBeTruthy();
  });

  /**
   * The same page on the hosted deployment, where Stripe keys are set. The waitlist wording
   * has to disappear or the product tells paying customers to write an email instead of
   * selling to them.
   */
  it('offers a sign-up for Cloud Pro once the server can take a payment', async () => {
    billingConfigured.mockResolvedValue(true);
    renderPricing();

    await waitFor(() =>
      expect(screen.getAllByRole('link', { name: 'Get started' }).length).toBeGreaterThan(1),
    );
    expect(screen.queryByRole('link', { name: 'Talk to us' })).toBeNull();
    expect(screen.queryByText(/Checkout is not open yet/)).toBeNull();
  });
});
