import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { Modal } from './Modal';

/**
 * A modal is a claim about the whole page, and these tests hold it to that claim from the
 * outside: focus goes in, cannot get out, and comes back to where it started. Asserting on
 * the props it was given would prove none of it — every one of these behaviours is a
 * property of the document, not of the component.
 */

function Host({ description }: { description?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>New issue</button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Create issue"
        {...(description === undefined ? {} : { description })}
        footer={<button>Save</button>}
      >
        <input aria-label="Title" />
        <button>Add label</button>
      </Modal>
    </>
  );
}

async function openModal(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'New issue' }));
  return screen.getByRole('dialog', { name: 'Create issue' });
}

describe('Modal', () => {
  it('names itself and says it is modal', async () => {
    const user = userEvent.setup();
    render(<Host description="Issues belong to a team." />);
    const dialog = await openModal(user);

    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(screen.getByRole('dialog', { description: 'Issues belong to a team.' })).toBe(dialog);
  });

  it('focuses the first field rather than the close button', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await openModal(user);

    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Title' }));
  });

  it('wraps Tab from the last element back to the first', async () => {
    const user = userEvent.setup();
    render(<Host />);
    const dialog = await openModal(user);

    const close = screen.getByRole('button', { name: 'Close' });
    const save = screen.getByRole('button', { name: 'Save' });

    await user.click(save);
    expect(document.activeElement).toBe(save);

    await user.tab();
    expect(document.activeElement).toBe(close);
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('wraps Shift+Tab from the first element back to the last', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await openModal(user);

    const close = screen.getByRole('button', { name: 'Close' });
    await user.click(close);
    // Clicking the close button closes the dialog, so the trap is exercised from the
    // keyboard instead: Shift+Tab off the first element in a reopened one.
    await openModal(user);

    screen.getByRole('button', { name: 'Close' }).focus();
    await user.tab({ shift: true });

    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Save' }));
  });

  it('closes on Escape and returns focus to whatever opened it', async () => {
    const user = userEvent.setup();
    render(<Host />);
    const trigger = screen.getByRole('button', { name: 'New issue' });
    await openModal(user);

    expect(document.activeElement).not.toBe(trigger);

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('closes on a click on the backdrop but not on one inside the dialog', async () => {
    const user = userEvent.setup();
    render(<Host />);
    const dialog = await openModal(user);

    await user.click(dialog);
    expect(screen.queryByRole('dialog')).not.toBeNull();

    const backdrop = dialog.parentElement;
    expect(backdrop).not.toBeNull();
    await user.click(backdrop as HTMLElement);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('locks the page behind it and gives the scroll back on close', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await openModal(user);

    expect(document.body.style.overflow).toBe('hidden');

    await user.keyboard('{Escape}');
    expect(document.body.style.overflow).toBe('');
  });
});
