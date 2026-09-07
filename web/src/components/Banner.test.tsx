/**
 * The tone decides how loudly the message is delivered, and that is the part every
 * hand-built banner in this codebase had got the same way regardless of what it said.
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Banner } from './Banner';

describe('Banner', () => {
  // Interrupting someone mid-sentence to say an update is available is a bad trade.
  it('waits its turn for news', () => {
    render(<Banner>Polaris 1.4 is ready</Banner>);
    expect(screen.getByRole('status').textContent).toBe('Polaris 1.4 is ready');
  });

  it('waits its turn for a warning too', () => {
    render(<Banner tone="warning">This team is nearing its issue limit</Banner>);
    expect(screen.getByRole('status')).toBeTruthy();
  });

  // Something is blocked, and continuing to type would waste the work.
  it('interrupts when the news is that something is broken', () => {
    render(<Banner tone="danger">Your connection to the sync hub was lost</Banner>);
    expect(screen.getByRole('alert').textContent).toBe('Your connection to the sync hub was lost');
  });

  it('carries at most one thing to do, at the trailing edge', () => {
    render(<Banner action={<button type="button">Restart</button>}>Polaris 1.4 is ready</Banner>);
    expect(screen.getByRole('button', { name: 'Restart' })).toBeTruthy();
  });

  it('offers no control when there is nothing to do', () => {
    render(<Banner>Polaris 1.4 is ready</Banner>);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
