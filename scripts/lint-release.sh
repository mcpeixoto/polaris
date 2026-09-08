#!/usr/bin/env bash
# What a release tag must actually do.
#
# Cutting `vX.Y.Z` is the only release mechanism this project has: it is what builds the
# desktop packages, what publishes them, and what uploads a build to TestFlight. Every
# failure this checks for has already happened here, and every one of them was green:
#
#   * Six tags — v0.6.2 through v0.7.3 — produced GitHub releases that were never taken out
#     of draft. Nobody outside the repo could download them, and `electron-updater`, which
#     resolves "latest" through the *published* release, told every installed copy there was
#     no update. The desktop auto-update path had never once worked.
#   * ios-release.yml uploaded whatever version string happened to be sitting in
#     ios/project.yml, so the tag chose the moment of the release and not its identity.
#
# Both are the same class of bug: a release pipeline where the tag is a trigger rather than
# an input, and where "the job succeeded" is not the same claim as "a user can install it".
set -euo pipefail

cd "$(dirname "$0")/.."

fail=0
note() { echo "FAIL: $*"; fail=1; }

desktop=.github/workflows/desktop.yml
ios=.github/workflows/ios-release.yml

for f in "$desktop" "$ios"; do
  [ -f "$f" ] || { note "$f is missing — a release tag would build nothing"; continue; }
  # A tag trigger, without which the file is dead weight on release day.
  grep -qE "^ *tags: *\['v\*'\]" "$f" \
    || note "$f does not trigger on tags: ['v*'], so cutting a tag will not run it"
done

# The draft must be cleared by the workflow, not by a human remembering to click Publish.
# A release nobody publishes is the exact state six tags are still in.
if ! grep -q -- '--draft=false' "$desktop"; then
  note "$desktop never clears the draft flag"
  echo "      A tag would leave the release as a draft: undownloadable, and invisible to"
  echo "      electron-updater, which only ever sees published releases."
fi

# Publishing must be gated on the build matrix. Without `needs: build` the publish job runs
# beside the platforms rather than after them, and a release goes out holding whichever
# artefacts happened to have finished uploading.
awk '/^  publish:/{p=1} p&&/needs: build/{found=1} END{exit !found}' "$desktop" \
  || note "$desktop: the publish job is not gated on \`needs: build\`, so a partial release can be published"

# The iOS version has to come from the tag. project.yml still carries literals — that is
# fine and is what a local build uses — but the release workflow must overwrite them.
if ! grep -q 'MARKETING_VERSION: ' "$ios"; then
  note "$ios does not set MARKETING_VERSION"
  echo "      The tag would decide when the build was uploaded and nothing about what it is:"
  echo "      TestFlight would show the literal version left in ios/project.yml."
fi
if ! grep -q 'CURRENT_PROJECT_VERSION: ' "$ios"; then
  note "$ios does not set CURRENT_PROJECT_VERSION"
  echo "      TestFlight refuses a build number it has already accepted, so a hand-bumped"
  echo "      literal fails the second tag nobody remembered to edit — at the end of the"
  echo "      archive, with the tag already spent."
fi

# Production is deployed by a tag, not by a merge.
#
# Merging to main is integration; a tag is the decision to put something in front of
# people. When main deployed, "deployed" and "released" were different events nobody could
# line up: the website ran ahead of every client by however many merges had happened since
# the last tag. Flipping this back is a product decision, not a refactor, so it fails here
# rather than being noticed weeks later by a version mismatch.
ci=.github/workflows/ci.yml
if grep -qE "if: github.event_name == 'push' && github.ref == 'refs/heads/main'" "$ci"; then
  note "$ci: the deploy job is gated on main, not on a tag"
  echo "      Merging would ship the website while the installers and the iOS build waited"
  echo "      for a tag — which is how a release ends up meaning two different commits."
fi
if ! grep -qE "startsWith\(github.ref, 'refs/tags/v'\)" "$ci"; then
  note "$ci: the deploy job is not gated on a v* tag"
fi

# The workflow that checks a tag actually reached every surface. Without it each workflow
# reports only itself, and nothing reports the release.
rel=.github/workflows/release.yml
if [ ! -f "$rel" ]; then
  note "$rel is missing — nothing checks that a tag reached the website, the installers and TestFlight"
