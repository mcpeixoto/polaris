export const RELEASES_URL = 'https://github.com/mcpeixoto/polaris/releases/latest';
export const RELEASES_API = 'https://api.github.com/repos/mcpeixoto/polaris/releases/latest';

export const DOWNLOADS = [
  {
    id: 'mac-arm64',
    platform: 'macOS',
    label: 'Apple Silicon',
    format: 'DMG',
    suffix: '-mac-arm64.dmg',
  },
  { id: 'mac-x64', platform: 'macOS', label: 'Intel', format: 'DMG', suffix: '-mac-x64.dmg' },
  {
    id: 'windows',
    platform: 'Windows',
    label: 'Intel / AMD and ARM64',
    format: 'Installer',
    suffix: '.exe',
  },
  {
    id: 'linux-appimage',
    platform: 'Linux',
    label: 'Intel / AMD 64-bit',
    format: 'AppImage',
    suffix: '-linux-x86_64.AppImage',
  },
  {
    id: 'linux-deb',
    platform: 'Linux',
    label: 'Debian / Ubuntu · Intel / AMD 64-bit',
    format: 'DEB',
    suffix: '_amd64.deb',
  },
] as const;

export interface Release {
  version: string;
  downloads: Partial<Record<(typeof DOWNLOADS)[number]['id'], string>>;
}

/** Use the API's URLs, but only for this release in the official repository. */
export function parseRelease(value: unknown): Release {
  if (typeof value !== 'object' || value === null) throw new Error('Invalid release');
  const release = value as Record<string, unknown>;
  if (
    typeof release.tag_name !== 'string' ||
    !/^v\d+\.\d+\.\d+$/.test(release.tag_name) ||
    release.draft !== false ||
    release.prerelease !== false ||
    !Array.isArray(release.assets)
  ) {
    throw new Error('No stable release available');
  }
  const version = release.tag_name.slice(1);
  const downloads: Release['downloads'] = {};
  for (const item of DOWNLOADS) {
    const name =
      item.id === 'windows'
        ? `Polaris-Setup-${version}.exe`
        : item.id === 'linux-deb'
          ? `polaris_${version}${item.suffix}`
          : `Polaris-${version}${item.suffix}`;
    const asset = release.assets.find((entry: unknown) => {
      if (typeof entry !== 'object' || entry === null) return false;
      const a = entry as Record<string, unknown>;
      return (
        a.name === name &&
        a.state === 'uploaded' &&
        typeof a.size === 'number' &&
        a.size > 0 &&
        a.browser_download_url ===
          `https://github.com/mcpeixoto/polaris/releases/download/${release.tag_name}/${name}`
      );
    }) as { browser_download_url: string } | undefined;
    if (asset) downloads[item.id] = asset.browser_download_url;
  }
  return { version, downloads };
}

export async function fetchRelease(signal: AbortSignal): Promise<Release> {
  // Public request: never send a Polaris session or a GitHub token to this endpoint.
  const response = await fetch(RELEASES_API, {
    signal,
    credentials: 'omit',
    headers: { Accept: 'application/vnd.github+json' },
  });
  if (!response.ok) throw new Error('Release lookup failed');
  return parseRelease(await response.json());
}
