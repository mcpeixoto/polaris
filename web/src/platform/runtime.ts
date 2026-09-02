/**
 * The runtime shim.
 *
 * The same bundle runs in a browser tab and inside the Electron shell, so every
 * capability that only one of them has is reached through here. Feature-detecting at the
 * call site instead would scatter `if (window.polarisDesktop)` through the UI and make
 * the web build's behaviour an accident of which branch somebody remembered to write.
 */

/**
 * What the shell's window looks like.
 *
 * The desktop app hides the title bar so the sidebar can run to the top edge, which makes
 * two things the renderer's problem: something has to be a drag region, and something has to
 * leave room for the window controls. The shell describes its own chrome rather than the web
 * app sniffing the platform, because the shell is the side that chose those numbers.
 */
export interface DesktopChrome {
  readonly titleBar: 'hidden' | 'native';
  readonly insetTop: number;
  readonly insetLeft: number;
  readonly os: 'mac' | 'windows' | 'linux';
}

// Imported for the web badge fallback below, which composes with the screen's own title.
import { setTitleBadge } from '~/hooks/useDocumentTitle';

export type UpdateStatus =
  | { readonly state: 'idle' }
  | { readonly state: 'checking' }
  | { readonly state: 'available'; readonly version: string }
  | { readonly state: 'downloading'; readonly percent: number }
  | { readonly state: 'ready'; readonly version: string }
  | { readonly state: 'error'; readonly message: string };

interface DesktopBridge {
  readonly isDesktop: true;
  /**
   * The server this installation talks to, or an empty string on first run.
   *
   * Synchronous, and it has to be: the sync engine builds its first URL before any promise
   * could resolve, and an async lookup here would mean either a request with no host or a
   * loading state wrapped around the entire application.
   */
  readonly serverUrl: string;
  readonly chrome?: DesktopChrome;
  /** Persists a new server and reloads the window, because the replica belongs to a server. */
  setServerUrl(url: string): Promise<{ ok: boolean; reason?: string }>;
  platform(): Promise<{ os: string; version: string; isDesktop: boolean }>;
  setBadgeCount(count: number, icon?: string): void;
  notify(payload: { title: string; body: string; route?: string }): void;
  onNavigate(handler: (route: string) => void): () => void;
  onUpdateStatus?(handler: (status: UpdateStatus) => void): () => void;
  installUpdate?(): void;
}

declare global {
  interface Window {
    polarisDesktop?: DesktopBridge;
  }
}

const bridge = typeof window !== 'undefined' ? window.polarisDesktop : undefined;

export const isDesktop = bridge?.isDesktop === true;

export type OS = 'mac' | 'windows' | 'linux' | 'unknown';

/**
 * Which key means "the command modifier".
 *
 * Read once at module load. The keymap uses it to decide whether `mod+k` matches Cmd or
 * Ctrl, and to render the hint as ⌘K or Ctrl+K, so it must agree with what the matcher
 * sees on the event.
 */
export const os: OS = detectOS();

function detectOS(): OS {
  if (typeof navigator === 'undefined') return 'unknown';
  const platform = navigator.platform ?? '';
  const ua = navigator.userAgent ?? '';
  if (/Mac|iPhone|iPad/.test(platform) || /Mac OS X/.test(ua)) return 'mac';
  if (/Win/.test(platform)) return 'windows';
  if (/Linux|X11/.test(platform)) return 'linux';
  return 'unknown';
}

export const isApple = os === 'mac';

/** The window chrome the shell built, or null in a browser tab where there is none. */
export function desktopChrome(): DesktopChrome | null {
  return bridge?.chrome ?? null;
}

/**
 * Tells the stylesheets which window they are in.
 *
 * An attribute on `<html>` rather than a class on the shell, because the two screens that
 * most need it — Connect to your server, and sign-in — are not inside the shell: on first
 * run the app is a centred card in a window with no title bar, and without a drag region
 * there is no way to move it at all.
 *
 * Stamped at module load, before React renders, so the first paint already has the inset.
 */
function applyDesktopChrome(): void {
  const chrome = bridge?.chrome;
  if (chrome === undefined || typeof document === 'undefined') return;
  if (chrome.titleBar !== 'hidden') return;
  document.documentElement.dataset.desktopChrome = chrome.os;
}

applyDesktopChrome();

/**
 * What the Windows taskbar overlay says.
 *
 * Two digits and a plus, because the overlay is 16 pixels square: anything longer is a grey
 * smudge. Exported for the test rather than inlined, since "what happens at 100" is the part
 * that is easy to get wrong and impossible to see.
 */
export function badgeLabel(count: number): string {
  if (count <= 0) return '';
  return count > 99 ? '99+' : String(count);
}

/**
 * Draws the unread count as a PNG the shell can hand to `setOverlayIcon`.
 *
 * Windows has no text badge: the taskbar overlay is an image or it is nothing. The renderer
 * is the side with a canvas and a font, so it draws, and the shell places. Null whenever
 * there is no canvas to draw on — a test environment, or a browser tab, where the caller
 * falls back to the tab title.
 */
