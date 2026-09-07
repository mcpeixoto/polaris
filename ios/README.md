# Polaris for iOS

A native SwiftUI client for Polaris. Talks to the same GraphQL API the web and desktop
clients use.

## Layout

| Path | What it is |
|---|---|
| `project.yml` | The source of truth for the Xcode project. **`Polaris.xcodeproj` is generated and gitignored.** |
| `PolarisCore/` | A SwiftPM package: wire types, the `PolarisAPI` protocol and its live client, and the `@Observable` stores. Platform-portable, so `swift test` runs host-side with no simulator. |
| `Polaris/` | The app target. Views are deliberately thin — they render what Core resolves. |
| `PolarisTests/` | App-hosted tests, for the few things that need the built bundle. |

## Development

```bash
brew install xcodegen
cd ios && xcodegen generate
open Polaris.xcodeproj
```

Run the Core tests without touching Xcode:

```bash
cd ios/PolarisCore && swift test
```

## Talking to a backend

A Debug build points at `http://localhost:8088` — a `make dev` stack on the same machine —
and signs in through `POST /auth/dev-session`, so the app opens straight into the seed
workspace with no login form. A Release build points at `https://polaris.peixotolabs.com`.

Pass `-polaris-hosted` as a launch argument to force the hosted backend from a Debug build.
It is a launch argument rather than a build flag on purpose: a build flag would make the two
paths different binaries, and the one that ships would be the one never run.

**The dev session only works in the Simulator.** The server requires the request to be
loopback — both the `Host` header and the TCP peer — and a physical device over the LAN is
neither. On a device, sign in normally with `dev@polaris.local` / `polaris-dev-password`.

## Architecture: no replica, a signal-only socket

The web and desktop clients hold a full local replica fed by a delta stream over WebSocket.
This client holds no replica. It calls GraphQL directly, and it keeps what it has shown fresh
two ways:

- **The sync socket, as a doorbell.** `RealtimeCoordinator` opens `/sync` with
  `signalOnly: true` in the hello. The server accepts that hello without the client-schema
  check — there are no local rows a mismatch could corrupt — and strips the payload from every
  `delta` it sends (`services/internal/syncsrv/session.go`). The client reads a delta as
  nothing more than "something you can see moved to version N" and refetches: the issue list,
  the inbox if it has been opened, the badge otherwise. A screen with a store of its own — the
  detail screen, a team's list — adopts `.refreshOnRealtime { await store.load() }`, which
  fires once per coalesced signal. The socket resumes from the `syncVersion` the last load
  observed, so a reconnect after backgrounding replays what was missed as one signal.
- **The thirty-second `syncVersion` poll, as the fallback.** It ticks only while the socket is
  down. A poll alongside a live socket is a query every thirty seconds for information the
  socket already delivered, so the two are alternatives, never a pair. Under
  `-polaris-fixtures` there is no socket at all and the poll runs every tick, which keeps a UI
  test run from dialling whatever happens to be on `localhost:8088`.

Both run only while the app is in front. On `.background` the socket is closed and the poll
stops; on `.active` one `syncVersion` check runs immediately, then the socket reconnects.

The replica is still deliberately absent:

- Using the delta stream *for data* requires first implementing the NDJSON bootstrap, a local
  store across ~40 entity types, the revoke cascade, gap detection and resync. Weeks of work
  before the first issue renders.
- It would pin the app to the server's `ClientSchemaVersion` constant, which bumps between
  releases. A mobile app that must ship an App Store update to keep syncing is the wrong
  coupling. The signal-only hello is exempt from that check, which is the whole reason the
  socket is affordable here.
- The read queries are whole-collection anyway — `issues(teamId:)` has no pagination — so a
  refetch on signal and a delta apply move comparable amounts of data.

What it keeps from the local-first design is the part that matters most for correctness:
every mutation carries `clientId` and `opId`, so a retry after a timeout replays the original
result instead of creating a duplicate, and `createIssue` mints its own v7 UUID.

The cost is honest: no offline *writes* — a cold-start read comes from the cache described
under **Offline** below — and a refetch of the whole list per signal rather than a row-level
patch.

While the last read failed with something a retry could fix — no network, a timeout, a 5xx —
the shell shows an "Offline" / "Reconnecting" pill (`ConnectionBanner`) at the top. A refused
read is not a pill; it is a sentence on the screen it happened on.

## Deep links

`polaris://` is registered in `project.yml` (`CFBundleURLTypes`) — the same scheme the desktop
app claims, so a link copied from one client opens the issue in whichever client is on the
device that receives it. The web routes are accepted too, from any host; the
associated-domains entitlement is what restricts universal links in production, not the
parser. `DeepLink.parse` in `PolarisCore/Navigation/DeepLink.swift` is pure and fully tested.

