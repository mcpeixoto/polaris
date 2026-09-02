/**
 * Which chords reach the registry from inside a text field.
 *
 * A keystroke aimed at a field belongs to that field — that rule is what keeps `e` from
 * archiving an issue while somebody types the word "the" into a comment. The exceptions are
 * the chords that have to work everywhere, and the shortcut sheet was not one of them: `⌘/`
 * was swallowed by whatever field had focus, which is precisely where somebody stuck
 * mid-composer reaches for it.
 *
 * The bare `?` the same action also binds is deliberately *not* an exception, and that is
 * worth a test of its own: a question mark typed into a comment is a question mark, and a
 * field that opened a dialog instead would be a worse bug than the one being fixed.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { KeymapProvider, useActions } from './keymap';

function Composer({ onHelp }: { onHelp: () => void }) {
  useActions(
    [
      {
        id: 'probe.help',
        title: 'Keyboard shortcuts',
        keys: ['?', 'mod+slash'],
        group: 'Probe',
        run: onHelp,
      },
    ],
    [],
  );

  return <textarea aria-label="Comment" />;
}

describe('the help chord from inside a text field', () => {
  it('opens the shortcut sheet, which is what it is for', async () => {
    const onHelp = vi.fn();
    const user = userEvent.setup();
    render(
      <KeymapProvider>
        <Composer onHelp={onHelp} />
      </KeymapProvider>,
    );

    screen.getByLabelText('Comment').focus();
    // Control rather than Meta: `mod` resolves per platform and the runner's navigator does
    // not look like an Apple one.
    await user.keyboard('{Control>}/{/Control}');

    expect(onHelp).toHaveBeenCalled();
  });

  it('leaves the bare question mark to the field it was typed into', async () => {
    const onHelp = vi.fn();
    const user = userEvent.setup();
    render(
      <KeymapProvider>
        <Composer onHelp={onHelp} />
      </KeymapProvider>,
    );

    await user.type(screen.getByLabelText('Comment'), 'does this work?');

    expect(onHelp).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Comment')).toHaveProperty('value', 'does this work?');
  });
});
