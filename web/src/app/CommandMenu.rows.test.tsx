/**
 * What a command-menu row looks like, as opposed to what it does.
 *
 * The placeholder is a sentence rather than a syntax reference, the grammar sits at the right
 * of the box, and every row carries a glyph at its left edge — an issue's state, a person's
 * avatar, a command's group — so the list is scannable by silhouette.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const navigated: string[] = [];
vi.mock('react-router', () => ({
  useNavigate: () => (to: string) => {
    navigated.push(to);
  },
}));

/*
  The store the palette reads for everything that is not an issue. It grew from `users`
  alone when the menu learned to find projects, initiatives, cycles, documents and views:
  `matchNamedEntities` walks each of those tables, so each has to exist here even when the
  assertion below is only about one of them.
*/
const STORE = {
  users: new Map(),
  projects: new Map([
    ['p1', { id: 'p1', name: 'Orbital launch', statusId: 'ps1', color: '#5e6ad2' }],
  ]),
  initiatives: new Map(),
  cycles: new Map(),
  documents: new Map(),
  views: new Map(),
  teams: new Map(),
  get: (type: string, id: string) =>
    type === 'projectStatus' && id === 'ps1' ? { id: 'ps1', name: 'In progress' } : undefined,
};

vi.mock('~/hooks/useViewer', () => ({ useViewerId: () => 'u1' }));

vi.mock('~/app/context', () => ({
  useEngine: () => ({ store: STORE }),
  useQuery: () => [
    {
      id: 'i1',
      identifier: 'ENG-4',
      title: 'Fix the flake',
      haystack: 'eng-4 fix the flake',
      state: { category: 'started', color: undefined },
    },
  ],
}));

vi.mock('./keymap', () => ({
  useKeymap: () => ({
    registry: {
      listForContext: () => [
        { id: 'issue.create', title: 'Create issue', keys: ['c'], group: 'Issues', run: () => {} },
        {
          id: 'nav.inbox',
          title: 'Go to Inbox',
          keys: ['g i'],
          group: 'Navigation',
          run: () => {},
        },
      ],
      actionsFor: () => [],
      all: () => [],
    },
    context: { screen: null },
  }),
}));

vi.mock('~/hooks/useFocusTrap', () => ({ useFocusTrap: () => undefined }));

const { CommandMenu } = await import('./CommandMenu');

describe('CommandMenu rows', () => {
  it('asks a question rather than printing its grammar', () => {
    render(<CommandMenu open onClose={() => undefined} />);
    expect(screen.getByPlaceholderText('Type a command or search…')).toBeTruthy();
    // The grammar is still on screen, at the right of the box, for the eye and not the ear.
    const grammar = document.querySelector('[aria-hidden="true"]');
    expect(grammar?.textContent).toContain('commands');
    expect(grammar?.textContent).toContain('#');
  });

  it('draws a glyph and the chord on every command row', () => {
    render(<CommandMenu open onClose={() => undefined} />);
    const row = screen.getByRole('option', { name: /Create issue/ });
    expect(row.querySelector('svg')).not.toBeNull();
    expect(row.querySelector('kbd')?.textContent).toBe('C');
  });

  it('draws an issue with its workflow state', () => {
    render(<CommandMenu open onClose={() => undefined} />);
    // Issues only join the list once there is something to match them against.
    fireEvent.change(screen.getByRole('combobox', { name: /search commands/i }), {
      target: { value: '#fix' },
    });
    const row = screen.getByRole('option', { name: /Fix the flake/ });
    // A decorative StateIcon: an svg with no role, and the identifier beside the title.
    expect(row.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    expect(row.textContent).toContain('ENG-4');
  });

  it('finds a project by name, under a heading of its own', () => {
    render(<CommandMenu open onClose={() => undefined} />);
    fireEvent.change(screen.getByRole('combobox', { name: /search commands/i }), {
      target: { value: 'orbital' },
    });

    const row = screen.getByRole('option', { name: /Orbital launch/ });
    expect(row.textContent).toContain('In progress');
    // The heading is a presentation row above it, as the Issues one is.
    const headings = [...document.querySelectorAll('[role="presentation"]')].map(
      (node) => node.textContent,
    );
    expect(headings).toContain('Projects');
    // And a glyph, the group's, so the run of project rows reads as one.
    expect(row.querySelector('svg')).not.toBeNull();
  });

  it('opens the project it was told to', async () => {
    navigated.length = 0;
    render(<CommandMenu open onClose={() => undefined} />);
    fireEvent.change(screen.getByRole('combobox', { name: /search commands/i }), {
      target: { value: 'orbital' },
    });

    fireEvent.click(screen.getByRole('option', { name: /Orbital launch/ }));
    // The palette runs its choice in a microtask, after it has closed itself.
    await Promise.resolve();
    expect(navigated).toEqual(['/project/p1']);
  });
});
