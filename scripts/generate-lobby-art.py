"""Draws the pictures on the lobby's welcome board and cards (static/assets/lobby/*.png): flat pictograms on a dark tile.

Run: python3 scripts/generate-lobby-art.py   (needs Pillow). The pictures are checked in; this is how they were made.
"""
import math
import os
from PIL import Image, ImageChops, ImageDraw, ImageFilter

OUT = os.path.join(os.path.dirname(__file__), '..', 'static', 'assets', 'lobby')
S = 3  # supersampling
BONE = (244, 241, 234)
INK = (13, 13, 22)
SURFACE_TOP = (30, 30, 46)
SURFACE_BOTTOM = (16, 16, 26)

ACCENTS = {
    'mint': (143, 240, 207),
    'glow': (255, 207, 122),
    'iris': (155, 140, 255),
    'sky': (110, 195, 255),
    'ember': (255, 122, 69),
    'rose': (255, 138, 170),
}


def shade(color, factor):
    return tuple(max(0, min(255, int(c * factor))) for c in color)


def canvas(width, height, accent):
    """A dark tile with a soft glow of the accent colour behind where the picture goes."""
    w, h = width * S, height * S
    image = Image.new('RGB', (w, h))
    pixels = ImageDraw.Draw(image)
    for y in range(h):
        t = y / (h - 1)
        pixels.line([(0, y), (w, y)], fill=tuple(int(a + (b - a) * t) for a, b in zip(SURFACE_TOP, SURFACE_BOTTOM)))
    glow = Image.new('RGB', (w, h), (0, 0, 0))
    ImageDraw.Draw(glow).ellipse([w * 0.18, h * 0.08, w * 0.82, h * 0.92], fill=shade(accent, 0.28))
    glow = glow.filter(ImageFilter.GaussianBlur(w * 0.09))
    return ImageChops.add(image, glow), w, h


def save(image, name, width, height):
    out = image.resize((width, height), Image.LANCZOS)
    out.save(os.path.join(OUT, name), optimize=True)


def circle(d, cx, cy, r, **kw):
    d.ellipse([cx - r, cy - r, cx + r, cy + r], **kw)


def rounded(d, box, r, **kw):
    d.rounded_rectangle(box, radius=r, **kw)


# --- pictograms, drawn around (cx, cy) at size `u` (about the half-height of the picture) ---

def compass(d, cx, cy, u, accent):
    circle(d, cx, cy, u, outline=accent, width=int(u * 0.13))
    circle(d, cx, cy, u * 0.78, outline=shade(accent, 0.45), width=int(u * 0.04))
    for k in range(12):  # ticks
        a = k * math.pi / 6
        r1, r2 = u * 0.86, u * (0.98 if k % 3 == 0 else 0.92)
        d.line([(cx + math.sin(a) * r1, cy - math.cos(a) * r1), (cx + math.sin(a) * r2, cy - math.cos(a) * r2)], fill=accent, width=int(u * 0.05))
    a = math.radians(40)  # needle, turned a little
    def pt(r, off):
        return (cx + math.sin(a + off) * r, cy - math.cos(a + off) * r)
    d.polygon([pt(u * 0.62, 0), pt(u * 0.14, math.pi / 2), pt(u * 0.14, -math.pi / 2)], fill=BONE)
    d.polygon([pt(u * 0.62, math.pi), pt(u * 0.14, math.pi / 2), pt(u * 0.14, -math.pi / 2)], fill=accent)
    circle(d, cx, cy, u * 0.09, fill=INK)


def cube(d, cx, cy, u, accent, plus=True):
    h = u * 0.62
    top = [(cx, cy - h * 1.15), (cx + h, cy - h * 0.58), (cx, cy), (cx - h, cy - h * 0.58)]
    left = [(cx - h, cy - h * 0.58), (cx, cy), (cx, cy + h * 1.15), (cx - h, cy + h * 0.57)]
    right = [(cx + h, cy - h * 0.58), (cx, cy), (cx, cy + h * 1.15), (cx + h, cy + h * 0.57)]
    d.polygon(top, fill=accent)
    d.polygon(left, fill=shade(accent, 0.62))
    d.polygon(right, fill=shade(accent, 0.42))
    for poly in (top, left, right):
        d.line(poly + [poly[0]], fill=INK, width=int(u * 0.035), joint='curve')
    if plus:
        bx, by, br = cx + u * 0.78, cy - u * 0.78, u * 0.34
        circle(d, bx, by, br, fill=BONE)
        d.rectangle([bx - br * 0.55, by - br * 0.13, bx + br * 0.55, by + br * 0.13], fill=INK)
        d.rectangle([bx - br * 0.13, by - br * 0.55, bx + br * 0.13, by + br * 0.55], fill=INK)


