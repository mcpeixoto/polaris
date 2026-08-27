#!/usr/bin/env bash
# Enforces the design-token rule.
#
# Custom themes are a product feature. A component that hardcodes a colour looks correct
# under the theme it was written against and wrong under every other one — and it fails
# silently, because nothing errors, it just looks broken to somebody who chose a light
# theme six months later.
#
# Two checks:
#   1. No literal colours in stylesheets outside tokens.css.
#   2. Every var(--token) a stylesheet references actually exists in tokens.css. A typo'd
#      token is not a build error; it resolves to nothing and the element renders
#      transparent or unstyled.
set -euo pipefail

cd "$(dirname "$0")/.."

TOKENS=web/src/styles/tokens.css
fail=0

if [ ! -f "$TOKENS" ]; then
  echo "FAIL: $TOKENS is missing — every stylesheet depends on it" >&2
  exit 1
fi

# --- 1. literal colours ---------------------------------------------------------------

hits=$(grep -rnE '#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(' web/src ee/web --include='*.css' \
        | grep -v "^$TOKENS:" || true)
if [ -n "$hits" ]; then
  echo "FAIL: literal colours outside tokens.css — custom themes cannot override these:"
  echo "$hits" | sed 's/^/  /'
  fail=1
fi

# --- 2. unresolvable custom properties ------------------------------------------------
#
# A var() must resolve to something. It may be a design token, or it may be a property the
# stylesheet declares for itself — LabelChip sets --label-color from workspace data, which
# is a legitimate raw colour and not a design decision anybody can theme.
#
# Both are accepted; neither being present is not. That second case is the one worth having
# the check for: an undeclared custom property does not error, it resolves to nothing, and
# the element renders transparent or unstyled. The original version of this rule only
# looked in tokens.css, which meant a component-local property was reported as a failure
# while a *misspelled* component-local property was reported identically — so the rule
# could not tell a deliberate one from a typo, and the fix for both looked the same.
#
# A locally-declared property should still carry a default value, so that a caller who
# forgets to set it gets something visible rather than nothing.

while IFS= read -r file; do
  [ "$file" = "$TOKENS" ] && continue
  for token in $(grep -ohE 'var\(--[a-zA-Z0-9-]+' "$file" | sed 's/var(//' | sort -u); do
    grep -q -- "$token:" "$TOKENS" && continue
    # Declared in this stylesheet: a component-local property.
    grep -qE "^[[:space:]]*$token:" "$file" && continue
    echo "FAIL: $file references $token, which is neither a token in $TOKENS nor declared in the file itself"
    fail=1
  done
done < <(find web/src ee/web -name '*.css' | sort)

if [ $fail -eq 0 ]; then
  echo "design tokens: ok"
fi
exit $fail
