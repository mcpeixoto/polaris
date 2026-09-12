# Desktop app (Electron, Windows + macOS)

The desktop app is a **shell**, not a second product. It loads the same `web/dist` bundle and adds the capabilities a browser can't provide. Every feature must work in the browser too; the shell only makes them better.

## What the shell exists to provide

Straight from the product spec (`01-features/19-clients-sync-preferences.md`):

| Capability | Why a browser can't |
|---|---|
| Native OS notifications | Safari has no Push API support; browser notifications are unreliable and permission-gated |
| Dock / taskbar unread badge | Not available cross-browser |
| In-app tabs | Multiple workspaces/views without browser chrome |
| Global keyboard shortcuts | Browsers reserve most useful chords |
| `polaris://` protocol handler | Deep links from Slack, email, and the web app |
| Localhost handoff | The web app probes ports to detect the desktop app and hand a URL over |
| Terminal / coding-tool launch | "Open issue in Cursor/Claude Code" needs local process spawning |
| Larger, durable offline cache | IndexedDB quotas in browsers are eviction-prone |
| Auto-update | — |

## Process architecture

```
main process (Node)
├── window manager      BrowserWindow(s), tab strip state, position persistence
├── notifications       native notifications, click → focus + route
├── badge               app.setBadgeCount (macOS) / overlay icon (Windows)
├── tray                Windows/Linux only: hide-to-tray, quick routes, inbox count
├── protocol            polaris:// registration + argv/open-url handling
├── localhost probe     tiny HTTP server on 44450 / 18450 / 33234
├── updater             electron-updater, GitHub Releases feed
├── deep storage        userData path for the IndexedDB partition
├── coding tools        spawn CLI/GUI editors with issue context
└── IPC                 typed channels only

preload (contextBridge)
└── window.polaris = { notify, setBadge, openExternal, openInTool,
                       onDeepLink, getVersion, checkForUpdate, platform }

renderer
└── the same React bundle as the web app
```

Security baseline, non-negotiable:
```js
new BrowserWindow({
  webPreferences: {
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    preload: path.join(__dirname, 'preload.js'),
  },
})
```
Plus: `session.setPermissionRequestHandler` denying everything not explicitly needed, a strict CSP, `shell.openExternal` only after URL validation, and `will-navigate` blocked to anything outside the app origin. An Electron app with `nodeIntegration: true` loading remote content is a remote-code-execution vector.

Google sign-in does not load Google Identity Services inside the shell: the CSP refuses
third-party scripts, and `polaris-app://` is not an origin Google will initialise. The
renderer draws a "Continue with Google" button; the main process opens the system browser,
listens on `http://127.0.0.1:42773/oauth2redirect`, and exchanges the authorization code
for an ID token (PKCE, same shape as iOS). That redirect URI must be listed on the Web
OAuth client — see `docs/05-infrastructure/11-self-hosting.md`.

## Loading strategy: bundled, not remote

Ship `web/dist` **inside** the app and point it at the API.

```
app://  → bundled index.html + assets   (loaded from disk, instant, offline-capable)
https://polaris.example.com/graphql → API
wss://polaris.example.com/sync      → sync
```

Rejected alternative: loading the web app remotely (`loadURL('https://…')`). It sounds simpler and means the desktop app is broken whenever the box is down, has a blank-window cold start, and inherits browser cache semantics for the shell itself. The whole point of a local-first product is that the UI works before the network does.

**Version skew** is the cost of bundling: a desktop app can be older than the server. A minimum-client header and blocking update screen remain a proposed compatibility mechanism, not an implemented guarantee. The `clientSchema` mechanism in the sync protocol already forces re-bootstrap on incompatible data shapes.

## The runtime shim

The React bundle must not know it's in Electron beyond one module:

```ts
// web/src/platform/index.ts
export interface Platform {
  kind: 'web' | 'desktop'
  notify(n: Notification): void
  setBadge(count: number): void
  openInTool(tool: string, ctx: IssueContext): Promise<void>
  onDeepLink(cb: (url: string) => void): () => void
  checkForUpdate?(): Promise<UpdateStatus>
}

export const platform: Platform =
  typeof window !== 'undefined' && window.polaris ? desktopPlatform : webPlatform
```

`webPlatform` degrades: Web Notifications API where permitted, `document.title` for unread counts, `window.open` for external tools. **No `if (isElectron)` anywhere else in the codebase.**

## Localhost handoff

