#!/usr/bin/env python3
"""Validate the complete desktop asset set and updater manifests before publication.

Usage: python3 scripts/verify-desktop-release.py vX.Y.Z release.json manifests/
release.json is `gh release view --json assets` output; manifests/ holds latest*.yml.
Requires PyYAML (also used by the release workflow).
"""
import json
from pathlib import Path
import re
import sys
from urllib.parse import unquote

import yaml


def validate(tag, release, directory):
    if not re.fullmatch(r"v\d+\.\d+\.\d+", tag):
        raise ValueError(f"Not a stable release tag: {tag}")
    version = tag[1:]
    assets = {asset['name']: asset for asset in release['assets']}
    mac = [f"Polaris-{version}-mac-{arch}.{ext}" for arch in ('arm64', 'x64') for ext in ('dmg', 'zip')]
    win = f"Polaris-Setup-{version}.exe"
    linux = f"Polaris-{version}-linux-x86_64.AppImage"
    required = [*mac, win, linux, f"polaris_{version}_amd64.deb", 'latest.yml', 'latest-mac.yml', 'latest-linux.yml']
    for name in required:
        if name not in assets or assets[name].get('size', 0) <= 0 or assets[name].get('state') != 'uploaded':
            raise ValueError(f"Missing or empty uploaded asset: {name}")

    for manifest, expected in {
        'latest.yml': {win},
        'latest-mac.yml': {name for name in mac if name.endswith('.zip')},
        'latest-linux.yml': {linux, f'polaris_{version}_amd64.deb'},
    }.items():
        data = yaml.safe_load((Path(directory) / manifest).read_text())
        if str(data.get('version')) != version:
            raise ValueError(f"{manifest}: version must be {version}")
        files = data.get('files', [])
        found = set()
        for item in files:
            name = unquote(item['url'])
            if name not in assets or name not in required or not name.startswith(('Polaris-', 'polaris_')):
                raise ValueError(f"{manifest}: unknown asset {name}")
            if item.get('size') != assets[name]['size'] or not item.get('sha512'):
                raise ValueError(f"{manifest}: missing checksum or incorrect size for {name}")
            found.add(name)
        if not expected.issubset(found):
            raise ValueError(f"{manifest}: missing update targets {sorted(expected - found)}")
        if unquote(data.get('path', '')) not in found or not data.get('sha512'):
            raise ValueError(f"{manifest}: invalid legacy update target")
    return f"{tag}: all 7 installers/update ZIPs and 3 updater manifests verified"


if __name__ == '__main__':
    try:
        print(validate(sys.argv[1], json.loads(Path(sys.argv[2]).read_text()), sys.argv[3]))
    except (ValueError, KeyError, TypeError, OSError) as error:
        sys.exit(f"Desktop release validation failed: {error}")
