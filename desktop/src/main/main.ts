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
  dialog,
  shell,
  ipcMain,
  clipboard,
  net,
  protocol,
  screen,
  session,
  Tray,
  Menu,
  nativeImage,
  nativeTheme,
  Notification,
  powerMonitor,
  type MenuItemConstructorOptions,
  type Rectangle,
  type WebContents,
} from 'electron';
/**
 * electron-updater is CommonJS, and it defines `autoUpdater` with a property getter rather
 * than a plain assignment. Node's ESM loader works out a CommonJS module's named exports by
 * static analysis, and that is one of the patterns it cannot see — so `import { autoUpdater }`
 * type-checks happily against the shipped .d.ts and then throws at *link* time, before a
 * single statement in this file runs.
 *
 * The symptom is the whole application: no window, no log line, nothing on stdout, just
 * Electron's "A JavaScript error occurred in the main process" dialog. Importing the default
 * and destructuring is the interop that actually holds, and it must stay that way while this
 * package is `"type": "module"`.
 */
import electronUpdater from 'electron-updater';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const { autoUpdater } = electronUpdater;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Everything this installation remembers between launches.
 *
 * A plain JSON file rather than a settings library. It holds a server address and a window
 * rectangle, it is read once at launch, and a dependency for that is a dependency to audit.
 */
interface WindowState {
  x?: number;
  y?: number;
  width: number;
  height: number;
  maximized?: boolean;
}

/**
 * Which Polaris server this installation talks to.
 *
 * Polaris is self-hosted, so there is no address that could be compiled in: the same
 * download has to point at whichever server the person running it has. It is stored beside
 * the app's own data rather than in the renderer, because the renderer needs it before it
 * can make its first request — see web/src/sync/endpoint.ts for why that ordering matters.
 */
interface Settings {
  serverUrl?: string;
  window?: WindowState;
  /**
   * The renderer's zoom level, which lives on the webContents and is otherwise lost on every
   * launch and on every window recreation. Somebody who zoomed out to fit a wide board is
   * telling us something durable about their eyes and their monitor, not about this session.
   */
  zoomLevel?: number;
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

function writeSettings(next: Settings): boolean {
  const file = settingsPath();
  // Written to a temporary file and renamed, so a crash or a full disk leaves the previous
  // settings intact rather than a half-written file the next launch cannot parse.
  const tmp = `${file}.tmp`;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8');
    fs.renameSync(tmp, file);
    return true;
  } catch (error) {
    // Losing a window position is a nuisance and not worth taking the main process down for.
    // Losing the *server address* is not the same failure: the next launch asks for it again
    // with no explanation, and the user has no way to connect the two events. The caller
    // decides which of the two it was — see `applyServerUrl`.
    log('settings write failed:', error);
    return false;
  }
}

/**
 * Diagnostics that survive the session.
 *
 * A packaged app has no stdout anybody can see, so every `console.warn` in this file used to
 * be a message to nobody: "updates never install" and "the tray icon is missing" are both
 * reported without a single line of evidence attached. The log is opened lazily, capped, and
 * reachable from Help → Open Logs, which is the whole point of writing it.
 */
const LOG_LIMIT = 1_000_000;

function logPath(): string {
  return path.join(app.getPath('logs'), 'polaris-main.log');
}

function log(...parts: readonly unknown[]): void {
  const line = `${new Date().toISOString()} ${parts
    .map((p) => (p instanceof Error ? (p.stack ?? p.message) : String(p)))
    .join(' ')}\n`;
  console.warn('[polaris]', line.trimEnd());
  try {
    const file = logPath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    // Truncated rather than rotated. One file that cannot grow without bound is the whole
    // requirement; a rotation scheme here would be a second thing to get wrong.
    if ((fs.statSync(file, { throwIfNoEntry: false })?.size ?? 0) > LOG_LIMIT) {
      fs.writeFileSync(file, '', 'utf8');
    }
    fs.appendFileSync(file, line, 'utf8');
  } catch {
    // A log that cannot be written must never be the reason the app stops working.
  }
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

/**
 * Every window this app owns, and which of them a side effect should land on.
 *
 * A set rather than a single `mainWindow`, because ⌘N opens a second one and every native
 * surface — the badge, a notification click, a deep link — has to pick a window rather than
 * assume there is one. The most recently focused is the right answer for all of them: it is
 * the window the user is looking at.
 */
const windows = new Set<BrowserWindow>();
let lastFocused: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;

function targetWindow(): BrowserWindow | null {
  const focused = BrowserWindow.getFocusedWindow();
  if (focused !== null && windows.has(focused)) return focused;
  if (lastFocused !== null && !lastFocused.isDestroyed()) return lastFocused;
  for (const win of windows) if (!win.isDestroyed()) return win;
  return null;
}

/**
 * A single instance owns the protocol handler and the tray.
 *
 * Without this, clicking a polaris:// link while the app is running starts a second copy
 * that fights the first for the tray icon and opens its own window — and the deep link
 * lands in the process the user was not looking at.
 */
// `app.exit` rather than `app.quit`: quit is asynchronous and this module keeps evaluating
// through it, including the `whenReady` chain at the bottom — so the losing process could
// reach `createWindow()` and flash a second window on screen before it went away.
const hasInstanceLock = app.requestSingleInstanceLock();
if (!hasInstanceLock) {
  app.exit(0);
} else {
  app.on('second-instance', (_event, argv) => {
    focusMainWindow();
    routeDeepLink(deepLinkFromArgv(argv));
  });
}

// --- window ------------------------------------------------------------------------

const DEFAULT_BOUNDS: WindowState = { width: 1440, height: 900 };

/**
 * The saved rectangle, if it still lands on a screen that exists.
 *
 * A laptop undocked from a second monitor is the common case, and a window restored to
 * where that monitor used to be is a window the user cannot find — it is off-screen, it has
 * no taskbar button on macOS, and the only cure is deleting a file they do not know about.
 * So the saved position is only honoured when it overlaps a display's work area.
 */
function restoredBounds(): WindowState {
  const saved = readSettings().window;
  if (!saved || typeof saved.width !== 'number' || typeof saved.height !== 'number') {
    return DEFAULT_BOUNDS;
  }

  const size = {
    width: Math.max(720, Math.round(saved.width)),
    height: Math.max(480, Math.round(saved.height)),
    maximized: saved.maximized === true,
  };
  if (typeof saved.x !== 'number' || typeof saved.y !== 'number') return size;

  const rect: Rectangle = { x: saved.x, y: saved.y, width: size.width, height: size.height };
  const work = screen.getDisplayMatching(rect).workArea;
  const overlaps =
    rect.x < work.x + work.width &&
    rect.x + rect.width > work.x &&
    rect.y < work.y + work.height &&
    rect.y + rect.height > work.y;

  return overlaps ? { ...size, x: Math.round(rect.x), y: Math.round(rect.y) } : size;
}

/**
 * Remembers where the window was.
 *
 * Debounced because `resize` fires on every frame of a drag, and settings.json is also
 * where the server address lives — a hundred rewrites a second is a hundred chances to be
 * interrupted mid-rename.
 */
function trackWindowState(win: BrowserWindow): void {
  let timer: NodeJS.Timeout | null = null;

  const persist = (): void => {
    if (win.isDestroyed() || win.isMinimized() || win.isFullScreen()) return;
    // getNormalBounds is the un-maximised rectangle, which is what a restore needs; the
    // maximised one is the size of a screen the user may not have next time.
    const { x, y, width, height } = win.getNormalBounds();
    writeSettings({
      ...readSettings(),
      window: { x, y, width, height, maximized: win.isMaximized() },
    });
  };

  const schedule = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(persist, 400);
  };

  win.on('resize', schedule);
  win.on('move', schedule);
  win.on('maximize', schedule);
  win.on('unmaximize', schedule);
  // Written synchronously on the way out, because the debounce timer will not survive quit.
  win.on('close', () => {
    if (timer) clearTimeout(timer);
    persist();
  });
}

