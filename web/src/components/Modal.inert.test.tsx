import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { Modal } from './Modal';

/**
 * `aria-modal` is a claim, and Safari with VoiceOver is where the claim runs out: the
 * virtual cursor still walks the page behind the scrim. `inert` on everything the dialog is
 * not is the same statement in the one mechanism every browser honours.
 */

function Host() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>New issue</button>
      <Modal open={open} onClose={() => setOpen(false)} title="Create issue">
        <input aria-label="Title" />
      </Modal>
    </>
  );
}

/** The direct children of <body> that are not the dialog's own backdrop. */
function pageChildren(): HTMLElement[] {
  const dialog = document.querySelector('[role="dialog"]');
  return [...document.body.children].filter(
    (child): child is HTMLElement => child instanceof HTMLElement && !child.contains(dialog),
  );
}

describe('Modal and the rest of the document', () => {
  it('makes the page inert while it is open and hands it back on close', async () => {
    const user = userEvent.setup();
    render(<Host />);

    expect(pageChildren().every((child) => child.inert !== true)).toBe(true);

    await user.click(screen.getByRole('button', { name: 'New issue' }));
    const behind = pageChildren();
    expect(behind.length).toBeGreaterThan(0);
    expect(behind.every((child) => child.inert === true)).toBe(true);

    await user.keyboard('{Escape}');

    expect(
      [...document.body.children].every((child) => (child as HTMLElement).inert !== true),
    ).toBe(true);
  });

  it('returns focus to the trigger, which the inertness must not have swallowed', async () => {
    const user = userEvent.setup();
    render(<Host />);
    const trigger = screen.getByRole('button', { name: 'New issue' });

    await user.click(trigger);
    await user.keyboard('{Escape}');

    expect(document.activeElement).toBe(trigger);
  });
});
