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

First launch (Debug or Release) shows **connect**: welcome → Polaris Cloud or your own
server → then the existing account welcome (Create account / Sign in). The chosen origin is
stored in `UserDefaults` under `polaris.apiBaseURL`. Settings shows the current host and a
**Change server** escape hatch that clears it and returns to connect.

Polaris Cloud is `https://polaris.peixotolabs.com` (same string as the desktop
`HOSTED_CLOUD_ORIGIN`). A self-hosted address is normalised like desktop (`https://`
assumed); plain `http://` is accepted only for loopback. HTTPS self-host is the supported
path in v1 — arbitrary LAN HTTP needs broader ATS than today's localhost-only exception.

Launch arguments for developers (and UI tests):

| Argument | Effect |
|---|---|
| *(none, no persisted URL)* | Connect UI |
| After Cloud / typed server | Persisted origin; sync derives `wss://…/sync` unless overridden |
| `-polaris-hosted` | Force hosted Cloud without a pick |
| `-polaris-server <url>` | Settle that origin for this launch without writing UserDefaults |
| `-polaris-sync-hub <ws-url>` | Point the sync socket at a hub other than the API origin |
| `-polaris-fixtures` | In-memory client; settles local development without connect (test harness) |
| `-polaris-force-connect` | Show connect even under fixtures |

`allowsDevSession` (Debug auto-login via `POST /auth/dev-session`) is enabled only for
loopback origins, so Cloud and customer self-hosts never get it.

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
  the inbox if it has been opened, the badge otherwise. A screen with a store of its own
  adopts `.refreshOnRealtime { await store.load() }`, which fires once per coalesced signal:
  the issue detail, a team's hub, its issues, its triage queue and its cycles, a cycle, a
  project, and search — which re-runs its last query. That list is the whole of it; a screen
  not on it does not refresh on a signal. The socket resumes from the `syncVersion` the last
  load observed, so a reconnect after backgrounding replays what was missed as one signal.

  Two things hold a reload back, and neither loses it — `RealtimeRefreshGate` replays whichever
  signal was sat out, once, when the hold lifts. A screen pushed off the top of the stack keeps
  its `onChange` and would otherwise read on every signal while invisible, four times over
  under a team hub, where all four screens share one store. And a screen defines when it is
  busy: an open composer, a picker sheet, a status change the server has not answered. A
  refetch under a cursor replaces text somebody is typing.

  `changeVersion` moves on socket signals only. While the socket is down the poll below keeps
  the issue list and the inbox current but does not bump it, so a screen holding its own store
  is as stale as its last pull-to-refresh until the socket returns.
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

### One write, every store that holds it

No replica also means several stores hold the same issue at once — My Issues, a team's list, a
project, a cycle, the search results, the detail screen on top — and none of them knows the
others exist. `AppModel.issueDidChange(_:from:)` is the one place a *server-confirmed* issue is
handed to every store holding that id; a screen registers its own store with
`observeIssueWrites` (or `adoptIssueWrites`, which also routes that store's writes back out),
and the registry holds them weakly, so a popped screen leaves on its own. Only confirmed
values go through it: fanning out the optimistic one would leave every other list showing a
status the server rejected, and none of them has the original to roll back to. The other half
of the same rule lives in the stores — `setState` asked about a row a list does not hold sends
the write anyway rather than returning, because a guard that drops a write is
indistinguishable from a tap that missed.

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
| `polaris://search?q=…`, `/search?q=…` | The search tab, with the query in the field and run. It is parked on `DeepLinkRouter.pendingSearchQuery` and the screen takes it — once, so returning to the tab later does not re-run it |
| `polaris://team/ENG`, `/team/ENG`, `/team/ENG/triage|cycles|projects` | The team, pushed on My Issues. The page is parsed but not yet routed — the hub opens on its issues |
| `/projects` | The My Issues tab, where the team pills are; there is no projects list yet |
| `/project/<id>` | The project's detail screen, pushed as a `Project` value — the destination `PolarisNavigation` declares for one |

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
due date and assignee — with a hairline under it and no card around it. The status glyph is a
button: tapping it opens that team's statuses, which is how a status is changed in the product
this one follows, and it sits alongside the leading swipe (complete), the trailing swipe (next
open state) and the row's long-press menu. A team's list and a
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

Only issues are cached, which is why `WorkspaceDataStore` distinguishes three answers about a
team's workflow states rather than two. That cached list can be on screen before — or instead
of — the bulk reference-data fetch, and an empty `states(forTeam:)` used to mean both "this
team has no statuses" and "nobody has asked yet". The picker read the second as the first, said
so, and disabled itself for the rest of the session; one failed request at launch was enough.
`statesAvailability(forTeam:)` is the difference, and every status control calls
`ensureStates(forTeam:)` as it appears, so the answer arrives whether or not the bulk fetch
ever did.

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

## Failures that say what happened, and offer a way back

Two things had to be true before a screen could be honest about a failure, and neither was.
`PolarisError.from(urlError:)` named four `URLError` codes and sent everything else to
`.badResponse` — "Polaris sent an unexpected response", not retryable — so a stopped API
container (`cannotConnectToHost`), a mistyped self-hosted address (`cannotFindHost`) and an
expired certificate (`serverCertificateHasBadDate`) all read as a bug in the app, with no
Retry button and no Offline pill. The codes are now grouped by what the reader should do:
`.offline` for a device with no network, `.serverUnreachable` for a device that has one and an
address that will not answer, `.insecureConnection` for TLS (never "you're offline" — that
sends somebody to reset a router that works), and `.cancelled` for a screen that walked away
from its own request. And the six reference collections — teams, users, labels, projects,
project statuses, favourites — got what the per-team workflow states already had:
`ensure(_:)`, `reload(_:)` and `failure(of:)` on `WorkspaceDataStore`, written once over a
`ReferenceCollection` rather than six times, so one refused `teams()` at sign-in no longer
disables the composer's Create button and hides every team screen for the life of the session.
