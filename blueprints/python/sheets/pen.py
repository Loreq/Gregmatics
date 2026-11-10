"""Pillow, in layout pixels. An image has PIXELS device pixels for each of them.

Layout code stays in layout pixels. Pen and font apply the multiplier.
"""

from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

# Device pixels per layout pixel.
PIXELS = 2

# Sheet chrome. Zone fills and machine colors come from the plan's palette.
PALETTE = {
    "paper": (244, 241, 234),
    "ink": (27, 36, 48),
    "muted": (86, 98, 112),
    "wall": (40, 44, 50),
    "halo": (255, 253, 248),
    "pad": (255, 253, 248),
    "shell": (226, 232, 238),
    "rust": (172, 78, 50),
    "mark": (92, 84, 74),
    "cut": (150, 96, 72),
    "ground": (120, 84, 52),
    "sky": (226, 238, 246),
    "glass": (70, 140, 190),
}

FONT_FOLDER = Path(r"C:\Windows\Fonts")
# The first file found is used: regular, then bold.
FONT_FILES = {False: ("segoeui.ttf", "arial.ttf"), True: ("segoeuib.ttf", "arialbd.ttf")}
# The eight offsets a halo is stamped at.
HALO_OFFSETS = ((-1, 0), (1, 0), (0, -1), (0, 1), (-1, -1), (1, 1), (-1, 1), (1, -1))

_FONTS: dict = {}


# --- fonts and text sizes ---

def _load_font(px: int, bold: bool):
    """The first of the fonts this machine has, or Pillow's own."""
    for name in FONT_FILES[bold]:
        path = FONT_FOLDER / name
        if path.exists():
            return ImageFont.truetype(str(path), px)
    return ImageFont.load_default()


def font(size: int, bold: bool = False):
    """A font `size` layout pixels high. Each size is loaded once."""
    px = max(1, round(size * PIXELS))
    key = (px, bold)
    if key not in _FONTS:
        _FONTS[key] = _load_font(px, bold)
    return _FONTS[key]


def _logical(box) -> tuple:
    """Device pixels as layout pixels."""
    return tuple(v / PIXELS for v in box)


def text_size(fnt, text: str) -> tuple:
    """The width and height of a text's ink, in layout pixels."""
    x0, y0, x1, y1 = _logical(fnt.getbbox(text))
    return x1 - x0, y1 - y0


def text_origin(fnt, text: str) -> tuple:
    """The font's bearing, in layout pixels, so ink sits on the point asked for."""
    return _logical(fnt.getbbox(text))[:2]


# --- the pen ---

class Pen:
    """Draws in layout pixels onto an image that has PIXELS device pixels for each of them."""

    def __init__(self, img) -> None:
        self.draw = ImageDraw.Draw(img, "RGBA")

    def _at(self, xy):
        """A number, a point, or a list of points in device pixels."""
        if isinstance(xy, (int, float)):
            return xy * PIXELS
        if isinstance(xy, tuple):
            return tuple(self._at(v) for v in xy)
        return [self._at(v) for v in xy]

    def _width(self, width) -> int:
        """A line width in device pixels, never thinner than one."""
        return max(1, round(width * PIXELS))

    def line(self, xy, fill=None, width=1) -> None:
        """A line through the points."""
        self.draw.line(self._at(xy), fill=fill, width=self._width(width))

    def rectangle(self, xy, fill=None, outline=None, width=1) -> None:
        """A rectangle, both corners inside."""
        self.draw.rectangle(self._at(xy), fill=fill, outline=outline, width=self._width(width))

    def polygon(self, xy, fill=None, outline=None) -> None:
        """A filled shape through the points."""
        self.draw.polygon(self._at(xy), fill=fill, outline=outline)

    def rounded_rectangle(self, xy, radius=0, fill=None, outline=None, width=1) -> None:
        """A rectangle with rounded corners."""
        self.draw.rounded_rectangle(self._at(xy), radius=radius * PIXELS, fill=fill, outline=outline,
                                    width=self._width(width))

    def text(self, xy, text, font=None, fill=None) -> None:
        """Text with the font's own bearing. Use text_at to put the ink on the point."""
        self.draw.text(self._at(xy), text, font=font, fill=fill)


def canvas(width, height, color) -> tuple:
    """A new RGB image and its pen. An RGBA pen on an RGB image blends translucent strokes."""
    img = Image.new("RGB", (round(width * PIXELS), round(height * PIXELS)), color)
    return img, Pen(img)


