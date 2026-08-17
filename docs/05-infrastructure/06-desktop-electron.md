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
├── tray                optional: quick create, inbox count
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

## Loading strategy: bundled, not remote

Ship `web/dist` **inside** the app and point it at the API.

```
app://  → bundled index.html + assets   (loaded from disk, instant, offline-capable)
https://polaris.peixotolabs.com/graphql → API
wss://polaris.peixotolabs.com/sync      → sync
```

Rejected alternative: loading the web app remotely (`loadURL('https://…')`). It sounds simpler and means the desktop app is broken whenever the box is down, has a blank-window cold start, and inherits browser cache semantics for the shell itself. The whole point of a local-first product is that the UI works before the network does.

**Version skew** is the cost of bundling: a desktop app can be older than the server. Handle it explicitly — the API returns a `X-Polaris-Min-Client` header; below it, the app shows a blocking "update required" screen and triggers the updater. The `clientSchema` mechanism in the sync protocol already forces re-bootstrap on incompatible data shapes.

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

## Auto-update

`electron-updater` against **GitHub Releases**.

| Concern | Decision |
|---|---|
| Channels | `latest` and `beta`; the app reads the channel from preferences |
| Cadence | Check on launch and every 4 h; download in background; install on quit |
| Forced updates | Only when `X-Polaris-Min-Client` demands it |
| Disable | Honour an enterprise policy file, mirroring the fleet's habit of allowing `AutoUpdateDisabled` via `defaults`/plist and MDM |
| Delta updates | Windows NSIS supports differential; macOS ships full DMG/ZIP |

## Code signing — the part that always slips

**macOS.** Apple Developer Program (already held — Team `H874DPF6H5`, used by MealMind and Almanac). Needs a *Developer ID Application* certificate (not the App Store one), hardened runtime, and **notarisation** via `notarytool` on every build. Without notarisation, Gatekeeper refuses to launch the app and users see "damaged and can't be opened". Entitlements needed: `com.apple.security.cs.allow-jit` (Chromium), and network client.

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

Ship **arm64 and x64** for macOS separately rather than a universal binary — half the download size, and the fleet already distinguishes Apple Silicon from Intel.

## Testing

- Playwright drives the packaged Electron build (`_electron.launch`), not just the web bundle.
- Smoke matrix per release: macOS arm64, macOS x64, Windows x64 — install, launch, sign in, create an issue, go offline, edit, reconnect, verify sync, receive a notification, follow a deep link, apply an update.
- Keep a Windows VM or a CI runner for this; "it works on my Mac" is how the Windows build stays broken for a month.

## Deliberately not in scope

- **Linux** — matches the source product; browser only.
- **Mobile** — the PWA covers the documented mobile workflows (inbox triage, quick create, search). Native apps are two XL items; revisit after web + desktop are solid.
- **Menu-bar mini-app / global quick-capture** — attractive, but it is a separate window lifecycle and its own bug surface. After 1.0.