else
  grep -q '/deployment' "$rel" \
    || note "$rel does not check that production is serving the tag's commit"
  grep -q 'isDraft' "$rel" \
    || note "$rel does not check that the release was published"
fi

# The iOS job must require a signing identity, not only an App Store Connect key.
# Removing this check is how the "the API key is enough" assumption comes back — it is
# wrong in a way that only shows up ten minutes into an archive on a release.
if ! grep -q 'IOS_DIST_P12' "$ios"; then
  note "$ios does not require a distribution identity (IOS_DIST_P12)"
  echo "      -allowProvisioningUpdates downloads a certificate, not a private key."
  echo "      Without the identity imported, the archive cannot be signed."
fi

# Uploading is not distributing, and the job must do both.
#
# A build with no beta group is VALID, READY_FOR_BETA_TESTING and invisible in the
# TestFlight app to every tester. Five builds sat that way over six weeks with every job
# green. If this step goes, releases silently stop reaching anybody again.
if ! grep -q 'distribute-build.py' "$ios"; then
  note "$ios uploads to TestFlight but never assigns the build to a group"
  echo "      An unassigned build is invisible to testers, and the upload job stays green."
fi

# Each release must carry a copy of every installer under a name with no version in it.
#
# Those are the only permanent links that exist. GitHub's /releases/latest/download/<name>
# redirect needs an exact filename, and every other asset is called Polaris-0.9.0-…, so
# without these the landing page can offer nothing but "here is a page with fifteen files
# on it" — which is what it did, and what somebody had to point out.
#
# Dropping the step breaks every download button on the site at the *next* release, not this
# one, and nothing else goes red.
for stable in Polaris-mac-arm64.dmg Polaris-mac-x64.dmg Polaris-Setup.exe \
              Polaris-linux-x86_64.AppImage polaris-amd64.deb; do
  grep -qF "$stable" "$desktop" \
    || note "$desktop never publishes a stable-named copy called $stable"
done
grep -q 'gh release upload' "$desktop" \
  || note "$desktop uploads no extra assets, so no permanent download URL exists"

# The distribution step must be told which build this run made.
#
# Without BUILD_NUMBER the script falls back to "newest build in the list", and App Store
# Connect does not list a build the moment altool finishes — so on v0.10.0 it distributed
# v0.9.0's build, printed "marketing version 0.10.0, build 7", and exited zero.
grep -q 'BUILD_NUMBER' "$ios" \
  || note "$ios does not pass BUILD_NUMBER to the distribution step, so it cannot tell this run's build from the last release's"

# And the verifier must ask App Store Connect, not the job that just ran.
if [ -f "$rel" ] && ! grep -q 'appstoreconnect.apple.com' "$rel"; then
  note "$rel takes the iOS job's word that a build reached testers"
  echo "      That has been wrong twice: a build in no group, and the previous release's"
  echo "      build distributed instead of this one. Both times the job was green."
fi

# Every secret a workflow reads must be written down, with what breaks without it.
#
# This is the drift that costs a release day: a workflow grows a `secrets.NEW_THING`, the
# repository it runs in does not have one, and nothing says so until the job fails months
# later on a tag. GITHUB_TOKEN is excluded — Actions provides it and there is nothing to
# configure.
doc=docs/05-infrastructure/12-release-secrets.md
if [ ! -f "$doc" ]; then
  note "$doc is missing — the secrets the workflows read are written down nowhere"
else
  undocumented=$(grep -rhoE 'secrets\.[A-Z_][A-Z0-9_]*' .github/workflows/ \
    | sed 's/secrets\.//' | sort -u | grep -vx GITHUB_TOKEN \
    | while read -r s; do grep -q "\`$s\`" "$doc" || echo "$s"; done)
  if [ -n "$undocumented" ]; then
    note "secrets read by a workflow but absent from $doc:"
    echo "$undocumented" | sed 's/^/        /'
    echo "      Add each one with what breaks when it is missing. A secret nobody knew was"
    echo "      needed is found on a release day, by the release failing."
  fi
fi

if [ $fail -eq 0 ]; then
  echo "release pipeline: ok"
fi
exit $fail
