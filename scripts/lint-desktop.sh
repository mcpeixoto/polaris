#!/usr/bin/env bash
# Every desktop artefact that ships more than one architecture must name it.
#
# electron-builder's default `artifactName` interpolates `-${arch}` for arm64 and NOTHING
# for x64. Ship both and the release page offers `Polaris-1.2.3.dmg` beside
# `Polaris-1.2.3-arm64.dmg` — so the plain name, the one that reads as the ordinary
# download, is the Intel build. An Apple Silicon user who takes it runs under Rosetta, and
# since macOS 26 the system tells them the app is not optimised for their Mac and its
# developer should update it. That is how this check came to exist: a native build was
# sitting on the same page the whole time.
#
# The architecture in the name is also what `electron-updater` matches on. There is no
# metadata behind the choice: MacUpdater.filterFilesForArch prefers files whose URL
# *contains the substring* "arm64" on Apple Silicon and excludes them everywhere else. So a
# nicer scheme — "apple-silicon", "universal2", a build number — would not merely read
# oddly, it would hand every Mac the Intel build on its next update, silently, forever.
# `${arch}` is the only spelling that is both readable and correct.
#
# Not checked here, because their defaults are already right:
#   - the .deb, whose default name carries the architecture (Debian requires it)
#   - the Windows NSIS installer, which packs both architectures into one file, so a name
#     without an architecture is the accurate one
set -euo pipefail

cd "$(dirname "$0")/.."

config=desktop/electron-builder.yml
fail=0

# Reads `artifactName:` from inside a top-level block, without a YAML parser — CI has bash
# and nothing else, and a check that skips when a tool is missing is a check that stops
# holding on the day it matters.
artifact_name_in() {
  awk -v want="$1" '
    /^[a-zA-Z]/ { inside = ($0 ~ "^" want ":") }
    inside && /^[[:space:]]+artifactName:/ {
      sub(/^[[:space:]]*artifactName:[[:space:]]*/, "")
      print
      exit
    }
  ' "$config"
}

# The macOS and AppImage blocks are the two that ship an unlabelled x64 artefact by default.
for block in mac appImage; do
  name=$(artifact_name_in "$block")

  if [ -z "$name" ]; then
    echo "FAIL: $config: \`$block\` has no artifactName, so its x64 artefact ships unlabelled"
    echo "      Set one containing \${arch}, e.g. \${productName}-\${version}-mac-\${arch}.\${ext}"
    fail=1
    continue
  fi

  case "$name" in
    *'${arch}'*) ;;
    *)
      echo "FAIL: $config: \`$block.artifactName\` does not contain \${arch}: $name"
      echo "      Both architectures would be written to the same filename, and the second"
      echo "      build would overwrite the first."
      fail=1
      ;;
  esac
done

if [ $fail -eq 0 ]; then
  echo "desktop artifact naming: ok"
fi
exit $fail
