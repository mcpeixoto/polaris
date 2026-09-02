import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ErrorBoundary } from './ErrorBoundary';

/**
 * The point of a boundary is what the user is left looking at, so these tests assert on the
 * document rather than on state: is there a card instead of a blank pane, does it carry the
 * exception's own sentence, and does navigating away actually recover.
 *
 * React writes its own "The above error occurred" line to the console for every caught throw,
 * which would drown the run. It is silenced here rather than asserted on — the boundary's own
 * log is the one this suite cares about.
 */

function Boom({ fail }: { fail: boolean }) {
  if (fail) throw new Error('project is undefined');
  return <p>The issue list</p>;
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ErrorBoundary', () => {
  it('replaces a crashed subtree with a card rather than a blank pane', () => {
    render(
      <ErrorBoundary>
        <Boom fail />
      </ErrorBoundary>,
    );

    expect(screen.getByRole('alert')).not.toBeNull();
    expect(screen.getByText('This screen crashed')).not.toBeNull();
    // The exception's own sentence, which is frequently the only clue anybody has.
    expect(screen.getByText('project is undefined')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Reload' })).not.toBeNull();
  });

  it('takes the title the caller gave it, so the two radii read differently', () => {
    render(
      <ErrorBoundary title="Polaris crashed">
        <Boom fail />
      </ErrorBoundary>,
    );

    expect(screen.getByText('Polaris crashed')).not.toBeNull();
  });

  it('recovers when the reset key changes, so navigating away is the way out', async () => {
    const user = userEvent.setup();

    function Host() {
      const [path, setPath] = useState('/team/ENG');
      return (
        <>
          <button onClick={() => setPath('/my-issues')}>Navigate</button>
          <ErrorBoundary resetKey={path}>
            <Boom fail={path === '/team/ENG'} />
          </ErrorBoundary>
        </>
      );
    }

    render(<Host />);
    expect(screen.getByText('This screen crashed')).not.toBeNull();

    await user.click(screen.getByRole('button', { name: 'Navigate' }));

    expect(screen.queryByText('This screen crashed')).toBeNull();
    expect(screen.getByText('The issue list')).not.toBeNull();
  });

  it('renders its children untouched when nothing throws', () => {
    render(
      <ErrorBoundary resetKey="/team/ENG">
        <Boom fail={false} />
      </ErrorBoundary>,
    );

    expect(screen.getByText('The issue list')).not.toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('still says what happened in the console, for whoever reads the ticket', () => {
    render(
      <ErrorBoundary>
        <Boom fail />
      </ErrorBoundary>,
    );

    expect(console.error).toHaveBeenCalledWith(
      '[polaris] a screen crashed',
      expect.any(Error),
      expect.anything(),
    );
  });
});
