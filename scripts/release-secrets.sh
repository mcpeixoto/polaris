#!/usr/bin/env bash
# Which release secrets are configured, and how to configure the ones that are not.
#
# The recurring failure this exists to end: a release day arrives, a workflow fails on a
# secret nobody knew was missing, and somebody has to go and find out where the credential
# lives, what it is called this week, and what role it needs. Every one of those answers is
# knowable in advance. This asks GitHub what is set, looks on this machine for what is not,
# and — with --set — puts them in place.
#
#   scripts/release-secrets.sh          what is configured and what each gap costs
#   scripts/release-secrets.sh --set    set the missing ones it can source locally
#
# Nothing here reads or prints a secret value. --set streams a credential from a local file
# straight into `gh secret set` without it passing through a variable, a log or a terminal.
#
# docs/05-infrastructure/12-release-secrets.md is the reference; this is the check.
set -euo pipefail

cd "$(dirname "$0")/.."

SET=0
[ "${1:-}" = "--set" ] && SET=1

if ! command -v gh >/dev/null; then
  echo "gh is not installed; nothing can be checked." >&2
  exit 1
fi

# Which checkout is this, and is it current?
#
# There are commonly a dozen worktrees against this repository, and a stale one is not
# obviously stale: it has a Makefile, a scripts/ directory and a git prompt like any other.
# Running `make release-secrets` in one that predates the target produces
# "No rule to make target", which reads as the target not existing rather than as the
# checkout being old. It has already happened.
branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?')
git fetch --quiet origin main 2>/dev/null || true
behind=$(git rev-list --count HEAD..origin/main 2>/dev/null || echo 0)
if [ "${behind:-0}" -gt 0 ]; then
  printf '\033[33mNote:\033[0m this checkout (%s, %s) is %s commit(s) behind origin/main.\n' \
    "$(pwd)" "$branch" "$behind"
  printf '      What you see below is still accurate — the secrets live on GitHub, not here —\n'
  printf '      but the script itself may be old. `git merge --ff-only origin/main` to update.\n\n'
fi

have=$(gh secret list --json name --jq '.[].name' 2>/dev/null || true)
if [ -z "$have" ]; then
  echo "No secrets readable — is this repo's remote right, and is gh authenticated?" >&2
  exit 1
fi

configured() { grep -qx "$1" <<<"$have"; }

green=0; gaps=()

group() { printf '\n\033[1m%s\033[0m\n' "$1"; }
ok()    { printf '  \033[32m✓\033[0m %s\n' "$1"; green=$((green+1)); }
gap()   { printf '  \033[31m✗\033[0m %-22s %s\n' "$1" "$2"; gaps+=("$1"); }

group "Deploy to production — merging to main"
for s in DEPLOY_HOST DEPLOY_USER DEPLOY_SSH_KEY DEPLOY_HOST_KEY; do
  configured "$s" && ok "$s" || gap "$s" "the deploy job cannot run"
done

group "TestFlight — ios-release.yml on a v* tag"
for s in APPLE_API_KEY_PATH APPLE_API_KEY_ID APPLE_API_ISSUER; do
  configured "$s" && ok "$s" || gap "$s" "no iOS build is ever uploaded"
done
# Separate from the API key, and not implied by it. -allowProvisioningUpdates downloads a
# certificate; the private key that makes it an identity lives only in the keychain whose
# CSR created it, and no App Store Connect role can hand one out.
for s in IOS_DIST_P12 IOS_DIST_P12_PASSWORD; do
  configured "$s" && ok "$s" || gap "$s" "the archive cannot be signed — no distribution private key"
done

group "Desktop signing — desktop.yml on a v* tag"
for s in MAC_CERT_P12 MAC_CERT_PASSWORD; do
  configured "$s" && ok "$s" || gap "$s" "macOS builds ship unsigned; Gatekeeper refuses them"
done
for s in AZURE_TENANT_ID AZURE_CLIENT_ID AZURE_CLIENT_SECRET; do
  configured "$s" && ok "$s" || gap "$s" "the Windows installer ships unsigned"
done

