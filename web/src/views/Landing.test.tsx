import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

  /**
   * Below 900px the five section links are `display: none`, and for a while nothing
   * replaced them: on a phone the page offered a logo, a sign-in and no route to Keyboard,
   * Sync or Self-host at all. The panel is the replacement, and these are the three things
   * about it that a stylesheet cannot guarantee.
   *
   * The width is not asserted — jsdom has no layout and the toggle is present at every
   * width, hidden by a media query. What is asserted is that the panel is a real
   * disclosure: closed to begin with, open on click, closed again on Escape, and carrying
   * the same links the wide header does.
   */
  describe('the compact menu', () => {
    it('starts closed, with its links out of the tree', () => {
      renderLanding();
      const toggle = screen.getByRole('button', { name: 'Open menu' });
      expect(toggle.getAttribute('aria-expanded')).toBe('false');
      expect(screen.queryByRole('navigation', { name: 'Page, compact' })).toBeNull();
    });

    it('opens on click and offers every section the wide header does', async () => {
      const user = userEvent.setup();
      renderLanding();

      await user.click(screen.getByRole('button', { name: 'Open menu' }));

      const panel = screen.getByRole('navigation', { name: 'Page, compact' });
      const labels = [...panel.querySelectorAll('a')].map((link) => link.textContent);
      expect(labels).toEqual(['Product', 'Keyboard', 'Sync', 'Pricing', 'Self-host']);
      expect(screen.getByRole('button', { name: 'Close menu' }).getAttribute('aria-expanded')).toBe(
        'true',
      );
    });

    it('closes on Escape, because a panel with no visible edge needs a way out', async () => {
      const user = userEvent.setup();
      renderLanding();

      await user.click(screen.getByRole('button', { name: 'Open menu' }));
      await user.keyboard('{Escape}');

      expect(screen.queryByRole('navigation', { name: 'Page, compact' })).toBeNull();
      expect(screen.getByRole('button', { name: 'Open menu' })).toBeTruthy();
    });

    it('closes when a link inside it is taken', async () => {
      const user = userEvent.setup();
      renderLanding();

      await user.click(screen.getByRole('button', { name: 'Open menu' }));
      const panel = screen.getByRole('navigation', { name: 'Page, compact' });
      await user.click([...panel.querySelectorAll('a')][1]!);

      expect(screen.queryByRole('navigation', { name: 'Page, compact' })).toBeNull();
    });
  });
});
