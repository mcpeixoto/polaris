/**
 * Peek preview of the highlighted issue while the command menu is open.
 *
 * Linear peeks as you arrow results; Polaris did not. The menu mounts the existing Peek
 * panel beside the palette when the active row is an issue, and clears it when the
 * highlight leaves issues or the menu closes.
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-router', () => ({
  useNavigate: () => () => undefined,
}));

const ISSUE_ID = '01900000-0000-7000-8000-0000000000a1';

vi.mock('~/hooks/useViewer', () => ({ useViewerId: () => 'u1' }));

vi.mock('~/app/context', () => ({
  useEngine: () => ({
    store: {
      users: new Map(),
      projects: new Map(),
      initiatives: new Map(),
      cycles: new Map(),
      documents: new Map(),
      views: new Map(),
      teams: new Map(),
      get: () => undefined,
    },
  }),
  useQuery: () => [
    {
      id: ISSUE_ID,
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
        {
          id: 'issue.create',
          title: 'Create issue',
          keys: ['c'],
          group: 'Issues',
          run: () => {},
        },
        {
          id: 'issue.fixFlakes',
          title: 'Fix flakes',
          keys: ['f'],
          group: 'Issues',
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

const peekCalls: Array<{ open: boolean; issueId: string | null; placement?: string }> = [];

vi.mock('~/features/peek/Peek', () => ({
  Peek: (props: {
    open: boolean;
    issueId: string | null;
    placement?: string;
    registerActions?: boolean;
  }) => {
    peekCalls.push({
      open: props.open,
      issueId: props.issueId,
      ...(props.placement === undefined ? {} : { placement: props.placement }),
    });
    if (!props.open || props.issueId === null) return null;
    return <aside aria-label={`Peek ${props.issueId}`} data-placement={props.placement} />;
  },
}));

const { CommandMenu } = await import('./CommandMenu');
const { CommandMenuPeekEnabled } = await import('./commandMenuPeek');

afterEach(() => {
  cleanup();
  peekCalls.length = 0;
});

function renderMenu(ui: ReactElement) {
  return render(<CommandMenuPeekEnabled>{ui}</CommandMenuPeekEnabled>);
}

describe('CommandMenu peek', () => {
  it('peeks the highlighted issue while arrowing issue results', () => {
    renderMenu(<CommandMenu open onClose={() => undefined} />);

    fireEvent.change(screen.getByRole('combobox', { name: /search commands/i }), {
      target: { value: '#fix' },
    });

    expect(screen.getByRole('option', { name: /Fix the flake/ })).toBeTruthy();
    expect(screen.getByLabelText(`Peek ${ISSUE_ID}`)).toBeTruthy();
    const last = peekCalls.at(-1);
    expect(last).toMatchObject({ open: true, issueId: ISSUE_ID, placement: 'float' });
  });

  it('clears peek when the highlight leaves issues', () => {
    renderMenu(<CommandMenu open onClose={() => undefined} />);
    const input = screen.getByRole('combobox', { name: /search commands/i });

    // Unprefixed needle matches a command and an issue. Commands are listed first, so the
    // highlight starts on the command; arrowing down peeks, arrowing back up clears.
    fireEvent.change(input, { target: { value: 'fix' } });
    expect(screen.getByRole('option', { name: /Fix flakes/ })).toBeTruthy();
    expect(screen.getByRole('option', { name: /Fix the flake/ })).toBeTruthy();
    expect(screen.queryByLabelText(`Peek ${ISSUE_ID}`)).toBeNull();

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(screen.getByLabelText(`Peek ${ISSUE_ID}`)).toBeTruthy();

    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(screen.queryByLabelText(`Peek ${ISSUE_ID}`)).toBeNull();
  });

  it('clears peek when the menu closes', () => {
    const { rerender } = renderMenu(<CommandMenu open onClose={() => undefined} />);
    fireEvent.change(screen.getByRole('combobox', { name: /search commands/i }), {
      target: { value: '#fix' },
    });
    expect(screen.getByLabelText(`Peek ${ISSUE_ID}`)).toBeTruthy();

    rerender(
      <CommandMenuPeekEnabled>
        <CommandMenu open={false} onClose={() => undefined} />
      </CommandMenuPeekEnabled>,
    );
    expect(screen.queryByLabelText(`Peek ${ISSUE_ID}`)).toBeNull();
    expect(screen.queryByRole('dialog', { name: /command menu/i })).toBeNull();
  });

  it('does not peek command-only results', () => {
    renderMenu(<CommandMenu open onClose={() => undefined} />);
    fireEvent.change(screen.getByRole('combobox', { name: /search commands/i }), {
      target: { value: '>create' },
    });

    expect(screen.getByRole('option', { name: /Create issue/ })).toBeTruthy();
    expect(screen.queryByLabelText(/^Peek /)).toBeNull();
    expect(peekCalls).toHaveLength(0);
  });

  it('does not peek when the opt-in provider is absent', () => {
    render(<CommandMenu open onClose={() => undefined} />);
    fireEvent.change(screen.getByRole('combobox', { name: /search commands/i }), {
      target: { value: '#fix' },
    });
    expect(screen.getByRole('option', { name: /Fix the flake/ })).toBeTruthy();
    expect(screen.queryByLabelText(/^Peek /)).toBeNull();
    expect(peekCalls).toHaveLength(0);
  });
});
