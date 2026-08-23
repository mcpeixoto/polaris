import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError, asks } from '~/sync/api';

import { AskFormPage } from './AskFormPage';

/**
 * The intake page has no store, no engine and no session — the token in the URL is the whole
 * credential — so what it *is* is a pair of calls to `~/sync/api` and the reading it gives
 * each failure. That reading is the thing worth guarding: the requester is a stranger with
 * one link, and telling them the link is dead is advice that ends the journey.
 */
vi.mock('~/sync/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/sync/api')>();
  return {
    ...actual,
    asks: {
      get: vi.fn(async () => ({ name: 'IT requests', description: '', teamName: 'Ops' })),
      submit: vi.fn(async () => ({ ok: 'created' })),
    },
  };
});

const TOKEN = 'a'.repeat(32);

function renderPage() {
  render(
    <MemoryRouter initialEntries={[`/ask/${TOKEN}`]}>
      <Routes>
        <Route path="/ask/:token" element={<AskFormPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('AskFormPage', () => {
  beforeEach(() => {
    vi.mocked(asks.get).mockReset();
    vi.mocked(asks.submit).mockReset();
    vi.mocked(asks.get).mockResolvedValue({
      name: 'IT requests',
      description: '',
      teamName: 'Ops',
    });
    vi.mocked(asks.submit).mockResolvedValue({ ok: 'created' });
  });

  it('files a request and thanks the requester by team', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('heading', { name: 'IT requests' });

    await user.type(screen.getByLabelText('Your name'), 'Ada');
    await user.type(screen.getByLabelText('Your email'), 'ada@example.com');
    await user.type(screen.getByLabelText('Title'), 'The printer is on fire');
    await user.click(screen.getByRole('button', { name: 'Submit' }));

    await screen.findByRole('heading', { name: 'Request sent' });
    expect(asks.submit).toHaveBeenCalledWith(TOKEN, {
      title: 'The printer is on fire',
      description: '',
      requesterName: 'Ada',
      requesterEmail: 'ada@example.com',
    });
  });

  it('says the link is retired only when the server says the form is gone', async () => {
    vi.mocked(asks.get).mockRejectedValue(new ApiError('NOT_FOUND', 'askForm not found'));
    renderPage();
    await screen.findByRole('heading', { name: /no longer available/i });
  });

  it.each([
    ['RATELIMITED', 'too many requests from this address'],
    ['INTERNAL', 'request failed'],
    ['NETWORK', 'offline'],
  ] as const)('does not blame the link when the lookup fails with %s', async (code, message) => {
    vi.mocked(asks.get).mockRejectedValue(new ApiError(code, message));
    renderPage();

    // The distinction the requester acts on: a link they should stop using, versus a page
    // they should reload. A throttled fetch is the second, and saying the first sends
    // somebody away from a form that works.
    await screen.findByRole('heading', { name: /could not be loaded/i });
    expect(screen.queryByRole('heading', { name: /no longer available/i })).toBeNull();
    expect(screen.getByRole('button', { name: /try again/i })).not.toBeNull();
  });

  it('retries the lookup and renders the form when the server comes back', async () => {
    const user = userEvent.setup();
    vi.mocked(asks.get).mockRejectedValueOnce(new ApiError('RATELIMITED', 'too many requests'));
    renderPage();
    await screen.findByRole('heading', { name: /could not be loaded/i });

    await user.click(screen.getByRole('button', { name: /try again/i }));
    await screen.findByRole('heading', { name: 'IT requests' });
  });

  it('shows a refused submission and leaves the form usable', async () => {
    const user = userEvent.setup();
    vi.mocked(asks.submit).mockRejectedValue(
      new ApiError('VALIDATION', 'title is too long', 'title'),
    );
    renderPage();
    await screen.findByRole('heading', { name: 'IT requests' });

    await user.type(screen.getByLabelText('Your name'), 'Ada');
    await user.type(screen.getByLabelText('Your email'), 'ada@example.com');
    await user.type(screen.getByLabelText('Title'), 'x');
    await user.click(screen.getByRole('button', { name: 'Submit' }));

    expect((await screen.findByRole('alert')).textContent).toBe('title is too long');
    await waitFor(() =>
      expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Submit' }).disabled).toBe(
        false,
      ),
    );
  });
});
