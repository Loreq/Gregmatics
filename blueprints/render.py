"""Paint the sheets. Pillow, one square per block, no SVG."""

from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

import layout as L
import model as M
from catalog import GROUPS, MULTIS, SINGLES
from schema import DIRS

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
PALETTE.update({style: L.rgb(color) for style, color in L.PALETTE.items()})
PALETTE.update({room.style: L.rgb(room.color) for room in L.ROOMS})

GROUP_COLORS = {group: L.rgb(color) for group, color in L.GROUP_COLORS.items()}
ROOM_BY_ID = {room.id: room for room in L.ROOMS}

STYLE_NAMES = {room.style: room.name for room in L.ROOMS}
STYLE_NAMES.update({"corridor": "Street", "entry": "Entrance", "door": "Door", "trench": "Pipe trench",
                    "stair": "Stairs", "well": "Shaft to the sky"})

_FONTS: dict = {}


def font(size: int, bold: bool = False):
    px = max(1, round(size * PIXELS))
    key = (px, bold)
    if key not in _FONTS:
        names = ["segoeuib.ttf", "arialbd.ttf"] if bold else ["segoeui.ttf", "arial.ttf"]
        for name in names:
            path = Path(r"C:\Windows\Fonts") / name
            if path.exists():
                _FONTS[key] = ImageFont.truetype(str(path), px)
                break
        else:
            _FONTS[key] = ImageFont.load_default()
    return _FONTS[key]


def _logical(box):
    return tuple(v / PIXELS for v in box)


def text_size(fnt, text):
    x0, y0, x1, y1 = _logical(fnt.getbbox(text))
    return x1 - x0, y1 - y0


def text_origin(fnt, text):
    """The font's bearing, in layout pixels, so ink sits on the point asked for."""
    return _logical(fnt.getbbox(text))[:2]


class Pen:
    """Draws in layout pixels onto an image that has PIXELS device pixels for each of them."""

    def __init__(self, img):
        self.draw = ImageDraw.Draw(img, "RGBA")

    def _at(self, xy):
        if isinstance(xy, (int, float)):
            return xy * PIXELS
        if isinstance(xy, tuple):
            return tuple(self._at(v) for v in xy)
        return [self._at(v) for v in xy]

    def _width(self, width):
        return max(1, round(width * PIXELS))

    def line(self, xy, fill=None, width=1):
        self.draw.line(self._at(xy), fill=fill, width=self._width(width))

    def rectangle(self, xy, fill=None, outline=None, width=1):
        self.draw.rectangle(self._at(xy), fill=fill, outline=outline, width=self._width(width))

    def polygon(self, xy, fill=None, outline=None):
        self.draw.polygon(self._at(xy), fill=fill, outline=outline)

    def rounded_rectangle(self, xy, radius=0, fill=None, outline=None, width=1):
        self.draw.rounded_rectangle(self._at(xy), radius=radius * PIXELS, fill=fill, outline=outline,
                                    width=self._width(width))

    def text(self, xy, text, font=None, fill=None):
        self.draw.text(self._at(xy), text, font=font, fill=fill)


def canvas(width, height, color):
    img = Image.new("RGB", (round(width * PIXELS), round(height * PIXELS)), color)
    return img, Pen(img)


def wrap(text, fnt, width):
    lines = []
    for para in text.split("\n"):
        words = para.split()
        if not words:
            lines.append("")
            continue
        cur = words[0]
        for word in words[1:]:
            if text_size(fnt, f"{cur} {word}")[0] <= width:
                cur = f"{cur} {word}"
            else:
                lines.append(cur)
                cur = word
        lines.append(cur)
    return lines


def fit(text, width, height, bold=True, cap=18, floor=8):
    for size in range(cap, floor - 1, -1):
        fnt = font(size, bold)
        w, h = text_size(fnt, text)
        if w <= width and h <= height:
            return fnt
    return None


def halo(draw, xy, text, fnt, fill, ring=PALETTE["halo"]):
    x, y = xy
    for dx, dy in ((-1, 0), (1, 0), (0, -1), (0, 1), (-1, -1), (1, 1), (-1, 1), (1, -1)):
        draw.text((x + dx, y + dy), text, font=fnt, fill=ring)
    draw.text((x, y), text, font=fnt, fill=fill)


def text_center(draw, cx, cy, text, fnt, fill, ring=PALETTE["halo"]):
    ox, oy = text_origin(fnt, text)
    w, h = text_size(fnt, text)
    halo(draw, (cx - w / 2 - ox, cy - h / 2 - oy), text, fnt, fill, ring)


def dashed(draw, a, b, fill, dash=6, gap=5, width=1):
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


def dashed_rect(draw, box, fill, dash=6, gap=5, width=1):
    l, t, r, b = box
    dashed(draw, (l, t), (r, t), fill, dash, gap, width)
    dashed(draw, (r, t), (r, b), fill, dash, gap, width)
    dashed(draw, (r, b), (l, b), fill, dash, gap, width)
    dashed(draw, (l, b), (l, t), fill, dash, gap, width)


def masthead(draw, subtitle="GTNH 2.9.0 · MV → HV"):
    draw.text((32, 20), "Gregmatics", font=font(16, True), fill=PALETTE["ink"])
    draw.text((156, 20), subtitle, font=font(16), fill=PALETTE["muted"])


def dashed_circle(draw, cx, cy, r, fill, width=1, steps=96):
    for i in range(0, steps, 2):
        a0 = 2 * math.pi * i / steps
        a1 = 2 * math.pi * (i + 1) / steps
        draw.line([(cx + r * math.cos(a0), cy + r * math.sin(a0)), (cx + r * math.cos(a1), cy + r * math.sin(a1))],
                  fill=fill, width=width)


