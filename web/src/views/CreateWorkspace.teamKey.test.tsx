/**
 * The team key is derived, which makes it the one field somebody can reach the submit without
 * ever having looked at — and `suggestTeamKey` genuinely returns '' for a name whose letters
 * start after a digit run ("123 Corp"), because that is what `cleanTeamKey` does to a leading
 * number. The form posted the empty key and the server refused it, naming a field the person
 * had never seen a problem on.
 *
 * The address preview and the server's own field-scoped refusal are here for the same reason:
 * the address is the field most likely to be refused, and it was the one saying least.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ApiError, auth } from '~/sync/api';

import { CreateWorkspace, suggestTeamKey } from './CreateWorkspace';

vi.mock('~/sync/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/sync/api')>();
  return { ...actual, auth: { createWorkspace: vi.fn(async () => ({})) } };
});

async function fillTheRest(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Your name'), 'Ada Lovelace');
}

describe('CreateWorkspace team key', () => {
  /** The premise, stated so a change to `cleanTeamKey` cannot quietly invalidate the check. */
  it('suggests nothing for a name whose letters follow a number', () => {
    expect(suggestTeamKey('123 Corp')).not.toBe('');
    expect(suggestTeamKey('123')).toBe('');
  });

  it('refuses an empty key on the key field rather than posting it', async () => {
    const user = userEvent.setup();
    render(<CreateWorkspace onCreated={vi.fn()} />);

    await user.type(screen.getByLabelText('Workspace name'), '123');
    await fillTheRest(user);
    await user.click(screen.getByRole('button', { name: 'Create workspace' }));

    const message = await screen.findByRole('alert');
    const key = screen.getByLabelText('Team key');
    expect(message.textContent).toMatch(/key/i);
    expect(key.getAttribute('aria-invalid')).toBe('true');
    expect(key.getAttribute('aria-describedby')).toContain(message.id);
    expect(document.activeElement).toBe(key);
    expect(vi.mocked(auth.createWorkspace)).not.toHaveBeenCalled();
  });

  it('previews the address the workspace will live at', async () => {
    const user = userEvent.setup();
    render(<CreateWorkspace onCreated={vi.fn()} />);

    await user.type(screen.getByLabelText('Workspace name'), 'Acme Corp');

    expect(screen.getByText('Your workspace will live at polaris.app/acme-corp')).toBeTruthy();
  });

  it('marks a taken address on the address field, with the cursor back in it', async () => {
    vi.mocked(auth.createWorkspace).mockRejectedValueOnce(
      new ApiError('VALIDATION', 'the address acme is already taken', 'urlKey'),
    );
    const user = userEvent.setup();
    render(<CreateWorkspace onCreated={vi.fn()} />);

    await user.type(screen.getByLabelText('Workspace name'), 'Acme');
    await fillTheRest(user);
    await user.click(screen.getByRole('button', { name: 'Create workspace' }));

    const message = await screen.findByRole('alert');
    const address = screen.getByLabelText('Address');
    expect(message.textContent).toMatch(/already taken/i);
    expect(address.getAttribute('aria-invalid')).toBe('true');
    expect(address.getAttribute('aria-describedby')).toContain(message.id);
    await waitFor(() => {
      expect(document.activeElement).toBe(address);
    });
  });
});
