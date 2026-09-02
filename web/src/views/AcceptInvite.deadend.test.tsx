/**
 * The two refusals a person cannot press their way out of, and the way out of each.
 *
 * The server answers `FORBIDDEN` when the invitation was sent to a different address, and a
 * `VALIDATION` on `token` when it has lapsed. This screen used to treat both as retryable —
 * and, for somebody already signed in, rendered no footer at all, so the card was one red
 * sentence over a button that would fail identically for ever.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError, auth, isSignedIn } from '~/sync/api';

import { AcceptInvite } from './AcceptInvite';

vi.mock('~/sync/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/sync/api')>();
  return {
    ...actual,
    isSignedIn: vi.fn(() => false),
    auth: {
      register: vi.fn(async () => ({ workspaces: [{ id: 'w1' }] })),
      login: vi.fn(async () => ({ workspaces: [] })),
      acceptInvite: vi.fn(async () => ({ workspaceId: 'w1' })),
      logout: vi.fn(async () => undefined),
    },
  };
});

const TOKEN = 'invitation-token';

function renderScreen() {
  render(
    <MemoryRouter initialEntries={[`/invite/${TOKEN}`]}>
      <Routes>
        <Route path="/invite/:token" element={<AcceptInvite onAccepted={vi.fn()} />} />
      </Routes>
    </MemoryRouter>,
  );
  return userEvent.setup();
}

describe('AcceptInvite dead ends', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isSignedIn).mockReturnValue(false);
  });

  it('offers a way out of the screen even to somebody already signed in', () => {
    vi.mocked(isSignedIn).mockReturnValue(true);
    renderScreen();
    expect(screen.getByRole('link', { name: 'Back to Polaris' })).toBeTruthy();
  });

  it('offers sign-out-and-retry when the invitation belongs to another address', async () => {
    vi.mocked(isSignedIn).mockReturnValue(true);
    vi.mocked(auth.acceptInvite).mockRejectedValueOnce(
      new ApiError('FORBIDDEN', 'this invitation was sent to a different email address'),
    );
    const user = renderScreen();

    await user.click(screen.getByRole('button', { name: 'Join workspace' }));

    expect((await screen.findByRole('alert')).textContent).toMatch(/different email address/i);
    expect(
      await screen.findByRole('button', { name: 'Sign out and use another account' }),
    ).toBeTruthy();
    // And the way back into the product is still there under it.
    expect(screen.getByRole('link', { name: 'Back to Polaris' })).toBeTruthy();
  });

  it('swaps the form for an explanation when the invitation has lapsed', async () => {
    vi.mocked(isSignedIn).mockReturnValue(true);
    vi.mocked(auth.acceptInvite).mockRejectedValueOnce(
      new ApiError('VALIDATION', 'this invitation is no longer valid', 'token'),
    );
    const user = renderScreen();

    await user.click(screen.getByRole('button', { name: 'Join workspace' }));

    expect(
      await screen.findByRole('heading', { name: 'This invitation has expired' }),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Join workspace' })).toBeNull();
    expect(screen.getByRole('link', { name: 'What is Polaris?' })).toBeTruthy();
  });

  /** And the credentials are checked before any of that can happen. */
  it('refuses an empty address on the field, without asking the server', async () => {
    const user = renderScreen();

    await user.click(screen.getByRole('button', { name: 'Create account and join' }));

    const message = await screen.findByRole('alert');
    const email = screen.getByLabelText('Email');
    expect(email.getAttribute('aria-invalid')).toBe('true');
    expect(email.getAttribute('aria-describedby')).toContain(message.id);
    expect(document.activeElement).toBe(email);
    expect(vi.mocked(auth.register)).not.toHaveBeenCalled();
  });
});
