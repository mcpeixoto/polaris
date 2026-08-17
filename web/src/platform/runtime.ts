/**
 * The runtime shim.
 *
 * The same bundle runs in a browser tab and inside the Electron shell, so every
 * capability that only one of them has is reached through here. Feature-detecting at the
 * call site instead would scatter `if (window.polarisDesktop)` through the UI and make
 * the web build's behaviour an accident of which branch somebody remembered to write.
 */

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
  /** Persists a new server and reloads the window, because the replica belongs to a server. */
  setServerUrl(url: string): void;
  platform(): Promise<{ os: string; version: string; isDesktop: boolean }>;
  setBadgeCount(count: number): void;
  notify(payload: { title: string; body: string; route?: string }): void;
  onNavigate(handler: (route: string) => void): () => void;
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

/**
 * Sets the unread count on the dock, taskbar or tab title.
 *
 * The web fallback writes it into document.title because that is the only badge a browser
 * tab has — and an unread count nobody can see is a notification system that does not work.
 */
export function setBadgeCount(count: number): void {
  if (bridge) {
    bridge.setBadgeCount(count);
    return;
  }
  const base = 'Polaris';
  document.title = count > 0 ? `(${count}) ${base}` : base;
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
export function setDesktopServerUrl(url: string): void {
  bridge?.setServerUrl(url);
}
