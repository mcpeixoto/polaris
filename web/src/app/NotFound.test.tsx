import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it } from 'vitest';

import { NotFound } from './App';

/**
 * The catch-all used to redirect an unknown path to the user's own issue list, rewriting the
 * address bar on the way — which is the argument `AdminOnly` in the same file already rejects
 * for members: bouncing silently reads as a broken link rather than as an answer, and it
 * destroys the one piece of evidence anybody has.
 */

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/" element={<p>The issue list</p>} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('the unknown-path screen', () => {
  it('says so and quotes the address that was followed', () => {
    renderAt('/team/RENAMED/cycles');

    expect(screen.getByText('Page not found')).not.toBeNull();
    expect(screen.getByText(/\/team\/RENAMED\/cycles/)).not.toBeNull();
  });

  it('offers the way home rather than taking it silently', async () => {
    const user = userEvent.setup();
    renderAt('/nope');

    // Still on the address the user followed, with the offer visible rather than taken.
    expect(screen.queryByText('The issue list')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Go home' }));
    expect(screen.getByText('The issue list')).not.toBeNull();
  });
});