# ---------------------------------------------------------------------------
# What is on this machine. Discovery rather than configuration: a path written down
# in a repo goes stale, and this is the same lookup a person would do by hand.
# ---------------------------------------------------------------------------
asc_key=$(ls -t "$HOME"/.appstoreconnect/private_keys/AuthKey_*.p8 2>/dev/null | head -1 || true)
asc_key_id=""
[ -n "$asc_key" ] && asc_key_id=$(basename "$asc_key" .p8 | sed 's/^AuthKey_//')
# The issuer is not a credential and already lives in the repo.
asc_issuer=$(grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' \
             ios/scripts/asc-setup.py 2>/dev/null | head -1 || true)
devid=$(security find-identity -v -p codesigning 2>/dev/null \
        | grep 'Developer ID Application' | head -1 | sed 's/.*"\(.*\)"/\1/' || true)
iosid=$(security find-identity -v -p codesigning 2>/dev/null \
        | grep 'Apple Distribution' | head -1 | sed 's/.*"\(.*\)"/\1/' || true)

group "On this machine"
[ -n "$asc_key" ]    && ok "App Store Connect key   $asc_key"        || printf '  \033[31m✗\033[0m No AuthKey_*.p8 under ~/.appstoreconnect/private_keys/\n'
[ -n "$asc_issuer" ] && ok "Issuer id               $asc_issuer"     || printf '  \033[31m✗\033[0m No issuer id found in ios/scripts/asc-setup.py\n'
[ -n "$devid" ]      && ok "Desktop identity        $devid"          || printf '  \033[31m✗\033[0m No "Developer ID Application" identity in the keychain\n'
[ -n "$iosid" ]      && ok "iOS identity            $iosid"          || printf '  \033[31m✗\033[0m No "Apple Distribution" identity in the keychain\n'

# Apple distribution certificates last a year, and a lapsed one fails the archive with the
# same message as no certificate at all. Reporting the date turns a yearly surprise into a
# yearly chore.
if [ -n "$iosid" ]; then
  end=$(security find-certificate -c 'Apple Distribution' -p login.keychain-db 2>/dev/null \
        | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2 || true)
  if [ -n "$end" ]; then
    left=$(( ( $(date -j -f '%b %e %T %Y %Z' "$end" +%s 2>/dev/null || echo 0) - $(date +%s) ) / 86400 ))
    if [ "$left" -lt 0 ]; then
      printf '  \033[31m✗\033[0m Certificate expiry      EXPIRED %s — every iOS release fails until it is renewed\n' "$end"
    elif [ "$left" -lt 45 ]; then
      printf '  \033[33m!\033[0m Certificate expiry      %s — %s days left; renew and re-export IOS_DIST_P12\n' "$end" "$left"
    else
      ok "Certificate expiry      $end ($left days)"
    fi
  fi
fi

# The role check, which is the one that cannot be guessed from a filename. Creating an iOS
# distribution asset needs App Manager; notarisation needs only Developer, and a
# notarisation-scoped key fails inside xcodebuild with a message about certificates that
# sends you looking at the project instead of at the key.
# PyJWT is not in a system Python and is not worth installing into one. A throwaway venv
# under the cache costs a few seconds on first use and nothing afterwards — and the check
# it enables is the difference between finding out about a too-narrow key here or ten
# minutes into an archive on a release.
probe_python() {
  if python3 -c 'import jwt, cryptography' 2>/dev/null; then echo python3; return; fi
  local venv="${XDG_CACHE_HOME:-$HOME/.cache}/polaris-asc-probe"
  if [ ! -x "$venv/bin/python" ]; then
    python3 -m venv "$venv" >/dev/null 2>&1 || return 1
    "$venv/bin/pip" install --quiet --disable-pip-version-check pyjwt cryptography >/dev/null 2>&1 || return 1
  fi
  "$venv/bin/python" -c 'import jwt, cryptography' 2>/dev/null && echo "$venv/bin/python"
}

py=""
if [ -n "$asc_key" ] && [ -n "$asc_issuer" ]; then
  py=$(probe_python || true)
fi
if [ -n "$py" ]; then
  role=$(ASC_KEY="$asc_key" ASC_KEY_ID="$asc_key_id" ASC_ISSUER="$asc_issuer" "$py" - <<'PY' 2>/dev/null || true
import os, time, json, urllib.request
try:
    import jwt
except ImportError:
    raise SystemExit(0)
now = int(time.time())
tok = jwt.encode({"iss": os.environ["ASC_ISSUER"], "iat": now, "exp": now + 600,
                  "aud": "appstoreconnect-v1"},
                 open(os.environ["ASC_KEY"]).read(), algorithm="ES256",
                 headers={"kid": os.environ["ASC_KEY_ID"], "typ": "JWT"})
req = urllib.request.Request("https://api.appstoreconnect.apple.com/v1/certificates?limit=200",
                             headers={"Authorization": "Bearer " + tok})
try:
    kinds = {d["attributes"]["certificateType"] for d in json.load(urllib.request.urlopen(req))["data"]}
except Exception:
    print("unreadable"); raise SystemExit(0)
print("app-manager" if any("DISTRIBUTION" in k for k in kinds) else "notarisation-only")
PY
)
  case "$role" in
    app-manager)       ok "Key role                reads distribution certificates — App Manager, which is what the archive needs" ;;
    notarisation-only) printf '  \033[31m✗\033[0m Key role                notarisation-scoped. It can notarise but cannot sign an iOS archive.\n' ;;
    unreadable)        printf '  \033[31m✗\033[0m Key role                App Store Connect rejected it. Wrong issuer, or the key was revoked.\n' ;;
    *)                 printf '  \033[33m·\033[0m Key role                probe failed to run — check by hand before relying on a release\n' ;;
  esac