/**
 * The window's own background, which is what the user looks at between the window appearing
 * and the first paint of the renderer.
 *
 * Two literals, and they are the only colours in this file. They are the two `--bg-primary`
 * values from web/src/styles/tokens.css, and they are here because a BrowserWindow option is
 * read before any stylesheet exists — there is no way to ask the renderer for a colour it
 * has not loaded yet. Following `nativeTheme` rather than pinning the dark one means a user
 * on a light desktop no longer gets a black flash on every launch.
 */
function windowBackground(): string {
  return nativeTheme.shouldUseDarkColors ? '#0d0e10' : '#ffffff';
}

/** The Windows controls overlay, recoloured with the theme so it is not a grey notch. */
function titleBarOverlayColors(): { color: string; symbolColor: string; height: number } {
  const dark = nativeTheme.shouldUseDarkColors;
  return {
    color: dark ? '#0d0e10' : '#ffffff',
    symbolColor: dark ? '#eeeff1' : '#282a30',
    // Repeated in preload.cts's `chromeOf`, which is what the renderer insets by.
    height: TITLE_BAR_HEIGHT,
  };
}

const TITLE_BAR_HEIGHT = 38;

/** Where the renderer lives: Vite in development, the app's own scheme once packaged. */
function appUrl(): string {
  return isDev ? DEV_SERVER : `${APP_ORIGIN}/index.html`;
}

function createWindow(): BrowserWindow {
  const bounds = restoredBounds();
  const isMac = process.platform === 'darwin';
  const isWindows = process.platform === 'win32';

  const win = new BrowserWindow({
    ...bounds,
    minWidth: 720,
    minHeight: 480,
    // The window controls sit inside the app's own chrome on both platforms that support it,
    // which is what lets the sidebar run to the top edge the way a native application does.
    // The renderer is told (preload.cts `chrome`) so it can leave room and declare a drag
    // region — with the title bar hidden, nothing else does either.
    titleBarStyle: isMac || isWindows ? (isMac ? 'hiddenInset' : 'hidden') : 'default',
    trafficLightPosition: { x: 16, y: 16 },
    ...(isWindows ? { titleBarOverlay: titleBarOverlayColors() } : {}),
    // Windows and Linux keep a real menu for its accelerators, but a keyboard-first product
    // showing a File/Edit strip above its own chrome reads as a wrapped web page. Alt still
    // reveals it for anybody who goes looking.
    autoHideMenuBar: true,
    backgroundColor: windowBackground(),
    // Do not show a white rectangle while the bundle parses; reveal on ready-to-show.
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.cjs'),
      // Handed to the preload as a process argument rather than over IPC, because the
      // renderer needs it synchronously — the sync engine builds its first URL before any
      // promise could resolve, and the alternative is a loading state wrapped around the
      // whole application to answer a question that was already settled at launch.
      // A command line is readable by any local user through `ps`, so this puts a
      // customer's internal hostname where an unprivileged process on the same machine can
      // see it. Accepted, narrowly: it is a hostname the machine also resolves and connects
      // to, and `ipcRenderer.sendSync` — the alternative with the same synchrony — blocks
      // the main process. Reconsider if anything secret ever needs the same treatment.
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

  if (bounds.maximized) win.maximize();
  trackWindowState(win);
  windows.add(win);
  lastFocused = win;
  win.on('focus', () => {
    lastFocused = win;
    // A laptop that was asleep for a week has a `setInterval` that never fired. Coming back
    // to the app is the moment a stale check is both cheap and wanted.
    checkForUpdatesIfStale();
  });
  win.on('closed', () => {
    windows.delete(win);
    if (lastFocused === win) lastFocused = null;
  });

  // Shown on `ready-to-show`, or after a deadline, whichever comes first.
  //
  // The deadline is not paranoia: `ready-to-show` fires off the renderer's first paint, so
  // anything that stops the bundle loading — a truncated extraResources copy, an antivirus
  // quarantine of the asar, a permissions problem on the install directory — leaves a
  // process with a dock icon and no window at all, forever, with nothing on screen to say
  // why. A visible window showing the failure is recoverable; an invisible one is not.
  let shown = false;
  const reveal = (): void => {
    if (shown || win.isDestroyed()) return;
    shown = true;
    win.show();
  };
  win.once('ready-to-show', reveal);
  const revealTimer = setTimeout(() => {
    if (shown) return;
    log('renderer did not become ready within 10s; showing the window anyway');
    reveal();
  }, 10_000);
  win.once('closed', () => clearTimeout(revealTimer));

  win.webContents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
    // Sub-resources fail for ordinary reasons (an avatar host that is down) and a cancelled
    // load is what a fast second navigation looks like. Neither is the case this exists for.
    if (!isMainFrame || code === -3) return;
    log(`renderer failed to load ${url}: ${description} (${code})`);
    reveal();
    void win.loadURL(failurePageUrl(url, `${description} (${code})`));
  });

  // The zoom level is per-webContents and would otherwise reset on every launch and every
  // window recreation. Applied after load, because setting it before there is a document
  // is silently dropped.
  win.webContents.on('did-finish-load', () => {
    const level = readSettings().zoomLevel;
    if (typeof level === 'number' && Number.isFinite(level)) {
      win.webContents.setZoomLevel(Math.max(-5, Math.min(5, level)));
    }
  });
  win.webContents.on('zoom-changed', () => {
    writeSettings({ ...readSettings(), zoomLevel: win.webContents.getZoomLevel() });
  });

  void win.loadURL(appUrl());
  if (isDev) win.webContents.openDevTools({ mode: 'detach' });

  // Closing the window hides the app rather than quitting it, on every platform where
  // something is left behind to bring it back. On macOS that is the dock icon; on Windows
  // and Linux it is the tray, which is otherwise a "quick way back" that disappears at the
  // exact moment it would be used — along with the unread badge and the notifications.
  win.on('close', (event) => {
    const hidesOnClose = process.platform === 'darwin' || tray !== null;
    // Only the last window hides; closing one of several is a plain close.
    const lastOne = [...windows].filter((w) => !w.isDestroyed()).length <= 1;
    if (hidesOnClose && lastOne && !isQuitting) {
      event.preventDefault();
      win.hide();
    }
  });

  return win;
}

