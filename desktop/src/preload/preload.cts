/**
 * The preload bridge.
 *
 * This is the entire surface the renderer can reach outside the browser sandbox, and it
 * is deliberately tiny. Everything here is a named, typed operation — never `ipcRenderer`
 * itself, and never a generic `invoke(channel, ...args)`, because either of those turns
 * the bridge into an arbitrary-IPC primitive and an XSS in the renderer into full main-
 * process access.
 */

import { contextBridge, ipcRenderer } from 'electron';

/**
 * The server URL, read from the launch arguments the main process attached to this window.
 *
 * A process argument rather than an IPC call because the renderer needs it *synchronously*:
 * the sync engine builds its first URL during module evaluation, long before any promise
 * could settle. `ipcRenderer.sendSync` would also work and is the usual answer, but it
 * blocks the main process on every window, and this value is fixed for the lifetime of the
 * window anyway.
 */
function serverUrlFromArgs(): string {
  const prefix = '--polaris-server=';
  const arg = process.argv.find((a) => a.startsWith(prefix));
  return arg === undefined ? '' : arg.slice(prefix.length);
}

/**
 * What the window this bundle is running in actually looks like.
 *
 * The shell hides the title bar on macOS and Windows so the sidebar can run to the top
 * edge, and a hidden title bar is a promise the renderer has to keep: nothing else draws a
 * drag handle, and nothing else leaves room for the traffic lights. Sent as a description
 * of the chrome rather than as a platform name so the two cannot drift — the shell is the
 * side that chose `titleBarStyle` and `trafficLightPosition`, so it is the side that knows.
 *
 * Synchronous, and derived here rather than fetched, because the first paint depends on it:
 * an inset that arrives a frame late is a workspace row that visibly jumps.
 */
export interface DesktopChrome {
  readonly titleBar: 'hidden' | 'native';
  /** Height of the strip the window controls sit in, in CSS pixels. */
  readonly insetTop: number;
  /** Width the traffic lights occupy on the left, 0 where the controls are elsewhere. */
  readonly insetLeft: number;
  readonly os: 'mac' | 'windows' | 'linux';
}

export type UpdateStatus =
  | { readonly state: 'idle' }
  | { readonly state: 'checking' }
  | { readonly state: 'available'; readonly version: string }
  | { readonly state: 'downloading'; readonly percent: number }
  | { readonly state: 'ready'; readonly version: string }
  | { readonly state: 'error'; readonly message: string };

export interface PolarisDesktop {
  readonly isDesktop: true;
  /** Where this installation's server is, or an empty string on first run. */
  readonly serverUrl: string;
  readonly chrome: DesktopChrome;
  /**
   * Points the installation at a server. Resolves once the shell has accepted or refused it
   * — the window is usually replaced before the promise settles, but "usually" is why the
   * refusal path exists: a rejected address has to leave the screen it came from usable.
   */
  setServerUrl(url: string): Promise<{ ok: boolean; reason?: string }>;
  platform(): Promise<{ os: string; version: string; isDesktop: boolean }>;
  /**
   * The unread count, plus an optional PNG data URL to draw as the Windows taskbar overlay.
   * Windows has no text badge API — the overlay is an image or it is nothing — and the
   * renderer is the side with a canvas, so it draws the digits and the shell places them.
   */
  setBadgeCount(count: number, icon?: string): void;
  notify(payload: { title: string; body: string; route?: string }): void;
  /** Deep links and notification clicks arrive here. Returns an unsubscribe function. */
  onNavigate(handler: (route: string) => void): () => void;
  /** Auto-update progress. Replays the last status to a late subscriber. */
  onUpdateStatus(handler: (status: UpdateStatus) => void): () => void;
  /** Quits and installs a downloaded update. Only meaningful in the `ready` state. */
  installUpdate(): void;
  /**
   * Loads the application again.
   *
   * For the failure page the shell shows when the bundle could not be read: it is a data:
   * URL, so `location.reload()` there reloads the error rather than retrying the app.
   */
  reloadApp(): void;
}

function chromeOf(): DesktopChrome {
  if (process.platform === 'darwin') {
    // Mirrors `trafficLightPosition` and the title-bar strip height in main.ts. Both
    // numbers are stated in one place there and repeated here rather than computed,
    // because the shell cannot ask the renderer and the renderer cannot ask AppKit.
    return { titleBar: 'hidden', insetTop: 38, insetLeft: 92, os: 'mac' };
  }
  if (process.platform === 'win32') {
    // The Windows controls overlay sits top-right, so nothing is displaced on the left.
    return { titleBar: 'hidden', insetTop: 38, insetLeft: 0, os: 'windows' };
  }
  return { titleBar: 'native', insetTop: 0, insetLeft: 0, os: 'linux' };
}