| Link | Opens |
|---|---|
| `polaris://issue/ENG-1`, `/issue/ENG-1`, `/issue/<uuid>` | The issue, pushed onto the tab that is up |
| `polaris://inbox`, `/inbox` | The inbox tab |
| `polaris://my-issues`, `/my-issues` | The My Issues tab |
| `polaris://search?q=…`, `/search?q=…` | The search tab; the query is parked on `DeepLinkRouter.pendingSearchQuery` for the search screen to read |
| `polaris://team/ENG`, `/team/ENG`, `/team/ENG/triage|cycles|projects` | The team, pushed on My Issues. The page is parsed but not yet routed — the hub opens on its issues |
| `/projects` | The My Issues tab, where the team pills are; there is no projects list yet |
| `/project/<id>` | Pushes the `Project` value; renders once a destination for it is declared |

A link that arrives before sign-in is queued by `DeepLinkRouter` and applied when the shell
appears. A link to something that does not exist gets an alert, not silence. For UI tests,
`-polaris-open-url <url>` delivers a link at launch through the same router.

## Background refresh, and the badge

`com.peixotolabs.polaris.refresh` is registered with `BGTaskScheduler` at launch and requested
on every move to the background. When iOS grants the wake-up — a few times a day, on its own
schedule — the task restores the session, asks for `unreadNotificationCount` and sets the icon
badge. In the foreground the badge mirrors the inbox tab's count, whichever path moved it.
Badge permission is requested once, for the badge alone; nothing here asks to alert.

`BGTaskScheduler` refuses every submit in the Simulator, so the path can only be exercised on
a device (or with the `_simulateLaunchForTaskWithIdentifier` debugger call).

## Screens

Four tabs on a phone — Inbox, My Issues, Search, Settings — and a `NavigationSplitView` with
the same four in a sidebar on an iPad, chosen on `horizontalSizeClass`. Create is a sheet from
the list's toolbar rather than the fifth tab
`docs/01-features/19-clients-sync-preferences.md` names: a tab that opens a modal and never
shows a screen of its own is a tab you cannot go back to.

Screens are content only. `PolarisNavigation` owns the `NavigationStack` and declares the
issue and team destinations, so the same view renders as a tab on a phone and as the detail
column on an iPad without knowing which it is in.

Every screen uses the system navigation bar with an inline title and plain toolbar glyphs. An
issue row is one 44pt line — priority glyph, identifier, status glyph, title, then label dots,
due date and assignee — with a hairline under it and no card around it. A team's list and a
search result are grouped by workflow state (`IssueListView(grouping: .status)`), started work
first and closed work last; My Issues stays flat in priority order, which is also Linear's
default for that view. The inbox is grouped by day, the detail screen lays its properties out
as a wrapping row of pills, and Settings is a standard inset-grouped list.

### There are no push notifications, and that is a backend gap

The server has no push infrastructure at all — no device-token schema, no APNs sender — so
there is nothing for this client to register with and nothing to receive. While the app is in
front the inbox and its badge move on the sync signal; while it is not, the badge moves only
when iOS grants a background refresh. Nothing arrives on a locked phone. Push notifications
are a backend project, not an iOS one.

## Theme

Colour lives in `PolarisCore/Design/Palette.swift` — the iOS half of
`web/src/styles/tokens.css`, primitives and semantics, as *data*. `Theme` in the app target
does nothing but hand those numbers to SwiftUI. A colour that only exists as a `SwiftUI.Color`
cannot be measured, and contrast and cross-client parity are properties of the numbers, which
is why `swift test` can read them.

The app follows the system appearance, with a light/dark/system preference in Settings. It was
pinned to dark, which cost two things: the web client ships all three, so the clients
disagreed about what Polaris looks like; and `LaunchBackground`'s light appearance was pure
white, so every cold start on a phone in Light mode flashed white before snapping to a
near-black app.

The look follows the web client's Linear parity pass: the system face at 13–15pt, a flat
`bgPrimary` page, hairline separators, radii of 4–8pt, and no gradients, glows or serif
display type. `StateIcon` and `PriorityIcon` draw the same glyphs as `web/src/components` —
a ring whose fill encodes the state category, and a three-bar scale with a filled square for
urgent — so the two clients say the same thing with the same shapes.

## Offline

There is still no replica (see above), but a successful load of "my issues" is written to a
JSON file in Application Support and put back on screen before the first request of the next
launch — marked as a saved copy, and replaced the moment a request answers. That is the
cold-start half of offline; live updates while the app sits open come over the socket, or the
poll while the socket is down.