def coins(d, cx, cy, u, accent):
    rx, ry, thick = u * 0.95, u * 0.34, u * 0.2
    for k in range(3):
        y = cy + u * 0.5 - k * (thick + u * 0.1)
        d.rectangle([cx - rx, y, cx + rx, y + thick], fill=shade(accent, 0.55))
        d.ellipse([cx - rx, y + thick - ry, cx + rx, y + thick + ry], fill=shade(accent, 0.55))
        d.ellipse([cx - rx, y - ry, cx + rx, y + ry], fill=accent, outline=shade(accent, 0.6), width=int(u * 0.03))
        d.ellipse([cx - rx * 0.55, y - ry * 0.55, cx + rx * 0.55, y + ry * 0.55], outline=shade(accent, 0.62), width=int(u * 0.04))


def gamepad(d, cx, cy, u, accent):
    rounded(d, [cx - u * 1.1, cy - u * 0.55, cx + u * 1.1, cy + u * 0.5], u * 0.45, fill=shade(BONE, 0.86))
    circle(d, cx - u * 0.85, cy + u * 0.3, u * 0.46, fill=shade(BONE, 0.86))
    circle(d, cx + u * 0.85, cy + u * 0.3, u * 0.46, fill=shade(BONE, 0.86))
    px, py, w = cx - u * 0.6, cy - u * 0.02, u * 0.17  # d-pad
    d.rectangle([px - u * 0.3, py - w, px + u * 0.3, py + w], fill=INK)
    d.rectangle([px - w, py - u * 0.3, px + w, py + u * 0.3], fill=INK)
    for dx, dy, color in ((0.7, -0.12, accent), (0.95, 0.12, shade(accent, 0.6)), (0.45, 0.12, shade(accent, 0.6)), (0.7, 0.34, accent)):
        circle(d, cx + u * dx, cy + u * dy, u * 0.12, fill=color)


def bag(d, cx, cy, u, accent):
    top, bottom = cy - u * 0.5, cy + u * 0.95
    d.arc([cx - u * 0.42, top - u * 0.62, cx + u * 0.42, top + u * 0.5], 180, 360, fill=BONE, width=int(u * 0.1))
    rounded(d, [cx - u * 0.95, top, cx + u * 0.95, bottom], u * 0.16, fill=accent)
    d.polygon([(cx - u * 0.95, top + u * 0.17), (cx + u * 0.95, top + u * 0.17), (cx + u * 0.95, top + u * 0.06), (cx - u * 0.95, top + u * 0.06)], fill=shade(accent, 0.7))
    circle(d, cx - u * 0.34, top + u * 0.2, u * 0.07, fill=INK)
    circle(d, cx + u * 0.34, top + u * 0.2, u * 0.07, fill=INK)
    # a star on the bag
    pts = []
    for k in range(10):
        r = u * (0.36 if k % 2 == 0 else 0.15)
        a = k * math.pi / 5
        pts.append((cx + math.sin(a) * r, cy + u * 0.3 - math.cos(a) * r))
    d.polygon(pts, fill=BONE)


