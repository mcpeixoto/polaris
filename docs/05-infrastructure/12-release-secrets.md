# Release secrets

Every repository secret the workflows read, what it unlocks, and what happens when it is
absent. No values live here — this file is in a public repository. It exists because the
absence of a secret is invisible until a release day, and by then the tag is spent.

Run `make release-secrets` to see which of these are actually configured right now.
`scripts/lint-release.sh` fails CI if a workflow reads a secret this table does not list,
so a new one cannot be introduced silently.

## Deploying to production

Cutting a `v*` tag deploys; merging to `main` runs the tests and stops. These four are
configured and working.

| Secret | What it is | Without it |
|---|---|---|
| `DEPLOY_HOST` | The server's address | Deploy job fails |
| `DEPLOY_USER` | SSH user | Deploy job fails |
| `DEPLOY_SSH_KEY` | Private key for that user. Pinned on the server to a forced command that accepts one 40-hex sha and nothing else | Deploy job fails |
| `DEPLOY_HOST_KEY` | The server's public host key, from `ssh-keyscan`. Pinned so the job cannot be talked onto another machine | Deploy job fails |
| `DEPLOY_PORT` | Optional, defaults to `22` | Port 22 assumed |
| `DEPLOY_BASE_URL`, `DEPLOY_HEALTH_URL` | Optional. Where the post-deploy checks look | Defaults used |

## Shipping to TestFlight

`ios-release.yml`, on a `v*` tag. **Not configured — the job fails at its first step.**

That failure is deliberate. `desktop.yml` degrades to an unsigned build when a certificate
is missing, which is right for something still useful unsigned; an upload is not. A release
reporting success having uploaded nothing is worse than a red X.

| Secret | What it is | Without it |
|---|---|---|
| `APPLE_API_KEY_PATH` | The contents of the App Store Connect `.p8` private key — the key itself, not a path, despite the name | No TestFlight build, ever |
| `APPLE_API_KEY_ID` | Its key id, the `ABCD123456` part of an `AuthKey_ABCD123456.p8` filename | As above |
| `APPLE_API_ISSUER` | The issuer id, a UUID. Also used by `ios/scripts/asc-setup.py`, which is where to read it from | As above |
| `IOS_DIST_P12` | The **Apple Distribution identity** — certificate *and* private key — exported as base64 `.p12` | The archive cannot be signed |
| `IOS_DIST_P12_PASSWORD` | The export passphrase | As above |

**The API key is not enough on its own, and this is the trap.** `-allowProvisioningUpdates`
downloads the *certificate* from App Store Connect. A certificate signs nothing without its
private key, and that key exists only in the keychain whose CSR created it — App Store
Connect has never had a copy and no role grants one. So a correctly-scoped App Manager key
still fails, ten minutes into the archive, with:

```
No signing certificate "iOS Distribution" found: No "iOS Distribution" signing
certificate matching team ID "..." with a private key was found.
```

which reads as a missing certificate and is a missing key. `make release-secrets` prints the
`security export` line for it.

The same three are what `desktop.yml` notarises macOS builds with, so setting them fixes
two things at once.

**The role matters and the failure is cryptic.** Notarisation needs only the Developer
role; creating or downloading an iOS distribution signing asset needs **App Manager**. A
notarisation-scoped key fails inside `xcodebuild` with `No signing certificate ... found`
or an authentication error from the provisioning update — which reads as a project problem
and is not one. `make release-secrets` probes the key against App Store Connect and tells
you which role it actually has, rather than leaving it to be discovered at the end of a
ten-minute archive.

## Signing the desktop apps

`desktop.yml`, on a `v*` tag. **Not configured — builds are published unsigned.**

An unsigned `.dmg` is refused by Gatekeeper on any machine that did not build it, and an
unsigned `.exe` raises SmartScreen. The artefacts are real and installable by someone
willing to click through; they are not something to point an ordinary user at.

| Secret | What it is | Without it |
|---|---|---|
| `MAC_CERT_P12` | A "Developer ID Application" certificate exported as base64 `.p12` | macOS builds unsigned, Gatekeeper-blocked |
| `MAC_CERT_PASSWORD` | The export passphrase | As above |
| `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` | Azure Trusted Signing. Since June 2023 a Windows code-signing key may not sit on disk, so this is cloud signing against an HSM | Windows installer unsigned |

The Azure three sign nothing on their own: electron-builder only reaches for Trusted
Signing when `win.azureSignOptions` names an endpoint, an account and a certificate profile.
Until that block exists in `desktop/electron-builder.yml` the step logs "no signing info
identified, signing is skipped" and produces an unsigned installer under a step called
"Package and sign".

## `GITHUB_TOKEN`

Provided by Actions. Nothing to configure. `desktop.yml` needs `permissions: contents:
write` for it to attach artefacts and publish the release, which that file already declares.
