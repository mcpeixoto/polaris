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
  net,
  protocol,
  screen,
  session,
  Tray,
  Menu,
  nativeImage,
  Notification,
  type MenuItemConstructorOptions,
  type Rectangle,
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
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8');
    fs.renameSync(tmp, file);
  } catch {
    // Losing a window position or having to retype a server address is a nuisance. Taking
    // the main process down over a read-only home directory is not a trade worth making.
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

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;

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
    writeSettings({ ...readSettings(), window: { x, y, width, height, maximized: win.isMaximized() } });
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

function createWindow(): BrowserWindow {
  const bounds = restoredBounds();

  const win = new BrowserWindow({
    ...bounds,
    minWidth: 720,
    minHeight: 480,
    // The traffic lights sit inside the app's own chrome, which is what lets the sidebar
    // run to the top edge the way a native application does.
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 16, y: 16 },
    // Windows and Linux keep a real menu for its accelerators, but a keyboard-first product
    // showing a File/Edit strip above its own chrome reads as a wrapped web page. Alt still
    // reveals it for anybody who goes looking.
    autoHideMenuBar: true,
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

  if (bounds.maximized) win.maximize();
  trackWindowState(win);

  win.once('ready-to-show', () => win.show());

  // Anything that is not the app itself opens in the user's browser. Without this an
  // external link navigates the app window and there is no back button to return from.
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (event, url) => {
    // The app may navigate within itself and nowhere else. Anything else — a link in a
    // comment, a redirect from a misconfigured server — opens in the user's browser rather
    // than replacing the application with a page that has no way back.
    const ownOrigin = isDev ? new URL(DEV_SERVER).origin : APP_ORIGIN;
    if (originOf(url) === ownOrigin) return;
    event.preventDefault();
    openExternal(url);
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

app.on('before-quit', () => {
  isQuitting = true;
});

function focusMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (!mainWindow.isVisible()) mainWindow.show();
  mainWindow.focus();
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
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: '&Window',
      submenu: [
        { role: 'minimize' },
        ...(isMac
          ? ([
              { role: 'zoom' },
              { type: 'separator' },
              { role: 'front' },
            ] satisfies MenuItemConstructorOptions[])
          : ([{ role: 'close' }] satisfies MenuItemConstructorOptions[])),
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// --- tray --------------------------------------------------------------------------

function createTray(): void {
  // Resolved relative to the compiled main process, which puts it at `assets/tray.png`
  // inside the asar once packaged — see the `files` list in electron-builder.yml, which has
  // to name it explicitly because `assets` is also the buildResources directory and is
  // excluded from the app by default.
  const icon = nativeImage.createFromPath(path.join(__dirname, '../../assets/tray.png'));
  if (icon.isEmpty()) {
    // An empty image gives macOS a tray slot with nothing in it, which the user reads as a
    // rendering bug in their menu bar. No tray at all is the better failure, and the app
    // works without one.
    console.warn('[polaris] tray icon missing; running without a tray');
    return;
  }

  // A template image is recoloured by macOS to match the menu bar, so it stays legible in
  // both light and dark mode without shipping two assets. Windows and Linux draw the PNG
  // as it is, and setting the flag there would be a lie about a platform behaviour.
  if (process.platform === 'darwin') icon.setTemplateImage(true);

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

/** `polaris://issue/ENG-123` becomes `/issue/ENG-123`. Null for anything that is not a link. */
function routeOf(url: string | undefined): string | null {
  if (url === undefined) return null;
  try {
    const parsed = new URL(url);
    return `/${parsed.host}${parsed.pathname}${parsed.search}`;
  } catch {
    // A malformed link is a user pasting something odd, not an error worth surfacing.
    return null;
  }
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
  const contents = mainWindow?.webContents;
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
  const api =
    serverUrl === '' ? [] : [serverUrl, serverUrl.replace(/^http/, 'ws')];

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

// Belt and braces over `webviewTag: false`: a <webview> gets its own webPreferences, and a
// tag that slipped past the flag would otherwise be free to set nodeIntegration itself.
app.on('web-contents-created', (_event, contents) => {
  contents.on('will-attach-webview', (event) => event.preventDefault());
});

// --- updates -----------------------------------------------------------------------

let manualUpdateCheck = false;

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
    console.warn('[polaris] update check failed:', error.message);
    if (!manualUpdateCheck) return;
    manualUpdateCheck = false;
    void dialog.showMessageBox({
      type: 'warning',
      message: 'Could not check for updates',
      detail: error.message,
      buttons: ['OK'],
    });
  });

  autoUpdater.on('update-not-available', () => {
    if (!manualUpdateCheck) return;
    manualUpdateCheck = false;
    void dialog.showMessageBox({
      type: 'info',
      message: `Polaris ${app.getVersion()} is the latest version.`,
      buttons: ['OK'],
    });
  });

  autoUpdater.on('update-downloaded', () => {
    manualUpdateCheck = false;
  });
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
  writeSettings({ ...readSettings(), serverUrl: next });

  const old = mainWindow;
  mainWindow = createWindow();
  old?.destroy();
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

void app.whenReady().then(() => {
  app.setAsDefaultProtocolClient('polaris');
  lockDownSession();
  if (!isDev) serveRenderer();
  buildMenu();
  mainWindow = createWindow();
  createTray();

  // A link that launched the app arrives through `open-url` on macOS — before `ready`, hence
  // the buffer — and in argv on Windows and Linux. Whichever it was, there is a window now.
  const coldStartRoute = pendingDeepLink ?? routeOf(deepLinkFromArgv(process.argv));
  pendingDeepLink = null;
  if (coldStartRoute !== null) navigateTo(coldStartRoute);

  wireUpdater();
  if (!isDev) {
    // Checked on launch and then daily. Downloaded in the background and applied on the
    // next quit, so an update never interrupts somebody mid-sentence.
    checkForUpdates({ manual: false });
    setInterval(() => checkForUpdates({ manual: false }), 24 * 60 * 60 * 1000);
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
ipcMain.on('polaris:set-server-url', (_event, raw: string) => {
  const next = validServerUrl(raw);
  if (next === null || next === serverUrl) return;
  applyServerUrl(next);
});
