import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Downloads } from './Downloads';
import { Landing } from './Landing';
import { DOWNLOADS, parseRelease, RELEASES_API, RELEASES_URL } from '~/features/downloads/releases';

const auth = vi.hoisted(() => ({ signedIn: false }));
vi.mock('~/sync/api', async (original) => ({
  ...(await original<object>()),
  isSignedIn: () => auth.signedIn,
}));

function fixture() {
  const names = [
    'Polaris-0.8.1-mac-arm64.dmg',
    'Polaris-0.8.1-mac-x64.dmg',
    'Polaris-Setup-0.8.1.exe',
    'Polaris-0.8.1-linux-x86_64.AppImage',
    'polaris_0.8.1_amd64.deb',
  ];
  return {
    tag_name: 'v0.8.1',
    draft: false,
    prerelease: false,
    assets: names.map((name) => ({
      name,
      size: 100,
      state: 'uploaded',
      browser_download_url: `https://github.com/mcpeixoto/polaris/releases/download/v0.8.1/${name}`,
    })),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  auth.signedIn = false;
});

function renderDownloads() {
  return render(
    <MemoryRouter>
      <Downloads />
    </MemoryRouter>,
  );
}

describe('desktop downloads', () => {
  it('links all five installer choices from the public release without credentials', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => fixture() });
    vi.stubGlobal('fetch', fetch);
    renderDownloads();
    expect(await screen.findByText('Latest release · 0.8.1')).toBeTruthy();
    expect(fetch).toHaveBeenCalledWith(
      RELEASES_API,
      expect.objectContaining({ credentials: 'omit' }),
    );
    const mac = screen.getByRole('region', { name: 'macOS downloads' });
    expect(
      within(mac)
        .getAllByRole('link', { name: /Download DMG/ })
        .map((a) => a.getAttribute('href')),
    ).toEqual(
      fixture()
        .assets.slice(0, 2)
        .map((a) => a.browser_download_url),
    );
    expect(screen.getAllByRole('link', { name: /Download / })).toHaveLength(DOWNLOADS.length);
  });

  it('keeps the release fallback usable while loading and after a failed request', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    renderDownloads();
    expect(screen.getByRole('link', { name: /All releases/ }).getAttribute('href')).toBe(
      RELEASES_URL,
    );
    expect(await screen.findByText(/We couldn’t load/)).toBeTruthy();
    expect(screen.queryAllByRole('link', { name: /Download / })).toHaveLength(0);
    expect(screen.getAllByRole('region')).toHaveLength(3);
  });

  it('does not invent links for missing or foreign assets', () => {
    const release = fixture();
    release.assets.pop();
    release.assets[0]!.browser_download_url = 'https://example.com/installer';
    const parsed = parseRelease(release);
    expect(parsed.downloads['linux-deb']).toBeUndefined();
    expect(parsed.downloads['mac-arm64']).toBeUndefined();
    expect(parsed.downloads['mac-x64']).toBeTruthy();
  });

  it('rejects drafts, prereleases and malformed API responses', () => {
    for (const data of [
      null,
      {},
      { ...fixture(), draft: true },
      { ...fixture(), prerelease: true },
    ]) {
      expect(() => parseRelease(data)).toThrow();
    }
  });

  it('shows unavailable choices without hiding the other platforms', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ...fixture(), assets: [] }) }),
    );
    renderDownloads();
    expect(await screen.findAllByText('Unavailable in this release')).toHaveLength(5);
  });

  it('offers a workspace return to authenticated visitors', () => {
    auth.signedIn = true;
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise(() => {})));
    renderDownloads();
    expect(
      screen
        .getAllByRole('link', { name: /Open workspace/ })
        .every((a) => a.getAttribute('href') === '/'),
    ).toBe(true);
    expect(screen.getAllByRole('link', { name: 'Polaris — home' })[0]!.getAttribute('href')).toBe(
      '/welcome',
    );
  });

  it('gives signed-in landing visitors a visible return and prominent downloads', () => {
    auth.signedIn = true;
    render(
      <MemoryRouter>
        <Landing />
      </MemoryRouter>,
    );
    expect(screen.getAllByRole('link', { name: 'Open workspace' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('link', { name: /Download Polaris/ }).length).toBeGreaterThanOrEqual(
      2,
    );
    expect(screen.getAllByRole('link', { name: 'Polaris — home' })[0]!.getAttribute('href')).toBe(
      '/welcome',
    );
  });
});