The web app checks whether the desktop app is running so it can hand links over:

```
browser → GET http://127.0.0.1:44450/ping   (then 18450, 33234)
        → {"app":"polaris","version":"1.4.0"}
        → if present, navigate to polaris://issue/ENG-123
```

Notes learned from the source product's own support docs:
- Chromium's **Local Network Access** prompt can block these probes; detect the failure and show the "allow local network access" hint rather than silently doing nothing.
- Brave Shields must be off for the domain.
- The probe server binds `127.0.0.1` only, responds to `/ping` alone, sends no CORS wildcard, and never accepts commands. It is a presence beacon, not an API.

## Deep links and protocol

Register `polaris://`. Handle three arrival paths:
- macOS: `app.on('open-url')` — fires **before** `ready` on cold start, so buffer it.
- Windows: `process.argv` on first launch, plus `second-instance` for subsequent ones.
- Both: enforce `app.requestSingleInstanceLock()`, or a second launch opens a second window with its own IndexedDB.

URL shape mirrors the web routes exactly: `polaris://issue/ENG-123`, `polaris://project/<id>`, `polaris://workspace/<slug>/view/<id>`.

## Notifications

Route on click: focus the window, restore from tray if needed, navigate to the entity. Batch to avoid a burst of 40 notifications after a long offline period — collapse into one "43 updates" notification when more than 5 arrive within 10 seconds.

Badge count comes from the local store (unread inbox items), not from a server call, so it's correct offline.

## Permanent download links

Every asset electron-builder produces carries the version, so none of its names is a link
that keeps working. The release workflow therefore uploads a second copy of each installer
under a name with no version in it, and `/releases/latest/download/<name>` resolves to the
newest release for good:

| Alias | What it is |
|---|---|
| `Polaris-mac-arm64.dmg` | Apple Silicon |
| `Polaris-mac-x64.dmg` | Intel Macs |
| `Polaris-Setup.exe` | Windows, both architectures in one installer |
| `Polaris-linux-x86_64.AppImage` | Linux, no install |
| `polaris-amd64.deb` | Debian and Ubuntu |

These are what the landing page links to, and `scripts/lint-release.sh` fails the build if
the workflow stops producing them — the failure would otherwise appear one release later, as
a page of dead buttons, with nothing else going red.

**They are additional assets and appear in no manifest.** That is the whole reason they are
safe: the updater's candidate list comes from the `files` array inside `latest*.yml`, so a
release asset absent from it is invisible to `electron-updater`. Putting an alias in a
manifest would reintroduce the substring hazard below. The `.zip` files — which are what
macOS actually updates from — deliberately get no alias.

## Auto-update

`electron-updater` against **GitHub Releases**.

| Concern | Decision |
|---|---|
| Channel | Latest published stable GitHub release |
| Cadence | Check on launch, every 4 h, on resume and on window focus when stale |
| Restart | A downloaded build is offered as a dismissable row in the app, and installs on quit if it is ignored |
| Linux formats | AppImage uses the in-app updater; DEB users install the newer package manually |
| Delta updates | Windows NSIS supports differential; macOS ships full DMG/ZIP |

## Code signing — the part that always slips

**macOS.** An Apple Developer Program membership. Needs a *Developer ID Application* certificate (not the App Store one), hardened runtime, and **notarisation** via `notarytool` on every build. Without notarisation, Gatekeeper refuses to launch the app and users see "damaged and can't be opened". Entitlements needed: `com.apple.security.cs.allow-jit` (Chromium), and network client.

**Windows.** An OV or EV code-signing certificate. Since June 2023 all new certs require hardware/HSM key storage, so signing runs against Azure Trusted Signing, DigiCert KeyLocker, or similar — you cannot just drop a `.pfx` in CI any more. Without a signature, SmartScreen warns on every download until reputation accumulates. Budget: ~€200–400/year (OV) or ~€300–600/year (EV, better SmartScreen behaviour).

CI secrets: `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`, `CSC_LINK`, `CSC_KEY_PASSWORD`, plus the Windows signing provider's credentials. All in GitHub Actions secrets, never in the repo.

**Do a signed, notarised build in the first week of desktop work**, even if the app is an empty window. Discovering the certificate pipeline the week you want to ship costs days.

## electron-builder configuration