export function badgeIcon(count: number): string | null {
  const label = badgeLabel(count);
  if (label === '') return null;
  if (typeof document === 'undefined') return null;

  const size = 32; // 16pt at 2x, which is what a high-DPI taskbar asks for
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx === null) return null;

  // The colours are read from the live document rather than written here, so the badge
  // follows the theme and the token file stays the only place a colour is chosen.
  const style = getComputedStyle(document.documentElement);
  const background = style.getPropertyValue('--accent').trim() || '#5e6ad2';
  const text = style.getPropertyValue('--accent-contrast').trim() || '#ffffff';

  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  ctx.fillStyle = background;
  ctx.fill();

  ctx.fillStyle = text;
  ctx.font = `600 ${label.length > 2 ? 14 : 18}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, size / 2, size / 2 + 1);

  try {
    return canvas.toDataURL('image/png');
  } catch {
    // A tainted or unsupported canvas. No badge is better than a thrown error in an effect.
    return null;
  }
}

/**
 * Sets the unread count on the dock, taskbar or tab title.
 *
 * The web fallback writes it into document.title because that is the only badge a browser
 * tab has — and an unread count nobody can see is a notification system that does not work.
 *
 * It composes with the screen's own title rather than replacing it. The base used to be the
 * literal `'Polaris'` here, which meant that the moment any screen named itself in the tab,
 * the next delta that changed the unread count would overwrite the name with the product's.
 * `hooks/useDocumentTitle` owns the string; this only prefixes the count onto it.
 */
export function setBadgeCount(count: number): void {
  if (bridge) {
    bridge.setBadgeCount(count, badgeIcon(count) ?? undefined);
    return;
  }
  setTitleBadge(count);
}

/**
 * Shows a system notification.
 *
 * On the web this needs permission the user has to grant, and asking on page load is both
 * annoying and usually denied — so the caller is expected to ask at a moment where the
 * request makes sense, and this function silently does nothing until then.
 */
export function notify(payload: { title: string; body: string; route?: string }): void {
  if (bridge) {
    bridge.notify(payload);
    return;
  }
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;

  const n = new Notification(payload.title, { body: payload.body });
  if (payload.route) {
    n.onclick = () => {
      window.focus();
      window.location.hash = '';
      window.history.pushState({}, '', payload.route);
      window.dispatchEvent(new PopStateEvent('popstate'));
    };
  }
}

export async function requestNotificationPermission(): Promise<boolean> {
  if (bridge) return true;
  if (typeof Notification === 'undefined') return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  return (await Notification.requestPermission()) === 'granted';
}

/** Deep links from the desktop shell. A no-op subscription on the web. */
export function onDeepLink(handler: (route: string) => void): () => void {
  if (!bridge) return () => {};
  return bridge.onNavigate(handler);
}

/**
 * The server the desktop app points at, or null on the web where the question does not
 * arise — the page was served by its own API.
 *
 * See sync/endpoint.ts for why this exists at all.
 */
export function desktopServerUrl(): string | null {
  if (!bridge) return null;
  return bridge.serverUrl === '' ? null : bridge.serverUrl;
}

/**
 * Points this installation at a server and reloads.
 *
 * The reload is not laziness. The local replica is a copy of one workspace on one server,
 * and carrying it across a change of server would leave a database full of another
 * installation's issues that the new server will never send a revoke for. Starting again is
 * the only correct answer, and doing it here means no screen has to remember to.
 */
export async function setDesktopServerUrl(url: string): Promise<{ ok: boolean; reason?: string }> {
  if (!bridge) return { ok: false, reason: 'Not running in the desktop app.' };
  try {
    // The window is usually destroyed and rebuilt before this settles, so the happy path
    // often never returns at all. The unhappy one always does, and that is the point: the
    // screen that called it has a spinner running until somebody tells it otherwise.
    return await bridge.setServerUrl(url);
  } catch {
    return { ok: false, reason: 'The app could not save that address.' };
  }
}

/**
 * Auto-update progress from the shell. A no-op subscription on the web, where the page is
 * whatever the server last served.
 */
export function onUpdateStatus(handler: (status: UpdateStatus) => void): () => void {
  if (!bridge?.onUpdateStatus) return () => {};
  return bridge.onUpdateStatus(handler);
}

/** Restarts into a downloaded update. Only ever called from the `ready` state. */
export function installUpdate(): void {
  bridge?.installUpdate?.();
}

/**
 * Whether the app window is the one the user is looking at.
 *
 * `document.hasFocus()` rather than a bridge call: in Electron it already reflects the
 * OS window's focus, and a notification decision that has to await an IPC round trip is one
 * that fires after the moment it was deciding about.
 */
export function isWindowFocused(): boolean {
  return typeof document !== 'undefined' && document.hasFocus();
}

/**
 * Hands the viewer to a URL this product does not own — today, Stripe's checkout and
 * billing portal.
 *
 * `window.open` rather than `location.assign`, because the same bundle runs inside the
 * Electron shell: the shell's `setWindowOpenHandler` sends this to the system browser and
 * keeps the app window where it was, while an in-place navigation would replace the
 * application with a page that has no way back. In a browser tab the popup is the same
 * gesture as a target=_blank link, and if the popup is blocked the fallback navigates.
 *
 * `noopener` because the opened page must not get a handle on this one.
 */
export function openExternalUrl(url: string): void {
  const opened = window.open(url, '_blank', 'noopener');
  if (opened === null) {
    window.location.assign(url);
  }
}