/**
 * Deep links are buffered here, not in the main process.
 *
 * A cold start from `polaris://issue/ENG-123` is the normal case, not an edge one, and it
 * means the route is delivered while the renderer is still parsing its bundle: the main
 * process sends when the document has loaded, and the application subscribes later still,
 * when React runs its effects. Neither side can see the other's timing.
 *
 * The preload can, because it is the one piece that is already running when the message
 * arrives. So it listens from the start and holds whatever nobody was there to receive,
 * which lets the main process send and forget.
 */
const subscribers = new Set<(route: string) => void>();
// Bounded, because an unbounded queue fed by IPC is a way to grow the renderer's memory
// without ever opening a window. Nobody legitimately queues eight links before launch.
const MISSED_LIMIT = 8;
const missed: string[] = [];

ipcRenderer.on('polaris:navigate', (_event: unknown, route: string) => {
  if (subscribers.size === 0) {
    if (missed.length < MISSED_LIMIT) missed.push(route);
    return;
  }
  for (const handler of subscribers) handler(route);
});

/**
 * The last update status, held for the same reason deep links are: `update-downloaded` can
 * land while the renderer is still parsing, and a subscriber that arrives afterwards would
 * otherwise never learn there is a build waiting.
 */
const updateSubscribers = new Set<(status: UpdateStatus) => void>();
let lastUpdateStatus: UpdateStatus = { state: 'idle' };

ipcRenderer.on('polaris:update-status', (_event: unknown, status: UpdateStatus) => {
  lastUpdateStatus = status;
  for (const handler of updateSubscribers) handler(status);
});

const api: PolarisDesktop = {
  isDesktop: true,

  serverUrl: serverUrlFromArgs(),

  chrome: chromeOf(),

  setServerUrl: (url: string) =>
    // Length-capped like every other string crossing this bridge. The main process
    // validates it as an http(s) origin before anything is written to disk; this end only
    // has to stop an unbounded value reaching IPC.
    ipcRenderer.invoke('polaris:set-server-url', String(url).slice(0, 2048)),

  platform: () => ipcRenderer.invoke('polaris:platform'),

  setBadgeCount: (count: number, icon?: string) => {
    // Clamped in the bridge rather than trusted from the renderer: a badge of NaN or a
    // negative number renders as garbage on the dock and there is no way to recover it
    // without restarting the app.
    const safe = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
    // The overlay image is a data URL the renderer drew. Only a PNG one is forwarded, and
    // only a small one: this is a string from the renderer being handed to a native image
    // decoder, which is the kind of edge worth keeping narrow.
    const png =
      typeof icon === 'string' && icon.startsWith('data:image/png;base64,') && icon.length < 32_768
        ? icon
        : undefined;
    ipcRenderer.send('polaris:set-badge', safe, png);
  },

  notify: (payload) => {
    ipcRenderer.send('polaris:notify', {
      title: String(payload.title).slice(0, 200),
      body: String(payload.body).slice(0, 500),
      route: payload.route ? String(payload.route).slice(0, 500) : undefined,
    });
  },

  onNavigate: (handler) => {
    subscribers.add(handler);

    // Delivered in a microtask rather than synchronously: the caller is a React effect, and
    // navigating during the effect that subscribes would route before the router it is
    // subscribing on has finished mounting.
    if (missed.length > 0) {
      const queued = missed.splice(0);
      queueMicrotask(() => {
        for (const route of queued) handler(route);
      });
    }

    return () => {
      subscribers.delete(handler);
    };
  },

  onUpdateStatus: (handler) => {
    updateSubscribers.add(handler);
    // Replayed in a microtask for the same reason a missed route is: the caller is a React
    // effect, and rendering a banner during the effect that subscribes is a state update in
    // the middle of a commit.
    if (lastUpdateStatus.state !== 'idle') {
      const status = lastUpdateStatus;
      queueMicrotask(() => handler(status));
    }
    return () => {
      updateSubscribers.delete(handler);
    };
  },

  installUpdate: () => {
    ipcRenderer.send('polaris:install-update');
  },

  reloadApp: () => {
    ipcRenderer.send('polaris:reload-app');
  },
};

contextBridge.exposeInMainWorld('polarisDesktop', api);
