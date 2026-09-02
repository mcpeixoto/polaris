import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { UpdateStatus } from './runtime';
import { UpdateBanner } from './UpdateBanner';

/**
 * The banner is the only thing that tells a desktop user an update finished downloading, so
 * the two failures that matter are it never appearing and it appearing in a browser tab.
 */
const state = vi.hoisted(() => ({
  isDesktop: true,
  status: { state: 'idle' } as UpdateStatus,
  installUpdate: vi.fn(),
}));

vi.mock('./runtime', () => ({
  get isDesktop() {
    return state.isDesktop;
  },
  onUpdateStatus: (handler: (status: UpdateStatus) => void) => {
    handler(state.status);
    return () => {};
  },
  installUpdate: state.installUpdate,
}));

describe('UpdateBanner', () => {
  beforeEach(() => {
    state.isDesktop = true;
    state.status = { state: 'idle' };
    state.installUpdate.mockClear();
  });

  it('says nothing until a build has finished downloading', () => {
    state.status = { state: 'downloading', percent: 40 };
    render(<UpdateBanner />);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('offers the restart once the update is ready', async () => {
    const user = userEvent.setup();
    state.status = { state: 'ready', version: '0.5.0' };
    render(<UpdateBanner />);

    expect(screen.getByRole('status').textContent).toContain('0.5.0');
    await user.click(screen.getByRole('button', { name: 'Restart' }));
    expect(state.installUpdate).toHaveBeenCalledTimes(1);
  });

  it('can be dismissed, because the update installs on the next quit anyway', async () => {
    const user = userEvent.setup();
    state.status = { state: 'ready', version: '0.5.0' };
    render(<UpdateBanner />);

    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('renders nothing in a browser tab, where there is nothing to restart into', () => {
    state.isDesktop = false;
    state.status = { state: 'ready', version: '0.5.0' };
    render(<UpdateBanner />);
    expect(screen.queryByRole('status')).toBeNull();
  });
});
