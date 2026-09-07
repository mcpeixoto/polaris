#!/usr/bin/env bash
# Did a release actually reach people?
#
#   make status              the newest tag
#   make status TAG=v0.9.0   a particular one
#
# Four surfaces ship from one tag and each can fail on its own, quietly. Every question
# below is asked of the thing itself rather than of the job that was supposed to do it,
# because every false green in this project's history came from trusting a job:
#
#   * six releases stayed drafts, so nobody could download them and the desktop updater,
#     which only reads published releases, told every installed copy it was current;
#   * five TestFlight builds belonged to no beta group, which makes them invisible in the
#     TestFlight app, while every upload job reported success;
#   * production ran whatever the last merge left, which was not what any tag said.
#
# So this asks the release page what it holds, asks production what it is running, and asks
# App Store Connect who can install the build.
set -euo pipefail

cd "$(dirname "$0")/.."

TAG="${TAG:-${1:-}}"
if [ -z "$TAG" ]; then
  git fetch --quiet --tags origin 2>/dev/null || true
  TAG=$(git tag --list 'v*' --sort=-v:refname | head -1)
fi
[ -n "$TAG" ] || { echo "No v* tag exists yet." >&2; exit 1; }

sha=$(git rev-list -n1 "$TAG" 2>/dev/null || true)
[ -n "$sha" ] || { echo "Unknown tag $TAG" >&2; exit 1; }
short="${sha:0:7}"

printf '\033[1m%s\033[0m  %s  —  %s\n\n' "$TAG" "$short" "$(git log -1 --format=%s "$sha" | cut -c1-60)"

fail=0
ok()   { printf '  \033[32m✓\033[0m %-12s %s\n' "$1" "$2"; }
bad()  { printf '  \033[31m✗\033[0m %-12s %s\n' "$1" "$2"; fail=1; }
warn() { printf '  \033[33m!\033[0m %-12s %s\n' "$1" "$2"; }

# ---- the website -----------------------------------------------------------------
url="${POLARIS_URL:-https://polaris.peixotolabs.com}"
if got=$(curl -fsS --max-time 20 "$url/deployment" 2>/dev/null); then
  rev=$(python3 -c 'import sys,json;print(json.load(sys.stdin).get("revision",""))' <<<"$got")
  env=$(python3 -c 'import sys,json;print(json.load(sys.stdin).get("env",""))' <<<"$got")
  if [ "$rev" = "$short" ]; then
    ok website "$url is serving $rev ($env)"
  else
    bad website "$url is serving $rev, not $short"
  fi
else
  bad website "$url/deployment did not answer"
fi

# ---- the release page ------------------------------------------------------------
if rel=$(gh api "repos/{owner}/{repo}/releases/tags/$TAG" 2>/dev/null); then
  draft=$(python3 -c 'import sys,json;print(json.load(sys.stdin)["draft"])' <<<"$rel")
  names=$(python3 -c 'import sys,json;print("\n".join(a["name"] for a in json.load(sys.stdin)["assets"]))' <<<"$rel")
  if [ "$draft" = "True" ]; then
    bad release "$TAG is still a draft — nobody can download it, and the updater cannot see it"
  else
    missing=""
    for want in '\.dmg$' '\.exe$' '\.AppImage$' '^latest\.yml$'; do
      grep -qE "$want" <<<"$names" || missing="$missing $want"
    done
    if [ -n "$missing" ]; then
      bad release "published but missing:$missing"
    elif ! grep -q "${TAG#v}" <<<"$names"; then
      bad release "published, but no asset carries version ${TAG#v}"
    else
      ok release "published, $(wc -l <<<"$names" | tr -d ' ') assets at version ${TAG#v}"
    fi
  fi
else
  bad release "no GitHub release exists for $TAG"
fi

# ---- desktop signing -------------------------------------------------------------
if gh secret list --json name --jq '.[].name' 2>/dev/null | grep -qx MAC_CERT_P12; then
  ok desktop "signed"
