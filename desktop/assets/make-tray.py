#!/usr/bin/env python3
"""Renders the menu-bar / tray icon.

A different image from the app icon, and it has to be: a tray icon is a *template* image.
macOS throws away its colour entirely and recolours the alpha channel to match the menu bar,
so shipping the app icon here would produce a solid recoloured rounded square — the ground
is opaque, and opacity is the only thing the platform reads.

So this is the star alone, on transparency, in solid black. Black rather than white because
that is the template convention: macOS inverts it for dark menu bars, and Windows and Linux
render it as-is on a light tray. Shipping white would be invisible on half the platforms.

Sizes: 16pt at 1x and 2x. Anything larger is never displayed and only costs bytes.

    python3 make-tray.py     # writes tray.png and tray@2x.png
"""

import pathlib

from PIL import Image, ImageDraw

HERE = pathlib.Path(__file__).parent
SS = 8  # supersampling; the star's points need it badly at 16px


def quad(p0, p1, p2, steps=64):
    out = []
    for i in range(steps + 1):
        t = i / steps
        u = 1 - t
        out.append((
            u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0],
            u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1],
        ))
    return out


def star(size):
    """The same four-pointed mark as the app icon, at tray proportions."""
    s = size * SS
    c = s / 2
    # Fuller than the app icon's 0.345: the tray has no ground behind it, so the star has
    # to carry the whole 16px square on its own or it reads as a speck.
    tip = 0.47 * s
    waist = 0.062 * s

    north, east, south, west = (c, c - tip), (c + tip, c), (c, c + tip), (c - tip, c)
    pts = []
    pts += quad(north, (c + waist, c - waist), east)
    pts += quad(east, (c + waist, c + waist), south)
    pts += quad(south, (c - waist, c + waist), west)
    pts += quad(west, (c - waist, c - waist), north)

    img = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    ImageDraw.Draw(img).polygon(pts, fill=(0, 0, 0, 255))
    return img.resize((size, size), Image.LANCZOS)


def main():
    star(16).save(HERE / 'tray.png')
    star(32).save(HERE / 'tray@2x.png')
    print('wrote tray.png, tray@2x.png')


if __name__ == '__main__':
    main()
