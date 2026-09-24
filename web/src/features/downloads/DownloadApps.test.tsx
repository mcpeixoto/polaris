import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { KeymapProvider } from '~/app/keymap';

import { DownloadApps } from './DownloadApps';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function renderApps() {
  render(
    <MemoryRouter initialEntries={['/inbox']}>
      <KeymapProvider>
        <Routes>
          <Route path="/inbox" element={<DownloadApps />} />
          <Route path="/downloads" element={<h1>Downloads</h1>} />
        </Routes>
      </KeymapProvider>
    </MemoryRouter>,
  );
}

describe('DownloadApps', () => {
  it('offers every desktop build, with this computer’s platform first', async () => {
    vi.stubGlobal('navigator', { userAgent: 'Windows NT 10.0', platform: 'Win32' });
    const user = userEvent.setup();
    renderApps();

    await user.click(screen.getByRole('button', { name: 'Download apps' }));

    const menu = screen.getByRole('menu', { name: 'Download Polaris' });
    const groups = within(menu).getAllByRole('group');
    expect(groups.map((group) => group.textContent ?? '')).toEqual([
      expect.stringMatching(/^Windows/),
      expect.stringMatching(/^macOS/),
      expect.stringMatching(/^Linux/),
    ]);
    expect(within(menu).getByRole('menuitem', { name: /Apple Silicon/ })).toBeTruthy();
    expect(within(menu).getByRole('menuitem', { name: /Intel/ })).toBeTruthy();
    expect(within(menu).getByRole('menuitem', { name: /Installer/ })).toBeTruthy();
    expect(within(menu).getByRole('menuitem', { name: /AppImage/ })).toBeTruthy();
    expect(within(menu).getByRole('menuitem', { name: /Debian/ })).toBeTruthy();
  });

  it('saves the file the release workflow publishes under a stable name', async () => {
    const user = userEvent.setup();
    let href = '';
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      href = this.href;
    });
    renderApps();

    await user.click(screen.getByRole('button', { name: 'Download apps' }));
    await user.click(screen.getByRole('menuitem', { name: /Apple Silicon/ }));

    expect(href).toBe(
      'https://github.com/mcpeixoto/polaris/releases/latest/download/Polaris-mac-arm64.dmg',
    );
  });

  it('keeps the full downloads page one row away', async () => {
    const user = userEvent.setup();
    renderApps();

    await user.click(screen.getByRole('button', { name: 'Download apps' }));
    await user.click(screen.getByRole('menuitem', { name: 'All downloads' }));

    expect(screen.getByRole('heading', { name: 'Downloads' })).toBeTruthy();
  });
});
