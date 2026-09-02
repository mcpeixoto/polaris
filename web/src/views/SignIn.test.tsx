/**
 * `AuthForm` is `noValidate`, so `required` and `type="email"` are advice and nothing else.
 * What this file pins down is the replacement: the checks happen before the request, they
 * land on the field they are about, and a failure the server scoped to a field is treated
 * exactly like one this screen found itself.
 *
 * The last case is the one that is easy to get backwards. Wrong credentials name no field,
 * and the cursor still belongs in the password — the address is almost certainly right, and
 * sending focus back to it makes the next attempt a tab and a triple-click.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError, auth } from '~/sync/api';

import { SignIn } from './SignIn';

vi.mock('~/sync/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/sync/api')>();
  return {
    ...actual,
    auth: {
      login: vi.fn(async () => ({ workspaces: [] })),
      // The provider row is rendered from what the server offers, and a deployment offering
      // nothing is the shape that keeps this file about the form.
      providers: vi.fn(async () => ({
        providers: [],
        googleClientId: '',
        appleClientId: '',
        openSignup: true,
      })),
    },
  };
});

function renderScreen(onSignedIn = vi.fn()) {
  render(
    <MemoryRouter>
      <SignIn onSignedIn={onSignedIn} />
    </MemoryRouter>,
  );
  return { onSignedIn, user: userEvent.setup() };
}

describe('SignIn', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('refuses an empty form on the field, without asking the server', async () => {
    const { user } = renderScreen();

    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    const message = await screen.findByRole('alert');
    const email = screen.getByLabelText('Email');
    expect(email.getAttribute('aria-invalid')).toBe('true');
    expect(email.getAttribute('aria-describedby')).toContain(message.id);
    expect(document.activeElement).toBe(email);
    expect(vi.mocked(auth.login)).not.toHaveBeenCalled();
  });

  it('catches a malformed address before the round trip', async () => {
    const { user } = renderScreen();

    await user.type(screen.getByLabelText('Email'), 'ada@example');
    await user.type(screen.getByLabelText('Password'), 'passphrase1');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect((await screen.findByRole('alert')).textContent).toMatch(/email address/i);
    expect(vi.mocked(auth.login)).not.toHaveBeenCalled();
  });

  it('moves on to the password once the address is good', async () => {
    const { user } = renderScreen();

    await user.type(screen.getByLabelText('Email'), 'ada@example.com');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    const message = await screen.findByRole('alert');
    const password = screen.getByLabelText('Password');
    expect(password.getAttribute('aria-describedby')).toContain(message.id);
    expect(document.activeElement).toBe(password);
    expect(vi.mocked(auth.login)).not.toHaveBeenCalled();
  });

  it('puts a field-scoped refusal from the server on that field', async () => {
    vi.mocked(auth.login).mockRejectedValueOnce(
      new ApiError('VALIDATION', 'that does not look like an email address', 'email'),
    );
    const { user } = renderScreen();

    await user.type(screen.getByLabelText('Email'), 'ada@example.com');
    await user.type(screen.getByLabelText('Password'), 'passphrase1');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    const message = await screen.findByRole('alert');
    const email = screen.getByLabelText('Email');
    expect(email.getAttribute('aria-invalid')).toBe('true');
    expect(email.getAttribute('aria-describedby')).toContain(message.id);
    expect(document.activeElement).toBe(email);
  });

  it('focuses and selects the password when the credentials were simply wrong', async () => {
    vi.mocked(auth.login).mockRejectedValueOnce(
      new ApiError('UNAUTHENTICATED', 'invalid credentials'),
    );
    const { user } = renderScreen();

    await user.type(screen.getByLabelText('Email'), 'ada@example.com');
    await user.type(screen.getByLabelText('Password'), 'notmypasswd');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect((await screen.findByRole('alert')).textContent).toMatch(/invalid credentials/i);
    const password = screen.getByLabelText('Password') as HTMLInputElement;
    await waitFor(() => {
      expect(document.activeElement).toBe(password);
    });
    expect(password.selectionStart).toBe(0);
    expect(password.selectionEnd).toBe(password.value.length);
    // The banner, not the field: nothing here is wrong with one control in particular.
    expect(password.getAttribute('aria-invalid')).toBeNull();
  });
});