/**
 * The page shown when the renderer could not be loaded.
 *
 * A data: URL rather than a bundled file, because the failure this reports is "the bundled
 * files cannot be read" — a fallback that lives in the same directory as the thing that
 * failed is a fallback that fails the same way.
 */
function failurePageUrl(url: string, reason: string): string {
  const escape = (s: string): string =>
    s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] ?? c);
  const html = `<!doctype html><meta charset="utf-8"><title>Polaris</title>
<style>
  html { color-scheme: dark light }
  body { font: 13px/1.5 system-ui, sans-serif; margin: 0; display: grid; place-items: center;
         height: 100vh; -webkit-app-region: drag }
  main { max-width: 34em; padding: 24px; text-align: center }
  h1 { font-size: 15px; margin: 0 0 8px }
  p { margin: 0 0 8px; opacity: .75 }
  code { word-break: break-all }
  button { -webkit-app-region: no-drag; margin-top: 12px; font: inherit; padding: 6px 14px }
</style>
<main>
  <h1>Polaris could not start</h1>
  <p>The application files could not be read. Reinstalling usually fixes this.</p>
  <p><code>${escape(url)}</code><br><code>${escape(reason)}</code></p>
  <button onclick="window.polarisDesktop ? window.polarisDesktop.reloadApp() : location.reload()">Retry</button>
</main>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

app.on('before-quit', () => {
  isQuitting = true;
});

function focusMainWindow(): void {
  const win = targetWindow();
  if (win === null) {
    createWindow();
    return;
  }
  if (win.isMinimized()) win.restore();
  if (!win.isVisible()) win.show();
  win.focus();
}

/** The origin of a URL, or null if it is not one. Never throws; callers are handling input. */
function originOf(raw: string): string | null {
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

/**
 * Hands a URL to the operating system, but only the three schemes a link in an issue could
 * legitimately be.
 *
 * `shell.openExternal` launches whichever application claims the scheme, so an unfiltered
 * one is a way for anything that can put a link in front of the user — a comment body, a
 * redirect from a server they do not control — to open a local file or drive another
 * installed application. The allowlist is the whole point; widening it needs a reason.
 */
const EXTERNAL_SCHEMES = new Set(['https:', 'http:', 'mailto:']);

function openExternal(raw: string): void {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return;
  }
  if (!EXTERNAL_SCHEMES.has(url.protocol)) return;
  void shell.openExternal(url.href);
}

// --- menu --------------------------------------------------------------------------

/**
 * The application menu.
 *
 * A Mac application running Electron's default menu says "unfinished" before the user has
 * clicked anything: it is titled after the executable, has no Settings item, and offers
 * nothing the product actually does. This is the smallest menu that reads as native.
 *
 * The Edit roles are not decoration. On macOS ⌘C and ⌘V only reach the renderer because a
 * menu item claims them — an Electron app without an Edit menu is one where copy and paste
 * silently do nothing, which is reported as "the app is broken" and diagnosed as a missing
 * menu about a day later.
 */
/** A menu item that navigates has to raise the window too — on macOS it may be hidden. */
function openRoute(route: string): void {
  focusMainWindow();
  navigateTo(route);
}

function buildMenu(): void {
  const isMac = process.platform === 'darwin';

  // The renderer binds ⌘Z to undoing an *issue* change and ⌘A to selecting every row in a
  // list, and an accelerator the menu registers is swallowed before the page ever sees the
  // keystroke. Electron's edit roles already leave theirs unregistered and route through
  // the platform's own edit machinery instead, which is what makes both work at once — the
  // key reaches the application outside a text field and the field inside one. Stated here
  // rather than inherited, because the whole Edit menu depends on it and a default that
  // changes upstream would break the shortcuts, not the build.
  const passthrough = { registerAccelerator: false } as const;

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? ([
          {
            label: app.name,
            submenu: [
              { role: 'about' },
              { label: 'Check for Updates…', click: () => checkForUpdates({ manual: true }) },
              {
                label: 'Restart to Update',
                // Only meaningful once a build has finished downloading, and a menu item
                // that does nothing is worse than one that is not there.
                visible: updateStatus.state === 'ready',
                click: installUpdate,
              },
              { type: 'separator' },
              {
                label: 'Settings…',
                accelerator: 'CmdOrCtrl+,',
                click: () => openRoute('/settings/notifications'),
              },
              { label: 'Change Server…', click: () => void changeServer() },
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' },
            ],
          },
        ] satisfies MenuItemConstructorOptions[])
      : []),
    {
      label: '&File',
      submenu: [
        { label: 'New Window', accelerator: 'CmdOrCtrl+N', click: () => createWindow() },
        { type: 'separator' },
        ...(isMac
          ? []
          : ([
              {
                label: 'Settings',
                accelerator: 'CmdOrCtrl+,',
                click: () => openRoute('/settings/notifications'),
              },
              { label: 'Change Server…', click: () => void changeServer() },
              { label: 'Check for Updates…', click: () => checkForUpdates({ manual: true }) },
              {
                label: 'Restart to Update',
                visible: updateStatus.state === 'ready',
                click: installUpdate,
              },
              { type: 'separator' },
            ] satisfies MenuItemConstructorOptions[])),
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      label: '&Edit',
      submenu: [
        { role: 'undo', ...passthrough },
        { role: 'redo', ...passthrough },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        ...(isMac
          ? ([{ role: 'pasteAndMatchStyle' }] satisfies MenuItemConstructorOptions[])
          : ([{ role: 'delete' }] satisfies MenuItemConstructorOptions[])),
        { role: 'selectAll', ...passthrough },
      ],
    },
    {
      label: '&View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        {
          // Not the role's default accelerator. On Windows and Linux that is Ctrl+Shift+I,
          // which the renderer binds to the Insights panel — and a menu-registered
          // accelerator is swallowed before the page sees the keystroke, so the product's
          // own shortcut opened devtools instead. F12 is the platform-native spelling
          // anyway; ⌥⌘I is the mac one, and neither collides with the registry.
          role: 'toggleDevTools',
          accelerator: isMac ? 'Alt+Command+I' : 'F12',
        },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        // Electron's zoomIn role registers CommandOrControl+Plus — the *shifted* key — and
        // the one almost everybody presses is the unshifted `=` next to it. Hidden extra
        // items rather than a second visible row, so the menu still reads as three entries.
        { role: 'zoomIn', accelerator: 'CommandOrControl+=', visible: false },
        { role: 'zoomIn', accelerator: 'CommandOrControl+numadd', visible: false },
        { role: 'zoomOut' },
        { role: 'zoomOut', accelerator: 'CommandOrControl+numsub', visible: false },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    // `windowMenu` on macOS rather than a hand-written submenu: the standard list of open
    // windows is part of it, and with ⌘N there is now more than one window to list.
    isMac
      ? { role: 'windowMenu' }
      : {
          label: '&Window',
          submenu: [{ role: 'minimize' }, { role: 'close' }],
        },
    {
      label: '&Help',
      role: 'help',
      submenu: [
        {
          label: 'Polaris Documentation',
          click: () => openExternal('https://github.com/mcpeixoto/polaris'),
        },
        {
          label: 'Report an Issue',
          click: () => openExternal('https://github.com/mcpeixoto/polaris/issues/new'),
        },
        { type: 'separator' },
        // The log is the only evidence a user can attach to "updates never install". A menu
        // item is the difference between it existing and it being findable.
        { label: 'Open Logs', click: () => void shell.openPath(path.dirname(logPath())) },
        ...(isMac
          ? []
          : ([{ type: 'separator' }, { role: 'about' }] as MenuItemConstructorOptions[])),
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// --- tray --------------------------------------------------------------------------

/**
 * The three things worth reaching without the window in front of you. One list, used by the
 * tray menu, the macOS dock menu and the Windows jump list — three surfaces that are the
 * same question asked by three platforms, and that drift apart the moment they are written
 * out separately.
 */
const QUICK_ROUTES: readonly { readonly label: string; readonly route: string }[] = [
  { label: 'Inbox', route: '/inbox' },
  { label: 'My Issues', route: '/my-issues' },
  { label: 'Search', route: '/search' },
];

function createTray(): void {
  // macOS has a dock icon that already does everything a tray icon would — it focuses the
  // app, it carries the unread badge, and it holds the quick-route menu below. A second
  // permanent icon in the menu bar is clutter this product does not need.
  if (process.platform === 'darwin') return;

  // Resolved relative to the compiled main process, which puts it at `assets/tray.png`
  // inside the asar once packaged — see the `files` list in electron-builder.yml, which has
  // to name it explicitly because `assets` is also the buildResources directory and is
  // excluded from the app by default.
  const icon = nativeImage.createFromPath(path.join(__dirname, '../../assets/tray.png'));
  if (icon.isEmpty()) {
    // An empty image gives macOS a tray slot with nothing in it, which the user reads as a
    // rendering bug in their menu bar. No tray at all is the better failure, and the app
    // works without one.
    log('tray icon missing; running without a tray');
    return;
  }

  tray = new Tray(icon);
  updateTrayMenu(0);
  // Windows and Linux deliver a plain left click separately from the context menu, and this
  // is the gesture people use to get the window back after closing it to the tray.
  tray.on('click', focusMainWindow);
}

/** The tray menu, rebuilt when the unread count changes so the count is actually in it. */
function updateTrayMenu(unread: number): void {
  if (tray === null || tray.isDestroyed()) return;
  tray.setToolTip(unread > 0 ? `Polaris — ${unread} unread` : 'Polaris');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open Polaris', click: focusMainWindow },
      { label: unread > 0 ? `${unread} unread` : 'No unread', enabled: false },
      { type: 'separator' },
      ...QUICK_ROUTES.map((entry) => ({ label: entry.label, click: () => openRoute(entry.route) })),
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          // The window hides rather than closes on this platform now, so quitting has to say
          // so explicitly — otherwise `app.quit()` runs into the close handler that hides.
          isQuitting = true;
          app.quit();
        },
      },
    ]),
  );
}

/** The dock and jump-list menus: the same quick routes, in each platform's own shape. */
function createLauncherMenus(): void {
  if (process.platform === 'darwin') {
    app.dock?.setMenu(
      Menu.buildFromTemplate(
        QUICK_ROUTES.map((entry) => ({ label: entry.label, click: () => openRoute(entry.route) })),
      ),
    );
    return;
  }
  if (process.platform !== 'win32') return;
  try {
    app.setJumpList([
      {
        type: 'tasks',
        items: QUICK_ROUTES.map((entry) => ({
          type: 'task' as const,
          title: entry.label,
          program: process.execPath,
          // Launched as a deep link rather than as a private flag, so the route travels the
          // one path that is already tested — including when the app is already running and
          // the second instance hands its argv over.
          args: `polaris:/${entry.route}`,
          description: `Open ${entry.label} in Polaris`,
        })),
      },
    ]);
  } catch (error) {
    // setJumpList throws if the app is not registered with the Start menu — an unpacked
    // development run, or a portable copy. Not a reason to fail a launch.
    log('jump list not set:', error);
  }
}

// --- deep links --------------------------------------------------------------------

/**
 * Deep links: polaris://issue/ENG-123 and the OAuth callback.
 *
 * The renderer owns routing, so the main process only translates the URL into an
 * application path and hands it over. It arrives by three different routes depending on the
 * platform and whether the app was already running, and all three end up here:
 *
 *   - macOS, any time: `open-url`, which can fire *before* `ready` on a cold start.
 *   - Windows and Linux, cold start: in `process.argv` of the first process.
 *   - Everywhere, already running: `second-instance` with the new process's argv.
 */
function deepLinkFromArgv(argv: readonly string[]): string | undefined {
  return argv.find((a) => a.startsWith('polaris://'));
}

/**
 * The route prefixes a link is allowed to name.
 *
 * An allowlist because this is an *external* input: anything on the machine can hand the app
 * a `polaris://` URL, and the renderer treats what arrives as a route it navigated to itself.
 * The documented shapes are the ones the product publishes links for; anything else is
 * either a typo or somebody probing, and both are better dropped than followed.
 */