## Sign in with Google

No SDK. `ASWebAuthenticationSession` opens Google's authorization page, the PKCE plumbing is
in `PolarisCore/Networking/GoogleSignIn.swift`, and the code is exchanged for an ID token on
the device — an iOS OAuth client is issued without a client secret precisely so that it can.
What reaches Polaris is the same `idToken` the Apple button sends, on `POST /auth/oidc/google`.

Three values have to agree, and only the first is written by hand more than once:

| Where | What |
|---|---|
| `GoogleSignIn.clientID` | The iOS OAuth client from the Google Cloud console. The one place the app names it. |
| `CFBundleURLSchemes` in `project.yml` | The same client id with its components reversed. A literal, because iOS reads the Info.plist before any Swift runs — `GoogleSignInTests` pins the two together. |
| `POLARIS_GOOGLE_CLIENT_IDS` on the server | Must include the iOS client id. The audience in a token minted for the iOS client is the iOS client, and a server configured only with the web one rejects every sign-in from the app. |

The button is drawn only when `GET /auth/providers` lists `google`, so a deployment that has
configured no Google client shows no button rather than one ending at a 404.

## Signing and TestFlight

Team `H874DPF6H5`, bundle id `com.peixotolabs.polaris`.

Debug signs automatically — right for the simulator, and a developer without the distribution
key can still build and run. Release is Manual against the `Polaris App Store` profile, because
automatic signing needs an interactively-authenticated Xcode and cannot resolve a profile from
a script or from CI.

Set the Apple side up with:

```bash
uv run --with "pyjwt[crypto]" --with requests python ios/scripts/asc-setup.py
```

It is idempotent. It registers the bundle id, enables the capabilities that match the
entitlements in `project.yml` (Sign in with Apple, Associated Domains), reuses the team's single
Apple Distribution certificate rather than minting a second one (an Individual team is capped,
and burning one per app is how you end up unable to sign anything), creates the App Store
provisioning profile and installs it. Enabling a capability invalidates the existing profile,
so the script deletes and remakes it under the same name; `project.yml` references it by name,
so nothing else changes.

## Universal links

An `https://polaris.peixotolabs.com/issue/ENG-123` link opens in the app rather than Safari.
Two halves have to agree:

- The app's `com.apple.developer.associated-domains` entitlement (declared in `project.yml`)
  names the domain: `applinks:polaris.peixotolabs.com` and
  `webcredentials:polaris.peixotolabs.com` (password autofill).
- The site serves `/.well-known/apple-app-site-association`, which names the app id
  `H874DPF6H5.com.peixotolabs.polaris` and lists which paths the app handles. It lives in
  `web/public/.well-known/` and is served as a static file by the web container's nginx, which
  sets `application/json` on it — the file has no extension, and Apple's CDN refuses any other
  type. `web/src/app/appSiteAssociation.test.ts` keeps it valid JSON with the right paths.

The production edge is a hand-written nginx block on the fleet box that proxies only
`/.well-known/oauth-*` to the API; every other `/.well-known/*` path falls through to the web
container, and `apple-app-site-association` must keep doing so. The bundled `Caddyfile` has an
explicit `handle` for it above the `/.well-known/*` → api block for the same reason. The deploy
job asserts the path answers as JSON, because a manifest served as `index.html` fails with no
error anywhere — every link simply keeps opening Safari.

Apple's CDN caches the file, so a change to it reaches devices on the next install or
after a delay, not on the next deploy. Debug builds can bypass the CDN with the
`?mode=developer` component, which is not set here on purpose.

Then archive, export and upload:

```bash
cd ios && xcodegen generate
xcodebuild -project Polaris.xcodeproj -scheme Polaris -configuration Release   -destination 'generic/platform=iOS' -archivePath build/Polaris.xcarchive archive
xcodebuild -exportArchive -archivePath build/Polaris.xcarchive   -exportOptionsPlist ExportOptions.plist -exportPath build/export
xcrun altool --upload-app -f build/export/Polaris.ipa -t ios   --apiKey GJKL39M374 --apiIssuer <issuer-uuid>
```

### The one manual step

`asc-setup.py` deliberately does not create the **App Store Connect app record**: the ASC API
has no endpoint for it. It has to be added once at
<https://appstoreconnect.apple.com/apps> (**+ > New App**) against this bundle id.

Until it exists, everything above succeeds and the *upload* fails with:

```
ERROR: Cannot determine the Apple ID from Bundle ID 'com.peixotolabs.polaris' and platform 'IOS'
```

which names neither the cause nor the fix — hence this paragraph. App names are globally
unique on the App Store, so `Polaris` may already be taken; the record's name does not have to
match `productName`.
