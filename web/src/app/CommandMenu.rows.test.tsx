/**
 * What a command-menu row looks like, as opposed to what it does.
 *
 * The placeholder is a sentence rather than a syntax reference, the grammar sits at the right
 * of the box, and every row carries a glyph at its left edge — an issue's state, a person's
 * avatar, a command's group — so the list is scannable by silhouette.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-router', () => ({ useNavigate: () => () => undefined }));

vi.mock('~/app/context', () => ({
  useEngine: () => ({ store: { users: new Map() } }),
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
});