const DEEP_LINK_PREFIXES = [
  'issue',
  'project',
  'initiative',
  'document',
  'workspace',
  'team',
  'view',
  'inbox',
  'my-issues',
  'search',
  'settings',
] as const;

/** `polaris://issue/ENG-123` becomes `/issue/ENG-123`. Null for anything that is not a link. */
function routeOf(url: string | undefined): string | null {
  if (url === undefined) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    // A malformed link is a user pasting something odd, not an error worth surfacing.
    return null;
  }

  // The OAuth callback is not a page path, and routing it as one would push an authorisation
  // code into the renderer's history — where it stays, readable, long after it was spent.
  // It has its own branch that consumes the parameters and lands on a clean URL.
  if (parsed.host === 'oauth' || parsed.host === 'auth') {
    // Nothing consumes the parameters yet — the desktop OAuth flow is not built — so they
    // are dropped here rather than carried. That is the safe half of the eventual handling,
    // and the half that has to exist first: without this branch the query string was routed
    // as a page path today.
    log('oauth callback received; the desktop flow is not implemented, landing on /login');
    return '/login';
  }

  if (!(DEEP_LINK_PREFIXES as readonly string[]).includes(parsed.host)) {
    log(`ignoring deep link with an unknown prefix: ${parsed.host}`);
    return null;
  }
  // The fragment is part of the route — `polaris://issue/ENG-123#comment-5` is a link to a
  // comment, and dropping it silently lands the reader at the top of a long thread.
  return `/${parsed.host}${parsed.pathname}${parsed.search}${parsed.hash}`;
}

