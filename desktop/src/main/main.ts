/**
 * The Electron main process.
 *
 * This is a shell, not a second application. It loads the same bundle the web app serves,
 * built once per release, so the desktop client cannot drift from the web client by a
 * commit nobody noticed. Everything native — tray, badge, notifications, deep links,
 * auto-update — lives here and is exposed to the renderer through a narrow preload bridge.
 */

import {
  app,
  BrowserWindow,
  shell,
  ipcMain,
  net,
  protocol,
  Tray,
  Menu,
  nativeImage,
  Notification,
} from 'electron';
import { autoUpdater } from 'electron-updater';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Which Polaris server this installation talks to.
 *
 * Polaris is self-hosted, so there is no address that could be compiled in: the same
 * download has to point at whichever server the person running it has. It is stored beside
 * the app's own data rather than in the renderer, because the renderer needs it before it
 * can make its first request — see web/src/sync/endpoint.ts for why that ordering matters.
 *
 * A plain JSON file rather than a settings library. It holds one string, it is read once at
 * launch, and a dependency for that is a dependency to audit.
 */
interface Settings {
  serverUrl?: string;
}

function settingsPath(): string {
  return path.join(app.getPath('userData'), 'settings.json');
}

function readSettings(): Settings {
  try {
    return JSON.parse(fs.readFileSync(settingsPath(), 'utf8')) as Settings;
  } catch {
    // Missing on first run, and corrupt if a disk filled up mid-write. Both mean "ask the
    // user again", which is recoverable; throwing here would mean an app that cannot start.
    return {};
  }
}

function writeSettings(next: Settings): void {
  const file = settingsPath();
  // Written to a temporary file and renamed, so a crash or a full disk leaves the previous
  // settings intact rather than a half-written file the next launch cannot parse.
  const tmp = `${file}.tmp`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

/**
 * Accepts only an http(s) origin, and stores only the origin.
 *
 * The renderer normalises what the user typed, but this is the boundary that persists it,
 * and a value that reaches disk is one every future launch trusts. A path here would end up
 * concatenated in front of every API route.
 */
function validServerUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    if (url.hostname === '') return null;
    return url.origin;
  } catch {
    return null;
  }
}

let serverUrl = validServerUrl(readSettings().serverUrl) ?? '';

const isDev = !app.isPackaged;
/** In development the renderer is Vite's dev server; in production it is the bundled app. */
const DEV_SERVER = 'http://localhost:5173';

/**
 * The renderer is served from its own scheme, not from file://.
 *
 * This looks like ceremony and is not. A page loaded from `file://` has the origin `null`,
 * and so does every sandboxed iframe on the web — so for the server to accept credentialed
 * requests from the desktop app it would have to allow the origin `null`, which would also
 * allow any page on the internet that framed one. There is no way to distinguish them.
 *
 * A custom scheme gives the app an origin that is unique to it and cannot be forged by a
 * web page, which is what the server allowlists (see services/internal/httpapi/cors.go).
 * It also makes the renderer a *secure context*, which `file://` is not — and without that
 * IndexedDB, crypto.subtle and service workers are either unavailable or quietly degraded,
 * which for a local-first client means no replica at all.
 */
const APP_SCHEME = 'polaris-app';
const APP_ORIGIN = `${APP_SCHEME}://app`;

protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: {
      standard: true, // gives it a real origin rather than an opaque one
      secure: true, // secure context: IndexedDB, crypto.subtle, the lot
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true, // the bootstrap endpoint is an NDJSON stream
    },
  },
]);

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;

/**
 * A single instance owns the protocol handler and the tray.
 *
 * Without this, clicking a polaris:// link while the app is running starts a second copy
 * that fights the first for the tray icon and opens its own window — and the deep link
 * lands in the process the user was not looking at.
 */
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    focusMainWindow();
    const deepLink = argv.find((a) => a.startsWith('polaris://'));
    if (deepLink) routeDeepLink(deepLink);
  });
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 720,
    minHeight: 480,
    // The traffic lights sit inside the app's own chrome, which is what lets the sidebar
    // run to the top edge the way a native application does.
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: '#0d0e10',
    // Do not show a white rectangle while the bundle parses; reveal on ready-to-show.
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.cjs'),
      // Handed to the preload as a process argument rather than over IPC, because the
      // renderer needs it synchronously — the sync engine builds its first URL before any
      // promise could resolve, and the alternative is a loading state wrapped around the
      // whole application to answer a question that was already settled at launch.
      additionalArguments: [`--polaris-server=${serverUrl}`],
      // The three settings that actually matter. contextIsolation keeps the renderer's
      // JavaScript context separate from the preload's, sandbox puts the renderer in the
      // OS sandbox, and nodeIntegration off means a cross-site script in the renderer
      // cannot reach the filesystem. All three default the wrong way in older Electron,
      // so they are set explicitly and must never be relaxed "temporarily".
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webviewTag: false,
      spellcheck: true,
    },
  });

  win.once('ready-to-show', () => win.show());

  // Anything that is not the app itself opens in the user's browser. Without this an
  // external link navigates the app window and there is no back button to return from.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (event, url) => {
    // The app may navigate within itself and nowhere else. Anything else — a link in a
    // comment, a redirect from a misconfigured server — opens in the user's browser rather
    // than replacing the application with a page that has no way back.
    const target = new URL(url);
    const ownOrigin = isDev ? new URL(DEV_SERVER).origin : APP_ORIGIN;
    if (target.origin !== ownOrigin) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });

  if (isDev) {
    void win.loadURL(DEV_SERVER);
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    void win.loadURL(`${APP_ORIGIN}/index.html`);
  }

  // On macOS closing the window hides the app rather than quitting it, matching every
  // other tray-resident application on the platform.
  win.on('close', (event) => {
    if (process.platform === 'darwin' && !isQuitting) {
      event.preventDefault();
      win.hide();
    }
  });

  return win;
}

