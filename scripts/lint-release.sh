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