/** Set when a link arrives before the app is ready; delivered by `whenReady`. */
let pendingDeepLink: string | null = null;

function routeDeepLink(url: string | undefined): void {
  const route = routeOf(url);
  if (route === null) return;

  // On macOS a link that launched the app arrives before there is an app to show it in.
  // Creating a BrowserWindow here would throw; holding it costs one string.
  if (!app.isReady()) {
    pendingDeepLink = route;
    return;
  }

  focusMainWindow();
  navigateTo(route);
}

/**
 * Asks the renderer to go somewhere.
 *
 * Sent as soon as the document has loaded rather than when React has mounted, because the
 * main process has no way to know the difference. The preload holds anything that arrives
 * before the application subscribes — see preload.cts, which is where that gap is closed.
 */
function navigateTo(route: string): void {
  const contents = targetWindow()?.webContents;
  if (!contents || contents.isDestroyed()) return;

  if (contents.isLoading()) {
    contents.once('did-finish-load', () => contents.send('polaris:navigate', route));
    return;
  }
  contents.send('polaris:navigate', route);
}

app.on('open-url', (event, url) => {
  event.preventDefault();
  routeDeepLink(url);
});

// --- the renderer ------------------------------------------------------------------

/**
 * The Content-Security-Policy the bundled renderer runs under.
 *
 * The shell decides this rather than the HTML, because `connect-src` cannot be known until
 * the user has said which server is theirs — a policy baked into index.html would either
 * name a server that does not exist or allow every origin, and the second is not a policy.
 *
 * `script-src` keeps `'unsafe-inline'` for one reason: index.html inlines the theme
 * bootstrap so a dark-mode user never sees a white flash, and a hash would silently break
 * the moment that script changed by a character. What the directive still buys is the part
 * that matters in a shell — no script may be *fetched* from anywhere but the app's own
 * scheme, so a compromised or hostile server cannot get code into the renderer.
 */
