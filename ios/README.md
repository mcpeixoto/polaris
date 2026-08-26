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

## Architecture: no replica, no socket

The web and desktop clients hold a full local replica fed by a delta stream over WebSocket.
This client deliberately does neither. It calls GraphQL directly and polls
`viewer.syncVersion` — the cheapest query in the schema — refetching only when that number
moves.

That is a considered trade, not a shortcut:

- Using the delta stream requires first implementing the NDJSON bootstrap, a local store
  across ~40 entity types, the revoke cascade, gap detection and resync. Weeks of work
  before the first issue renders.
- It would pin the app to the server's `ClientSchemaVersion` constant, which bumps between
  releases. A mobile app that must ship an App Store update to keep syncing is the wrong
  coupling.
- The read queries are whole-collection anyway — `issues(teamId:)` has no pagination — so a
  poll and a sync move comparable amounts of data.

What it keeps from the local-first design is the part that matters most for correctness:
every mutation carries `clientId` and `opId`, so a retry after a timeout replays the original
result instead of creating a duplicate, and `createIssue` mints its own v7 UUID.

The cost is honest: no live updates while the app sits in the foreground, and no offline
reads. If realtime is wanted later, the middle path is to open the socket and use `delta`
frames purely as invalidation signals — refetch what changed — without holding a replica.

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

It is idempotent. It registers the bundle id, reuses the team's single Apple Distribution
certificate rather than minting a second one (an Individual team is capped, and burning one
per app is how you end up unable to sign anything), creates the App Store provisioning profile
and installs it.

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
