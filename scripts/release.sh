#!/usr/bin/env bash
# Cut a release.
#
#   make release VERSION=v0.9.0
#
# A tag is the only release mechanism here: it deploys production, builds and publishes the
# desktop installers, and uploads to TestFlight. That makes `git tag && git push` a
# deceptively large action to take by hand, and every way it goes wrong is quiet:
#
#   * tagging from a stale checkout ships an old commit as a new version
#   * tagging with a dirty tree ships something that was never on main
#   * tagging when a signing secret is missing produces a release with a hole in it, found
#     when somebody tries to install it
#   * tagging a version that already exists does nothing at all, visibly successfully
#
# So this refuses first and tags second. Everything it checks, it checks before creating
# anything, because a tag that should not have been cut cannot be taken back — the tooling
# and every clone have already seen it.
set -euo pipefail

cd "$(dirname "$0")/.."

VERSION="${VERSION:-${1:-}}"
if [ -z "$VERSION" ]; then
  echo "usage: make release VERSION=v0.9.0" >&2
  exit 2
fi
[[ "$VERSION" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || {
  echo "FAIL: '$VERSION' is not vMAJOR.MINOR.PATCH." >&2
  echo "      The iOS build derives CFBundleShortVersionString from it, and App Store" >&2
  echo "      Connect takes nothing else." >&2
  exit 1
}

fail=0
note() { printf '\033[31mFAIL:\033[0m %s\n' "$*"; fail=1; }
ok()   { printf '\033[32m  ok\033[0m %s\n' "$*"; }

echo "Releasing $VERSION"
echo

git fetch --quiet origin main
tip=$(git rev-parse origin/main)

# The tree that will be released, not the tree you are looking at.
if [ -n "$(git status --porcelain)" ]; then
  note "working tree is not clean"
  echo "      A tag is cut from origin/main, so uncommitted work here would NOT be in the"
  echo "      release — which is worse than failing, because the release looks fine."
else
  ok "working tree clean"
fi

behind=$(git rev-list --count HEAD..origin/main)
[ "$behind" -gt 0 ] && printf '\033[33m  note\033[0m this checkout is %s behind origin/main; tagging %s anyway\n' "$behind" "${tip:0:7}"
ok "origin/main is ${tip:0:7} — $(git log -1 --format=%s "$tip" | cut -c1-60)"

if git rev-parse -q --verify "refs/tags/$VERSION" >/dev/null || \
   git ls-remote --exit-code --tags origin "refs/tags/$VERSION" >/dev/null 2>&1; then
  note "$VERSION already exists"
  echo "      Pushing it again is a no-op that reports success. Pick the next version."
else
  ok "$VERSION is unused"
fi

# CI must have passed on the exact commit being released. A tag whose tree was never
# validated is how a broken release reaches production, since the deploy runs off the tag.
if command -v gh >/dev/null; then
  concl=$(gh api "repos/{owner}/{repo}/commits/$tip/check-runs?per_page=100" \
          --jq '[.check_runs[]|select(.conclusion!=null and .conclusion!="success" and .conclusion!="skipped" and .conclusion!="neutral")]|length' 2>/dev/null || echo "?")
  pend=$(gh api "repos/{owner}/{repo}/commits/$tip/check-runs?per_page=100" \
          --jq '[.check_runs[]|select(.status!="completed")]|length' 2>/dev/null || echo "?")
  if [ "$concl" = "?" ]; then
    printf '\033[33m  note\033[0m could not read check runs for %s\n' "${tip:0:7}"
  elif [ "$pend" != 0 ]; then
    note "CI is still running on ${tip:0:7} ($pend pending)"
    echo "      The deploy runs off this tag. Wait for it."
  elif [ "$concl" != 0 ]; then
    note "CI failed on ${tip:0:7} ($concl failing)"
  else
    ok "CI is green on ${tip:0:7}"
  fi
fi

# Which surfaces will actually ship. Not fatal on its own — an unsigned desktop build is
# still a build — but it must be said before the tag, not discovered after it.
echo
missing=$(gh secret list --json name --jq '.[].name' 2>/dev/null || true)
for s in APPLE_API_KEY_PATH APPLE_API_KEY_ID APPLE_API_ISSUER; do
  grep -qx "$s" <<<"$missing" || { printf '\033[33m  warn\033[0m %s is not set — no TestFlight build\n' "$s"; break; }
done
grep -qx MAC_CERT_P12 <<<"$missing" \
  || printf '\033[33m  warn\033[0m MAC_CERT_P12 is not set — macOS builds ship unsigned and Gatekeeper refuses them\n'

if [ $fail -ne 0 ]; then
  echo
  echo "Nothing was tagged."
  exit 1
fi

echo
read -r -p "Tag $VERSION at ${tip:0:7} and push? [y/N] " answer
case "$answer" in [yY]*) ;; *) echo "Nothing was tagged."; exit 1;; esac

git tag -a "$VERSION" "$tip" -m "$VERSION"
git push origin "$VERSION"

echo
echo "Tagged. Four workflows now run on $VERSION:"
echo "  CI       — the suite, then the production deploy"
echo "  Desktop  — macOS, Windows and Linux, then publishes the release"
echo "  iOS      — archive, validate, upload to TestFlight"
echo "  Release  — checks all of the above actually shipped"
echo
echo "  gh run list --branch $VERSION"