fi

if [ ${#gaps[@]} -eq 0 ]; then
  printf '\n%s secrets configured. Nothing missing.\n' "$green"
  exit 0
fi

printf '\n\033[1m%d missing.\033[0m ' "${#gaps[@]}"
if [ $SET -eq 0 ]; then
  echo "Run with --set to configure the ones sourceable from this machine."
  echo "See docs/05-infrastructure/12-release-secrets.md for the rest."
  exit 0
fi

printf 'Setting what can be sourced locally.\n\n'

set_from_file() {  # name, path — streamed, never held in a variable
  gh secret set "$1" < "$2" && echo "  set $1 from $2"
}
set_value() { gh secret set "$1" --body "$2" && echo "  set $1"; }

if [ -n "$asc_key" ] && [ -n "$asc_issuer" ]; then
  configured APPLE_API_KEY_PATH || set_from_file APPLE_API_KEY_PATH "$asc_key"
  configured APPLE_API_KEY_ID   || set_value     APPLE_API_KEY_ID   "$asc_key_id"
  configured APPLE_API_ISSUER   || set_value     APPLE_API_ISSUER   "$asc_issuer"
fi

# The macOS certificate is deliberately not automated. Exporting it needs the login
# keychain password, which belongs to a person at a keyboard and to nothing else.
if ! configured IOS_DIST_P12 && [ -n "$iosid" ]; then
  cat <<EOT

  IOS_DIST_P12 needs a manual export — the login keychain will ask for your password.
  Export the *identity*, so the private key goes with the certificate:

    security export -t identities -f pkcs12 -P '<choose-a-passphrase>' \\
      -o /tmp/polaris-ios-dist.p12 -k login.keychain-db
    base64 -i /tmp/polaris-ios-dist.p12 | gh secret set IOS_DIST_P12
    gh secret set IOS_DIST_P12_PASSWORD --body '<the-same-passphrase>'
    rm /tmp/polaris-ios-dist.p12

  Identity: $iosid
EOT
fi

if ! configured MAC_CERT_P12 && [ -n "$devid" ]; then
  cat <<EOT

  MAC_CERT_P12 needs a manual export — the login keychain will ask for your password:

    security export -t identities -f pkcs12 -P '<choose-a-passphrase>' \\
      -o /tmp/polaris-devid.p12 -k login.keychain-db
    base64 -i /tmp/polaris-devid.p12 | gh secret set MAC_CERT_P12
    gh secret set MAC_CERT_PASSWORD --body '<the-same-passphrase>'
    rm /tmp/polaris-devid.p12

  Identity: $devid
EOT
fi

printf '\nRe-run without --set to confirm.\n'