function contentSecurityPolicy(): string {
  const api = serverUrl === '' ? [] : [serverUrl, serverUrl.replace(/^http/, 'ws')];

  return [
    "default-src 'none'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    // Avatars and workspace logos are URLs the workspace sets, so they are not 'self'.
    // Images are the one sink here that cannot execute, which is why this is the loose one.
    `img-src 'self' data: blob: https: ${serverUrl}`.trimEnd(),
    "font-src 'self' data:",
    "manifest-src 'self'",
    ['connect-src', "'self'", ...api].join(' '),
    "worker-src 'self' blob:",
    "media-src 'self' blob:",
    // Nothing in this app frames anything, and nothing may frame it.
    "frame-src 'none'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
}

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
async function isFile(candidate: string): Promise<boolean> {
  try {
    return (await fs.promises.stat(candidate)).isFile();
  } catch {
    return false;
  }
}

function serveRenderer(): void {
  const root = path.join(process.resourcesPath, 'renderer');

  const index = path.join(root, 'index.html');

  protocol.handle(APP_SCHEME, async (request) => {
    const url = new URL(request.url);
    // decodeURIComponent throws URIError on a lone `%`, which a bundler plugin or a filename
    // with a percent sign can produce. Uncaught it rejects the request with no diagnostic at
    // all; treated as "no such file" it degrades to the single-page-app fallback below.
    let resolved: string | null = null;
    try {
      resolved = path.join(root, path.normalize(decodeURIComponent(url.pathname)));
    } catch {
      resolved = null;
    }

    // path.join normalises away the ../ segments, so this comparison is what actually
    // stops traversal rather than the normalisation above.
    const inside = resolved !== null && (resolved === root || resolved.startsWith(root + path.sep));
    // Asynchronous stat, not existsSync/statSync: this handler runs on the main process's
    // thread and serves every chunk, font and image the renderer asks for, so a synchronous
    // filesystem call here is a stall in the same loop that draws the menus.
    const target = inside && resolved !== null && (await isFile(resolved)) ? resolved : index;

    // pathToFileURL rather than string concatenation: a Windows drive letter and a space in
    // a user's install path both produce a URL that silently resolves to nothing otherwise.
    const response = await net.fetch(pathToFileURL(target).href);

    // The policy is attached here rather than to the document alone: every asset the page
    // pulls comes back through this handler, and a header on only the HTML is a policy that
    // a single mis-typed URL routes around.
    const headers = new Headers(response.headers);
    headers.set('Content-Security-Policy', contentSecurityPolicy());
    return new Response(response.body, { status: response.status, headers });
  });
}

/**
 * What the renderer is allowed to ask the operating system for.
 *
 * Denied by default rather than allowed by default, because the list of permissions
 * Chromium grows is not one this app tracks — a geolocation or MIDI prompt appearing in an
 * issue tracker is a bug whether or not anybody meant it. Notifications go through the
 * main process instead (see `polaris:notify`), so the renderer never needs that one.
 */
const ALLOWED_PERMISSIONS = new Set(['clipboard-sanitized-write']);

function lockDownSession(): void {
  const defaultSession = session.defaultSession;

  // The spellchecker otherwise uses whatever the OS locale happens to be, with no way to add
  // a second language — which for a team writing English issues on a German laptop is a
  // document underlined end to end. The user's locale first, English always, and anything
  // Chromium does not have a dictionary for dropped rather than thrown.
  const wanted = [app.getLocale(), app.getSystemLocale(), 'en-US'];
  const supported = new Set(defaultSession.availableSpellCheckerLanguages);
  const languages = [...new Set(wanted.filter((code) => supported.has(code)))];
  if (languages.length > 0) defaultSession.setSpellCheckerLanguages(languages);

  defaultSession.setPermissionRequestHandler((_contents, permission, callback) => {
    callback(ALLOWED_PERMISSIONS.has(permission));
  });
  defaultSession.setPermissionCheckHandler((_contents, permission) =>
    ALLOWED_PERMISSIONS.has(permission),
  );
  // USB, HID and serial. Nothing in an issue tracker needs a device, and a shell that can
  // reach one is a shell worth attacking.
  defaultSession.setDevicePermissionHandler(() => false);
}

/**
 * The guards every web contents gets, whether or not this file created it.
 *
 * Attached here rather than in `createWindow` because "there is exactly one window" stopped
 * being true: a second window, a devtools contents, anything a future feature opens would
 * otherwise inherit none of these. A navigation guard that only covers the windows somebody
 * remembered to wire is not a guard.
 */
app.on('web-contents-created', (_event, contents) => {
  // Belt and braces over `webviewTag: false`: a <webview> gets its own webPreferences, and a
  // tag that slipped past the flag would otherwise be free to set nodeIntegration itself.
  contents.on('will-attach-webview', (event) => event.preventDefault());

  // Anything that is not the app itself opens in the user's browser. Without this an
  // external link navigates the app window and there is no back button to return from.
  contents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: 'deny' };
  });

  contents.on('will-navigate', (event, url) => {
    // The app may navigate within itself and nowhere else. Anything else — a link in a
    // comment, a redirect from a misconfigured server — opens in the user's browser rather
    // than replacing the application with a page that has no way back.
    const ownOrigin = isDev ? new URL(DEV_SERVER).origin : APP_ORIGIN;
    if (originOf(url) === ownOrigin) return;
    event.preventDefault();
    openExternal(url);
  });

  contents.on('context-menu', (_event, params) => showContextMenu(contents, params));

  // A renderer that stops pumping its message loop is a frozen app with no menu bar on
  // Windows (`autoHideMenuBar`) and therefore no way to reload. Offering the reload is the
  // difference between a hang the user recovers from and one they force-quit.
  contents.on('unresponsive', () => {
    log('renderer became unresponsive');
    const win = BrowserWindow.fromWebContents(contents);
    void dialog
      .showMessageBox({
        type: 'warning',
        buttons: ['Wait', 'Reload'],
        defaultId: 0,
        cancelId: 0,
        message: 'Polaris is not responding',
        detail: 'Reloading keeps your synced data; anything typed and not yet saved is lost.',
      })
      .then(({ response }) => {
        if (response === 1 && win !== null && !win.isDestroyed()) contents.reload();
      });
  });
});

/**
 * A renderer crash, once.
 *
 * Reloaded automatically the first time, because the overwhelmingly common cause is a
 * transient out-of-memory in one tab-sized process and the user's session survives it. Not
 * the second time within a minute: a crash that reproduces on load is a reload loop, and a
 * loop is worse than a blank window because it never stops long enough to read anything.
 */
let recentRendererCrashes = 0;

app.on('render-process-gone', (_event, contents, details) => {
  log(`renderer gone: ${details.reason} (exit ${details.exitCode})`);
  if (details.reason === 'clean-exit') return;

  recentRendererCrashes += 1;
  setTimeout(() => (recentRendererCrashes = Math.max(0, recentRendererCrashes - 1)), 60_000);

  const win = BrowserWindow.fromWebContents(contents);
  if (win === null || win.isDestroyed()) return;

  if (recentRendererCrashes <= 1) {
    void win.loadURL(appUrl());
    return;
  }
  void win.loadURL(
    failurePageUrl(appUrl(), `The window stopped unexpectedly (${details.reason}).`),
  );
});

// The default for an uncaught throw in the main process is Electron's raw modal, which names
// a stack frame and offers nothing. Logged first so there is something to send with a bug
// report, then reported in the app's own words. Not exiting: most of these are a failed
// native call, and an app that is still running is still recoverable.
process.on('uncaughtException', (error: Error) => {
  log('uncaught exception in the main process:', error);
  if (app.isReady()) {
    dialog.showErrorBox('Polaris hit an unexpected error', `${error.message}\n\n${logPath()}`);
  }
});

process.on('unhandledRejection', (reason: unknown) => {
  log('unhandled rejection in the main process:', reason);
});

/**
 * The right-click menu.
 *
 * `spellcheck: true` on its own underlines a misspelling and then offers nothing when it is
 * clicked, which reads as a broken feature rather than a missing one. Cut/copy/paste are
 * here for the same reason: on Windows the context menu, not the Edit menu, is the gesture
 * people actually reach for.
 */
function showContextMenu(contents: WebContents, params: Electron.ContextMenuParams): void {
  const items: MenuItemConstructorOptions[] = [];

  for (const suggestion of params.dictionarySuggestions.slice(0, 5)) {
    items.push({ label: suggestion, click: () => contents.replaceMisspelling(suggestion) });
  }
  if (params.dictionarySuggestions.length > 0) items.push({ type: 'separator' });
  if (params.misspelledWord !== '') {
    items.push({
      label: 'Add to Dictionary',
      click: () => contents.session.addWordToSpellCheckerDictionary(params.misspelledWord),
    });
    items.push({ type: 'separator' });
  }

  if (params.linkURL !== '') {
    const link = params.linkURL;
    items.push({ label: 'Open Link', click: () => openExternal(link) });
    items.push({
      label: 'Copy Link Address',
      click: () => clipboard.writeText(link),
    });
    items.push({ type: 'separator' });
  }

  items.push(
    { role: 'cut', enabled: params.editFlags.canCut },
    { role: 'copy', enabled: params.editFlags.canCopy },
    { role: 'paste', enabled: params.editFlags.canPaste },
    { type: 'separator' },
    { role: 'selectAll', enabled: params.editFlags.canSelectAll },
  );

  Menu.buildFromTemplate(items).popup();
}

