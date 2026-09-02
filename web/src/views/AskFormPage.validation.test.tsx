import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { asks } from '~/sync/api';

import { AskFormPage } from './AskFormPage';

/**
 * What the form refuses to send, and what its action is called.
 *
 * A separate file from `AskFormPage.test.tsx` because that one is about the reading the page
 * gives each *load* failure and mocks `asks` for that purpose; this is about the values that
 * do and do not leave the browser. The two share no fixtures beyond the mock shape.
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

describe('AskFormPage validation', () => {
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

  /**
   * The bug this guards: every field is sent `.trim()`ed and native `required` only asks
   * whether the control is non-empty, so a title of three spaces satisfied the browser and
   * filed an issue with no title at all — on the one screen in the product a stranger uses.
   */
  it('refuses an all-whitespace title instead of filing an empty issue', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('heading', { name: 'IT requests' });

    await user.type(screen.getByLabelText('Your name'), 'Ada');
    await user.type(screen.getByLabelText('Your email'), 'ada@example.com');
    await user.type(screen.getByLabelText('Title'), '   ');
    await user.click(screen.getByRole('button', { name: 'Submit' }));

    expect(asks.submit).not.toHaveBeenCalled();
    // Through Input's own `error` prop, so the message is wired to the field by
    // `aria-describedby` rather than floating above the form.
    expect(screen.getByLabelText('Title').getAttribute('aria-describedby')).toBeTruthy();
    expect(screen.getByText('Say what you need in a few words')).toBeTruthy();
  });

  /**
   * `loading`, not `disabled`. A disabled button cannot hold focus, so the browser drops the
   * requester to the top of the document the moment they press send.
   */
  it('keeps the send button focusable while the request is in flight', async () => {
    const user = userEvent.setup();
    let release = () => {};
    vi.mocked(asks.submit).mockImplementation(
      () => new Promise((resolve) => (release = () => resolve({ ok: 'created' }))),
    );

    renderPage();
    await screen.findByRole('heading', { name: 'IT requests' });
    await user.type(screen.getByLabelText('Your name'), 'Ada');
    await user.type(screen.getByLabelText('Your email'), 'ada@example.com');
    await user.type(screen.getByLabelText('Title'), 'The printer is on fire');
    await user.click(screen.getByRole('button', { name: 'Submit' }));

    const button = screen.getByRole('button', { name: 'Submit' });
    expect(button.hasAttribute('disabled')).toBe(false);
    expect(button.getAttribute('aria-disabled')).toBe('true');
    release();
  });
});
