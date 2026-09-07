#!/usr/bin/env bash
# Enforces the three-breakpoint rule documented in web/src/styles/tokens.css.
#
# A media condition is resolved before the cascade exists, so `max-width: var(--bp-md)` is
# not valid CSS and there is no token layer to lean on here. Without a check, a breakpoint
# is whatever number the person writing the rule had in mind — which is how this codebase
# arrived at ten of them (420, 520, 560, 640, 720, 860, 900, 901, 960, 1100 and one in
# rem). Ten breakpoints is not a responsive design; it is ten surfaces each reflowing at a
# window size none of the others agree with, so dragging a window narrow takes the product
# apart one piece at a time instead of moving it through three states.
#
# The three widths are sm 720, md 960, lg 1100. Adding a fourth means editing the prose in
# tokens.css and this list together, on purpose, which is the point.
#
# Only width queries are checked. `prefers-color-scheme`, `prefers-reduced-motion` and
# anything else describing the person rather than the window are not breakpoints and are
# none of this script's business.
set -euo pipefail

cd "$(dirname "$0")/.."

fail=0

# The three widths, plus the one-pixel-higher partner each one takes when a rule genuinely
# has to be written the other way round: a `min-width: 961px` beside a `max-width: 960px`
# covers the whole axis with no window where both match and none where neither does.
ALLOWED='720px 960px 1100px 721px 961px 1101px'

# Every `(max|min)-width: <value>` inside an @media prelude, with its file and line.
# Preludes in this codebase are single-line; one broken across lines would be missed here,
# and the fix if that ever appears is to join lines before matching, not to widen this.
hits=$(grep -rnE '@media[^{]*(max|min)-width' web/src ee/web --include='*.css' || true)

while IFS= read -r hit; do
  [ -z "$hit" ] && continue
  for value in $(printf '%s' "$hit" | grep -ohE '(max|min)-width[[:space:]]*:[[:space:]]*[0-9.]+[a-z]*' \
                   | sed -E 's/.*:[[:space:]]*//'); do
    case " $ALLOWED " in
      *" $value "*) ;;
      *)
        printf 'FAIL: %s\n' "$hit"
        printf '      %s is not one of the three breakpoints (720px, 960px, 1100px).\n' "$value"
        printf '      See the Breakpoints block in web/src/styles/tokens.css.\n'
        fail=1
        ;;
    esac
  done
done <<< "$hits"

# The range syntax — `@media (width < 800px)` — states a breakpoint without ever writing
# `max-width`, so the loop above would not see it and the rule would be one rewrite away
# from being unenforced. It is refused outright rather than parsed: nothing in this codebase
# uses it, and a check that quietly ignores a second spelling of the thing it exists to
# police is worse than no check.
range=$(grep -rnE '@media[^{]*\([^)]*[0-9]+(px|rem|em)[^)]*[<>]|@media[^{]*[<>][^)]*[0-9]+(px|rem|em)' \
          web/src ee/web --include='*.css' || true)
if [ -n "$range" ]; then
  echo "FAIL: media range syntax states a breakpoint this check cannot read:"
  echo "$range" | sed 's/^/  /'
  echo "      Write it as (max-width: 720px | 960px | 1100px) instead."
  fail=1
fi

if [ $fail -eq 0 ]; then
  echo "breakpoints: ok"
fi
exit $fail
