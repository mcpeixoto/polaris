#!/usr/bin/env python3
"""Renders the iOS app icon: Polaris/Assets.xcassets/AppIcon.appiconset/icon-1024.png.

The committed icon was a pale four-point star on a flat accent tile, drawn once by hand when
the app was added and never touched again. It had none of the mark's facet, orbit or rays,
and when the accent changed it kept the old one — the same failure the two Pillow generators
for the web and desktop icons exist to prevent. This is the third of them, reading the same
numbers out of `scripts/polaris_mark.py`.

    python3 ios/scripts/make-app-icon.py

Differences from `desktop/assets/make-icon.py`, all because iOS draws the shape itself:

  - the square is full-bleed. iOS applies its own corner mask, and a pre-rounded icon shows
    the ground's corners inside it as a second, slightly different curve;
  - there is no alpha channel. App Store Connect rejects an icon that has one;
  - there is no inset edge highlight, for the same reason as the corners.

Supersampled 4x and downsampled with LANCZOS, like the other two.
"""

import pathlib
import sys

from PIL import Image

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2] / 'scripts'))

import polaris_mark as mark  # noqa: E402

OUT = (
    pathlib.Path(__file__).resolve().parents[1]
    / 'Polaris' / 'Assets.xcassets' / 'AppIcon.appiconset' / 'icon-1024.png'
)

SIZE = 1024
SS = 4


def build():
    s = SIZE * SS
    ground = mark.vertical_gradient(s, mark.GROUND_TOP, mark.GROUND_BOTTOM)
    icon = mark.draw_mark(ground, ground=mark.GROUND_BOTTOM, thin_detail=True)
    return icon.convert('RGB').resize((SIZE, SIZE), Image.LANCZOS)


def main():
    build().save(OUT)
    print(f'wrote {OUT.name}')


if __name__ == '__main__':
    sys.exit(main())
