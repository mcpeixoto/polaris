import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';

import { Landing } from './Landing';

function renderLanding() {
  return render(
    <MemoryRouter>
      <Landing />
    </MemoryRouter>,
  );
}

describe('Landing', () => {
  it('has a heading a screen reader can find', () => {
    renderLanding();
    expect(
      screen.getByRole('heading', { level: 1, name: 'Issue tracking without the wait.' }),
    ).toBeTruthy();
  });

  it('offers sign in, get started, and self-host', () => {
    renderLanding();
    const started = screen.getAllByRole('link', { name: 'Get started' });
    const signIn = screen.getAllByRole('link', { name: 'Sign in' });
    expect(started[0]?.getAttribute('href')).toBe('/signup');
    expect(signIn[0]?.getAttribute('href')).toBe('/signin');
    expect(screen.getAllByRole('link', { name: 'Self-host' })[0]?.getAttribute('href')).toBe(
      '#self-host',
    );
  });

  it('names the product surfaces Polar actually ships', () => {
    renderLanding();
    for (const name of ['Issues', 'Projects', 'Cycles', 'Triage', 'Initiatives', 'Timeline']) {
      expect(screen.getAllByText(name).length, name).toBeGreaterThan(0);
    }
    expect(screen.getByRole('heading', { name: 'Every shortcut in one place.' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Offline is the normal case.' })).toBeTruthy();
  });

  it('carries pricing in the nav and a band that links to the page', () => {
    renderLanding();
    expect(screen.getAllByRole('link', { name: 'Pricing' })[0]?.getAttribute('href')).toBe(
      '#pricing',
    );
    expect(screen.getByRole('link', { name: 'Compare plans' }).getAttribute('href')).toBe(
      '/pricing',
    );
    // Quoted from features/pricing/plans.ts rather than typed into the copy, so the poster
    // and the price list cannot disagree in front of a customer.
    expect(screen.getAllByText(/€4/).length).toBeGreaterThan(0);
  });

  /**
   * The self-host band used to end "Cloud is EU-only when it exists". Cloud is now something
   * we sell, and a marketing page still saying the product does not exist is the one sentence
   * that costs a sign-up outright.
   */
  it('no longer says the cloud does not exist', () => {
    const { container } = renderLanding();
    expect(container.textContent).not.toContain('when it exists');
  });

  /**
   * The page carried a logo strip and three pull quotes that were openly labelled
   * "Placeholder". Invented company names and invented sentences read as unfinished
   * whether or not the page admits they are stand-ins, so the band is gone until there
   * are real customers to name.
   */
  it('ships no invented customers or testimonials', () => {
    const { container } = renderLanding();
    expect(container.textContent).not.toContain('Placeholder');
    expect(container.textContent).not.toContain('Northwind Labs');
  });
});
