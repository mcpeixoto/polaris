#!/usr/bin/env python3
"""Renders the menu-bar / tray icon.

A different image from the app icon, and it has to be: a tray icon is a *template* image.
macOS throws away its colour entirely and recolours the alpha channel to match the menu bar,
so shipping the app icon here would produce a solid recoloured rounded square — the ground
is opaque, and opacity is the only thing the platform reads.

So this is the star alone, on transparency, in solid black. Black rather than white because
that is the template convention: macOS inverts it for dark menu bars, and Windows and Linux
render it as-is on a light tray. Shipping white would be invisible on half the platforms.

The star itself is the canonical one — `web/src/components/Logo.tsx` decides the shape,
`scripts/polaris_mark.py` holds it as numbers, and this reads the waist proportion from
there. It used to pick its own: a tip of 0.47 with a waist of 0.062, a ratio of 0.13 against
the mark's 0.21, which is a visibly rounder star. A tray icon does need a longer point than
the app icon, because it has no ground behind it — but that is a reason to scale the waist
with the tip, not a reason to draw a different star.

No orbit and no rays here, and that is not a divergence: at 16px with no ground they are a
fifth of a pixel, and a template image has no colour to separate them from the star. The
silhouette is all the platform will show.

Sizes: 16pt at 1x and 2x. Anything larger is never displayed and only costs bytes.

    python3 make-tray.py     # writes tray.png and tray@2x.png
"""

import pathlib
import sys

from PIL import Image, ImageDraw

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2] / 'scripts'))

import polaris_mark as mark  # noqa: E402

HERE = pathlib.Path(__file__).parent
SS = 8  # supersampling; the star's points need it badly at 16px

#: Fuller than the app icon's 0.32 of the square (0.82 inset x 15.5/40): the tray has no
#: ground behind it, so the star must carry the whole 16px alone or it reads as a speck. The
#: waist follows the tip through polaris_mark.WAIST_RATIO, so it is the same star, longer.
TIP = 0.47


def star(size):
    """The canonical mark's silhouette, at tray proportions."""
    s = size * SS
    pts = mark.star_outline_at(s / 2, s / 2, TIP * s)
    img = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    ImageDraw.Draw(img).polygon(pts, fill=(0, 0, 0, 255))
    return img.resize((size, size), Image.LANCZOS)


def main():
    star(16).save(HERE / 'tray.png')
    star(32).save(HERE / 'tray@2x.png')
    print('wrote tray.png, tray@2x.png')


if __name__ == '__main__':
    main()
