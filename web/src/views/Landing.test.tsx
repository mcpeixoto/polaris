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
      screen.getByRole('heading', { level: 1, name: 'The fast path never touches the network.' }),
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
    expect(
      screen.getByRole('heading', { name: 'One registry. The menu is a view of it.' }),
    ).toBeTruthy();
    expect(
      screen.getByRole('heading', { name: 'Local-first is the architecture, not a badge.' }),
    ).toBeTruthy();
  });

  it('keeps social proof as placeholders rather than invented customers', () => {
    renderLanding();
    expect(screen.getAllByText('Placeholder').length).toBeGreaterThan(0);
    expect(screen.getByText('Northwind Labs')).toBeTruthy();
  });
});
