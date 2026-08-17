/**
 * Ad-hoc signs the macOS bundle when there is no certificate to sign it with.
 *
 * "Unsigned" is a legitimate choice for a pre-release, but on macOS it is not a choice that
 * produces an app: electron-builder assembles the bundle by rewriting the Electron binary's
 * Resources, which invalidates the ad-hoc signature Electron ships with. What comes out is
 * not unsigned, it is *badly* signed, and the difference is the whole download —
 *
 *     codesign --verify:  code has no resources but signature indicates they must be present
 *
 * — which Gatekeeper reports to the user as "Polaris is damaged and can't be opened. You
 * should move it to the Trash." There is no right-click-Open around that one, and the
 * artefact is untestable by anybody who did not build it. It runs fine on the build machine,
 * because a file that was never downloaded carries no quarantine flag. That is the worst
 * shape a release bug can have.
 *
 * Re-signing ad-hoc costs nothing and turns it back into the honest failure: an app from an
 * unidentified developer, which a user can still open deliberately. It is not a substitute
 * for a Developer ID signature and notarisation, and it must not be read as one — see the
 * signing section of docs/05-infrastructure/06-desktop-electron.md.
 *
 * Runs from `afterPack`, which is before electron-builder's own signing step, so a real
 * certificate always wins: @electron/osx-sign passes --force and replaces this.
 */

const { execFileSync } = require('node:child_process');
const path = require('node:path');

exports.default = async function adhocSign(context) {
  if (context.electronPlatformName !== 'darwin') return;

  // The same three things electron-builder itself looks at to decide whether to sign. If any
  // of them says a certificate is available, stay out of the way.
  const willBeSigned =
    Boolean(process.env.CSC_LINK) ||
    Boolean(process.env.CSC_NAME) ||
    process.env.CSC_IDENTITY_AUTO_DISCOVERY !== 'false';
  if (willBeSigned) return;

  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);

  // --deep is the wrong tool for a distribution signature and the right one here: there is no
  // certificate, no entitlements and nothing to get subtly wrong, and the helpers and
  // frameworks all need a signature for the outer bundle's to verify.
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
  console.log(`  • ad-hoc signed ${path.basename(app)}  reason=no certificate configured`);
};
