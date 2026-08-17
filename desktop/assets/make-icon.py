#!/usr/bin/env python3
"""Renders the Polaris app icon.

Drawn in Pillow rather than authored as an SVG and rasterised, and that is not the obvious
choice, so: the first version was an SVG with three gradients, and ImageMagick's built-in
renderer silently ignored every one of them and produced a black square. It did not warn.
Rasterising SVG correctly needs librsvg or Inkscape as a delegate, which makes the icon
build depend on which delegates happen to be installed on the machine — and the failure is
a valid-looking PNG, so CI would have shipped it.

Pillow is a hard dependency that either exists or does not, and what it draws is what you
get. Everything is supersampled 4x and downsampled with LANCZOS, which is what gives the
star's points clean edges at 16px.

The mark: Polaris is the north star — the fixed point you navigate by. A four-pointed star
with concave sides, because a five-pointed one turns to mush below about 24px, and this
icon has to survive a Windows taskbar and a favicon.

    python3 make-icon.py        # writes icon.png, icon.icns, icon.ico
"""

import pathlib
import subprocess
import sys

from PIL import Image, ImageDraw, ImageFilter

HERE = pathlib.Path(__file__).parent

SIZE = 1024
SS = 4  # supersampling factor
S = SIZE * SS

# The product's own accent ramp, from web/src/styles/tokens.css. The icon and the interface
# are the same blue rather than two blues nobody quite matched.
GROUND_TOP = (26, 29, 34)      # --color-neutral-900
GROUND_BOTTOM = (14, 16, 19)   # --color-neutral-950
STAR_LIGHT = (122, 131, 230)   # --color-accent-400
STAR_DARK = (75, 86, 186)      # --color-accent-600
GLOW = (94, 106, 210)          # --color-accent-500

# 22.4% of the width: the macOS squircle proportion. Close enough that the icon does not
# look like a different shape sitting next to system apps.
RADIUS = int(0.224 * S)


def vertical_gradient(size, top, bottom):
    """A one-pixel-wide column stretched, which is both exact and instant."""
    column = Image.new('RGB', (1, size), top)
    px = column.load()
    for y in range(size):
        t = y / max(size - 1, 1)
        px[0, y] = tuple(round(a + (b - a) * t) for a, b in zip(top, bottom))
    return column.resize((size, size), Image.NEAREST)


def rounded_mask(size, radius):
    mask = Image.new('L', (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, size - 1, size - 1], radius, fill=255)
    return mask


def radial_glow(size, colour, cx, cy, r, peak):
    """A soft light behind the star, so the ground is lit rather than flat."""
    glow = Image.new('L', (size, size), 0)
    draw = ImageDraw.Draw(glow)
    # Concentric discs of increasing brightness, then blurred. Cheaper and smoother than a
    # per-pixel falloff at this resolution, and the blur hides the banding.
    steps = 48
    for i in range(steps, 0, -1):
        t = i / steps
        radius = r * t
        value = round(peak * (1 - t) ** 2)
        draw.ellipse([cx - radius, cy - radius, cx + radius, cy + radius], fill=value)
    glow = glow.filter(ImageFilter.GaussianBlur(r * 0.18))
    layer = Image.new('RGB', (size, size), colour)
    return layer, glow


def quad(p0, p1, p2, steps=96):
    """Points along a quadratic bezier. The star's concave sides are four of these."""
    out = []
    for i in range(steps + 1):
        t = i / steps
        u = 1 - t
        out.append((
            u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0],
            u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1],
        ))
    return out


def star_points():
    """
    A four-pointed star, drawn as four concave quadratic sides.

    The control points decide everything. A straight line between two adjacent tips would
    put its midpoint at 0.71 x tip from the centre; anything near that value produces a
    diamond, which is what the first attempt drew. Pulling the controls right in to 0.13 x
    tip is what makes the sides concave enough to read as a star at 32px.
    """
    c = S / 2
    tip = 0.345 * S      # distance from centre to a point
    waist = 0.045 * S    # how far the control points pull the sides in

    north = (c, c - tip)
    east = (c + tip, c)
    south = (c, c + tip)
    west = (c - tip, c)

    pts = []
    pts += quad(north, (c + waist, c - waist), east)
    pts += quad(east, (c + waist, c + waist), south)
    pts += quad(south, (c - waist, c + waist), west)
    pts += quad(west, (c - waist, c - waist), north)
    return pts