```yaml
appId: com.peixotolabs.polaris
productName: Polaris
directories: { output: dist, buildResources: build }
files: ["out/**", "!**/*.map"]
protocols:
  - name: Polaris
    schemes: [polaris]
mac:
  category: public.app-category.productivity
  target: [{ target: dmg, arch: [arm64, x64] }, { target: zip, arch: [arm64, x64] }]
  hardenedRuntime: true
  gatekeeperAssess: false
  entitlements: build/entitlements.mac.plist
  notarize: true
win:
  target: [{ target: nsis, arch: [x64, arm64] }]
  signingHashAlgorithms: [sha256]
nsis:
  oneClick: false
  perMachine: false          # per-user install avoids UAC prompts
  allowToChangeInstallationDirectory: true
publish:
  provider: github
  releaseType: release
```

Ship **arm64 and x64** for macOS separately rather than a universal binary — half the download size, and the updater picks the right one on its own.

Shipping them separately makes the **filename** part of the contract, so `artifactName` is set explicitly rather than left to the default. The default interpolates `-arm64` for Apple Silicon and *nothing* for Intel, which puts `Polaris-<version>.dmg` beside `Polaris-<version>-arm64.dmg` — and the plain name, the one that reads as the ordinary download, is the Intel build. An Apple Silicon user who takes it gets an app under Rosetta and, since macOS 26, a system banner saying the app is not optimised for their Mac and should be updated by its developer. Nothing was wrong with the build; the label was.

The word `arm64` in the name is also load-bearing at update time. `electron-updater` chooses a macOS update by substring — `MacUpdater.filterFilesForArch` prefers files whose URL contains `arm64` on Apple Silicon and excludes them everywhere else, with no metadata behind it. An arm64 artefact must keep `arm64` in its name and an x64 one must never acquire it, which `${arch}` gets right and a friendlier scheme ("apple-silicon") would get silently, permanently wrong.

The same asymmetry exists in the Linux AppImage and is fixed the same way. It does not exist for the `.deb`, whose default name already carries the architecture because Debian requires it, nor for Windows: NSIS packs both architectures into one installer, so a name without an architecture is the accurate one there.

## Testing

- `desktop/scripts/smoke.mjs` launches the packaged binary and inspects its renderer through Chrome DevTools Protocol.
- CI launches the packaged app on each runner’s native architecture: macOS, Windows x64 and Linux x86-64. Linux uses Xvfb and Chromium’s setuid sandbox; the sandbox stays enabled.
- Installation, signing, offline editing, reconnection, notifications, deep links and applying a real update still require platform acceptance checks; a successful launch is not proof of those flows.
- Keep a Windows VM or a CI runner for this; "it works on my Mac" is how the Windows build stays broken for a month.

## Deliberately not in scope

- **Linux ARM64** — not currently built. Linux x86-64 ships as AppImage and DEB.
- **Mobile distribution** — maintained separately; see `ios/README.md` for the existing iOS app.
- **Menu-bar mini-app / global quick-capture** — attractive, but it is a separate window lifecycle and its own bug surface. After 1.0.


## Download page and maintenance

`/downloads` is public and also reachable from the workspace menu. The landing page at
`/welcome` has a prominent download button and remains accessible after sign-in.
The page reads the latest stable GitHub release, uses its actual asset URLs and labels
macOS Apple Silicon / Intel, the combined Windows installer, and Linux x86-64 formats.
An unavailable asset is not offered as a download. GitHub Releases remains reachable
if discovery is unavailable or rate-limited. Both renderer CSPs allow `api.github.com`.

All platforms bundle `web/dist` from the tagged source and frozen lockfile. A new web
interface reaches installed apps through a desktop release; it does not hot-load the
website. Keep the existing tag-driven workflow so production and installers track the
same release. Weekly Dependabot PRs group compatible Electron/builder/updater updates;
major changes remain separate review work.

Before publication, `scripts/verify-desktop-release.py` requires all five advertised
installers, both macOS updater ZIPs and all three updater manifests. It checks versions,
referenced assets, file sizes and checksum presence. It does not prove binary signatures
or successful update installation. Its regression tests run in CI.

Windows signing remains unconfigured: `win.signtoolOptions.publisherName` verifies
Peixoto Labs signatures, but `win.azureSignOptions` still needs the real endpoint,
account and certificate profile plus provider credentials. Do not disable signature
verification to make unsigned releases update. macOS certificates and notarization
must likewise be verified on the distributed artifact, not inferred from configuration.

For a dated review of the existing published release, see
[desktop release audit](13-desktop-release-audit.md).
