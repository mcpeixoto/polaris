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

group "On this machine"
[ -n "$asc_key" ]    && ok "App Store Connect key   $asc_key"        || printf '  \033[31m✗\033[0m No AuthKey_*.p8 under ~/.appstoreconnect/private_keys/\n'
[ -n "$asc_issuer" ] && ok "Issuer id               $asc_issuer"     || printf '  \033[31m✗\033[0m No issuer id found in ios/scripts/asc-setup.py\n'
[ -n "$devid" ]      && ok "Signing identity        $devid"          || printf '  \033[31m✗\033[0m No "Developer ID Application" identity in the keychain\n'

# The role check, which is the one that cannot be guessed from a filename. Creating an iOS
# distribution asset needs App Manager; notarisation needs only Developer, and a
# notarisation-scoped key fails inside xcodebuild with a message about certificates that
# sends you looking at the project instead of at the key.
if [ -n "$asc_key" ] && [ -n "$asc_issuer" ] && command -v python3 >/dev/null; then
  role=$(ASC_KEY="$asc_key" ASC_KEY_ID="$asc_key_id" ASC_ISSUER="$asc_issuer" python3 - <<'PY' 2>/dev/null || true
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
    *)                 printf '  \033[33m·\033[0m Key role                not probed (pip install pyjwt cryptography to check)\n' ;;
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
