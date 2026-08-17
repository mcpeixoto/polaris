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

export interface PolarisDesktop {
  readonly isDesktop: true;
  /** Where this installation's server is, or an empty string on first run. */
  readonly serverUrl: string;
  setServerUrl(url: string): void;
  platform(): Promise<{ os: string; version: string; isDesktop: boolean }>;
  setBadgeCount(count: number): void;
  notify(payload: { title: string; body: string; route?: string }): void;
  /** Deep links and notification clicks arrive here. Returns an unsubscribe function. */
  onNavigate(handler: (route: string) => void): () => void;
}

const api: PolarisDesktop = {
  isDesktop: true,

  serverUrl: serverUrlFromArgs(),

  setServerUrl: (url: string) => {
    // Length-capped like every other string crossing this bridge. The main process
    // validates it as an http(s) origin before anything is written to disk; this end only
    // has to stop an unbounded value reaching IPC.
    ipcRenderer.send('polaris:set-server-url', String(url).slice(0, 2048));
  },

  platform: () => ipcRenderer.invoke('polaris:platform'),

  setBadgeCount: (count: number) => {
    // Clamped in the bridge rather than trusted from the renderer: a badge of NaN or a
    // negative number renders as garbage on the dock and there is no way to recover it
    // without restarting the app.
    const safe = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
    ipcRenderer.send('polaris:set-badge', safe);
  },

  notify: (payload) => {
    ipcRenderer.send('polaris:notify', {
      title: String(payload.title).slice(0, 200),
      body: String(payload.body).slice(0, 500),
      route: payload.route ? String(payload.route).slice(0, 500) : undefined,
    });
  },

  onNavigate: (handler) => {
    const listener = (_event: unknown, route: string) => handler(route);
    ipcRenderer.on('polaris:navigate', listener);
    return () => ipcRenderer.removeListener('polaris:navigate', listener);
  },
};

contextBridge.exposeInMainWorld('polarisDesktop', api);
