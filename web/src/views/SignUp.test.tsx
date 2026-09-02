/**
 * The hint under the password field promised a rule the form did not enforce: `minLength`
 * is inert under `AuthForm`'s `noValidate`, so a four-character password made a full round
 * trip to be told about a floor the screen had already stated. Same for a malformed address.
 *
 * The other half is where the server's own refusals land. `ApiError.field` was parsed and
 * never read, so "use at least 10 characters" arrived as a banner over an unmarked field —
 * a second treatment for the class of problem this screen already knew how to report.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError, auth } from '~/sync/api';

import { SignUp } from './SignUp';

vi.mock('~/sync/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/sync/api')>();
  return {
    ...actual,
    auth: {
      register: vi.fn(async () => ({ workspaces: [] })),
      providers: vi.fn(async () => ({
        providers: [],
        googleClientId: '',
        appleClientId: '',
        openSignup: true,
      })),
    },
  };
});

function renderScreen() {
  render(
    <MemoryRouter>
      <SignUp onSignedIn={vi.fn()} />
    </MemoryRouter>,
  );
  return userEvent.setup();
}

const SUBMIT = { name: 'Create account' };

describe('SignUp', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('refuses a short password on the field it is about', async () => {
    const user = renderScreen();

    await user.type(screen.getByLabelText('Email'), 'ada@example.com');
    await user.type(screen.getByLabelText('Password'), 'short');
    await user.type(screen.getByLabelText('Confirm password'), 'short');
    await user.click(screen.getByRole('button', SUBMIT));

    const message = await screen.findByRole('alert');
    expect(message.textContent).toMatch(/at least 10 characters/i);
    const password = screen.getByLabelText('Password');
    expect(password.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(password);
    expect(vi.mocked(auth.register)).not.toHaveBeenCalled();
  });

  it('refuses a malformed address before the password is even looked at', async () => {
    const user = renderScreen();

    await user.type(screen.getByLabelText('Email'), 'ada@example');
    await user.type(screen.getByLabelText('Password'), 'short');
    await user.click(screen.getByRole('button', SUBMIT));

    expect((await screen.findByRole('alert')).textContent).toMatch(/email address/i);
    expect(document.activeElement).toBe(screen.getByLabelText('Email'));
  });

  /** The one check that could only ever have been done here. Still last, still on its field. */
  it('still refuses a mistyped confirmation', async () => {
    const user = renderScreen();

    await user.type(screen.getByLabelText('Email'), 'ada@example.com');
    await user.type(screen.getByLabelText('Password'), 'passphrase1');
    await user.type(screen.getByLabelText('Confirm password'), 'passphrase2');
    await user.click(screen.getByRole('button', SUBMIT));

    expect((await screen.findByRole('alert')).textContent).toMatch(/do not match/i);
    expect(document.activeElement).toBe(screen.getByLabelText('Confirm password'));
    expect(vi.mocked(auth.register)).not.toHaveBeenCalled();
  });

  it('marks the field the server named rather than banging a banner over the form', async () => {
    vi.mocked(auth.register).mockRejectedValueOnce(
      new ApiError('VALIDATION', 'that address is already registered', 'email'),
    );
    const user = renderScreen();

    await user.type(screen.getByLabelText('Email'), 'ada@example.com');
    await user.type(screen.getByLabelText('Password'), 'passphrase1');
    await user.type(screen.getByLabelText('Confirm password'), 'passphrase1');
    await user.click(screen.getByRole('button', SUBMIT));

    const message = await screen.findByRole('alert');
    const email = screen.getByLabelText('Email');
    expect(message.textContent).toMatch(/already registered/i);
    expect(email.getAttribute('aria-invalid')).toBe('true');
    expect(email.getAttribute('aria-describedby')).toContain(message.id);
    expect(document.activeElement).toBe(email);
  });

  /** A refusal that names no field is still the banner's, and still says what to do next. */
  it('keeps the invite-only refusal in the banner', async () => {
    vi.mocked(auth.register).mockRejectedValueOnce(
      new ApiError('FORBIDDEN', 'this server does not take open registrations'),
    );
    const user = renderScreen();

    await user.type(screen.getByLabelText('Email'), 'ada@example.com');
    await user.type(screen.getByLabelText('Password'), 'passphrase1');
    await user.type(screen.getByLabelText('Confirm password'), 'passphrase1');
    await user.click(screen.getByRole('button', SUBMIT));

    expect((await screen.findByRole('alert')).textContent).toMatch(/open registrations/i);
    expect(screen.getByText(/An invitation link signs you up on its own/)).toBeTruthy();
    expect(screen.getByLabelText('Email').getAttribute('aria-invalid')).toBeNull();
  });
});
