#!/usr/bin/env -S uv run --with "pyjwt[crypto]" --with requests python
"""Register Polaris's bundle id and App Store provisioning profile.

Reuses the existing Apple Distribution certificate rather than minting a new one:
an Individual team is capped at a small number of distribution certs, and burning
one per app is how you end up unable to sign anything. One cert signs every app on
the team.

Idempotent — safe to re-run. Each step looks for the resource first.

Deliberately does NOT create the App Store Connect app record. The ASC API has no
endpoint for it, so it has to be added once by hand at
https://appstoreconnect.apple.com/apps (+ > New App). This script reports whether
it is there yet, because a missing record fails the *upload* — the very last step,
after a full archive — and the error at that point does not say what is wrong.

Usage: uv run --with "pyjwt[crypto]" --with requests python ios/scripts/asc-setup.py
"""

import base64
import json
import subprocess
import sys
import time
from pathlib import Path

import jwt
import requests

KEY_ID = "GJKL39M374"
ISSUER = "f91bc550-f9f4-44be-b17c-04d85e6e7fb2"
P8 = Path.home() / ".appstoreconnect/private_keys/AuthKey_GJKL39M374.p8"
API = "https://api.appstoreconnect.apple.com/v1"

BUNDLE_ID = "com.peixotolabs.polaris"
APP_NAME = "Polaris"
PROFILE_NAME = "Polaris App Store"


def token() -> str:
    now = int(time.time())
    return jwt.encode(
        {"iss": ISSUER, "iat": now, "exp": now + 1200, "aud": "appstoreconnect-v1"},
        P8.read_text(),
        algorithm="ES256",
        headers={"kid": KEY_ID},
    )


def api(method: str, path: str, payload=None, **params):
    response = requests.request(
        method,
        API + path,
        headers={"Authorization": f"Bearer {token()}", "Content-Type": "application/json"},
        data=json.dumps(payload) if payload else None,
        params=params,
        timeout=60,
    )
    if response.status_code >= 400:
        print(f"{method} {path} -> {response.status_code}\n{response.text}", file=sys.stderr)
        response.raise_for_status()
    return response.json() if response.text else {}


if not P8.exists():
    print(f"no App Store Connect key at {P8}", file=sys.stderr)
    sys.exit(1)

# 1. Bundle id. Polaris needs no capabilities: it talks to its own server over
#    HTTPS and holds no iCloud data, no push, no sign-in-with-Apple.
found = api("GET", "/bundleIds", **{"filter[identifier]": BUNDLE_ID})["data"]
if found:
    bundle = found[0]
    print(f"bundle id exists: {BUNDLE_ID} ({bundle['id']})")
else:
    bundle = api(
        "POST",
        "/bundleIds",
        {
            "data": {
                "type": "bundleIds",
                "attributes": {"identifier": BUNDLE_ID, "name": APP_NAME, "platform": "IOS"},
            }
        },
    )["data"]
    print(f"registered bundle id: {BUNDLE_ID} ({bundle['id']})")

# 2. Distribution certificate — reuse, never create a second one.
certs = api("GET", "/certificates", **{"filter[certificateType]": "DISTRIBUTION"})["data"]
if not certs:
    print("no Apple Distribution certificate on this team.", file=sys.stderr)
    sys.exit(1)
cert = certs[0]
print(f"using distribution cert: {cert['id']} (expires {cert['attributes'].get('expirationDate','?')[:10]})")

# The private key must be in the keychain or codesign cannot use the cert. This is
# the failure that surfaces much later as "no signing identity found", so it is
# checked here, where the message can say what to do about it.
identities = subprocess.run(
    ["security", "find-identity", "-v", "-p", "codesigning"], capture_output=True, text=True
).stdout
if "Apple Distribution" not in identities:
    print(
        "WARNING: no 'Apple Distribution' identity in the login keychain. The "
        "certificate exists on the team but its private key is not on this Mac, "
        "so archiving will fail.",
        file=sys.stderr,
    )

# 3. App Store provisioning profile for this bundle id.
profiles = api("GET", "/profiles", **{"filter[profileType]": "IOS_APP_STORE", "limit": 200})["data"]
profile = next((p for p in profiles if p["attributes"]["name"] == PROFILE_NAME), None)
if profile is None:
    profile = api(
        "POST",
        "/profiles",
        {
            "data": {
                "type": "profiles",
                "attributes": {"name": PROFILE_NAME, "profileType": "IOS_APP_STORE"},
                "relationships": {
                    "bundleId": {"data": {"type": "bundleIds", "id": bundle["id"]}},
                    "certificates": {"data": [{"type": "certificates", "id": cert["id"]}]},
                },
            }
        },
    )["data"]
    print(f"created profile: {PROFILE_NAME} ({profile['id']})")
else:
    print(f"profile exists: {PROFILE_NAME} ({profile['id']})")

profile_dir = Path.home() / "Library/MobileDevice/Provisioning Profiles"
profile_dir.mkdir(parents=True, exist_ok=True)
target = profile_dir / "Polaris_AppStore.mobileprovision"
target.write_bytes(base64.b64decode(profile["attributes"]["profileContent"]))
print(f"installed: {target}")

# 4. Report whether the App Store Connect app record exists yet.
apps = api("GET", "/apps", **{"filter[bundleId]": BUNDLE_ID})["data"]
if apps:
    app = apps[0]
    print(f"app record: {app['attributes']['name']} (Apple ID {app['id']})")
else:
    print(
        "\nNO APP RECORD YET for this bundle id. The ASC API cannot create one; it "
        "has to be added once at https://appstoreconnect.apple.com/apps (+ > New "
        "App), after which everything else here is automated."
    )
