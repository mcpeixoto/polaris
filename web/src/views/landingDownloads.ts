/**
 * The desktop builds the marketing page offers, and which one a visitor's machine wants.
 *
 * ## Why the links are what they are
 *
 * electron-builder stamps the version into every asset name — `Polaris-0.9.0-mac-arm64.dmg`
 * — so those names cannot be written down here: they go stale on the next release and
 * nothing fails, the button simply 404s or hands out an old app. Reading the real name from
 * api.github.com at runtime is the other way, and it is unavailable: web/nginx.conf serves
 * this page under `connect-src 'self' ws: wss:`, so the request is blocked in production
 * while working fine in dev — a feature that only breaks where nobody is looking.
 *
 * So the release workflow publishes a second copy of each installer under a name with no
 * version in it, and these link to those. `/releases/latest/download/<name>` resolves to the
 * newest release for as long as the project exists, and `scripts/lint-release.sh` fails the
 * build if the workflow stops producing them.
 *
 * The URLs are the contract. Renaming one here without renaming it in
 * `.github/workflows/desktop.yml` produces a page of dead buttons, which is why the lint
 * names the same five strings.
 *
 * ## Signing
 *
 * The mac and Windows builds are unsigned today. A download button that ends at a
 * Gatekeeper refusal with no warning is worse than no button, so every platform carries
 * one line saying what the machine will say and what to do about it.
 */

export const RELEASES = 'https://github.com/mcpeixoto/polaris/releases/latest';

/** Where a stable-named asset lives. The name must match the one desktop.yml uploads. */
const file = (name: string) => `${RELEASES}/download/${name}`;

export type DownloadOS = 'mac' | 'windows' | 'linux' | 'unknown';

/** One downloadable file: what it is for, and what it is called on the releases page. */
export interface DownloadBuild {
  /** Button text. Reads as the choice being made, not as a file format. */
  readonly label: string;
  /** Which machine this one is for, and the file name it arrives as. */
  readonly detail: string;
  /** A permanent link to the file itself, not to a page listing it. */
  readonly url: string;
}

export interface DownloadPlatform {
  readonly os: Exclude<DownloadOS, 'unknown'>;
  readonly name: string;
  readonly builds: readonly DownloadBuild[];
  /**
   * What the OS will say the first time, in the words the reader will see. Absent when the
   * platform's build is signed and there is nothing to warn about — an explanation of a
   * dialog that does not appear is its own kind of confusing.
   */
  readonly caution?: string;
}

/**
 * Canonical order. The detected platform is moved to the front for display, but nothing is
 * ever dropped: a visitor on a work Windows box downloading for the Mac at home is a normal
 * thing to do, and detection is a guess in any case.
 */
export const DOWNLOADS: readonly DownloadPlatform[] = [
  {
    os: 'mac',
    name: 'macOS',
    builds: [
      {
        label: 'Apple Silicon',
        detail: 'M1 and later · Polaris-…-mac-arm64.dmg',
        url: file('Polaris-mac-arm64.dmg'),
      },
      {
        label: 'Intel',
        detail: 'Macs from 2020 and earlier · Polaris-…-mac-x64.dmg',
        url: file('Polaris-mac-x64.dmg'),
      },
    ],
    // Signed with a Developer ID certificate and notarised by Apple, so it opens the way
    // any other Mac app does. The workflow proves it on every release — `spctl --assess`
    // has to accept the bundle or the release does not publish — which is what makes it
    // safe to say nothing here.
  },
  {
    os: 'windows',
    name: 'Windows',
    builds: [
      {
        label: 'Installer',
        detail: '64-bit · Polaris-Setup-….exe',
        url: file('Polaris-Setup.exe'),
      },
    ],
    caution:
      'The Windows build is not signed yet, so SmartScreen shows a blue box saying it protected your PC. Click More info, then Run anyway.',
  },
  {
    os: 'linux',
    name: 'Linux',
    builds: [
      {
        label: 'AppImage',
        detail: 'Runs anywhere · Polaris-…-linux-x86_64.AppImage',
        url: file('Polaris-linux-x86_64.AppImage'),
      },
      {
        label: 'Debian / Ubuntu',
        detail: 'apt install ./… · polaris_…_amd64.deb',
        url: file('polaris-amd64.deb'),
      },
    ],
    caution:
      'Nothing to click past here. Mark the AppImage executable and run it, or install the .deb.',
  },
];

/**
 * The user agent and platform string, joined, or an empty string where there is no
 * navigator at all — a prerender, or a test that has not stubbed one.
 */
function platformHint(): string {
  const nav = (globalThis as { navigator?: { userAgent?: string; platform?: string } }).navigator;
  return `${nav?.platform ?? ''} ${nav?.userAgent ?? ''}`;
}

/**
 * Which platform to lead with.
 *
 * Deliberately coarse, and deliberately not consulted for the *architecture*: there is no
 * reliable way to tell an Apple Silicon Mac from an Intel one in a browser — Safari does
 * not implement `userAgentData`, and Rosetta makes the strings that do exist lie — so the
 * two Mac builds are always offered side by side and labelled. Handing an M-series user an
 * Intel .dmg silently is the failure this avoids.
 *
 * The hint is a parameter so tests can assert every branch without pretending to be a Mac.
 */
export function detectDownloadOS(hint: string = platformHint()): DownloadOS {
  if (/mac|iphone|ipad|ipod/i.test(hint)) return 'mac';
  if (/win/i.test(hint)) return 'windows';
  if (/linux|x11|android|cros/i.test(hint)) return 'linux';
  return 'unknown';
}

/** The platform list with the visitor's own first. Same items, different order. */
export function orderedDownloads(os: DownloadOS): readonly DownloadPlatform[] {
  return [...DOWNLOADS].sort((a, b) => Number(b.os === os) - Number(a.os === os));
}
