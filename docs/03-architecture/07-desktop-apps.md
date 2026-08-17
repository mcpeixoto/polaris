# The desktop apps

One shell, three platforms, and the same renderer the web app serves.

macOS ships as a signed and notarised `.dmg` for Apple silicon and Intel. Windows ships as
an NSIS installer for x64 and arm64. Linux ships as an AppImage and a `.deb`. All three are
built by `.github/workflows/desktop.yml`, each on its own runner.

## The shell is a shell

`desktop/src/main` contains no product logic and is not allowed to grow any. It owns the
things a browser tab cannot do — tray, dock badge, system notifications, deep links,
auto-update — and exposes each through a named function on a preload bridge. There is
deliberately no generic `invoke(channel, ...args)`: that single convenience turns the bridge
into an arbitrary-IPC primitive, and an XSS in the renderer into full main-process access.

The renderer is `web/dist`, built once per release and copied in. Building it separately for
the desktop is how a desktop client ends up a commit behind the web client with nobody
noticing until a user reports that one of them behaves differently.

## Two decisions that took a rebuild to get right

Both were found by packaging the app and looking at it, not by reading the code. Both are
invisible in development, which is what makes them worth writing down.

### The renderer is served over a custom scheme, not `file://`

The obvious way to load a bundled renderer is `win.loadFile(...)`. It works, and it produces
an application that cannot talk to any server.

A page loaded from `file://` has the origin `null`. So does every sandboxed iframe on the
internet. For the API to accept credentialed requests from the desktop app it would have to
allow the origin `null` — which would also allow any page on the web that framed one, with
the user's own cookies attached. There is no way to tell the two apart, so there is no safe
version of that configuration.

`file://` is also not a *secure context*. IndexedDB, `crypto.subtle` and service workers are
unavailable or quietly degraded there, and for a local-first client with no IndexedDB there
is no replica — which is the entire architecture.

So the app registers `polaris-app://` as a privileged scheme (standard, secure, fetch and
CORS enabled) and serves the renderer from `polaris-app://app`. That origin is unique to the
application and cannot be forged by a web page, and it is what
`services/internal/httpapi/cors.go` allowlists. The handler resolves paths inside the
renderer directory and falls back to `index.html`, because a single-page app has no file
behind `/issue/ENG-123`.

### The renderer's path is resolved from `resourcesPath`, not `__dirname`

In a packaged app the main process runs from inside `app.asar`, so `__dirname` is
`…/Resources/app.asar/dist/main` and any relative walk from it stays inside the archive.
`extraResources` copies the renderer *alongside* the archive, not into it. The first version
resolved to a path that does not exist; the symptom was a blank window in the packaged build
only, because in development the renderer is a dev server and everything works.

## Which server?

Polaris is self-hosted, so there is no address that could be compiled in — the same download
has to work against anybody's server, and baking one in would mean a build per customer.

The shell stores an origin in `settings.json` beside the app's own data, and hands it to the
renderer as a launch argument. A launch argument rather than IPC because the client needs it
*synchronously*: the sync engine builds its first URL during module evaluation, and an async
lookup would mean wrapping the entire application in a loading state to answer a question
that was settled before the window opened.

`web/src/sync/endpoint.ts` is the one place that turns a path into a URL. On the web it
returns the path unchanged and the behaviour is exactly what it always was; on the desktop
it prefixes the configured origin and switches `fetch` to `credentials: 'include'`, because
a desktop app is cross-origin to its server by construction.

Changing the server recreates the window rather than reloading it, and the client clears its
replica first. A local database is a copy of *one workspace on one server*: carrying it
across would leave issues the new server will never send a revoke for.

## What signing needs

Neither platform's signing can be done on a developer's machine, and both fail in ways worth
knowing before a release is due.

**macOS** needs a Developer ID certificate and notarisation. An unnotarised `.dmg` is not a
release — Gatekeeper refuses to open it at all on any machine that did not build it, and the
error it shows says the app is damaged rather than unsigned.

**Windows** needs an OV or EV certificate, and since June 2023 the private key may not live
on disk. Signing is therefore a cloud operation against an HSM, done in CI, not a `.pfx` in a
secret. Without it SmartScreen warns on every download until the certificate accumulates
reputation.

Both are configured in the release workflow and both are inert without their secrets, so a
fork or a pull request still gets an unsigned build that proves the package assembles.

## What is not verified here

The Windows installer cannot be built on a macOS machine — electron-builder can do it
through wine, and an unsigned NSIS produced through an emulation layer is exactly the kind of
artefact that works until it does not. CI builds it on a Windows runner instead. The same
applies in reverse: `codesign` and `notarytool` exist only on macOS.
