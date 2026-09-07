/**
 * The desktop builds the marketing page offers, and which one a visitor's machine wants.
 *
 * ## Why every link is the releases page rather than a file
 *
 * electron-builder stamps the version into every asset name — `Polaris-0.9.0-mac-arm64.dmg`,
 * `Polaris-Setup-0.9.0.exe` — so there is no stable URL to a build. GitHub's
 * `/releases/latest/download/<name>` redirect needs that exact name, which means writing a
 * version into this file that goes stale on the next release with nothing failing: the
 * button keeps working and hands out an old app, or 404s, and neither says so.
 *
 * Reading the real name from api.github.com at runtime is the other way, and it is not
 * available. web/nginx.conf serves this page under `connect-src 'self' ws: wss:`, so the
 * request is blocked in production while working fine in dev — a feature that only breaks
 * where nobody is looking.
 *
 * So each build links to `…/releases/latest`, which is correct for as long as the project
 * exists, and names the file to look for once the page opens, with the version left out
 * because that is exactly the part this file cannot know.
 *
 * ## Signing
 *
 * The mac and Windows builds are unsigned today. A download button that ends at a
 * Gatekeeper refusal with no warning is worse than no button, so every platform carries
 * one line saying what the machine will say and what to do about it.
 */

export const RELEASES = 'https://github.com/mcpeixoto/polaris/releases/latest';

export type DownloadOS = 'mac' | 'windows' | 'linux' | 'unknown';

/** One downloadable file: what it is for, and what it is called on the releases page. */
export interface DownloadBuild {
  /** Button text. Reads as the choice being made, not as a file format. */
  readonly label: string;
  /** Which machine this one is for, and the file name to click. */
  readonly detail: string;
}

export interface DownloadPlatform {
  readonly os: Exclude<DownloadOS, 'unknown'>;
  readonly name: string;
  readonly builds: readonly DownloadBuild[];
  /** What the OS will say the first time, in the words the reader will see. */
  readonly caution: string;
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
      { label: 'Apple Silicon', detail: 'M1 and later · Polaris-…-mac-arm64.dmg' },
      { label: 'Intel', detail: 'Macs from 2020 and earlier · Polaris-…-mac-x64.dmg' },
    ],
    caution:
      'The Mac build is not signed yet, so macOS will say it cannot check it for malware. Open Applications, right-click Polaris, choose Open, then Open again. Once, on the first run.',
  },
  {
    os: 'windows',
    name: 'Windows',
    builds: [{ label: 'Installer', detail: '64-bit · Polaris-Setup-….exe' }],
    caution:
      'The Windows build is not signed yet, so SmartScreen shows a blue box saying it protected your PC. Click More info, then Run anyway.',
  },
  {
    os: 'linux',
    name: 'Linux',
    builds: [
      { label: 'AppImage', detail: 'Runs anywhere · Polaris-…-linux-x86_64.AppImage' },
      { label: 'Debian / Ubuntu', detail: 'apt install ./… · polaris_…_amd64.deb' },
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
