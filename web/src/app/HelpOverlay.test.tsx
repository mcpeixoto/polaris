import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

/**
 * The sheet is generated from the registry, so the registry is the thing to stand in for.
 * What is being tested is the three things the generation was getting wrong: the order the
 * groups read in, whether forty rows can be narrowed to one, and what is shown when the
 * narrowing finds nothing.
 */

const groups = new Map([
  [
    'Editor',
    [
      { id: 'editor.bold', title: 'Bold', keys: ['mod+b'] },
      { id: 'editor.italic', title: 'Italic', keys: ['mod+i'] },
    ],
  ],
  [
    'General',
    [
      { id: 'app.commandMenu', title: 'Open the command menu', keys: ['mod+k'] },
      { id: 'app.help', title: 'Keyboard shortcuts', keys: ['?'] },
    ],
  ],
]);

// Only `useKeymap` is stood in for. The rest of the module is real, because the dialog this
// sheet renders inside pushes a key context of its own through it.
vi.mock('./keymap', async () => ({
  ...(await vi.importActual<typeof import('./keymap')>('./keymap')),
  useKeymap: () => ({
    registry: { byGroup: () => groups },
    context: [],
    pushContext: () => () => undefined,
  }),
}));

const { HelpOverlay } = await import('./HelpOverlay');

function headings(): string[] {
  return screen.getAllByRole('heading', { level: 3 }).map((node) => node.textContent ?? '');
}

describe('HelpOverlay', () => {
  it('puts General first, where an alphabetical sort had buried it', () => {
    render(<HelpOverlay open onClose={() => undefined} />);

    expect(headings()).toEqual(['General', 'Editor']);
  });

  it('filters by what a shortcut does', async () => {
    const user = userEvent.setup();
    render(<HelpOverlay open onClose={() => undefined} />);

    await user.type(screen.getByPlaceholderText('Filter shortcuts…'), 'bold');

    expect(headings()).toEqual(['Editor']);
    expect(screen.queryByText('Open the command menu')).toBeNull();
  });

  it('filters by the keys as well, because half of looking one up is arriving with them', async () => {
    const user = userEvent.setup();
    render(<HelpOverlay open onClose={() => undefined} />);

    await user.type(screen.getByPlaceholderText('Filter shortcuts…'), 'mod+k');

    expect(screen.getByText('Open the command menu')).not.toBeNull();
    expect(screen.queryByText('Bold')).toBeNull();
  });

  it('says so rather than painting an empty dialog body', async () => {
    const user = userEvent.setup();
    render(<HelpOverlay open onClose={() => undefined} />);

    await user.type(screen.getByPlaceholderText('Filter shortcuts…'), 'zzzz');

    expect(screen.getByText('No shortcuts match')).not.toBeNull();
    expect(screen.queryAllByRole('heading', { level: 3 })).toHaveLength(0);
  });
});
