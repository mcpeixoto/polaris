#!/usr/bin/env python3
"""Renders the Polaris desktop app icon.

The geometry is not defined here. `web/src/components/Logo.tsx` draws the mark on a 40x40
grid and is the source of truth for it; `scripts/polaris_mark.py` is that drawing as numbers,
and this script imports it. It used to carry its own star — a different tip length, a waist
pulled to a third of the canonical depth, no orbit and no rays — which is how the product
ended up with two drawings of "the mark" in one directory. If the star needs to change, it
changes in Logo.tsx, then in polaris_mark.py, then this is re-run.

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

## The orbit and the rays below 64px

The orbit is a 1-unit stroke and each ray is 1.4 units on a 40-unit grid, inside a mark
inset to 82% of the square. At 32px that is a third of a pixel and a half of one: they do
not render as hairlines, they render as grey haze around the star, which is worse than not
having them. So the icon is built twice — with the orbit and rays for 64px and up, without
them for 48, 32 and 16 — and the small sizes are the star alone, which is what the previous
icon was and what survives a taskbar. This is a deliberate divergence with a threshold
written down, not the silent kind that produced the second logo.

    python3 make-icon.py        # writes icon.png, icon.icns, icon.ico
"""

import io
import pathlib
import struct
import sys

from PIL import Image, ImageDraw, ImageFilter

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2] / 'scripts'))

import polaris_mark as mark  # noqa: E402

HERE = pathlib.Path(__file__).parent

SIZE = 1024
SS = 4  # supersampling factor
S = SIZE * SS

#: Below this, the icon is rendered without the orbit and the rays. See the header.
THIN_DETAIL_MIN = 64

# 22.4% of the width: the macOS squircle proportion. Close enough that the icon does not
# look like a different shape sitting next to system apps.
RADIUS = int(mark.SQUIRCLE * S)


#: The .icns entries, as (four-character type, pixel size). Every one of these takes a PNG
#: payload — macOS has read PNG-in-icns since 10.7, and the packed-RGB formats it replaced
#: are the reason this used to need a macOS-only tool at all.
ICNS_ENTRIES = (
    (b'icp4', 16), (b'icp5', 32), (b'ic11', 32), (b'ic12', 64),
    (b'ic07', 128), (b'ic13', 256), (b'ic08', 256), (b'ic14', 512),
    (b'ic09', 512), (b'ic10', 1024),
)


def write_icns(path, frame):
    """Write an .icns, without iconutil.

    This used to shell out to `iconutil`, which ships with Xcode and exists nowhere else, so
    the .icns could only be rebuilt on a Mac — and the check was a skip, which meant every
    run on Linux or CI left the old file in place claiming to be current. That is how a
    stale icon outlives the mark it was drawn from. The container is a 'icns' magic, a
    big-endian total length, then one typed, length-prefixed chunk per size; the payload is
    an ordinary PNG. Writing it here makes the icon reproducible on any machine that can run
    the rest of this script.

    `frame(px)` returns the image to use at that size.
    """
    chunks = []
    for kind, px in ICNS_ENTRIES:
        buf = io.BytesIO()
        frame(px).save(buf, format='PNG')
        data = buf.getvalue()
        chunks.append(kind + struct.pack('>I', len(data) + 8) + data)
    body = b''.join(chunks)
    path.write_bytes(b'icns' + struct.pack('>I', len(body) + 8) + body)


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


def build(thin_detail=True):
    ground = mark.vertical_gradient(S, mark.GROUND_TOP, mark.GROUND_BOTTOM)

    glow_layer, glow_mask = radial_glow(S, mark.ACCENT, S * 0.5, S * 0.46, S * 0.42, 95)
    ground = Image.composite(glow_layer, ground, glow_mask.point(lambda v: v // 3))

    ground = mark.draw_mark(
        ground, ground=mark.GROUND_BOTTOM, thin_detail=thin_detail,
    )

    # A single highlight on the upper-right limb: what stops the star reading as a flat
    # vector shape, without adding anything that disappears at 16px. It is the star's own
    # north-east side, so it is cut from the canonical outline rather than redrawn.
    quarter = len(mark.star_outline()) // 4
    limb = mark.star_outline()[: quarter + 1]
    to_px = [
        (S / 2 + (x - mark.CENTRE) * S * mark.MARK_SCALE / mark.GRID,
         S / 2 + (y - mark.CENTRE) * S * mark.MARK_SCALE / mark.GRID)
        for x, y in limb
    ]
    to_px.append((S / 2, S / 2))
    hl_mask = Image.new('L', (S, S), 0)
    ImageDraw.Draw(hl_mask).polygon(to_px, fill=48)
    ground = Image.composite(Image.new('RGB', (S, S), (255, 255, 255)), ground, hl_mask)

    # The inner edge, a hairline lighter than the ground. Icons without one look pasted
    # onto the dock rather than lit by the same room.
    edge = Image.new('L', (S, S), 0)
    ImageDraw.Draw(edge).rounded_rectangle(
        [SS * 2, SS * 2, S - SS * 2, S - SS * 2], RADIUS, outline=22, width=SS * 3,
    )
    ground = Image.composite(Image.new('RGB', (S, S), (255, 255, 255)), ground, edge)

    icon = ground.convert('RGBA')
    icon.putalpha(mark.rounded_mask(S, RADIUS))
    return icon.resize((SIZE, SIZE), Image.LANCZOS)


def main():
    icon = build()
    plain = build(thin_detail=False)
    icon.save(HERE / 'icon.png')

    def at(px):
        return (icon if px >= THIN_DETAIL_MIN else plain).resize((px, px), Image.LANCZOS)

    # macOS wants an .icns; Windows wants a multi-resolution .ico. Both are generated here
    # rather than by electron-builder so that the small sizes are downsampled from this
    # render with LANCZOS instead of from whatever the packager picks — the 16px version is
    # the one people actually look at all day.
    write_icns(HERE / 'icon.icns', at)

    sizes = [(s, s) for s in (256, 128, 64, 48, 32, 16)]
    # Pillow builds an .ico by downsampling the image it is given, which would put the thin
    # detail back into the 16px frame. Each frame is rendered from the right source instead.
    icon.save(HERE / 'icon.ico', sizes=sizes, append_images=[at(s) for s, _ in sizes])

    print('wrote icon.png, icon.icns, icon.ico')


if __name__ == '__main__':
    sys.exit(main())