// --- updates -----------------------------------------------------------------------

let manualUpdateCheck = false;

/**
 * What the renderer is told about updates.
 *
 * The shell used to download a new version and say nothing: the update landed on the next
 * quit, and on a laptop that is never quit that is several versions behind indefinitely.
 * The status is pushed to every window so the app can offer the restart itself — a quiet row
 * the user clicks when they are between things, rather than a modal in the middle of one.
 */
type UpdateStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'available'; version: string }
  | { state: 'downloading'; percent: number }
  | { state: 'ready'; version: string }
  | { state: 'error'; message: string };

let updateStatus: UpdateStatus = { state: 'idle' };
let lastUpdateCheck = 0;

function setUpdateStatus(next: UpdateStatus): void {
  updateStatus = next;
  for (const win of windows) {
    if (!win.isDestroyed()) win.webContents.send('polaris:update-status', next);
  }
  // The menu carries a "Restart to Update" item whose visibility depends on this, and a
  // menu template is a snapshot — it has to be rebuilt for the item to appear.
  if (next.state === 'ready' || next.state === 'idle') buildMenu();
}

function installUpdate(): void {
  if (updateStatus.state !== 'ready') return;
  // Set first, or the close handler that hides the window on quit fights quitAndInstall and
  // the app stays running with the installer waiting behind it.
  isQuitting = true;
  autoUpdater.quitAndInstall();
}

/**
 * Auto-update against the GitHub releases the CI workflow publishes.
 *
 * The error listener is not optional. `autoUpdater` is an EventEmitter, and an 'error' with
 * no listener is re-thrown — so a feed that 404s, which is exactly what happens to anybody
 * who forks this and never configures one, takes down the main process and replaces the
 * application with a dialog. A self-hosted product has to treat a failed update check as
 * the ordinary case.
 */
function wireUpdater(): void {
  autoUpdater.on('error', (error: Error) => {
    log('update check failed:', error.message);
    setUpdateStatus({ state: 'error', message: error.message });
    if (!manualUpdateCheck) return;
    manualUpdateCheck = false;
    void dialog.showMessageBox({
      type: 'warning',
      message: 'Could not check for updates',
      detail: error.message,
      buttons: ['OK'],
    });
  });

  autoUpdater.on('checking-for-update', () => setUpdateStatus({ state: 'checking' }));

  autoUpdater.on('update-available', (info: { version: string }) => {
    setUpdateStatus({ state: 'available', version: info.version });
  });

  autoUpdater.on('download-progress', (progress: { percent: number }) => {
    setUpdateStatus({ state: 'downloading', percent: Math.round(progress.percent) });
  });

  autoUpdater.on('update-not-available', () => {
    setUpdateStatus({ state: 'idle' });
    if (!manualUpdateCheck) return;
    manualUpdateCheck = false;
    void dialog.showMessageBox({
      type: 'info',
      message: `Polaris ${app.getVersion()} is the latest version.`,
      buttons: ['OK'],
    });
  });

  autoUpdater.on('update-downloaded', (info: { version: string }) => {
    manualUpdateCheck = false;
    setUpdateStatus({ state: 'ready', version: info.version });
  });
}

/**
 * The check a `setInterval` cannot make.
 *
 * An interval does not run while the machine is asleep, so a laptop closed for a week checks
 * once on wake at the earliest — and only if the timer happens to be due. Coming back to the
 * app, and waking the machine, are both moments where a check is free and wanted.
 */
const UPDATE_INTERVAL_MS = 4 * 60 * 60 * 1000;

function checkForUpdatesIfStale(): void {
  if (isDev) return;
  if (Date.now() - lastUpdateCheck < UPDATE_INTERVAL_MS) return;
  checkForUpdates({ manual: false });
}

function checkForUpdates({ manual }: { manual: boolean }): void {
  // In development there is no packaged app to replace and electron-updater says so with an
  // error dialog, which is noise rather than information.
  if (isDev) {
    if (manual) {
      void dialog.showMessageBox({
        type: 'info',
        message: 'Updates are only checked in a packaged build.',
        buttons: ['OK'],
      });
    }
    return;
  }
  manualUpdateCheck = manual;
  lastUpdateCheck = Date.now();
  // Caught as well as listened for. `checkForUpdatesAndNotify` both emits 'error' *and*
  // returns a promise that rejects, so handling only the event still leaves an unhandled
  // rejection — which is a warning today and process-fatal the day Electron changes the
  // default. The listener above is the one that reports; this only absorbs the duplicate.
  autoUpdater.checkForUpdatesAndNotify().catch(() => {});
}

// --- server ------------------------------------------------------------------------

/**
 * Points this installation at a different server.
 *
 * The window is recreated rather than reloaded, because the server URL is read once when
 * the window is built and handed to the preload as a launch argument. Reloading would keep
 * the old value and produce an app that appears to accept the new address and then talks to
 * the old one — which is far more confusing than a window that blinks.
 */
function applyServerUrl(next: string): void {
  serverUrl = next;
  if (!writeSettings({ ...readSettings(), serverUrl: next })) {
    // A window rectangle that fails to save is a nuisance; a server address that fails to
    // save is an app that asks for it again on the next launch with no explanation, and the
    // user has no way to connect that to the read-only home directory it came from.
    dialog.showErrorBox(
      'Polaris could not save the server address',
      `Polaris will work until you quit, and then ask for the address again.\n\n${settingsPath()}`,
    );
  }

  // Every window is replaced, not just the focused one: the server URL is a launch argument
  // of the window, so any that survived would keep talking to the old server.
  const previous = [...windows];
  createWindow();
  for (const win of previous) win.destroy();
}

/**
 * Forgets the server, so the next window asks again.
 *
 * Somebody who mistypes their address on first run has otherwise painted themselves into a
 * corner: the app only offers the "connect to your server" screen when no server is set, so
 * a wrong-but-valid address is a permanently broken installation with no way back that does
 * not involve deleting a JSON file they have never heard of.
 *
 * The local replica goes with it. A replica is a copy of one workspace on one server, and
 * carrying it across would leave issues the new server will never send a revoke for. The
 * renderer does this for itself on the normal path; from here the shell has to.
 */
