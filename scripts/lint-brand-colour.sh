#!/usr/bin/env bash
# Keeps the old indigo accent from coming back as the product's own colour.
#
# The accent ramp used to be an indigo whose 500 stop, #5e6ad2, is another issue
# tracker's brand colour — and a product that also shares that tracker's vocabulary and
# density does not need to share its colour as well. The ramp is now polar cyan. A ramp
# does not change back on its own; it changes back when somebody copies a hex out of an old
# screenshot, an old branch or a design reference, and nothing would notice.
#
# Scoped to the files that define the brand: the token file, the iOS palette, the mark and
# its generators, the committed icons, and the server's email and Slack styling. Test
# fixtures that use #5e6ad2 as an arbitrary stored entity colour are data, not the brand,
# and migrations that already ran are history — neither is checked.
set -euo pipefail

cd "$(dirname "$0")/.."

# The retired ramp, 50 through 900, plus the dark mark's highlight stop.
retired=(eef0fd dce0fb bcc3f6 97a1ef 9aa2ee 7a83e6 5e6ad2 4b56ba 3c4599 2e3577 212650)

files=(
  web/src/styles/tokens.css
  web/src/platform/runtime.ts
  web/public/icon.svg
  web/index.html
  web/public/manifest.webmanifest
  ios/PolarisCore/Sources/PolarisCore/Design/Palette.swift
  ios/PolarisCore/Sources/PolarisCore/Design/Mark.swift
  ios/Polaris/DesignSystem/Theme.swift
  scripts/polaris_mark.py
  desktop/assets/icon.svg
  .github/assets/logo-dark.svg
  .github/assets/logo-light.svg
  .github/assets/mark-dark.svg
  .github/assets/mark-light.svg
  services/internal/domain/slack.go
  services/internal/domain/workflowstate.go
  services/internal/domain/projects.go
  services/cmd/polarisctl/seed.go
  README.md
)
while IFS= read -r f; do files+=("$f"); done < <(find services/internal/mailer -name '*.go' ! -name '*_test.go' | sort)

fail=0
for hex in "${retired[@]}"; do
  # The three spellings the brand files use: #5e6ad2 / 5e6ad2 in CSS, SVG and URLs,
  # 0x5E6AD2 in Swift, and (0x5E, 0x6A, 0xD2) in the Pillow generators.
  tuple="0x${hex:0:2}, 0x${hex:2:2}, 0x${hex:4:2}"
  for f in "${files[@]}"; do
    [ -f "$f" ] || continue
    hits=$(grep -niE "${hex}|${tuple}" "$f" || true)
    if [ -n "$hits" ]; then
      echo "FAIL: $f uses the retired indigo accent ($hex):"
      echo "$hits" | sed 's/^/  /'
      fail=1
    fi
  done
done

if [ $fail -eq 0 ]; then
  echo "brand colour: ok"
fi
exit $fail
