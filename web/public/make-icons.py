#!/usr/bin/env python3
"""Renders the web icons: favicon.ico, icon-192.png, icon-512.png, apple-touch-icon.png.

`icon.svg` beside this file is what most browsers actually use — an SVG icon is the mark at
whatever size the chrome asks for, and it needs no build step. These rasters are the fallback
set: the .ico for browsers that ignore SVG icons and for a bookmark saved before the SVG
existed, the two PNGs for the installed web app declared in manifest.webmanifest, and the
apple-touch-icon for an iOS home screen, which has never read an SVG.

They existed as four binaries of unknown vintage, drawn by nobody remembers what, which is a
problem specific to committed rasters: nothing about a PNG says which drawing it came from,
so it can disagree with the mark for years without anyone noticing. Now they come from
`scripts/polaris_mark.py`, which is `web/src/components/Logo.tsx` written as numbers, and
Logo.tsx is the source of truth for the geometry. If the mark changes, it changes there, then
in polaris_mark.py, then this is re-run.

    python3 make-icons.py

Supersampled 4x and downsampled with LANCZOS, the same as desktop/assets/make-icon.py, which
is what gives the star's points clean edges at 16px.

## The orbit and the rays below 64px

The orbit is a 1-unit stroke and each ray is 1.4 units on a 40-unit grid, inside a mark inset
to 82% of the square: below roughly 64px they are a fraction of a pixel and render as haze
around the star rather than as hairlines. So the small .ico frames are the star alone, as
desktop/assets/make-icon.py does at the same threshold and for the same reason. The 192, 512
and 180px icons are all comfortably above it and carry the whole mark.
"""

import pathlib
import sys

from PIL import Image

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2] / 'scripts'))

import polaris_mark as mark  # noqa: E402

HERE = pathlib.Path(__file__).parent

SS = 4  # supersampling factor
THIN_DETAIL_MIN = 64

#: The tab strip is white in one theme and near-black in the other, and a bare indigo star
#: disappears into the second one — so the icon carries its own ground. `rx` is 9 on the 40
#: grid in icon.svg, which is 22.5%: near enough the macOS squircle that the installed app
#: and the desktop app are the same shape.
GROUND_RADIUS = 0.225


def build(size, thin_detail=True):
    """One icon, ground and mark, at `size` pixels."""
    s = size * SS
    base = Image.new('RGB', (s, s), mark.GROUND_BOTTOM)
    base = mark.draw_mark(base, ground=mark.GROUND_BOTTOM, thin_detail=thin_detail)
    icon = base.convert('RGBA')
    icon.putalpha(mark.rounded_mask(s, round(GROUND_RADIUS * s)))
    return icon.resize((size, size), Image.LANCZOS)


def main():
    build(512).save(HERE / 'icon-512.png')
    build(192).save(HERE / 'icon-192.png')
    # 180 is the size iOS asks for; anything else it rescales itself, less well.
    build(180).save(HERE / 'apple-touch-icon.png')

    # Every .ico frame is rendered at its own size rather than downsampled from one big
    # image, so the 16px frame is the star alone rather than the whole mark reduced to mush.
    sizes = (48, 32, 16)
    frames = [build(px, thin_detail=px >= THIN_DETAIL_MIN) for px in sizes]
    frames[0].save(
        HERE / 'favicon.ico',
        sizes=[(px, px) for px in sizes],
        append_images=frames,
    )

    print('wrote icon-512.png, icon-192.png, apple-touch-icon.png, favicon.ico')


if __name__ == '__main__':
    sys.exit(main())
