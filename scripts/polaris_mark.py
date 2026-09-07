"""The Polaris mark as numbers, so that four renderings of it cannot drift into four marks.

`web/src/components/Logo.tsx` is the source of truth for the geometry: the star, the facet,
the rays and the orbit are drawn there on a 40x40 grid, and every other surface — the tab
icon, the installed web app, the desktop dock icon, the iOS welcome screen — is that same
drawing at another size. This file is the machine-readable copy of it for the two Pillow
generators, `desktop/assets/make-icon.py` and `web/public/make-icons.py`.

It exists because the product spent a while with four different logos. The web component had
the current mark; the desktop icon had an older star with a different waist, no orbit and no
rays; and the iOS app had Apple's `sparkle` SF Symbol on a tile, which was not the Polaris
mark by any reading. None of that was a decision — it was three files nobody changed when the
fourth one changed. A number that appears in exactly one place cannot fall out of step with
itself, so the numbers live here and the generators import them.

The rule for the whole set: if the geometry changes, it changes in Logo.tsx first, then here,
then the generators are re-run. A raster that no longer matches this file is a stale file, not
a variant.

## The grid

Everything is on Logo.tsx's 40x40 grid, centred on (20, 20):

  - the points reach r=15.5 and the waist is pulled to r~4.5 by control points 3.2 off
    centre, which is what makes the points read as sharp rather than as a rounded plus;
  - the two vertical points are painted again over the star, so it is faceted like a compass
    rose rather than one flat silhouette;
  - four rays sit in the diagonal gaps, r=8.5 out to r=13.5;
  - the orbit is an ellipse rx=17.5 ry=6.8 rotated 24 degrees anticlockwise;
  - the core is a disc of r=1.7 in the ground colour, which is what gives the star its
    pierced centre.

## Colour

Every literal here is the actual value from `web/src/styles/tokens.css`, named in the
comment beside it. An icon file is painted by an OS or by browser chrome, neither of which
can read tokens.css — this is the documented exception to the token rule, and the exception
holds only as long as the values are genuinely the token values.
"""

import math

from PIL import Image, ImageDraw

# --- the grid -------------------------------------------------------------------------

GRID = 40.0
CENTRE = 20.0
#: Distance from the centre to a point. `M20 4.5` in Logo.tsx.
TIP = 15.5
#: How far the quadratic control points sit off the centre line. `Q23.2 16.8` in Logo.tsx.
CTRL = 3.2
#: The orbit ellipse, and the angle it is turned through, anticlockwise on screen.
ORBIT_RX = 17.5
ORBIT_RY = 6.8
ORBIT_DEG = 24.0
ORBIT_STROKE = 1.0  # .ring { stroke-width: 1 }
RAY_STROKE = 1.4  # .ray { stroke-width: 1.4 }
CORE_R = 1.7

#: The four diagonal rays as (x1, y1, x2, y2): r=8.5 out to r=13.5 at 45, 135, 225 and 315
#: degrees, which is the empty quarter between two of the star's points.
RAYS = (
    (26.01, 13.99, 29.55, 10.45),
    (13.99, 13.99, 10.45, 10.45),
    (13.99, 26.01, 10.45, 29.55),
    (26.01, 26.01, 29.55, 29.55),
)

#: How much of the icon's square the 40-unit grid is scaled to fill. The mark has to sit
#: inside the safe area of whatever shape an OS crops an installed icon to, and the orbit is
#: the widest part of it, so the grid is inset rather than bled to the edge. This is the same
#: 0.82 the tab icon already used.
MARK_SCALE = 0.82

# --- colour, from web/src/styles/tokens.css ---------------------------------------------

GROUND_TOP = (0x1A, 0x1D, 0x22)  # --color-neutral-900
GROUND_BOTTOM = (0x0E, 0x10, 0x13)  # --color-neutral-950, and <meta name="theme-color">
STAR_LIGHT = (0x7A, 0x83, 0xE6)  # --color-accent-400
STAR_DARK = (0x4B, 0x56, 0xBA)  # --color-accent-600
ACCENT = (0x5E, 0x6A, 0xD2)  # --color-accent-500

