import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { setDesktopServerUrl } from '~/platform/runtime';

import { ConnectServer } from './ConnectServer';

/**
 * The address complaint used to be a form-level banner, and it was announced by mounting —
 * so typing the same bad address twice said it once. It is a field message now, which is
 * both where it belongs and what lets it clear on the next keystroke and come back.
 */
vi.mock('~/platform/runtime', () => ({ setDesktopServerUrl: vi.fn() }));

describe('ConnectServer', () => {
  it('reports a bad address on the field, and saves nothing', async () => {
    const user = userEvent.setup();
    render(<ConnectServer />);

    const field = screen.getByLabelText('Server address');
    await user.type(field, 'not a server');
    await user.click(screen.getByRole('button', { name: 'Connect' }));

    const message = await screen.findByRole('alert');
    expect(message.textContent).toMatch(/web address/i);
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(field.getAttribute('aria-describedby')).toContain(message.id);
    expect(vi.mocked(setDesktopServerUrl)).not.toHaveBeenCalled();
  });

  it('says what is missing rather than sitting behind a disabled button', async () => {
    const user = userEvent.setup();
    render(<ConnectServer />);

    const submit = screen.getByRole('button', { name: 'Connect' });
    expect((submit as HTMLButtonElement).disabled).toBe(false);

    await user.click(submit);

    expect((await screen.findByRole('alert')).textContent).toMatch(/address/i);
    expect(document.activeElement).toBe(screen.getByLabelText('Server address'));
  });

  it('takes the message away on the next keystroke, so the next submit can announce again', async () => {
    const user = userEvent.setup();
    render(<ConnectServer />);

    await user.click(screen.getByRole('button', { name: 'Connect' }));
    await screen.findByRole('alert');

    await user.type(screen.getByLabelText('Server address'), 'polaris.acme.com');
    await waitFor(() => {
      expect(screen.queryByRole('alert')).toBeNull();
    });

    await user.click(screen.getByRole('button', { name: 'Connect' }));
    expect(vi.mocked(setDesktopServerUrl)).toHaveBeenCalledWith('https://polaris.acme.com');
  });
});