else
  warn desktop "installers are unsigned — Gatekeeper refuses them on machines that did not build them"
fi

# ---- TestFlight ------------------------------------------------------------------
key=$(ls -t "$HOME"/.appstoreconnect/private_keys/AuthKey_*.p8 2>/dev/null | head -1 || true)
issuer=$(grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' \
         ios/scripts/asc-setup.py 2>/dev/null | head -1 || true)
if [ -z "$key" ] || [ -z "$issuer" ]; then
  warn testflight "not checked — no App Store Connect key on this machine"
else
  venv="${XDG_CACHE_HOME:-$HOME/.cache}/polaris-asc-probe"
  py=$(python3 -c 'import jwt,cryptography' 2>/dev/null && echo python3 || echo "$venv/bin/python")
  if [ ! -x "$py" ] && [ "$py" != python3 ]; then
    python3 -m venv "$venv" >/dev/null 2>&1 && \
      "$venv/bin/pip" install --quiet --disable-pip-version-check pyjwt cryptography >/dev/null 2>&1 || true
  fi
  if [ -x "$py" ] || [ "$py" = python3 ]; then
    out=$(ASC_KEY="$key" ASC_KEY_ID="$(basename "$key" .p8 | sed 's/^AuthKey_//')" \
          ASC_ISSUER="$issuer" WANT="${TAG#v}" "$py" - <<'PY' 2>/dev/null || true
import os, time, json, urllib.request
import jwt
now = int(time.time())
tok = jwt.encode({"iss": os.environ["ASC_ISSUER"], "iat": now, "exp": now + 600,
                  "aud": "appstoreconnect-v1"}, open(os.environ["ASC_KEY"]).read(),
                 algorithm="ES256", headers={"kid": os.environ["ASC_KEY_ID"], "typ": "JWT"})
def get(p):
    r = urllib.request.Request("https://api.appstoreconnect.apple.com/v1/" + p,
                               headers={"Authorization": "Bearer " + tok})
    return json.load(urllib.request.urlopen(r))
want = os.environ["WANT"]
app = get("apps?filter[bundleId]=com.peixotolabs.polaris")["data"][0]["id"]
r = get(f"builds?filter[app]={app}&limit=20&sort=-uploadedDate"
        "&include=preReleaseVersion,betaGroups")
inc = {i["id"]: i for i in r.get("included", [])}
for d in r["data"]:
    pv = d["relationships"].get("preReleaseVersion", {}).get("data")
    ver = inc[pv["id"]]["attributes"]["version"] if pv and pv["id"] in inc else ""
    if ver != want:
        continue
    groups = [inc[g["id"]]["attributes"]["name"]
              for g in (d["relationships"].get("betaGroups", {}).get("data") or [])
              if g["id"] in inc]
    print(json.dumps({"build": d["attributes"]["version"],
                      "state": d["attributes"]["processingState"], "groups": groups}))
    break
else:
    print(json.dumps({}))
PY
)
    if [ -z "$out" ] || [ "$out" = "{}" ]; then
      bad testflight "no build for ${TAG#v} in App Store Connect"
    else
      st=$(python3 -c 'import sys,json;d=json.load(sys.stdin);print(d["state"])' <<<"$out")
      gs=$(python3 -c 'import sys,json;d=json.load(sys.stdin);print(", ".join(d["groups"]))' <<<"$out")
      bn=$(python3 -c 'import sys,json;print(json.load(sys.stdin)["build"])' <<<"$out")
      if [ -z "$gs" ]; then
        bad testflight "build $bn is $st but belongs to no group — invisible to every tester"
      else
        ok testflight "build $bn ($st) available to: $gs"
      fi
    fi
  fi
fi

echo
if [ $fail -eq 0 ]; then
  printf '\033[32m%s shipped.\033[0m\n' "$TAG"
else
  printf '\033[31m%s did not fully ship.\033[0m\n' "$TAG"
fi
exit $fail
