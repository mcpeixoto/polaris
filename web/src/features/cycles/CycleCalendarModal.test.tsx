/**
 * Copying the feed URL. The button keeps its name and the confirmation is announced beside
 * it, rather than the label swapping itself out — which said nothing to a screen reader and
 * took the word "copy" away from the person still looking for it.
 */

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CycleCalendarModal } from './CycleCalendarModal';

vi.mock('./calendar', () => ({
  ensureCycleCalendarFeed: vi.fn().mockResolvedValue({ url: 'https://polaris.test/feed.ics' }),
  rotateCycleCalendarFeed: vi.fn().mockResolvedValue({ url: 'https://polaris.test/other.ics' }),
  googleCalendarSubscribeURL: (url: string) => url,
}));

afterEach(cleanup);

describe('CycleCalendarModal copy row', () => {
  it('keeps the button’s name and announces the copy in a live region', async () => {
    // userEvent installs its own clipboard, which is the one the component writes to.
    const user = userEvent.setup();

    render(<CycleCalendarModal open teamId="t1" teamName="Engineering" onClose={() => {}} />);

    const button = await screen.findByRole('button', { name: 'Copy feed URL' });
    await user.click(button);

    await waitFor(async () =>
      expect(await navigator.clipboard.readText()).toBe('https://polaris.test/feed.ics'),
    );
    // Still called what it does, with the confirmation somewhere a screen reader hears it.
    expect(screen.getByRole('button', { name: 'Copy feed URL' })).toBe(button);
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Copied'));
  });
});
