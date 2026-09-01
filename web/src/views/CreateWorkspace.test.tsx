import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { auth } from '~/sync/api';

import { CreateWorkspace } from './CreateWorkspace';

/**
 * What this file guards is the refusal, not the happy path.
 *
 * The submit button used to carry `disabled={!ready}` over three fields, which named nothing
 * and left the primary action out of the tab order. The replacement is a live button and a
 * submit that reports on the field it is unhappy about — so the thing worth pinning down is
 * that a bad submit produces a message, that the message is attached to the right control,
 * and that nothing reaches the server on the way.
 */
vi.mock('~/sync/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/sync/api')>();
  return {
    ...actual,
    auth: { createWorkspace: vi.fn(async () => ({})) },
  };
});

describe('CreateWorkspace', () => {
  it('keeps the submit reachable and names the field it refused', async () => {
    const user = userEvent.setup();
    render(<CreateWorkspace onCreated={vi.fn()} />);

    const submit = screen.getByRole('button', { name: 'Create workspace' });
    // Reachable, not greyed out: the whole point of dropping `disabled`.
    expect((submit as HTMLButtonElement).disabled).toBe(false);
    expect(submit.getAttribute('aria-disabled')).toBeNull();

    await user.click(submit);

    const message = await screen.findByRole('alert');
    expect(message.textContent).toMatch(/name/i);
    expect(vi.mocked(auth.createWorkspace)).not.toHaveBeenCalled();

    // Wired by Field, not by hand: the control is invalid and points at the message.
    const name = screen.getByLabelText('Workspace name');
    expect(name.getAttribute('aria-invalid')).toBe('true');
    expect(name.getAttribute('aria-describedby')).toContain(message.id);
    expect(document.activeElement).toBe(name);
  });

  it('clears the refusal as soon as the field is corrected', async () => {
    const user = userEvent.setup();
    render(<CreateWorkspace onCreated={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Create workspace' }));
    await screen.findByRole('alert');

    await user.type(screen.getByLabelText('Workspace name'), 'Acme');

    await waitFor(() => {
      expect(screen.queryByRole('alert')).toBeNull();
    });
    expect(screen.getByLabelText('Workspace name').getAttribute('aria-invalid')).toBeNull();
  });

  it('moves on to the next unfilled field rather than reporting all of them', async () => {
    const user = userEvent.setup();
    render(<CreateWorkspace onCreated={vi.fn()} />);

    await user.type(screen.getByLabelText('Workspace name'), 'Acme');
    await user.click(screen.getByRole('button', { name: 'Create workspace' }));

    // The address is derived from the name, so it is already valid; the person's own name
    // is the one still missing.
    const message = await screen.findByRole('alert');
    expect(screen.getByLabelText('Your name').getAttribute('aria-describedby')).toContain(
      message.id,
    );
    expect(vi.mocked(auth.createWorkspace)).not.toHaveBeenCalled();
  });
});