#: 22.4% of the width: the macOS squircle proportion, close enough that the icon does not
#: look like a different shape sitting next to system apps.
SQUIRCLE = 0.224

# --- geometry ---------------------------------------------------------------------------


def _quad(p0, p1, p2, steps=96):
    """Points along a quadratic bezier. The star's concave sides are four of these."""
    out = []
    for i in range(steps + 1):
        t = i / steps
        u = 1 - t
        out.append(
            (
                u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0],
                u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1],
            )
        )
    return out


#: The waist depth as a fraction of the tip length. This ratio, not either number on its own,
#: is what makes the sides concave enough to read as a star rather than as a rounded plus sign
#: — so a rendering that needs a longer point (the tray icon, which has no ground behind it and
#: must carry a 16px square alone) scales the waist with it rather than picking a new number.
WAIST_RATIO = CTRL / TIP


def star_outline_at(cx, cy, tip):
    """The canonical star at an arbitrary centre and tip length, in the caller's own units."""
    k = tip * WAIST_RATIO
    north, east, south, west = (cx, cy - tip), (cx + tip, cy), (cx, cy + tip), (cx - tip, cy)
    return (
        _quad(north, (cx + k, cy - k), east)
        + _quad(east, (cx + k, cy + k), south)
        + _quad(south, (cx - k, cy + k), west)
        + _quad(west, (cx - k, cy - k), north)
    )


def star_outline():
    """The star silhouette on the 40x40 grid — `STAR` in Logo.tsx, sampled."""
    return star_outline_at(CENTRE, CENTRE, TIP)


def facet_outlines():
    """The two vertical points on their own — `FACET` in Logo.tsx, sampled."""
    c, t, k = CENTRE, TIP, CTRL
    north = _quad((c, c - t), (c + k, c - k), (c, c)) + _quad((c, c), (c - k, c - k), (c, c - t))
    south = _quad((c, c + t), (c + k, c + k), (c, c)) + _quad((c, c), (c - k, c + k), (c, c + t))
    return [north, south]


# --- rendering ---------------------------------------------------------------------------


def _mapper(size, scale):
    """Grid units to pixels, centred, at `scale` of the square."""
    k = size * scale / GRID

    def to_px(x, y):
        return (size / 2 + (x - CENTRE) * k, size / 2 + (y - CENTRE) * k)

    return to_px, k


def star_mask(size, scale=MARK_SCALE):
    """An 'L' mask of the star silhouette, filling `scale` of a `size`-pixel square."""
    to_px, _ = _mapper(size, scale)
    mask = Image.new('L', (size, size), 0)
    ImageDraw.Draw(mask).polygon([to_px(*p) for p in star_outline()], fill=255)
    return mask


def facet_mask(size, scale=MARK_SCALE):
    """An 'L' mask of the two vertical points, to be painted over the star."""
    to_px, _ = _mapper(size, scale)
    mask = Image.new('L', (size, size), 0)
    draw = ImageDraw.Draw(mask)
    for outline in facet_outlines():
        draw.polygon([to_px(*p) for p in outline], fill=255)
    return mask


def rays_mask(size, scale=MARK_SCALE):
    """An 'L' mask of the four diagonal rays, drawn with round caps as the stylesheet does."""
    to_px, k = _mapper(size, scale)
    mask = Image.new('L', (size, size), 0)
    draw = ImageDraw.Draw(mask)
    width = max(1, round(RAY_STROKE * k))
    for x1, y1, x2, y2 in RAYS:
        draw.line([to_px(x1, y1), to_px(x2, y2)], fill=255, width=width)
        # Pillow has no round cap, so the ends are discs. Without them a 1.4-unit stroke at
        # icon size ends in a visible square, which reads as a tick rather than a ray.
        for px, py in (to_px(x1, y1), to_px(x2, y2)):
            r = width / 2
            draw.ellipse([px - r, py - r, px + r, py + r], fill=255)
    return mask