def overlay(width, height) -> tuple:
    """A clear RGBA image and its pen, to be pasted over a sheet."""
    img = Image.new("RGBA", (round(width * PIXELS), round(height * PIXELS)), (0, 0, 0, 0))
    return img, Pen(img)


def device(*values) -> tuple:
    """Layout pixels as whole device pixels, for pasting one image onto another."""
    return tuple(round(v * PIXELS) for v in values)


# --- fitting text ---

def _wrap_words(words: list, fnt, width) -> list:
    """One paragraph's words as lines no wider than `width`. No words is one blank line."""
    if not words:
        return [""]
    lines = []
    cur = words[0]
    for word in words[1:]:
        if text_size(fnt, f"{cur} {word}")[0] <= width:
            cur = f"{cur} {word}"
        else:
            lines.append(cur)
            cur = word
    lines.append(cur)
    return lines


def wrap(text: str, fnt, width) -> list:
    """Text as lines no wider than `width`. A line break in the text starts a new paragraph."""
    lines = []
    for para in text.split("\n"):
        lines += _wrap_words(para.split(), fnt, width)
    return lines


def fit(text: str, width, height, bold: bool = True, cap: int = 18, floor: int = 8):
    """The largest font from `cap` down to `floor` that fits a text in a box, or None."""
    for size in range(cap, floor - 1, -1):
        fnt = font(size, bold)
        w, h = text_size(fnt, text)
        if w <= width and h <= height:
            return fnt
    return None


# --- drawing text ---

def halo(draw, xy, text: str, fnt, fill, ring=PALETTE["halo"]) -> None:
    """Text with a one-pixel ring around it, so it reads over any fill."""
    x, y = xy
    for dx, dy in HALO_OFFSETS:
        draw.text((x + dx, y + dy), text, font=fnt, fill=ring)
    draw.text((x, y), text, font=fnt, fill=fill)


def text_at(draw, xy, text: str, fnt, fill) -> None:
    """Text whose ink starts at a point, whatever the font's bearing."""
    ox, oy = text_origin(fnt, text)
    draw.text((xy[0] - ox, xy[1] - oy), text, font=fnt, fill=fill)


def text_middle(draw, cx, cy, text: str, fnt, fill) -> None:
    """Text whose ink is centered on a point."""
    w, h = text_size(fnt, text)
    text_at(draw, (cx - w / 2, cy - h / 2), text, fnt, fill)


def text_center(draw, cx, cy, text: str, fnt, fill, ring=PALETTE["halo"]) -> None:
    """Haloed text whose ink is centered on a point."""
    ox, oy = text_origin(fnt, text)
    w, h = text_size(fnt, text)
    halo(draw, (cx - w / 2 - ox, cy - h / 2 - oy), text, fnt, fill, ring)


# --- dashes ---

def dashed(draw, a, b, fill, dash=6, gap=5, width=1) -> None:
    """A dashed line from a to b."""
    (x0, y0), (x1, y1) = a, b
    length = math.hypot(x1 - x0, y1 - y0)
    if not length:
        return
    ux, uy = (x1 - x0) / length, (y1 - y0) / length
    t = 0.0
    while t < length:
        e = min(length, t + dash)
        draw.line([(x0 + ux * t, y0 + uy * t), (x0 + ux * e, y0 + uy * e)], fill=fill, width=width)
        t += dash + gap


def dashed_rect(draw, box, fill, dash=6, gap=5, width=1) -> None:
    """A dashed outline, drawn clockwise from the top left."""
    l, t, r, b = box
    dashed(draw, (l, t), (r, t), fill, dash, gap, width)
    dashed(draw, (r, t), (r, b), fill, dash, gap, width)
    dashed(draw, (r, b), (l, b), fill, dash, gap, width)
    dashed(draw, (l, b), (l, t), fill, dash, gap, width)


def dashed_circle(draw, cx, cy, r, fill, width=1, steps=96) -> None:
    """A dashed circle: every other one of `steps` short chords."""
    for i in range(0, steps, 2):
        a0 = 2 * math.pi * i / steps
        a1 = 2 * math.pi * (i + 1) / steps
        draw.line([(cx + r * math.cos(a0), cy + r * math.sin(a0)), (cx + r * math.cos(a1), cy + r * math.sin(a1))],
                  fill=fill, width=width)