def diagonal_gradient(size, a, b):
    """Top-left light, as every physical object is. Flat fills read as stickers."""
    grad = Image.new('RGB', (size, size))
    px = grad.load()
    # Built at low resolution and scaled: a per-pixel loop over 4096² is minutes, and the
    # gradient has no detail that survives the downsample anyway.
    small = 64
    tmp = Image.new('RGB', (small, small))
    tpx = tmp.load()
    for y in range(small):
        for x in range(small):
            t = (x / (small - 1) * 0.45) + (y / (small - 1) * 0.55)
            tpx[x, y] = tuple(round(p + (q - p) * t) for p, q in zip(a, b))
    grad = tmp.resize((size, size), Image.BICUBIC)
    return grad


def build():
    ground = vertical_gradient(S, GROUND_TOP, GROUND_BOTTOM)

    glow_layer, glow_mask = radial_glow(S, GLOW, S * 0.5, S * 0.46, S * 0.42, 95)
    ground = Image.composite(
        Image.blend(ground, glow_layer, 0.55), ground, glow_mask,
    ) if False else Image.composite(glow_layer, ground, glow_mask.point(lambda v: v // 3))

    # The star.
    star_mask = Image.new('L', (S, S), 0)
    ImageDraw.Draw(star_mask).polygon(star_points(), fill=255)
    star = diagonal_gradient(S, STAR_LIGHT, STAR_DARK)
    ground = Image.composite(star, ground, star_mask)

    # A single highlight on the upper-right limb: what stops the star reading as a flat
    # vector shape, without adding anything that disappears at 16px.
    c = S / 2
    tip = 0.345 * S
    waist = 0.045 * S
    limb = quad((c, c - tip), (c + waist, c - waist), (c + tip, c))
    limb += [(c + tip * 0.30, c - tip * 0.30), (c, c - tip)]
    hl_mask = Image.new('L', (S, S), 0)
    ImageDraw.Draw(hl_mask).polygon(limb, fill=56)
    ground = Image.composite(Image.new('RGB', (S, S), (255, 255, 255)), ground, hl_mask)

    # The inner edge, a hairline lighter than the ground. Icons without one look pasted
    # onto the dock rather than lit by the same room.
    edge = Image.new('L', (S, S), 0)
    ImageDraw.Draw(edge).rounded_rectangle(
        [SS * 2, SS * 2, S - SS * 2, S - SS * 2], RADIUS, outline=22, width=SS * 3,
    )
    ground = Image.composite(Image.new('RGB', (S, S), (255, 255, 255)), ground, edge)

    icon = ground.convert('RGBA')
    icon.putalpha(rounded_mask(S, RADIUS))
    return icon.resize((SIZE, SIZE), Image.LANCZOS)


def main():
    icon = build()
    icon.save(HERE / 'icon.png')

    # macOS wants an .icns built from a named iconset; Windows wants a multi-resolution
    # .ico. Both are generated here rather than by electron-builder so that the small sizes
    # are downsampled from this render with LANCZOS instead of from whatever the packager
    # picks — the 16px version is the one people actually look at all day.
    iconset = HERE / 'polaris.iconset'
    iconset.mkdir(exist_ok=True)
    for base in (16, 32, 128, 256, 512):
        icon.resize((base, base), Image.LANCZOS).save(iconset / f'icon_{base}x{base}.png')
        icon.resize((base * 2, base * 2), Image.LANCZOS).save(iconset / f'icon_{base}x{base}@2x.png')
    subprocess.run(
        ['iconutil', '-c', 'icns', str(iconset), '-o', str(HERE / 'icon.icns')], check=True,
    )
    for f in iconset.iterdir():
        f.unlink()
    iconset.rmdir()

    sizes = [(s, s) for s in (256, 128, 64, 48, 32, 16)]
    icon.save(HERE / 'icon.ico', sizes=sizes)

    print('wrote icon.png, icon.icns, icon.ico')


if __name__ == '__main__':
    sys.exit(main())