def globe(d, cx, cy, u, accent):
    """A world: a sphere with its meridians and parallels, and a badge that says "new"."""
    r = u * 0.95
    circle(d, cx, cy, r, fill=shade(accent, 0.45))
    circle(d, cx, cy, r, outline=accent, width=int(u * 0.09))
    line = shade(accent, 1.0)
    w = int(u * 0.05)
    for k in (0.28, 0.62):  # meridians
        d.ellipse([cx - r * k, cy - r, cx + r * k, cy + r], outline=line, width=w)
    d.line([(cx, cy - r), (cx, cy + r)], fill=line, width=w)
    d.line([(cx - r, cy), (cx + r, cy)], fill=line, width=w)
    for k in (0.5,):  # parallels
        half = math.sqrt(1 - k * k) * r
        d.line([(cx - half, cy - r * k), (cx + half, cy - r * k)], fill=line, width=w)
        d.line([(cx - half, cy + r * k), (cx + half, cy + r * k)], fill=line, width=w)
    bx, by, br = cx + u * 0.88, cy - u * 0.8, u * 0.36
    circle(d, bx, by, br, fill=BONE)
    d.rectangle([bx - br * 0.55, by - br * 0.13, bx + br * 0.55, by + br * 0.13], fill=INK)
    d.rectangle([bx - br * 0.13, by - br * 0.55, bx + br * 0.13, by + br * 0.55], fill=INK)


def feedback(d, cx, cy, u, accent):
    """A speech bubble with a heart in it: what people think."""
    rounded(d, [cx - u * 1.05, cy - u * 0.85, cx + u * 1.05, cy + u * 0.55], u * 0.35, fill=accent)
    d.polygon([(cx - u * 0.55, cy + u * 0.45), (cx - u * 0.75, cy + u * 1.05), (cx - u * 0.05, cy + u * 0.45)], fill=accent)
    hx, hy, hr = cx, cy - u * 0.12, u * 0.3
    circle(d, hx - hr * 0.62, hy - hr * 0.2, hr * 0.7, fill=INK)
    circle(d, hx + hr * 0.62, hy - hr * 0.2, hr * 0.7, fill=INK)
    d.polygon([(hx - hr * 1.28, hy - hr * 0.05), (hx + hr * 1.28, hy - hr * 0.05), (hx, hy + hr * 1.3)], fill=INK)


def people(d, cx, cy, u, accent):
    """Two people side by side: playing together."""
    def person(x, y, scale, color):
        circle(d, x, y - u * 0.5 * scale, u * 0.3 * scale, fill=color)
        d.pieslice([x - u * 0.62 * scale, y - u * 0.05 * scale, x + u * 0.62 * scale, y + u * 1.2 * scale], 180, 360, fill=color)
    person(cx + u * 0.5, cy + u * 0.15, 0.85, shade(accent, 0.55))
    person(cx - u * 0.35, cy + u * 0.3, 1.0, accent)


def user(d, cx, cy, u, accent):
    """One person and a check: your account."""
    circle(d, cx, cy - u * 0.38, u * 0.4, fill=accent)
    d.pieslice([cx - u * 0.9, cy + u * 0.15, cx + u * 0.9, cy + u * 1.7], 180, 360, fill=accent)
    bx, by, br = cx + u * 0.82, cy + u * 0.62, u * 0.34
    circle(d, bx, by, br, fill=BONE)
    d.line([(bx - br * 0.5, by + br * 0.02), (bx - br * 0.1, by + br * 0.42), (bx + br * 0.55, by - br * 0.38)], fill=INK, width=int(u * 0.11), joint='curve')


# The topics of the guide: each has a wide picture for its button and a square one for its page.
TOPICS = [
    ('explore', 'sky', compass), ('create', 'mint', globe), ('friends', 'ember', people),
    ('credits', 'glow', coins), ('controls', 'iris', gamepad), ('account', 'rose', user),
]
CARDS = [('card-create', 'mint', globe), ('card-workshop', 'glow', cube), ('card-feedback', 'iris', feedback), ('card-store', 'sky', bag)]


def draw(name, accent_name, picture, width, height, scale):
    accent = ACCENTS[accent_name]
    image, w, h = canvas(width, height, accent)
    d = ImageDraw.Draw(image)
    picture(d, w * 0.5, h * 0.5, h * scale, accent)
    save(image, f'{name}.png', width * 2, height * 2)


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    for key, accent, picture in TOPICS:
        draw(f'tile-{key}', accent, picture, 340, 120, 0.36)
        draw(f'icon-{key}', accent, picture, 120, 120, 0.3)
    for name, accent, picture in CARDS:
        draw(name, accent, picture, 320, 300, 0.3)
    print('drawn', 2 * len(TOPICS) + len(CARDS), 'pictures in', os.path.normpath(OUT))