async function changeServer(): Promise<void> {
  const { response } = await dialog.showMessageBox({
    type: 'warning',
    buttons: ['Cancel', 'Disconnect'],
    defaultId: 1,
    cancelId: 0,
    message: 'Disconnect from this server?',
    detail:
      'Polaris will ask for a server address again. The offline copy of this workspace is deleted, and downloaded again when you sign in.',
  });
  if (response !== 1) return;

  await session.defaultSession.clearStorageData();
  applyServerUrl('');
}

// --- launch ------------------------------------------------------------------------

// Guarded on the lock rather than trusting `app.exit` to have taken effect: the losing
// process keeps evaluating this module, and a second copy that reaches `createWindow` flashes
// a window and grabs the tray for however long it has left.
if (hasInstanceLock) {
  void app.whenReady().then(onReady);
}

function onReady(): void {
  // The AUMID is what ties this process to the Start-menu shortcut electron-builder writes.
  // Without it Windows attributes toast notifications to `electron.app.Polaris` or drops
  // them, taskbar pinning is unreliable, and `setJumpList` has nothing to attach to. It must
  // stay identical to `appId` in electron-builder.yml.
  if (process.platform === 'win32') app.setAppUserModelId('com.peixotolabs.polaris');

  registerProtocolClient();
  lockDownSession();
  if (!isDev) serveRenderer();
  buildMenu();
  createWindow();
  createTray();
  createLauncherMenus();

  // The window background and the Windows controls overlay are both colours, and a user who
  // switches their system to light mode should not be left with the dark ones until relaunch.
  nativeTheme.on('updated', () => {
    for (const win of windows) {
      if (win.isDestroyed()) continue;
      win.setBackgroundColor(windowBackground());
      if (process.platform === 'win32') win.setTitleBarOverlay?.(titleBarOverlayColors());
    }
  });

  // A link that launched the app arrives through `open-url` on macOS — before `ready`, hence
  // the buffer — and in argv on Windows and Linux. Whichever it was, there is a window now.
  const coldStartRoute = pendingDeepLink ?? routeOf(deepLinkFromArgv(process.argv));
  pendingDeepLink = null;
  if (coldStartRoute !== null) navigateTo(coldStartRoute);

  wireUpdater();
  if (!isDev) {
    // Checked on launch and then every four hours, per the cadence in
    // docs/05-infrastructure/06-desktop-electron.md. Downloaded in the background; the
    // renderer offers the restart, so an update never interrupts somebody mid-sentence.
    checkForUpdates({ manual: false });
    setInterval(() => checkForUpdates({ manual: false }), UPDATE_INTERVAL_MS);
    // An interval does not tick through sleep. Waking is the other moment a check is due.
    powerMonitor.on('resume', checkForUpdatesIfStale);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else focusMainWindow();
  });
}

/**
 * Claims `polaris://`.
 *
 * The one-argument form is wrong in development on Windows: it registers `electron.exe`, so
 * a link opened during a dev session launches a bare Electron rather than this app. The
 * three-argument form names the executable and the script it should be handed.
 */
function registerProtocolClient(): void {
  const script = isDev && process.platform === 'win32' ? process.argv[1] : undefined;
  if (script !== undefined) {
    app.setAsDefaultProtocolClient('polaris', process.execPath, [path.resolve(script)]);
    return;
  }
  app.setAsDefaultProtocolClient('polaris');
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// --- the preload bridge's other end ------------------------------------------------

/**
 * Unread count on the dock, the taskbar and the tray.
 *
 * Windows has no text badge: `setOverlayIcon` draws an *image*, and passing null — which is
 * what this used to do — removes the overlay and leaves the count reaching nothing but the
 * screen reader. The renderer draws the digits, because the renderer is the side with a
 * canvas and a font, and hands the PNG over with the number.
 */
ipcMain.on('polaris:set-badge', (_event, count: number, icon?: string) => {
  if (process.platform === 'darwin') {
    app.dock?.setBadge(count > 0 ? String(count) : '');
  } else {
    const win = targetWindow();
    const overlay =
      count > 0 && typeof icon === 'string' ? nativeImage.createFromDataURL(icon) : null;
    // A data URL the decoder rejected is an empty image, which draws as a blank square on the
    // taskbar button. No overlay is the better failure.
    win?.setOverlayIcon(
      overlay !== null && !overlay.isEmpty() ? overlay : null,
      count > 0 ? `${count} unread` : '',
    );
    // Linux has no overlay at all; the launcher badge is the count itself.
    if (process.platform === 'linux') app.badgeCount = count;
  }
  updateTrayMenu(count);
});

ipcMain.on('polaris:notify', (_event, payload: { title: string; body: string; route?: string }) => {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title: payload.title, body: payload.body, silent: false });
  n.on('click', () => {
    focusMainWindow();
    if (payload.route) navigateTo(payload.route);
  });
  n.show();
});

ipcMain.handle('polaris:platform', () => ({
  os: process.platform,
  version: app.getVersion(),
  isDesktop: true,
}));

/**
 * The renderer clears its own replica before calling this: a local database is a copy of one
 * workspace on one server, and carrying it across would leave issues the new server will
 * never send a revoke for.
 */
ipcMain.handle('polaris:set-server-url', (_event, raw: string) => {
  // A reply, not a fire-and-forget. The screen that calls this shows a spinner and expects
  // the window to be replaced underneath it — so the two paths that do nothing used to leave
  // that spinner turning forever, with force-quit as the only way out. Retyping the address
  // you are already connected to is the ordinary way somebody tries to fix a connection
  // problem, and it is one of those two paths.
  const next = validServerUrl(raw);
  if (next === null) {
    return { ok: false, reason: 'That does not look like a server address.' };
  }
  if (next === serverUrl) {
    return { ok: false, reason: `Already connected to ${next}.` };
  }
  applyServerUrl(next);
  return { ok: true };
});

ipcMain.on('polaris:install-update', installUpdate);

/**
 * Reloads the app after a failed load.
 *
 * Called only from the failure page, which is a data: URL and cannot navigate itself back to
 * the app's scheme. A named method rather than a generic reload channel, because the whole
 * point of this bridge is that every operation on it is one the main process chose to offer.
 */
ipcMain.on('polaris:reload-app', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win === null || win.isDestroyed()) return;
  void win.loadURL(appUrl());
});