let isQuitting = false;
app.on('before-quit', () => {
  isQuitting = true;
});

function focusMainWindow(): void {
  if (!mainWindow) {
    mainWindow = createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (!mainWindow.isVisible()) mainWindow.show();
  mainWindow.focus();
}

function createTray(): void {
  const icon = nativeImage.createFromPath(path.join(__dirname, '../../assets/tray.png'));
  // A template image is recoloured by macOS to match the menu bar, so it stays legible in
  // both light and dark mode without shipping two assets.
  icon.setTemplateImage(true);

  tray = new Tray(icon);
  tray.setToolTip('Polaris');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open Polaris', click: focusMainWindow },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() },
    ]),
  );
  tray.on('click', focusMainWindow);
}

/**
 * Deep links: polaris://issue/ENG-123 and the OAuth callback.
 *
 * The renderer owns routing, so the main process only translates the URL into an
 * application path and hands it over.
 */
function routeDeepLink(url: string): void {
  try {
    const parsed = new URL(url);
    const route = `/${parsed.host}${parsed.pathname}${parsed.search}`;
    focusMainWindow();
    mainWindow?.webContents.send('polaris:navigate', route);
  } catch {
    // A malformed link is a user pasting something odd, not an error worth surfacing.
  }
}

app.on('open-url', (event, url) => {
  event.preventDefault();
  routeDeepLink(url);
});

/**
 * Serves the bundled renderer over the app's own scheme.
 *
 * Two things here are not optional:
 *
 *   - The resolved path is checked to be INSIDE the renderer directory. A request for
 *     `polaris-app://app/../../../etc/passwd` reaches this handler as a path, and a handler
 *     that simply joins it onto a root will happily read whatever it names. The renderer is
 *     content this app shipped, so nothing should be asking — but "nothing should be
 *     asking" is not a check.
 *   - Anything that is not a file falls back to index.html, because the client is a
 *     single-page app: a deep link to /issue/ENG-123 has no file behind it, and without
 *     this every reload on a real route shows nothing.
 */
function serveRenderer(): void {
  const root = path.join(process.resourcesPath, 'renderer');

  protocol.handle(APP_SCHEME, async (request) => {
    const url = new URL(request.url);
    const requested = path.normalize(decodeURIComponent(url.pathname));
    const resolved = path.join(root, requested);

    // path.join normalises away the ../ segments, so this comparison is what actually
    // stops traversal rather than the normalisation above.
    const inside = resolved === root || resolved.startsWith(root + path.sep);
    const target =
      inside && fs.existsSync(resolved) && fs.statSync(resolved).isFile()
        ? resolved
        : path.join(root, 'index.html');

    return net.fetch(`file://${target}`);
  });
}

void app.whenReady().then(() => {
  app.setAsDefaultProtocolClient('polaris');
  if (!isDev) serveRenderer();
  mainWindow = createWindow();
  createTray();

  if (!isDev) {
    // Updates are checked on launch and then daily. Downloaded in the background and
    // applied on the next quit, so an update never interrupts somebody mid-sentence.
    void autoUpdater.checkForUpdatesAndNotify();
    setInterval(() => void autoUpdater.checkForUpdatesAndNotify(), 24 * 60 * 60 * 1000);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow();
    else focusMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// --- the preload bridge's other end ------------------------------------------------

/** Unread count on the dock or taskbar. */
ipcMain.on('polaris:set-badge', (_event, count: number) => {
  if (process.platform === 'darwin') {
    app.dock?.setBadge(count > 0 ? String(count) : '');
  } else {
    mainWindow?.setOverlayIcon(null, count > 0 ? `${count} unread` : '');
  }
});

ipcMain.on('polaris:notify', (_event, payload: { title: string; body: string; route?: string }) => {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title: payload.title, body: payload.body, silent: false });
  n.on('click', () => {
    focusMainWindow();
    if (payload.route) mainWindow?.webContents.send('polaris:navigate', payload.route);
  });
  n.show();
});

ipcMain.handle('polaris:platform', () => ({
  os: process.platform,
  version: app.getVersion(),
  isDesktop: true,
}));

/**
 * Points this installation at a server.
 *
 * The window is recreated rather than reloaded, because the server URL is read once when
 * the window is built and handed to the preload as a launch argument. Reloading would keep
 * the old value and produce an app that appears to accept the new address and then talks to
 * the old one — which is far more confusing than a window that blinks.
 *
 * The renderer clears its own replica before calling this: a local database is a copy of one
 * workspace on one server, and carrying it across would leave issues the new server will
 * never send a revoke for.
 */
ipcMain.on('polaris:set-server-url', (_event, raw: string) => {
  const next = validServerUrl(raw);
  if (next === null || next === serverUrl) return;

  serverUrl = next;
  writeSettings({ ...readSettings(), serverUrl: next });

  const old = mainWindow;
  mainWindow = createWindow();
  old?.destroy();
});
