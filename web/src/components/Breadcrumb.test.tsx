/**
 * The trail's whole job is to say where you are and offer the way back. The parts worth
 * pinning are the ones a hand-rolled copy loses: the landmark's name, the current page
 * being marked, and the current page not being a link to itself.
 */

import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';

import { Breadcrumb } from './Breadcrumb';

function renderTrail(items: Parameters<typeof Breadcrumb>[0]['items']) {
  return render(
    <MemoryRouter>
      <Breadcrumb items={items} />
    </MemoryRouter>,
  );
}

describe('Breadcrumb', () => {
  it('is a landmark called Breadcrumb', () => {
    renderTrail([{ label: 'Projects', to: '/projects' }, { label: 'Apollo' }]);
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toBeTruthy();
  });

  it('links every step but the last', () => {
    renderTrail([
      { label: 'Projects', to: '/projects' },
      { label: 'Apollo', to: '/project/1' },
      { label: 'Overview', to: '/project/1' },
    ]);

    const links = screen.getAllByRole('link');
    expect(links.map((link) => link.textContent)).toEqual(['Projects', 'Apollo']);
  });

  // A link to the page you are on is a link that does nothing, and a trail whose last step
  // is clickable reads as though there is somewhere further to go.
  it('marks the last step as the current page and does not link it', () => {
    renderTrail([
      { label: 'Projects', to: '/projects' },
      { label: 'Apollo', to: '/project/1' },
    ]);

    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(nav).queryByRole('link', { name: 'Apollo' })).toBeNull();
    const current = nav.querySelector('[aria-current="page"]');
    expect(current?.textContent).toBe('Apollo');
  });

  // A step that is a name rather than a destination — a team the viewer cannot open — is
  // still a step, and must not become a dead link.
  it('renders a middle step without a destination as text', () => {
    renderTrail([
      { label: 'Workspace' },
      { label: 'Apollo', to: '/project/1' },
      { label: 'Issues' },
    ]);

    expect(screen.queryByRole('link', { name: 'Workspace' })).toBeNull();
    expect(screen.getByText('Workspace')).toBeTruthy();
  });

  it('carries a step icon without letting it into the name', () => {
    renderTrail([
      { label: 'Apollo', to: '/project/1', icon: <span data-testid="mark">🚀</span> },
      { label: 'Issues' },
    ]);

    const link = screen.getByRole('link', { name: 'Apollo' });
    expect(within(link).getByTestId('mark')).toBeTruthy();
  });
});
