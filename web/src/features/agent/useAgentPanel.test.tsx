/**
 * The chord, and only the chord.
 *
 * Registration is the part that can silently fail: an action bound in a context nothing
 * pushes, or on a chord something else already owns, produces a key that does nothing and
 * no error anywhere. So this mounts the hook inside a real `KeymapProvider` and presses the
 * key, rather than asserting that a call was made with the right arguments.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { KeymapProvider } from '~/app/keymap';

import { useAgentPanel } from './useAgentPanel';

function Harness() {
  const agent = useAgentPanel();
  return (
    <div>
      <p>{agent.open ? 'panel open' : 'panel shut'}</p>
      <button type="button" onClick={agent.close}>
        Close it
      </button>
    </div>
  );
}

function mounted() {
  render(
    <KeymapProvider>
      <Harness />
    </KeymapProvider>,
  );
}

describe('useAgentPanel', () => {
  it('starts shut', () => {
    mounted();
    expect(screen.getByText('panel shut')).not.toBeNull();
  });

  // Control rather than Command: jsdom's user agent is not a Mac, so `mod` resolves to
  // Control, which is what the matcher will be comparing against.
  it('opens on the shortcut and closes on it again', async () => {
    const user = userEvent.setup();
    mounted();

    await user.keyboard('{Control>}j{/Control}');
    expect(screen.getByText('panel open')).not.toBeNull();

    await user.keyboard('{Control>}j{/Control}');
    expect(screen.getByText('panel shut')).not.toBeNull();
  });

  it('shuts on request, which is what the shell’s dismiss reaches for', async () => {
    const user = userEvent.setup();
    mounted();

    await user.keyboard('{Control>}j{/Control}');
    await user.click(screen.getByRole('button', { name: 'Close it' }));

    expect(screen.getByText('panel shut')).not.toBeNull();
  });
});
