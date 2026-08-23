/**
 * The React plumbing over the registry — specifically, what an action sees when it runs.
 *
 * `useActions` hands the registry an object once, on mount. Everything else here follows
 * from that: a `run` written inline captures the render it was written in, so unless the
 * hook interposes, a shortcut dispatches the state as it stood when the screen appeared.
 * That failure is silent by construction — the component renders correctly, the mutation is
 * correct, and the only symptom is a chord that answers with values the user replaced
 * several keystrokes ago.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { KeymapProvider, useActions, useKeyContext } from './keymap';

/** A field plus an action bound to `mod+Enter` that submits whatever is in it. */
function Form({ onSubmit }: { onSubmit: (value: string) => void }) {
  const [value, setValue] = useState('');

  useKeyContext('modal');
  useActions(
    [
      {
        id: 'probe.submit',
        title: 'Submit',
        keys: ['mod+Enter'],
        when: 'modal',
        group: 'Probe',
        // Deliberately inline and closing over `value`: this is the shape every create
        // dialogue in the product is written in, and the shape the hook has to survive.
        run: () => onSubmit(value),
      },
    ],
    [],
  );

  return <input aria-label="Field" value={value} onChange={(e) => setValue(e.target.value)} />;
}

describe('useActions', () => {
  it('dispatches with the current render, not the one that registered', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(
      <KeymapProvider>
        <Form onSubmit={onSubmit} />
      </KeymapProvider>,
    );

    await user.type(screen.getByLabelText('Field'), 'typed after mount');
    await user.keyboard('{Control>}{Enter}{/Control}');

    expect(onSubmit).toHaveBeenCalledWith('typed after mount');
  });

  it('re-evaluates `enabled` on every keystroke', async () => {
    const ran = vi.fn();
    const user = userEvent.setup();

    function Gated() {
      const [armed, setArmed] = useState(false);
      useKeyContext('modal');
      useActions(
        [
          {
            id: 'probe.gated',
            title: 'Gated',
            keys: ['mod+Enter'],
            when: 'modal',
            group: 'Probe',
            enabled: () => armed,
            run: () => ran(),
          },
        ],
        [],
      );
      return <button onClick={() => setArmed(true)}>Arm</button>;
    }

    render(
      <KeymapProvider>
        <Gated />
      </KeymapProvider>,
    );

    await user.keyboard('{Control>}{Enter}{/Control}');
    expect(ran).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Arm' }));
    await user.keyboard('{Control>}{Enter}{/Control}');
    expect(ran).toHaveBeenCalledTimes(1);
  });

  it('leaves an action with no `enabled` unguarded, so conflict detection still bites', () => {
    // Two unguarded actions on one key in one context must still throw at registration. If
    // the forwarder handed the registry an `enabled` the caller never wrote, every binding
    // in the product would look guarded and the check would stop finding anything.
    function Twice() {
      useActions(
        [
          { id: 'probe.first', title: 'First', keys: ['mod+j'], group: 'Probe', run: () => {} },
          { id: 'probe.second', title: 'Second', keys: ['mod+j'], group: 'Probe', run: () => {} },
        ],
        [],
      );
      return null;
    }

    expect(() =>
      render(
        <KeymapProvider>
          <Twice />
        </KeymapProvider>,
      ),
    ).toThrow(/is already bound by/);
  });
});