class Plan:
    """A plan view of one region at one floor."""

    def __init__(self, grid, region, scale, floor, level):
        self.grid = grid
        self.x0, self.x1, self.z0, self.z1 = region
        self.s = scale
        self.floor = floor
        self.level = level
        self.w = (self.x1 - self.x0 + 1) * scale
        self.h = (self.z1 - self.z0 + 1) * scale
        # RGB image with an RGBA pen: translucent strokes blend instead of replacing pixels.
        self.img, self.draw = canvas(self.w, self.h, PALETTE["rock"])

    def box(self, xa, xb, za, zb):
        l = (min(xa, xb) - self.x0) * self.s
        t = (min(za, zb) - self.z0) * self.s
        r = (max(xa, xb) - self.x0 + 1) * self.s - 1
        b = (max(za, zb) - self.z0 + 1) * self.s - 1
        return l, t, r, b

    def center(self, xa, xb, za, zb):
        l, t, r, b = self.box(xa, xb, za, zb)
        return (l + r + 1) / 2, (t + b + 1) / 2

    def inside(self, x, z):
        return self.x0 <= x <= self.x1 and self.z0 <= z <= self.z1

    def style(self, x, z):
        if self.floor == "basement":
            return M.style_at(self.grid, x, z, self.level)
        return M.floor_style(self.grid, x, z, self.floor)

    # --- layers ---

    def cells(self):
        for x in range(self.x0, self.x1 + 1):
            for z in range(self.z0, self.z1 + 1):
                st = self.style(x, z)
                if st != "rock":
                    self.draw.rectangle(self.box(x, x, z, z), fill=PALETTE[st])

    def hatch_well(self):
        for shaft in L.SHAFTS:
            if shaft.floor != self.floor:
                continue
            l, t, r, b = self.box(shaft.x0, shaft.x1, shaft.z0, shaft.z1)
            w, h = int(r - l + 1), int(b - t + 1)
            layer = Image.new("RGBA", (round(w * PIXELS), round(h * PIXELS)), (0, 0, 0, 0))
            pen = Pen(layer)
            for k in range(-h, w, 9):
                pen.line([(k, h), (k + h, 0)], fill=(120, 170, 200, 90), width=1)
            self.img.paste(layer, (round(l * PIXELS), round(t * PIXELS)), layer)
            self.draw.rectangle((l, t, r, b), outline=(90, 150, 190), width=2)

    def stairs(self):
        for stair in L.STAIRS:
            if self.floor not in stair.floors:
                continue
            l, t, r, b = self.box(stair.x0, stair.x1, stair.z0, stair.z1)
            self.draw.rectangle((l, t, r, b), fill=PALETTE["stair"])
            step = max(3, self.s // 2)
            if stair.low in "ns":
                for y in range(int(t), int(b), step):
                    self.draw.line([(l, y), (r, y)], fill=(150, 132, 104, 150))
            else:
                for x in range(int(l), int(r), step):
                    self.draw.line([(x, t), (x, b)], fill=(150, 132, 104, 150))
            dx, dz = DIRS[stair.low]
            cx, cy = (l + r) / 2, (t + b) / 2
            span = (b - t if stair.low in "ns" else r - l) * 0.36
            low = (cx + dx * span, cy + dz * span)
            high = (cx - dx * span, cy - dz * span)
            going_up = self.floor == stair.floors[0]
            start, tip = (low, high) if going_up else (high, low)
            self.draw.line([start, tip], fill=PALETTE["ink"], width=2)
            ax, ay = (-dx, -dz) if going_up else (dx, dz)
            wing = max(4, self.s * 0.45)
            self.draw.polygon([tip, (tip[0] - ax * wing - ay * wing * 0.7, tip[1] - ay * wing - ax * wing * 0.7),
                               (tip[0] - ax * wing + ay * wing * 0.7, tip[1] - ay * wing + ax * wing * 0.7)],
                              fill=PALETTE["ink"])
            word = "UP" if going_up else "DOWN"
            fnt = fit(word, r - l - 2, self.s * 1.4, True, 14, 8)
            if fnt:
                text_center(self.draw, start[0], start[1], word, fnt, PALETTE["ink"])

    def grid_lines(self):
        hair = (0, 0, 0, 64)
        for x in range(self.x0, self.x1 + 1):
            for z in range(self.z0, self.z1 + 1):
                if self.style(x, z) == "rock":
                    continue
                l, t, r, b = self.box(x, x, z, z)
                self.draw.line([(l, b), (r, b)], fill=hair)
                self.draw.line([(r, t), (r, b)], fill=hair)
        chunk = (176, 156, 128, 48)
        for x in range(self.x0, self.x1 + 2):
            if x % 16 == 0:
                px = (x - self.x0) * self.s
                self.draw.line([(px, 0), (px, self.h)], fill=chunk, width=1)
        for z in range(self.z0, self.z1 + 2):
            if z % 16 == 0:
                py = (z - self.z0) * self.s
                self.draw.line([(0, py), (self.w, py)], fill=chunk, width=1)

    def chunk_squares(self):
        """Tint the first column and the first row of each chunk."""
        tint = (70, 110, 160, 52)
        for x in range(self.x0, self.x1 + 1):
            if x % 16 == 0:
                self.draw.rectangle(self.box(x, x, self.z0, self.z1), fill=tint)
        for z in range(self.z0, self.z1 + 1):
            if z % 16 == 0:
                self.draw.rectangle(self.box(self.x0, self.x1, z, z), fill=tint)

    def pollution(self):
        names = sorted(L.DIRTY)
        bounds = [M.chunk_bounds(n) for n in names]
        xa = min(b[0] for b in bounds)
        xb = max(b[1] for b in bounds)
        za = min(b[2] for b in bounds)
        zb = max(b[3] for b in bounds)
        xa, xb = max(xa, self.x0), min(xb, self.x1)
        za, zb = max(za, self.z0), min(zb, self.z1)
        if xa > xb or za > zb:
            return
        l, t, r, b = self.box(xa, xb, za, zb)
        self.draw.rectangle((l, t, r, b), fill=PALETTE["rust"] + (20,))
        dashed_rect(self.draw, (l + 1, t + 1, r - 1, b - 1), PALETTE["rust"] + (200,), 9, 6, 2)
        self.pollution_label = (l, b)

    def pollution_tag(self):
        if not getattr(self, "pollution_label", None):
            return
        l, b = self.pollution_label
        fnt = font(13 if self.s < 12 else 15, True)
        text = f"POLLUTION ZONE {dirty_span()}"
        filters = sorted({M.chunk_name((p.x0 + p.x1) // 2, (p.z0 + p.z1) // 2) for p in L.PADS if p.key == "eaf"})
        if filters:
            text += " · air filter at " + ", ".join(filters)
        w, h = text_size(fnt, text)
        self.draw.rounded_rectangle((l + 4, b - h - 14, l + w + 16, b - 4), radius=4,
                                    fill=PALETTE["paper"] + (235,), outline=PALETTE["rust"])
        ox, oy = text_origin(fnt, text)
        self.draw.text((l + 10 - ox, b - h - 9 - oy), text, font=fnt, fill=PALETTE["rust"])

    def walls(self):
        width = 1 if self.s < 12 else 2
        tone = PALETTE["wall"]
        for x in range(self.x0, self.x1 + 1):
            for z in range(self.z0, self.z1 + 1):
                st = self.style(x, z)
                if st == "rock":
                    continue
                l, t, r, b = self.box(x, x, z, z)
                for side, (dx, dz) in DIRS.items():
                    if self.style(x + dx, z + dz) != "rock":
                        continue
                    if side == "n":
                        self.draw.rectangle((l, t, r, t + width - 1), fill=tone)
                    elif side == "s":
                        self.draw.rectangle((l, b - width + 1, r, b), fill=tone)
                    elif side == "w":
                        self.draw.rectangle((l, t, l + width - 1, b), fill=tone)
                    else:
                        self.draw.rectangle((r - width + 1, t, r, b), fill=tone)

    def marks(self, detail):
        for mark in L.MARKS:
            room = ROOM_BY_ID[mark.room]
            if room.floor != self.floor or (mark.detail and not detail):
                continue
            l, t, r, b = self.box(mark.x0, mark.x1, mark.z0, mark.z1)
            if r < 0 or b < 0 or l > self.w or t > self.h:
                continue
            if mark.shape == "text":
                self.painted(mark.x0, mark.z0, mark.short, mark.vertical, detail)
                continue
            tone = PALETTE["mark"] + (190,)
            if mark.shape == "service":
                self.draw.rectangle((l, t, r, b), fill=(120, 114, 104, 70))
                for k in range(int(t), int(b), 4):
                    self.draw.line([(l, k), (r, k)], fill=(90, 84, 76, 80))
                continue
            if mark.shape == "circle":
                cx, cy = self.center(mark.x0, mark.x1, mark.z0, mark.z1)
                radius = (mark.radius + 0.5) * self.s
                dashed_circle(self.draw, cx, cy, radius, tone, 2 if detail else 1)
                if mark.short and detail:
                    fnt = font(12, True)
                    text_center(self.draw, cx, cy - radius + 10, mark.short, fnt, PALETTE["ink"])
                continue
            if mark.shape == "well":
                fnt = font(14 if detail else 11, True)
                text = (mark.short or "Sky well").upper()
                _w, h = text_size(fnt, text)
                y = t - h - 7 if mark.z0 - room.z0 >= 3 else b + 5
                halo(self.draw, (l, y), text, fnt, (40, 100, 150))
                continue
            dashed_rect(self.draw, (l + 1, t + 1, r - 1, b - 1), tone, 5, 4, 1)
            label = mark.short or ""
            if not label:
                continue
            fnt = fit(label, r - l - 6, b - t - 4, False, 14 if detail else 11, 9)
            if fnt:
                halo(self.draw, (l + 4, t + 2), label, fnt, PALETTE["ink"])

    def pads(self, detail):
        clusters = pad_clusters()
        for pad in L.PADS:
            if M.floor_of(pad.y) != self.floor:
                continue
            spec = MULTIS[pad.key]
            l, t, r, b = self.box(pad.x0, pad.x1, pad.z0, pad.z1)
            if detail and spec.front_air[0] > 1:
                cells = M.pad_front(pad, depth=0)
                xs = [c[0] for c in cells]
                zs = [c[1] for c in cells]
                kl, kt, kr, kb = self.box(min(xs), max(xs), min(zs), max(zs))
                self.draw.rectangle((kl, kt, kr, kb), fill=(255, 255, 255, 90))
                dashed_rect(self.draw, (kl + 1, kt + 1, kr - 1, kb - 1), PALETTE["mark"] + (200,), 4, 3, 1)
                fnt = fit("keep clear", kr - kl - 4, kb - kt - 4, False, 11, 7)
                if fnt:
                    text_center(self.draw, (kl + kr) / 2, (kt + kb) / 2, "keep clear", fnt, PALETTE["muted"])
            outline = PALETTE["rust"] if spec.pollution else PALETTE["wall"]
            width = 2 if (spec.pollution or detail) else 1
            if spec.shell:
                for x, z in M.pad_blocks(pad):
                    self.draw.rectangle(self.box(x, x, z, z), fill=PALETTE["shell"])
                self.draw.rectangle((l, t, r, b), outline=outline, width=width)
                il, it, ir, ib = self.box(pad.x0 + 1, pad.x1 - 1, pad.z0 + 1, pad.z1 - 1)
                self.draw.rectangle((il - 1, it - 1, ir + 1, ib + 1), outline=PALETTE["wall"], width=1)
                dl, dt, dr, db = self.box(pad.door[0], pad.door[0], pad.door[1], pad.door[1])
                self.draw.rectangle((dl, dt, dr, db), fill=PALETTE["door"])
            else:
                self.draw.rectangle((l, t, r, b), fill=PALETTE["pad"], outline=outline, width=width)
            if pad.key == "blood_altar":
                cx, cy = self.center(pad.x0, pad.x1, pad.z0, pad.z1)
                for size, tag in ((7, "T3"), (11, "T4")):
                    half = size * self.s / 2
                    dashed_rect(self.draw, (cx - half, cy - half, cx + half, cy + half), (150, 70, 70, 200), 5, 4, 1)
                    if detail:
                        halo(self.draw, (cx - half + 3, cy - half + 2), tag, font(11, True), (150, 70, 70))
                if detail:
                    halo(self.draw, (l + 4, t + 3), "T5", font(11, True), (150, 70, 70))
            self.notch(pad)
        for group in clusters:
            lead = group[0]
            if M.floor_of(lead.y) != self.floor:
                continue
            spec = MULTIS[lead.key]
            xa = min(p.x0 for p in group)
            xb = max(p.x1 for p in group)
            za = min(p.z0 for p in group)
            zb = max(p.z1 for p in group)
            l, t, r, b = self.box(xa, xb, za, zb)
            count = sum(max(1, p.wx) * max(1, p.wz) for p in group)
            nums = f"{count}× {spec.short}" if count > 1 else spec.short
            cx, cy = self.center(xa, xb, za, zb)
            if not detail:
                self.badge(cx, cy, nums)
                continue
            if spec.shell:
                il, it, ir, ib = self.box(xa + 1, xb - 1, za + 1, zb - 1)
                label = spec.short
                fnt = fit(label, ir - il, self.s * 1.2, True, 15, 8)
                if fnt:
                    halo(self.draw, (il + 3, ib - self.s + 2), label, fnt, PALETTE["ink"])
                continue
            label = f"{count}× {spec.short}" if count > 1 else spec.short
            fnt = fit(label, r - l - 4, b - t - 4, True, 16, 8)
            if fnt is None:
                label = spec.short
                fnt = fit(label, r - l - 2, b - t - 2, True, 14, 7)
            if fnt:
                text_center(self.draw, cx, cy, label, fnt, PALETTE["ink"])

    def notch(self, pad):
        for x0, x1, z0, z1, front in M.modules(pad):
            l, t, r, b = self.box(x0, x1, z0, z1)
            cx, cy = (l + r) / 2, (t + b) / 2
            k = max(2, self.s // 3)
            if front == "n":
                rect = (cx - k, t, cx + k, t + k // 1.5)
            elif front == "s":
                rect = (cx - k, b - k // 1.5, cx + k, b)
            elif front == "w":
                rect = (l, cy - k, l + k // 1.5, cy + k)
            else:
                rect = (r - k // 1.5, cy - k, r, cy + k)
            self.draw.rectangle(rect, fill=PALETTE["ink"])

    def badge(self, cx, cy, label):
        fnt = font(10, True)
        w, h = text_size(fnt, label)
        rx = max(7, w // 2 + 5)
        ry = 7
        self.draw.rounded_rectangle((cx - rx, cy - ry, cx + rx, cy + ry), radius=ry, fill=PALETTE["ink"])
        ox, oy = text_origin(fnt, label)
        self.draw.text((cx - w / 2 - ox, cy - h / 2 - oy), label, font=fnt, fill=PALETTE["paper"])

    def machines(self, detail):
        inset = 1 if self.s < 12 else 2
        for m in M.machines():
            if M.floor_of(m.y) != self.floor or not self.inside(m.x, m.z):
                continue
            spec = SINGLES[m.code]
            color = GROUP_COLORS[spec.group]
            l, t, r, b = self.box(m.x, m.x, m.z, m.z)
            self.draw.rectangle((l + inset, t + inset, r - inset, b - inset), fill=color,
                                outline=PALETTE["wall"] if detail else None)
            bar = max(1, self.s // 7)
            if m.face == "n":
                face = (l + inset, t + inset, r - inset, t + inset + bar)
            elif m.face == "s":
                face = (l + inset, b - inset - bar, r - inset, b - inset)
            elif m.face == "w":
                face = (l + inset, t + inset, l + inset + bar, b - inset)
            else:
                face = (r - inset - bar, t + inset, r - inset, b - inset)
            self.draw.rectangle(face, fill=(255, 255, 255, 210))
            if detail and m.tier != "MV":
                fnt = font(max(7, min(9, self.s // 4)), True)
                tw, th = text_size(fnt, m.tier)
                if m.face == "e":
                    tx, ty = l + inset + 1, b - inset - th
                elif m.face == "s":
                    tx, ty = r - inset - tw - 1, t + inset + 1
                else:
                    tx, ty = r - inset - tw - 1, b - inset - th
                self.draw.text((tx, ty), m.tier, font=fnt, fill=(255, 255, 255))
            if detail:
                fnt = fit(m.code, r - l - 2 * inset - 2, b - t - 2 * inset - 2, True, 11, 7)
                if fnt:
                    cx, cy = (l + r) / 2, (t + b) / 2
                    text_center(self.draw, cx, cy + 1, m.code, fnt, (255, 255, 255), ring=color)

    def rooms(self, detail):
        standard = {floor.id: floor.height for floor in L.FLOORS}
        for room in L.ROOMS:
            if room.floor != self.floor:
                continue
            ax, az = room.label_at
            if not (room.x0 <= ax <= room.x1 and room.z0 <= az <= room.z1):
                ax, az = (room.x0 + room.x1) // 2, (room.z0 + room.z1) // 2
            if not self.inside(ax, az):
                continue
            l, t, r, b = self.box(room.x0, room.x1, room.z0, room.z1)
            fnt = font(12 if not detail else 13, True)
            bw, bh = text_size(fnt, room.code)
            bl, bt = max(l, 0) + 4, max(t, 0) + 4
            badge = (bl, bt, bl + bw + 10, bt + bh + 8)
            self.draw.rounded_rectangle(badge, radius=4, fill=PALETTE["ink"])
            ox, oy = text_origin(fnt, room.code)
            self.draw.text((bl + 5 - ox, bt + 4 - oy), room.code, font=fnt, fill=PALETTE["paper"])
            cx, cy = self.center(ax, ax, az, az)
            size = 15 if not detail else 18
            label_font = fit(room.name, (r - l) - 12, 40, True, size, 9) or font(9, True)
            w, h = text_size(label_font, room.name)
            if cx - w / 2 < badge[2] + 6 and cy - h / 2 < badge[3] + 2 and cy + h / 2 > badge[1]:
                cx = badge[2] + 8 + w / 2
            cx = min(max(cx, l + w / 2 + 4), r - w / 2 - 4)
            text_center(self.draw, cx, cy, room.name, label_font, PALETTE["ink"])
            height = room.y1 - room.y0 + 1
            if height != standard[room.floor]:
                tag = f"{height} high, air Y {room.y0}–{room.y1}"
                tag_font = fit(tag, (r - l) - 12, 16, False, 11 if not detail else 13, 8)
                if tag_font:
                    _w, th = text_size(tag_font, tag)
                    text_center(self.draw, cx, cy + h / 2 + th / 2 + 5, tag, tag_font, PALETTE["muted"])
            if room.grade:
                self.roof_tag(room, r, t, detail)

    def roof_tag(self, room, r, t, detail):
        text = "GLASS ROOF" if room.roof == "glass" else "BUILD THE ROOF"
        fnt = font(11 if detail else 9, True)
        w, h = text_size(fnt, text)
        color = PALETTE["glass"] if room.roof == "glass" else PALETTE["ground"]
        box = (r - w - 12, t + 4, r - 4, t + h + 10)
        self.draw.rounded_rectangle(box, radius=3, fill=PALETTE["paper"] + (230,), outline=color)
        ox, oy = text_origin(fnt, text)
        self.draw.text((box[0] + 4 - ox, box[1] + 3 - oy), text, font=fnt, fill=color)

    def lifts(self, detail):
        for lift in L.LIFTS:
            if self.floor not in lift.floors or not self.inside(lift.x, lift.z):
                continue
            l, t, r, b = self.box(lift.x, lift.x, lift.z, lift.z)
            pad = 1 if self.s < 12 else 2
            self.draw.rectangle((l - pad, t - pad, r + pad, b + pad), fill=PALETTE["ink"])
            cx, cy = (l + r) / 2, (t + b) / 2
            k = max(2.0, self.s * 0.32)
            self.draw.polygon([(cx, cy - k - 1), (cx - k, cy - 1), (cx + k, cy - 1)], fill=PALETTE["paper"])
            self.draw.polygon([(cx, cy + k + 1), (cx - k, cy + 1), (cx + k, cy + 1)], fill=PALETTE["paper"])
            if detail:
                fnt = font(12, True)
                halo(self.draw, (r + pad + 4, t - 2), lift.label.upper(), fnt, PALETTE["ink"])

    def grade_line(self):
        """Dashed line where the entrance floor's ceiling comes within COVER blocks of the ground."""
        top = L.FLOOR[L.ENTRANCE_FLOOR].air[1]

        def at_grade(x, z):
            return M.cover(x, z, top) < L.COVER

        pen = PALETTE["ground"] + (220,)
        width = 2 if self.s < 12 else 3
        spot = None
        room_cells = {(x, z) for room in L.ROOMS for x, z in M.iter_rect(room.x0, room.x1, room.z0, room.z1)}
        for x in range(self.x0, self.x1 + 1):
            for z in range(self.z0, self.z1 + 1):
                here = at_grade(x, z)
                l, t, r, b = self.box(x, x, z, z)
                if z < self.z1 and at_grade(x, z + 1) != here:
                    dashed(self.draw, (l, b + 0.5), (r + 1, b + 0.5), pen, 4, 3, width)
                    clear = all((x - k, z + j) not in room_cells for k in range(10) for j in range(1, 4))
                    if clear and x <= self.x1 - 2 and (spot is None or x > spot[0]):
                        spot = (x, z, l, b)
                if x < self.x1 and at_grade(x + 1, z) != here:
                    dashed(self.draw, (r + 0.5, t), (r + 0.5, b + 1), pen, 4, 3, width)
        self.grade_label = spot

    def grade_tag(self):
        if not getattr(self, "grade_label", None):
            return
        _x, _z, _l, b = self.grade_label
        fnt = font(12 if self.s < 12 else 14, True)
        w, _h = text_size(fnt, "AT GRADE ↓")
        halo(self.draw, (self.box(_x, _x, _z, _z)[2] - w, b + 4), "AT GRADE ↓", fnt, PALETTE["ground"])

    def streets(self, detail):
        for street in L.STREETS:
            if street.floor != self.floor or not street.label:
                continue
            x, z = street.label_at or (street.x0 + 1, (street.z0 + street.z1) // 2)
            self.painted(x, z, street.label, street.label_vertical, detail)

    def painted(self, x, z, text, vertical, detail):
        """A name painted on the floor: a street's, or an aisle's. Vertical text is centered on its cell."""
        if not self.inside(x, z):
            return
        fnt = font(12 if not detail else 14, True)
        if vertical:
            w, h = text_size(fnt, text)
            tmp = Image.new("RGBA", (round((w + 10) * PIXELS), round((h + 10) * PIXELS)), (0, 0, 0, 0))
            ImageDraw.Draw(tmp).text((5 * PIXELS, 3 * PIXELS), text, font=fnt, fill=PALETTE["muted"])
            tmp = tmp.rotate(90, expand=True, resample=Image.Resampling.BICUBIC)
            cx, cy = self.center(x, x, z, z)
            self.img.paste(tmp, (round(cx * PIXELS - tmp.size[0] / 2), round(cy * PIXELS - tmp.size[1] / 2)), tmp)
        else:
            l, t, _r, _b = self.box(x, x, z, z)
            halo(self.draw, (l, t), text, fnt, PALETTE["muted"])

    def callouts(self, sheet_id):
        for c in L.CALLOUTS:
            if sheet_id not in c["sheets"]:
                continue
            l, t, r, b = self.box(c["x0"], c["x1"], c["z0"], c["z1"])
            dashed_rect(self.draw, (l, t, r, b), PALETTE["cut"] + (200,), 7, 5, 1)
            halo(self.draw, (l + 6, t + 6), c["title"], font(13, True), PALETTE["ink"])
            halo(self.draw, (l + 6, t + 24), c["body"], font(12), PALETTE["muted"])

    def cuts(self):
        for name, axis, value, _caption in L.CUTS:
            if axis == "x" and self.x0 <= value <= self.x1:
                px = (value - self.x0 + 0.5) * self.s
                dashed(self.draw, (px, 0), (px, self.h), PALETTE["cut"] + (150,), 4, 9, 1)
                halo(self.draw, (px + 3, 3), name, font(14, True), PALETTE["cut"])
            if axis == "z" and self.z0 <= value <= self.z1:
                py = (value - self.z0 + 0.5) * self.s
                dashed(self.draw, (0, py), (self.w, py), PALETTE["cut"] + (150,), 4, 9, 1)
                halo(self.draw, (3, py - 18), name, font(14, True), PALETTE["cut"])


def plan(grid, sheet, region, scale, floor, level, detail):
    p = Plan(grid, region, scale, floor, level)
    p.cells()
    p.hatch_well()
    p.stairs()
    p.grid_lines()
    if floor != "basement":
        p.pollution()
    p.chunk_squares()
    p.walls()
    if floor != "basement":
        p.marks(detail)
        p.pads(detail)
        p.machines(detail)
        p.lifts(detail)
        p.callouts(sheet["id"])
        p.rooms(detail)
        p.streets(detail)
    if sheet.get("cuts"):
        p.cuts()
    p.pollution_tag()
    return p


def dirty_span() -> str:
    """The dirty chunks as a range, such as E6–G8."""
    def key(name):
        return L.COLUMNS.index(name[0]), int(name[1:])

    first, last = min(L.DIRTY, key=key), max(L.DIRTY, key=key)
    return f"{first}–{last}" if first != last else first


def pad_clusters():
    """Wallshared pads of the same kind, grouped so they get one label."""
    groups = []
    used = set()
    for pad in L.PADS:
        if pad.num in used:
            continue
        group = [pad]
        used.add(pad.num)
        if pad.share:
            grew = True
            while grew:
                grew = False
                for other in L.PADS:
                    if other.num in used or not other.share or other.key != pad.key:
                        continue
                    for member in group:
                        if (other.x0 <= member.x1 + 1 and member.x0 <= other.x1 + 1
                                and other.z0 <= member.z1 + 1 and member.z0 <= other.z1 + 1):
                            group.append(other)
                            used.add(other.num)
                            grew = True
                            break
        groups.append(sorted(group, key=lambda p: p.num))
    return groups


def axes(draw, origin, p):
    """The first column and first row of each chunk, with the in-game coordinate.

    The marked square is a multiple of 16, and the number is that block.
    The Z number is the square itself.
    """
    ox, oy = origin
    tick = font(11)
    chunk_font = font(14, True)
    mark = (70, 110, 160)
    label_y = oy - p.s - 12

    zs = [z for z in range(p.z0, p.z1 + 1) if z % 16 == 0]
    z_w = max((text_size(tick, str(z))[0] for z in zs), default=0)
    for x in range(p.x0, p.x1 + 1):
        if x % 16 != 0:
            continue
        left = ox + (x - p.x0) * p.s
        draw.rectangle((left, oy - p.s, left + p.s - 1, oy - 1), fill=mark)
        text_center(draw, left + p.s / 2, label_y, str(x), tick, PALETTE["ink"])
    for z in zs:
        top = oy + (z - p.z0) * p.s
        draw.rectangle((ox - p.s, top, ox - 1, top + p.s - 1), fill=mark)
        label = str(z)
        w, _h = text_size(tick, label)
        text_center(draw, ox - p.s - 6 - w / 2, top + p.s / 2, label, tick, PALETTE["ink"])
    for cx in sorted({x >> 4 for x in range(p.x0, p.x1 + 1)}):
        xa = max(cx * 16, p.x0)
        xb = min(cx * 16 + 15, p.x1)
        letter = M.chunk_letter(cx)
        if xb - xa < 3 or not letter:
            continue
        mid = ox + ((xa + xb + 1) / 2 - p.x0) * p.s
        text_center(draw, mid, label_y, letter, chunk_font, PALETTE["ink"], PALETTE["paper"])
    for cz in sorted({z >> 4 for z in range(p.z0, p.z1 + 1)}):
        za = max(cz * 16, p.z0)
        zb = min(cz * 16 + 15, p.z1)
        number = M.chunk_number(cz)
        if zb - za < 3 or not number:
            continue
        mid = oy + ((za + zb + 1) / 2 - p.z0) * p.s
        text_center(draw, ox - p.s - 18 - z_w, mid, str(number), chunk_font, PALETTE["ink"], PALETTE["paper"])


def edges(draw, origin, p):
    """A frame on the four edges of the sheet, labeled with the block there.

    West and east are X. North and south are Z.
    """
    ox, oy = origin
    ink = PALETTE["cut"]
    fnt = font(13, True)
    west, east = p.x0, p.x1
    north, south = p.z0, p.z1
    draw.rectangle((ox - 4, oy - 4, ox + p.w + 3, oy + p.h + 3), outline=ink, width=2)
    above = oy - p.s - 30
    below = oy + p.h + 14
    mid = ox + p.w / 2
    text_center(draw, ox, above, f"X {west}", fnt, ink)
    text_center(draw, mid, above, f"Z {north}", fnt, ink)
    text_center(draw, ox + p.w, above, f"X {east}", fnt, ink)
    text_center(draw, ox, below, f"X {west}", fnt, ink)
    text_center(draw, mid, below, f"Z {south}", fnt, ink)
    text_center(draw, ox + p.w, below, f"X {east}", fnt, ink)


def legend_styles(p):
    present = []
    for x in range(p.x0, p.x1 + 1):
        for z in range(p.z0, p.z1 + 1):
            st = p.style(x, z)
            if st != "rock" and st not in present:
                present.append(st)
    order = [r.style for r in L.ROOMS] + ["corridor", "entry", "door", "stair", "trench", "well"]
    return [s for s in order if s in present]


def machines_in(p):
    found = []
    for m in M.machines():
        if M.floor_of(m.y) == p.floor and p.inside(m.x, m.z) and m.code not in found:
            found.append(m.code)
    return found


def pads_in(p):
    return [pad for pad in L.PADS if M.floor_of(pad.y) == p.floor and p.inside((pad.x0 + pad.x1) // 2,
                                                                               (pad.z0 + pad.z1) // 2)]


def sheet_image(grid, sheet, index, total):
    detail = sheet["kind"] == "detail"
    floor, level = L.sheet_level(sheet)
    if detail:
        region, scale = tuple(sheet["region"]), sheet["scale"]
    else:
        region, scale = (L.X_MIN, L.X_MAX, L.Z_MIN, L.Z_MAX), 8
    p = plan(grid, sheet, region, scale, floor, level, detail)

    panel_w = 460
    left, top = 96, 176
    styles = legend_styles(p)
    key_cols = max(1, p.w // 210)
    key_rows = (len(styles) + key_cols - 1) // key_cols
    key_h = 40 + key_rows * 24
    body = font(14)
    note_lines = []
    for note in [sheet["blurb"], *sheet.get("notes", [])]:
        note_lines += wrap(note, body, panel_w - 30) + [""]
    sched = schedule(p, detail)
    panel_h = 40 + len(note_lines) * 19 + sum(h for _t, _f, h in sched) + 40
    width = left + p.w + 30 + panel_w
    height = max(top + p.h + key_h + 46, top + panel_h)
    img, draw = canvas(width, height, PALETTE["paper"])

    masthead(draw)
    draw.text((32, 46), sheet["title"], font=font(30, True), fill=PALETTE["ink"])
    tw, _ = text_size(font(30, True), sheet["title"])
    draw.text((52 + tw, 58), f"Cut at Y={level}    Sheet {index} of {total}", font=font(15), fill=PALETTE["muted"])
    draw.text((32, 92), "1 square = 1 block · north is up · blue squares are a chunk's first column and row",
              font=font(13), fill=PALETTE["muted"])

    img.paste(p.img, (round(left * PIXELS), round(top * PIXELS)))
    draw.rectangle((left - 1, top - 1, left + p.w, top + p.h), outline=PALETTE["wall"])
    axes(draw, (left, top), p)
    edges(draw, (left, top), p)

    ky = top + p.h + 34
    draw.text((left, ky), "Colors", font=font(13, True), fill=PALETTE["ink"])
    for i, st in enumerate(styles):
        col, row = i % key_cols, i // key_cols
        sx, sy = left + col * 210, ky + 22 + row * 24
        draw.rectangle((sx, sy, sx + 16, sy + 16), fill=PALETTE[st], outline=(170, 160, 146))
        draw.text((sx + 22, sy - 1), STYLE_NAMES.get(st, st), font=font(13), fill=PALETTE["ink"])

    px, py = left + p.w + 30, top
    draw.text((px, py), "How to read this sheet", font=font(16, True), fill=PALETTE["ink"])
    py += 28
    for line in note_lines:
        draw.text((px, py), line, font=body, fill=PALETTE["ink"])
        py += 19
    for text, kind, h in sched:
        if kind == "head":
            draw.text((px, py + 4), text, font=font(14, True), fill=PALETTE["ink"])
        elif kind == "chip":
            code, label, color = text
            draw.rectangle((px, py + 3, px + 14, py + 15), fill=color, outline=PALETTE["wall"])
            draw.text((px + 20, py), code, font=font(13, True), fill=PALETTE["ink"])
            draw.text((px + 60, py), label, font=font(13), fill=PALETTE["muted"])
        elif kind == "group":
            name, color = text
            draw.rectangle((px, py + 3, px + 14, py + 15), fill=color, outline=PALETTE["wall"])
            draw.text((px + 20, py), name, font=font(13, True), fill=PALETTE["ink"])
        elif kind == "symbol":
            symbol(draw, px, py, text)
        else:
            draw.text((px, py), text, font=font(13), fill=PALETTE["muted"])
        py += h
    return img.convert("RGB")


SYMBOLS = [
    ("pad", "Multiblock footprint, named on the drawing"),
    ("rust", "Rust outline: this multiblock pollutes"),
    ("notch", "Black tab: the controller face"),
    ("machine", "Colored square: singleblock; the white edge is its front"),
    ("dashed", "Dashed box: a floor mark, not a wall"),
    ("lift", "Lift: an elevator block on every floor it serves"),
]


def symbol(draw, x, y, kind):
    label = dict(SYMBOLS)[kind]
    if kind in ("pad", "rust", "notch"):
        outline = PALETTE["rust"] if kind == "rust" else PALETTE["wall"]
        draw.rectangle((x, y + 1, x + 16, y + 15), fill=PALETTE["pad"], outline=outline, width=2)
        if kind == "notch":
            draw.rectangle((x + 5, y + 1, x + 11, y + 4), fill=PALETTE["ink"])
    elif kind == "machine":
        draw.rectangle((x + 1, y + 2, x + 15, y + 15), fill=GROUP_COLORS["form"])
        draw.rectangle((x + 1, y + 13, x + 15, y + 15), fill=(255, 255, 255))
    elif kind == "lift":
        draw.rectangle((x + 2, y + 2, x + 14, y + 14), fill=PALETTE["ink"])
        draw.polygon([(x + 8, y + 3), (x + 4, y + 7), (x + 12, y + 7)], fill=PALETTE["paper"])
        draw.polygon([(x + 8, y + 13), (x + 4, y + 9), (x + 12, y + 9)], fill=PALETTE["paper"])
    else:
        dashed_rect(draw, (x, y + 1, x + 16, y + 15), PALETTE["mark"], 3, 2, 1)
    draw.text((x + 24, y), label, font=font(13), fill=PALETTE["muted"])


def schedule(p, detail):
    rows = []
    pads = pads_in(p)
    if pads:
        rows.append(("Multiblocks", "head", 24))
        nums = {pad.num for pad in pads}
        for group in pad_clusters():
            group = [g for g in group if g.num in nums]
            if not group:
                continue
            lead = group[0]
            spec = MULTIS[lead.key]
            w, d = lead.x1 - lead.x0 + 1, lead.z1 - lead.z0 + 1
            h = M.pad_height(lead)
            count = sum(max(1, p.wx) * max(1, p.wz) for p in group)
            extra = f" · {lead.label}" if lead.label and count == 1 else ""
            smoke = " · pollutes" if spec.pollution else ""
            text = f"{count}× {spec.name} {w}×{d}×{h}{extra}{smoke}" if count > 1 else f"{spec.name} {w}×{d}×{h}{extra}{smoke}"
            for line in wrap(text, font(13), 440):
                rows.append((line, "text", 18))
    codes = machines_in(p)
    if codes:
        rows.append(("Machines", "head", 24))
        groups = {}
        for code in codes:
            groups.setdefault(SINGLES[code].group, []).append(code)
        for group, members in groups.items():
            color = GROUP_COLORS[group]
            if detail:
                for code in members:
                    rows.append(((code, SINGLES[code].name, color), "chip", 18))
            else:
                rows.append(((GROUPS[group], color), "group", 18))
                names = ", ".join(SINGLES[c].name for c in members)
                for line in wrap(names, font(13), 420):
                    rows.append((f"    {line}", "text", 17))
    if p.floor != "basement":
        rows.append(("Symbols", "head", 24))
        has_lift = any(p.floor in lift.floors and p.inside(lift.x, lift.z) for lift in L.LIFTS)
        for kind, _label in SYMBOLS:
            if kind == "lift" and not has_lift:
                continue
            rows.append((kind, "symbol", 20))
    if detail:
        walls = [w for w in L.WALLS if M.floor_of(w.y) == p.floor and p.inside(w.x, w.z)]
        if walls:
            rows.append(("Walls, in order", "head", 24))
            for w in walls:
                codes = " ".join(c or "·" for c in w.codes)
                rows.append((f"{w.id}  {w.title}", "text", 17))
                rows.append((f"      {codes}", "text", 18))
    return rows


def level_lines() -> list[tuple]:
    """(Y, what it is) for the dashed lines on the sections: each floor's slab and ceiling, and the crawl."""
    lines = []
    for floor in L.FLOORS:
        lines.append((floor.slab, floor.name.lower()))
        lines.append((floor.air[1], f"{floor.name.lower()} ceiling"))
    lines.append((L.CRAWL["air"][0], L.CRAWL["name"].lower()))
    return sorted(lines)


def sections(grid):
    y0 = min(floor.slab for floor in L.FLOORS) - 4
    y1 = max(100, max(floor.air[1] for floor in L.FLOORS) + 19)
    ss = 6
    margin = 92
    label_h = 44
    gap = 44
    sec_h = (y1 - y0 + 1) * ss
    length = max(L.X_MAX - L.X_MIN, L.Z_MAX - L.Z_MIN) + 1
    width = margin + length * ss + 60
    height = 120 + len(L.CUTS) * (label_h + 18 + sec_h + gap) + 30
    img, draw = canvas(width, height, PALETTE["paper"])
    masthead(draw, "GTNH 2.9.0")
    draw.text((32, 46), "Sections", font=font(30, True), fill=PALETTE["ink"])
    names = [cut[0] for cut in L.CUTS]
    span = f"{names[0]}–{names[-1]}" if len(names) > 1 else names[0]
    draw.text((200, 58), f"Cuts {span}, Y={y0} to Y={y1}. The brown line is the estimated ground.", font=font(15),
              fill=PALETTE["muted"])
    top = 110
    for name, axis, value, caption in L.CUTS:
        draw.text((margin, top), f"Cut {name}", font=font(18, True), fill=PALETTE["cut"])
        axis_text = (f"X={value}, looking east; north is on the left" if axis == "x"
                     else f"Z={value}, looking north; west is on the left")
        lines = wrap(f"{caption}. {axis_text}.", font(14), width - margin - 96)
        for k, line in enumerate(lines):
            draw.text((margin + 76, top + 4 + 18 * k), line, font=font(14), fill=PALETTE["ink"])
        top += label_h + 18 * (len(lines) - 1)
        if axis == "x":
            cols = list(range(L.Z_MIN, L.Z_MAX + 1))
        else:
            cols = list(range(L.X_MIN, L.X_MAX + 1))
        ground = [M.surface(value, c) if axis == "x" else M.surface(c, value) for c in cols]
        samples = {}
        for y in range(y0, y1 + 1):
            py = top + (y1 - y) * ss
            for i, c in enumerate(cols):
                st = M.style_at(grid, value, c, y) if axis == "x" else M.style_at(grid, c, value, y)
                samples[(i, y)] = st
                if st != "rock":
                    fill = PALETTE[st]
                else:
                    fill = PALETTE["sky"] if y > ground[i] else PALETTE["rock"]
                draw.rectangle((margin + i * ss, py, margin + (i + 1) * ss - 1, py + ss - 1), fill=fill)
                if c % 16 == 0:
                    draw.rectangle((margin + i * ss, py, margin + (i + 1) * ss - 1, py + ss - 1),
                                   fill=(70, 110, 160, 52))
        run = []
        for i, g in enumerate(ground + [y1 + 1]):
            if g <= y1 + 0.5:
                run.append((margin + (i + 0.5) * ss, top + (y1 - g + 0.5) * ss))
                continue
            if len(run) > 1:
                draw.line(run, fill=PALETTE["ground"], width=2)
            run = []
        if max(ground) > y1:
            halo(draw, (margin + 6, top + 4), f"Ground up to ≈Y {max(ground):.0f}, above the frame",
                 font(12, True), PALETTE["ground"])
        draw.rectangle((margin - 1, top - 1, margin + len(cols) * ss, top + sec_h), outline=PALETTE["wall"])
        for mark, _what in level_lines():
            py = top + (y1 - mark) * ss + ss / 2
            dashed(draw, (margin, py), (margin + len(cols) * ss, py), (176, 150, 126, 150), 5, 8, 1)
            draw.text((18, py - 8), f"Y{mark}", font=font(12), fill=PALETTE["muted"])
        for i, c in enumerate(cols):
            if c % 16 == 0:
                left = margin + i * ss
                draw.rectangle((left, top + sec_h + 4, left + ss - 1, top + sec_h + 3 + ss), fill=(70, 110, 160))
                text_center(draw, left + ss / 2, top + sec_h + ss + 16, str(c), font(11), PALETTE["ink"])
        label_runs(draw, samples, margin, top, ss, y1)
        top += sec_h + gap
    legend = "Dashed lines: " + ", ".join(f"Y{y} {what}" for y, what in level_lines()) + "."
    for k, line in enumerate(wrap(legend, font(13), width - margin - 40)):
        draw.text((margin, top - 10 + 18 * k), line, font=font(13), fill=PALETTE["muted"])
    return img.convert("RGB")


def label_runs(draw, samples, left, top, ss, y1):
    from collections import deque

    seen = set()
    for key, st in samples.items():
        if key in seen or st in ("rock", "door"):
            continue
        bag = []
        queue = deque([key])
        seen.add(key)
        while queue:
            col, y = queue.popleft()
            bag.append((col, y))
            for nxt in ((col + 1, y), (col - 1, y), (col, y + 1), (col, y - 1)):
                if nxt not in seen and samples.get(nxt) == st:
                    seen.add(nxt)
                    queue.append(nxt)
        if len(bag) < 30:
            continue
        cols = [c for c, _ in bag]
        ys = [y for _, y in bag]
        w = (max(cols) - min(cols) + 1) * ss - 4
        h = (max(ys) - min(ys) + 1) * ss - 2
        name = STYLE_NAMES.get(st, st)
        fnt = fit(name, w, h, True, 13, 8)
        if not fnt:
            continue
        cx = left + (min(cols) + max(cols) + 1) / 2 * ss
        cy = top + (y1 - (min(ys) + max(ys)) / 2) * ss + ss / 2
        text_center(draw, cx, cy, name, fnt, PALETTE["ink"])


# Ground colors, one band per 9 blocks, matching the contour screenshot's bands.
BAND_BASE, BAND_STEP = 71, 9
BAND_STOPS = [(71, (204, 226, 196)), (110, (226, 233, 200)), (150, (240, 232, 204)), (185, (236, 220, 192)),
              (222, (224, 204, 176))]


def band(y):
    return int((y - BAND_BASE) // BAND_STEP)


def band_color(y):
    mid = BAND_BASE + BAND_STEP * band(y) + BAND_STEP / 2
    for (ya, ca), (yb, cb) in zip(BAND_STOPS, BAND_STOPS[1:]):
        if mid <= yb or (yb, cb) == BAND_STOPS[-1]:
            t = min(max((mid - ya) / (yb - ya), 0.0), 1.0)
            return tuple(round(a + (b - a) * t) for a, b in zip(ca, cb))
    return BAND_STOPS[0][1]


def terrain_plan(grid, scale):
    entrance = L.FLOOR[L.ENTRANCE_FLOOR]
    p = Plan(grid, (L.X_MIN, L.X_MAX, L.Z_MIN, L.Z_MAX), scale, entrance.id, entrance.walk)
    heights = {(x, z): M.surface(x, z) for x in range(p.x0, p.x1 + 1) for z in range(p.z0, p.z1 + 1)}
    for (x, z), y in heights.items():
        p.draw.rectangle(p.box(x, x, z, z), fill=band_color(y))
    contour = (124, 100, 76, 120)
    for (x, z), y in heights.items():
        l, t, r, b = p.box(x, x, z, z)
        if (x + 1, z) in heights and band(heights[(x + 1, z)]) != band(y):
            p.draw.line([(r, t), (r, b)], fill=contour)
        if (x, z + 1) in heights and band(heights[(x, z + 1)]) != band(y):
            p.draw.line([(l, b), (r, b)], fill=contour)
    chunk = (150, 132, 108, 70)
    for x in range(p.x0, p.x1 + 2):
        if x % 16 == 0:
            p.draw.line([((x - p.x0) * p.s, 0), ((x - p.x0) * p.s, p.h)], fill=chunk)
    for z in range(p.z0, p.z1 + 2):
        if z % 16 == 0:
            p.draw.line([(0, (z - p.z0) * p.s), (p.w, (z - p.z0) * p.s)], fill=chunk)
    p.chunk_squares()
    order = [f.id for f in L.FLOORS]
    for room in sorted(L.ROOMS, key=lambda r: order.index(r.floor)):
        floor = L.FLOOR[room.floor]
        l, t, r, b = p.box(room.x0, room.x1, room.z0, room.z1)
        pen = L.rgb(floor.pen)
        if room.grade:
            tint = PALETTE["glass"] if room.roof == "glass" else PALETTE["ground"]
            p.draw.rectangle((l, t, r, b), fill=tint + (60,))
        if floor.id == entrance.id:
            p.draw.rectangle((l, t, r, b), outline=pen, width=2)
        else:
            dashed_rect(p.draw, (l + 2, t + 2, r - 2, b - 2), pen + (230,), 6, 4, 2)
        fnt = fit(room.code, r - l - 4, b - t - 4, True, 12, 8)
        if fnt and floor.slab >= entrance.slab:
            cx, cy = p.center(room.x0, room.x1, room.z0, room.z1)
            text_center(p.draw, cx, cy + (10 if floor.slab > entrance.slab else 0), room.code, fnt, pen)
    for shaft in L.SHAFTS:
        p.draw.rectangle(p.box(shaft.x0, shaft.x1, shaft.z0, shaft.z1), fill=(90, 150, 190, 200))
    for lift in L.LIFTS:
        l, t, r, b = p.box(lift.x, lift.x, lift.z, lift.z)
        p.draw.rectangle((l - 2, t - 2, r + 2, b + 2), fill=PALETTE["ink"])
    p.grade_line()
    for r_, row in enumerate(M.TERRAIN):
        for c_, value in enumerate(row):
            xa, xb, za, zb = M.chunk_bounds(f"{L.COLUMNS[c_]}{r_ + 1}")
            l, t, _r, _b = p.box(max(xa, p.x0), max(xa, p.x0), max(za, p.z0), max(za, p.z0))
            halo(p.draw, (l + 4, t + 3), f"≈{value}", font(11, True), PALETTE["ground"])
    p.grade_tag()
    return p


def long_section(grid, x, ss, y0, y1):
    """North–south profile at one X, from below the lower floor to above the summit."""
    cols = list(range(L.Z_MIN, L.Z_MAX + 1))
    w, h = len(cols) * ss, (y1 - y0 + 1) * ss
    img, draw = canvas(w, h, PALETTE["rock"])
    ground = [M.surface(x, z) for z in cols]
    for i, z in enumerate(cols):
        for y in range(y0, y1 + 1):
            st = M.style_at(grid, x, z, y)
            if st != "rock":
                fill = PALETTE[st]
            elif y > ground[i]:
                fill = PALETTE["sky"]
            else:
                continue
            py = (y1 - y) * ss
            draw.rectangle((i * ss, py, (i + 1) * ss - 1, py + ss - 1), fill=fill)
    draw.line([((i + 0.5) * ss, (y1 - g + 0.5) * ss) for i, g in enumerate(ground)], fill=PALETTE["ground"],
              width=2)
    for lift in L.LIFTS:
        if lift.x != x:
            continue
        i = cols.index(lift.z)
        ya, yb = M.FLOORS[lift.floors[0]].slab, M.FLOORS[lift.floors[-1]].slab
        dashed(draw, ((i + 0.5) * ss, (y1 - yb) * ss), ((i + 0.5) * ss, (y1 - ya) * ss), PALETTE["ink"], 4, 3, 2)
    return img, ground


def shaft_checks() -> list[str]:
    """Where to read the ground with F3 before digging each shaft, and what the estimate expects."""
    lines = []
    for shaft in L.SHAFTS:
        x, z = (shaft.x0 + shaft.x1) // 2, (shaft.z0 + shaft.z1) // 2
        lines.append(f"{shaft.label or shaft.id}: X {x}, Z {z}, about Y {M.surface(x, z):.0f}")
    return lines


def terrain_sheet(grid, sheet, index, total):
    scale, ss, y0, y1 = 5, 3, 40, 226
    p = terrain_plan(grid, scale)
    profiles = [(x, *long_section(grid, x, ss, y0, y1)) for x in sheet.get("profiles", ())]
    panel_w = 460
    left, top = 96, 176
    body = font(14)
    note_lines = []
    for note in [sheet["blurb"], *sheet.get("notes", [])]:
        note_lines += wrap(note, body, panel_w - 30) + [""]
    covers = []
    for room in L.ROOMS:
        least = min(M.cover(x, z, room.y1) for x, z in M.iter_rect(room.x0, room.x1, room.z0, room.z1))
        covers.append((least, room))
    thin = sorted(covers, key=lambda item: item[0])[:6]
    checks = shaft_checks()
    entrance = L.FLOOR[L.ENTRANCE_FLOOR]
    roofs = {room.roof for room in L.ROOMS if room.grade}
    keys = [(entrance.id, f"{entrance.name} room, Y={entrance.slab}")]
    keys += [(f.id, f"{f.name} room, Y={f.slab}") for f in reversed(L.FLOORS) if f.id != entrance.id]
    keys += [("shaft", "Shaft to the sky")]
    keys += [("glass", "At grade, glass roof")] if "glass" in roofs else []
    keys += [("built", "At grade, build a solid roof")] if "built" in roofs else []
    keys += [("grade", f"{entrance.name} reaches grade past here")] if getattr(p, "grade_label", None) else []
    sec_w = (L.Z_MAX - L.Z_MIN + 1) * ss
    sec_h = (y1 - y0 + 1) * ss
    width = max(left + p.w + 30 + panel_w, left + len(profiles) * (sec_w + 70) + 40)
    panel_h = (28 + len(note_lines) * 19 + 24 + len(keys) * 20 + 32 + 9 * 18 + 32 + len(thin) * 18
               + 32 + len(checks) * 18)
    sec_top = max(top + p.h, top + panel_h) + 90
    height = sec_top + sec_h + 110
    img, draw = canvas(width, height, PALETTE["paper"])
    masthead(draw)
    draw.text((32, 46), sheet["title"], font=font(30, True), fill=PALETTE["ink"])
    tw, _ = text_size(font(30, True), sheet["title"])
    draw.text((52 + tw, 58), f"Every floor    Sheet {index} of {total}", font=font(15), fill=PALETTE["muted"])
    draw.text((32, 92), "Plan: 1 square = 1 block, north is up, colors are ground height · profiles: north is "
                        "on the left", font=font(13), fill=PALETTE["muted"])
    img.paste(p.img, (round(left * PIXELS), round(top * PIXELS)))
    draw.rectangle((left - 1, top - 1, left + p.w, top + p.h), outline=PALETTE["wall"])
    axes(draw, (left, top), p)
    edges(draw, (left, top), p)

    px, py = left + p.w + 30, top
    draw.text((px, py), "How to read this sheet", font=font(16, True), fill=PALETTE["ink"])
    py += 28
    for line in note_lines:
        draw.text((px, py), line, font=body, fill=PALETTE["ink"])
        py += 19
    draw.text((px, py), "Lines and fills", font=font(14, True), fill=PALETTE["ink"])
    py += 24
    for kind, text in keys:
        if kind == entrance.id:
            draw.rectangle((px, py + 2, px + 16, py + 14), outline=L.rgb(entrance.pen), width=2)
        elif kind in L.FLOOR:
            dashed_rect(draw, (px, py + 2, px + 16, py + 14), L.rgb(L.FLOOR[kind].pen), 4, 3, 2)
        elif kind == "glass":
            draw.rectangle((px, py + 2, px + 16, py + 14), fill=PALETTE["glass"] + (90,))
        elif kind == "built":
            draw.rectangle((px, py + 2, px + 16, py + 14), fill=PALETTE["ground"] + (80,))
        elif kind == "shaft":
            draw.rectangle((px, py + 2, px + 16, py + 14), fill=(90, 150, 190, 200))
        else:
            dashed(draw, (px, py + 8), (px + 16, py + 8), PALETTE["ground"], 4, 3, 2)
        draw.text((px + 24, py), text, font=font(13), fill=PALETTE["muted"])
        py += 20
    py += 8
    draw.text((px, py), "Ground height", font=font(14, True), fill=PALETTE["ink"])
    py += 24
    for k in range(0, 17, 2):
        ya = BAND_BASE + BAND_STEP * k
        draw.rectangle((px, py + 2, px + 16, py + 14), fill=band_color(ya + 1), outline=(170, 160, 146))
        draw.text((px + 24, py), f"Y {ya}–{ya + BAND_STEP - 1}", font=font(13), fill=PALETTE["muted"])
        py += 18
    py += 8
    draw.text((px, py), "Thinnest roofs, blocks of rock over the ceiling", font=font(14, True), fill=PALETTE["ink"])
    py += 24
    for least, room in thin:
        tag = ("at grade, glass roof" if room.roof == "glass" else "at grade, build the roof") if room.grade \
            else f"{least:.0f}"
        draw.text((px, py), f"{room.name}", font=font(13), fill=PALETTE["ink"])
        draw.text((px + 200, py), tag, font=font(13), fill=PALETTE["muted"])
        py += 18
    if checks:
        py += 8
        draw.text((px, py), "Read the ground with F3 before digging", font=font(14, True), fill=PALETTE["ink"])
        py += 24
        for line in checks:
            draw.text((px, py), line, font=font(13), fill=PALETTE["muted"])
            py += 18

    sx = left
    for x, sec, ground in profiles:
        draw.text((sx, sec_top - 44), f"Profile at X={x}", font=font(16, True), fill=PALETTE["cut"])
        draw.text((sx, sec_top - 22), f"Ground from ≈Y {ground[0]:.0f} at the north edge to ≈Y {ground[-1]:.0f} at "
                                      "the south edge", font=font(12), fill=PALETTE["muted"])
        img.paste(sec, (round(sx * PIXELS), round(sec_top * PIXELS)))
        draw.rectangle((sx - 1, sec_top - 1, sx + sec_w, sec_top + sec_h), outline=PALETTE["wall"])
        for mark in sorted({floor.slab for floor in L.FLOORS} | {100, 150, 200, 220}):
            yy = sec_top + (y1 - mark) * ss + ss / 2
            dashed(draw, (sx, yy), (sx + sec_w, yy), (150, 130, 106, 110), 4, 6, 1)
            draw.text((sx - 40, yy - 8), f"Y{mark}", font=font(11), fill=PALETTE["muted"])
        for i, z in enumerate(range(L.Z_MIN, L.Z_MAX + 1)):
            if z % 16 == 0:
                text_center(draw, sx + (i + 0.5) * ss, sec_top + sec_h + 12, str(z), font(10), PALETTE["ink"])
        sx += sec_w + 70
    draw.text((left, height - 40), "Profiles show what each floor cuts at that X, from Y 40 up to Y 226. Blue is "
                                   "open air above the estimated ground.", font=font(13), fill=PALETTE["muted"])
    return img.convert("RGB")
