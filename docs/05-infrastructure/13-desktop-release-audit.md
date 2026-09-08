# Desktop release audit — 2026-09-07

The published release is [v0.8.1](https://github.com/mcpeixoto/polaris/releases/tag/v0.8.1),
published at 17:44:51 UTC. Production `/deployment` reported revision `6994628`, matching
that tag's commit `699462879535afa728f060a1316240d07ac621fa`. The website and published
installers therefore share a release identity; this is not a byte-level comparison of
their renderer bundles.

| Distribution | Published asset | Review |
|---|---|---|
| macOS Apple Silicon | `Polaris-0.8.1-mac-arm64.dmg` and `.zip` | Present; ZIP referenced in matching updater manifest |
| macOS Intel | `Polaris-0.8.1-mac-x64.dmg` and `.zip` | Present; ZIP referenced in matching updater manifest |
| Windows x64 / ARM64 | `Polaris-Setup-0.8.1.exe` | Present; matching updater manifest; both architectures configured in the shared NSIS installer |
| Linux x86-64 | `Polaris-0.8.1-linux-x86_64.AppImage` | Present; matching updater manifest |
| Debian / Ubuntu amd64 | `polaris_0.8.1_amd64.deb` | Present; manual package upgrades |

Downloaded and validated all three updater manifests against public release metadata:

```text
v0.8.1: all 7 installers/update ZIPs and 3 updater manifests verified
```

The validation checks version, target existence, file size and checksum presence.
Installer contents, signatures, notarization and real update installation were not
verified by that check. Published metadata cannot establish those properties.

The source locked Electron 43.4.0. This change updates it to 43.6.0 in the same major
series. The official npm registry reports electron-builder 26.15.3 and electron-updater
6.8.9 as latest; both were already locked at those versions. No unrelated dependency
updates are included.

Windows signing is a known setup gap: the publisher verification name exists, but
Azure signing configuration does not. Unsigned updates are rejected by that verification;
this change preserves it. Credential/certificate provisioning is outside this change.
macOS signature/notarization status and installed-update acceptance on each OS remain
unverified pending access to the corresponding distributed artifact and platform.

Linux packaged launch was previously omitted from CI. The workflow now launches the
packaged Linux app under Xvfb with Chromium's setuid sandbox enabled. CI checks the runner's
native architecture; it does not certify macOS Intel or Windows ARM64 execution.
