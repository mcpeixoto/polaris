import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError, auth, isSignedIn } from '~/sync/api';

import { AcceptInvite } from './AcceptInvite';

/**
 * The auth client is the boundary under test.
 *
 * This screen has no store, no engine and no replica — it runs before any of them exist —
 * so what it *is* is a sequence of calls to `~/sync/api`, and the bug it is guarded against
 * was entirely in that sequence: registering, and then trying to redeem an invitation the
 * registration had already spent.
 */
vi.mock('~/sync/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/sync/api')>();
  return {
    ...actual,
    isSignedIn: vi.fn(() => false),
    auth: {
      register: vi.fn(async () => ({})),
      login: vi.fn(async () => ({})),
      acceptInvite: vi.fn(async () => ({})),
    },
  };
});

const TOKEN = 'invitation-token';

function renderScreen(onAccepted = vi.fn()) {
  render(
    <MemoryRouter initialEntries={[`/invite/${TOKEN}`]}>
      <Routes>
        <Route path="/invite/:token" element={<AcceptInvite onAccepted={onAccepted} />} />
      </Routes>
    </MemoryRouter>,
  );
  return onAccepted;
}

describe('AcceptInvite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isSignedIn).mockReturnValue(false);
  });

  /**
   * The one that was broken.
   *
   * `POST /auth/register` takes the token and creates the account and the membership in one
   * transaction, so a second call to `/auth/invites/accept` can only fail — with "this
   * invitation cannot be used", on a join that had in fact just worked. Before the token
   * travelled on the register call, the registration itself was refused on any default
   * install and the invited person could not sign up at all.
   */
  it('redeems the invitation on the register call, and does not accept it twice', async () => {
    const user = userEvent.setup();
    const onAccepted = renderScreen();

    await user.type(screen.getByLabelText(/^email$/i), 'ada@example.com');
    await user.type(screen.getByLabelText(/^password$/i), 'a-long-enough-password');
    await user.type(screen.getByLabelText(/your name/i), 'Ada Lovelace');
    await user.click(screen.getByRole('button', { name: /create account and join/i }));

    await waitFor(() => expect(onAccepted).toHaveBeenCalled());
    expect(auth.register).toHaveBeenCalledWith('ada@example.com', 'a-long-enough-password', {
      inviteToken: TOKEN,
      displayName: 'Ada Lovelace',
    });
    expect(auth.acceptInvite).not.toHaveBeenCalled();
    expect(auth.login).not.toHaveBeenCalled();
  });

  /** An omitted name has to be omitted, not sent as an empty one that overwrites theirs. */
  it('sends no display name when the field is left blank', async () => {
    const user = userEvent.setup();
    renderScreen();

    await user.type(screen.getByLabelText(/^email$/i), 'ada@example.com');
    await user.type(screen.getByLabelText(/^password$/i), 'a-long-enough-password');
    await user.click(screen.getByRole('button', { name: /create account and join/i }));

    await waitFor(() => expect(auth.register).toHaveBeenCalled());
    expect(auth.register).toHaveBeenCalledWith('ada@example.com', 'a-long-enough-password', {
      inviteToken: TOKEN,
      displayName: undefined,
    });
  });

  /**
   * The other branch, which is not registration and must keep accepting explicitly: somebody
   * who already has an account is joining a second workspace, and there is no registration
   * for the membership to be folded into.
   */
  it('signs an existing account in and then accepts', async () => {
    const user = userEvent.setup();
    const onAccepted = renderScreen();

    await user.click(screen.getByRole('button', { name: /sign in instead/i }));
    await user.type(screen.getByLabelText(/^email$/i), 'ada@example.com');
    await user.type(screen.getByLabelText(/^password$/i), 'a-long-enough-password');
    await user.click(screen.getByRole('button', { name: /sign in and join/i }));

    await waitFor(() => expect(onAccepted).toHaveBeenCalled());
    expect(auth.login).toHaveBeenCalledWith('ada@example.com', 'a-long-enough-password');
    expect(auth.acceptInvite).toHaveBeenCalledWith(TOKEN, undefined);
    expect(auth.register).not.toHaveBeenCalled();
  });

  /** Already signed in: no credentials at all, one accept. */
  it('accepts without credentials when a session is already open', async () => {
    vi.mocked(isSignedIn).mockReturnValue(true);
    const user = userEvent.setup();
    const onAccepted = renderScreen();

    expect(screen.queryByLabelText(/^password$/i)).toBeNull();
    await user.type(screen.getByLabelText(/your name/i), 'Ada');
    await user.click(screen.getByRole('button', { name: /join workspace/i }));

    await waitFor(() => expect(onAccepted).toHaveBeenCalled());
    expect(auth.acceptInvite).toHaveBeenCalledWith(TOKEN, 'Ada');
    expect(auth.register).not.toHaveBeenCalled();
    expect(auth.login).not.toHaveBeenCalled();
  });

  /** A refusal is said on the screen rather than swallowed; the person is not sent onward. */
  it('shows the server’s refusal and stays put', async () => {
    vi.mocked(auth.register).mockRejectedValueOnce(
      new ApiError('FORBIDDEN', 'this invitation cannot be used — ask for a new one'),
    );
    const user = userEvent.setup();
    const onAccepted = renderScreen();

    await user.type(screen.getByLabelText(/^email$/i), 'ada@example.com');
    await user.type(screen.getByLabelText(/^password$/i), 'a-long-enough-password');
    await user.click(screen.getByRole('button', { name: /create account and join/i }));

    expect((await screen.findByRole('alert')).textContent).toMatch(/invitation cannot be used/i);
    expect(onAccepted).not.toHaveBeenCalled();
  });
});