def orbit_mask(size, scale=MARK_SCALE):
    """An 'L' mask of the orbit hairline, turned through ORBIT_DEG anticlockwise.

    Drawn flat and then rotated, because Pillow cannot stroke a rotated ellipse. The rotation
    resamples, which is exactly what is wanted here: a hairline that is antialiased along its
    whole length rather than stepped on the diagonals.
    """
    to_px, k = _mapper(size, scale)
    mask = Image.new('L', (size, size), 0)
    cx, cy = to_px(CENTRE, CENTRE)
    rx, ry = ORBIT_RX * k, ORBIT_RY * k
    width = max(1, round(ORBIT_STROKE * k))
    ImageDraw.Draw(mask).ellipse(
        [cx - rx, cy - ry, cx + rx, cy + ry], outline=255, width=width
    )
    return mask.rotate(ORBIT_DEG, resample=Image.BICUBIC, center=(cx, cy))


def core_mask(size, scale=MARK_SCALE):
    """An 'L' mask of the pierced centre."""
    to_px, k = _mapper(size, scale)
    mask = Image.new('L', (size, size), 0)
    cx, cy = to_px(CENTRE, CENTRE)
    r = CORE_R * k
    ImageDraw.Draw(mask).ellipse([cx - r, cy - r, cx + r, cy + r], fill=255)
    return mask


def rounded_mask(size, radius):
    mask = Image.new('L', (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, size - 1, size - 1], radius, fill=255)
    return mask


def vertical_gradient(size, top, bottom):
    """A one-pixel-wide column stretched, which is both exact and instant."""
    column = Image.new('RGB', (1, size), top)
    px = column.load()
    for y in range(size):
        t = y / max(size - 1, 1)
        px[0, y] = tuple(round(a + (b - a) * t) for a, b in zip(top, bottom))
    return column.resize((size, size), Image.NEAREST)


def diagonal_gradient(size, a, b):
    """Top-left light, as every physical object is. Flat fills read as stickers."""
    # Built at low resolution and scaled: a per-pixel loop over 4096 squared is minutes, and
    # the gradient has no detail that survives the downsample anyway.
    small = 64
    tmp = Image.new('RGB', (small, small))
    tpx = tmp.load()
    for y in range(small):
        for x in range(small):
            t = (x / (small - 1) * 0.45) + (y / (small - 1) * 0.55)
            tpx[x, y] = tuple(round(p + (q - p) * t) for p, q in zip(a, b))
    return tmp.resize((size, size), Image.BICUBIC)


def paint(base, colour, mask, opacity=1.0):
    """Composite a flat colour through a mask at an opacity. The one paint operation."""
    if opacity < 1.0:
        mask = mask.point(lambda v: round(v * opacity))
    layer = Image.new('RGB', base.size, colour) if isinstance(colour, tuple) else colour
    return Image.composite(layer, base, mask)


def draw_mark(base, scale=MARK_SCALE, ground=GROUND_BOTTOM, thin_detail=True):
    """Paint the whole mark onto an RGB square, in Logo.tsx's own order.

    `thin_detail` draws the orbit and the rays. They are a 1-unit and a 1.4-unit stroke on a
    40-unit grid — under a pixel below roughly a 32px render — so the small sizes drop them
    and keep the star, rather than turning them into grey fringe. The caller decides, because
    the threshold depends on whether it is downsampling from a supersampled render.
    """
    size = base.size[0]
    out = base
    if thin_detail:
        # Opacities are the stylesheet's: .ring is 0.42, .ray is 0.55.
        out = paint(out, ACCENT, orbit_mask(size, scale), 0.42)
        out = paint(out, ACCENT, rays_mask(size, scale), 0.55)
    out = paint(out, diagonal_gradient(size, STAR_LIGHT, STAR_DARK), star_mask(size, scale))
    # The facet: the vertical points again at full strength over the gradient. One paint, and
    # the star stops being a silhouette.
    out = paint(out, STAR_LIGHT, facet_mask(size, scale), 0.9)
    out = paint(out, ground, core_mask(size, scale))
    return out


def orbit_circumference():
    """Ramanujan, for the stylesheet's stroke-dasharray. Kept here so the two agree."""
    a, b = ORBIT_RX, ORBIT_RY
    h = (a - b) ** 2 / (a + b) ** 2
    return math.pi * (a + b) * (1 + 3 * h / (10 + math.sqrt(4 - 3 * h)))
