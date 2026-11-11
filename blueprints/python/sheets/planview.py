"""A plan view of one region at one floor, painted a layer at a time."""

from __future__ import annotations

from PIL import Image

import layout as L
import model as M
from catalog import MULTIS, SINGLES
from .pen import (PALETTE, PIXELS, canvas, dashed, dashed_circle, dashed_rect, device, fit, font, halo, overlay,
                 text_at, text_center, text_middle, text_size)
from schema import DIRS

# Fills of dug cells, by the style that dug them: the plan's palette, then each room's own color.
FILLS = {style: L.rgb(color) for style, color in L.PALETTE.items()}
FILLS.update({room.style: L.rgb(room.color) for room in L.ROOMS})
GROUP_COLORS = {group: L.rgb(color) for group, color in L.GROUP_COLORS.items()}
ROOM_BY_ID = {room.id: room for room in L.ROOMS}

# The name a sheet uses for the pipe crawl's layer.
BASEMENT = "basement"
# A plan drawn smaller than this many pixels a block uses thinner lines and smaller type.
FINE_SCALE = 12
CHUNK = 16

WHITE = (255, 255, 255)
CHUNK_BLUE = (70, 110, 160)
CHUNK_TINT = CHUNK_BLUE + (52,)
CHUNK_LINE = (176, 156, 128, 48)
BLOCK_LINE = (0, 0, 0, 64)
WELL_HATCH = (120, 170, 200, 90)
WELL_EDGE = (90, 150, 190)
SKY_INK = (40, 100, 150)
TREAD_LINE = (150, 132, 104, 150)
SERVICE_FILL = (120, 114, 104, 70)
SERVICE_LINE = (90, 84, 76, 80)
KEEP_CLEAR_FILL = WHITE + (90,)
MACHINE_FRONT = WHITE + (210,)
ALTAR_INK = (150, 70, 70)

AIR_FILTER = "eaf"
BLOOD_ALTAR = "blood_altar"
# The smaller altars a T5 footprint holds, as (blocks a side, tier).
ALTAR_TIERS = ((7, "T3"), (11, "T4"))
GRADE_TEXT = "AT GRADE ↓"


def dirty_box():
    """The smallest (x0, x1, z0, z1) around the dirty chunks, or None when the plan has none."""
    bounds = [M.chunk_bounds(name) for name in sorted(L.DIRTY)]
    if not bounds:
        return None
    return (min(b[0] for b in bounds), max(b[1] for b in bounds), min(b[2] for b in bounds), max(b[3] for b in bounds))


def _chunk_order(name: str) -> tuple:
    """A chunk name's place on the grid, column first, so names sort the way they read."""
    letters, number = L.chunk_parts(name)
    return L.COLUMNS.index(letters), number


def dirty_span() -> str:
    """The dirty chunks as a range, such as E6–G8."""
    first, last = min(L.DIRTY, key=_chunk_order), max(L.DIRTY, key=_chunk_order)
    return f"{first}–{last}" if first != last else first


def _pollution_text() -> str:
    """The pollution zone's caption: its chunks, and where the air filter stands."""
    text = f"POLLUTION ZONE {dirty_span()}"
    filters = sorted({M.chunk_name((p.x0 + p.x1) // 2, (p.z0 + p.z1) // 2) for p in L.PADS if p.key == AIR_FILTER})
    if filters:
        text += " · air filter at " + ", ".join(filters)
    return text


# --- wallshared clusters ---

def _beside(a, b) -> bool:
    """Whether two footprints touch or overlap."""
    return a.x0 <= b.x1 + 1 and b.x0 <= a.x1 + 1 and a.z0 <= b.z1 + 1 and b.z0 <= a.z1 + 1


def _cluster(pad, used: set) -> list:
    """A pad and every shared pad of its kind that touches the group, lowest number first."""
    group = [pad]
    used.add(pad.num)
    grew = pad.share
    while grew:
        grew = False
        for other in L.PADS:
            fits = other.num not in used and other.share and other.key == pad.key
            if fits and any(_beside(other, member) for member in group):
                group.append(other)
                used.add(other.num)
                grew = True
    return sorted(group, key=lambda p: p.num)


def pad_clusters() -> list:
    """Wallshared pads of the same kind, grouped so they get one label."""
    used: set = set()
    return [_cluster(pad, used) for pad in L.PADS if pad.num not in used]


def cluster_count(group: list) -> int:
    """How many structures a cluster holds, counting every module of every row."""
    return sum(max(1, p.wx) * max(1, p.wz) for p in group)


def cluster_box(group: list) -> tuple:
    """The smallest (x0, x1, z0, z1) around a cluster."""
    return (min(p.x0 for p in group), max(p.x1 for p in group), min(p.z0 for p in group), max(p.z1 for p in group))


def counted(count: int, name: str) -> str:
    """A name with how many there are in front of it, when there is more than one."""
    return f"{count}× {name}" if count > 1 else name


# --- small shapes ---

def _edge_strip(box: tuple, side: str, depth) -> tuple:
    """The strip `depth` pixels deep along one side of a box, inside it."""
    l, t, r, b = box
    if side == "n":
        return l, t, r, t + depth - 1
    if side == "s":
        return l, b - depth + 1, r, b
    if side == "w":
        return l, t, l + depth - 1, b
    return r - depth + 1, t, r, b


def _tab(box: tuple, side: str, k) -> tuple:
    """A tab in the middle of one side of a box: the controller face."""
    l, t, r, b = box
    cx, cy = (l + r) / 2, (t + b) / 2
    if side == "n":
        return cx - k, t, cx + k, t + k // 1.5
    if side == "s":
        return cx - k, b - k // 1.5, cx + k, b
    if side == "w":
        return l, cy - k, l + k // 1.5, cy + k
    return r - k // 1.5, cy - k, r, cy + k


def _arrow_head(tip: tuple, ax, ay, wing) -> list:
    """A triangle at `tip`, pointing along (ax, ay)."""
    return [tip, (tip[0] - ax * wing - ay * wing * 0.7, tip[1] - ay * wing - ax * wing * 0.7),
            (tip[0] - ax * wing + ay * wing * 0.7, tip[1] - ay * wing + ax * wing * 0.7)]


def _label_cell(room) -> tuple:
    """The cell a room's name is centered on: where the plan puts it, or the middle when that is outside the room."""
    ax, az = room.label_at
    if room.x0 <= ax <= room.x1 and room.z0 <= az <= room.z1:
        return ax, az
    return (room.x0 + room.x1) // 2, (room.z0 + room.z1) // 2


def _at_grade(x: int, z: int, top: int) -> bool:
    """Whether the ground over a block is too thin to roof air that tops out at `top`."""
    return M.cover(x, z, top) < L.COVER


class Plan:
    """A plan view of one region at one floor."""

    def __init__(self, grid: dict, region: tuple, scale: int, floor: str, level: int) -> None:
        self.grid = grid
        self.x0, self.x1, self.z0, self.z1 = region
        self.s = scale
        self.floor = floor
        self.level = level
        self.w = (self.x1 - self.x0 + 1) * scale
        self.h = (self.z1 - self.z0 + 1) * scale
        # RGB image with an RGBA pen: translucent strokes blend instead of replacing pixels.
        self.img, self.draw = canvas(self.w, self.h, FILLS[M.ROCK])
        # Where the pollution zone and the at-grade line want their captions, once those layers are drawn.
        self.pollution_label = None
        self.grade_label = None

    # --- where things are ---

    def box(self, xa: int, xb: int, za: int, zb: int) -> tuple:
        """The pixels of a footprint, as (left, top, right, bottom), all inside."""
        l = (min(xa, xb) - self.x0) * self.s
        t = (min(za, zb) - self.z0) * self.s
        r = (max(xa, xb) - self.x0 + 1) * self.s - 1
        b = (max(za, zb) - self.z0 + 1) * self.s - 1
        return l, t, r, b

    def cell(self, x: int, z: int) -> tuple:
        """The pixels of one block."""
        return self.box(x, x, z, z)

    def of(self, zone) -> tuple:
        """The pixels of a record's footprint."""
        return self.box(*zone.box)

    def center(self, xa: int, xb: int, za: int, zb: int) -> tuple:
        """The middle of a footprint, in pixels."""
        l, t, r, b = self.box(xa, xb, za, zb)
        return (l + r + 1) / 2, (t + b + 1) / 2

    def inside(self, x: int, z: int) -> bool:
        """Whether a block is in the region drawn."""
        return self.x0 <= x <= self.x1 and self.z0 <= z <= self.z1

    def style(self, x: int, z: int) -> str:
        """What dug a block at the level this plan is cut at."""
        if self.floor == BASEMENT:
            return M.style_at(self.grid, x, z, self.level)
        return M.floor_style(self.grid, x, z, self.floor)

    def dug(self):
        """(x, z, style) for each block of the region that is not rock, column by column."""
        for x in range(self.x0, self.x1 + 1):
            for z in range(self.z0, self.z1 + 1):
                st = self.style(x, z)
                if st != M.ROCK:
                    yield x, z, st

    def fine(self) -> bool:
        """Whether the plan is drawn small, so lines and type step down."""
        return self.s < FINE_SCALE

    # --- the ground the plan is drawn on ---

    def cells(self) -> None:
        """Fill every dug block with the color of what dug it."""
        for x, z, st in self.dug():
            self.draw.rectangle(self.cell(x, z), fill=FILLS[st])

    def hatch_well(self) -> None:
        """Hatch each shaft on this floor and outline it."""
        for shaft in L.SHAFTS:
            if shaft.floor != self.floor:
                continue
            l, t, r, b = self.of(shaft)
            w, h = int(r - l + 1), int(b - t + 1)
            layer, pen = overlay(w, h)
            for k in range(-h, w, 9):
                pen.line([(k, h), (k + h, 0)], fill=WELL_HATCH, width=1)
            self.img.paste(layer, device(l, t), layer)
            self.draw.rectangle((l, t, r, b), outline=WELL_EDGE, width=2)

    def _treads(self, stair, box: tuple) -> None:
        """Lines across a stair, one per step."""
        l, t, r, b = box
        step = max(3, self.s // 2)
        if stair.low in "ns":
            for y in range(int(t), int(b), step):
                self.draw.line([(l, y), (r, y)], fill=TREAD_LINE)
        else:
            for x in range(int(l), int(r), step):
                self.draw.line([(x, t), (x, b)], fill=TREAD_LINE)

    def _climb_arrow(self, stair, box: tuple) -> None:
        """An arrow along the climb, with UP or DOWN where a person steps on from this floor."""
        l, t, r, b = box
        dx, dz = DIRS[stair.low]
        cx, cy = (l + r) / 2, (t + b) / 2
        span = (b - t if stair.low in "ns" else r - l) * 0.36
        low = (cx + dx * span, cy + dz * span)
        high = (cx - dx * span, cy - dz * span)
        going_up = self.floor == stair.floors[0]
        start, tip = (low, high) if going_up else (high, low)
        self.draw.line([start, tip], fill=PALETTE["ink"], width=2)
        ax, ay = (-dx, -dz) if going_up else (dx, dz)
        self.draw.polygon(_arrow_head(tip, ax, ay, max(4, self.s * 0.45)), fill=PALETTE["ink"])
        word = "UP" if going_up else "DOWN"
        fnt = fit(word, r - l - 2, self.s * 1.4, True, 14, 8)
        if fnt:
            text_center(self.draw, start[0], start[1], word, fnt, PALETTE["ink"])

    def stairs(self) -> None:
        """Each stair that reaches this floor: its treads and the way it climbs."""
        for stair in L.STAIRS:
            if self.floor not in stair.floors:
                continue
            box = self.of(stair)
            self.draw.rectangle(box, fill=FILLS["stair"])
            self._treads(stair, box)
            self._climb_arrow(stair, box)

    def chunk_lines(self, color: tuple) -> None:
        """A line along the west and north edge of every chunk."""
        for x in range(self.x0, self.x1 + 2):
            if x % CHUNK == 0:
                px = (x - self.x0) * self.s
                self.draw.line([(px, 0), (px, self.h)], fill=color, width=1)
        for z in range(self.z0, self.z1 + 2):
            if z % CHUNK == 0:
                py = (z - self.z0) * self.s
                self.draw.line([(0, py), (self.w, py)], fill=color, width=1)

    def grid_lines(self) -> None:
        """The block grid, inside dug cells only, and the lighter chunk lines."""
        for x, z, _st in self.dug():
            l, t, r, b = self.cell(x, z)
            self.draw.line([(l, b), (r, b)], fill=BLOCK_LINE)
            self.draw.line([(r, t), (r, b)], fill=BLOCK_LINE)
        self.chunk_lines(CHUNK_LINE)

    def chunk_squares(self) -> None:
        """Tint the first column and the first row of each chunk."""
        for x in range(self.x0, self.x1 + 1):
            if x % CHUNK == 0:
                self.draw.rectangle(self.box(x, x, self.z0, self.z1), fill=CHUNK_TINT)
        for z in range(self.z0, self.z1 + 1):
            if z % CHUNK == 0:
                self.draw.rectangle(self.box(self.x0, self.x1, z, z), fill=CHUNK_TINT)

    def walls(self) -> None:
        """A wall line on the outer pixels of each dug block, on every side that touches rock."""
        width = 1 if self.fine() else 2
        for x, z, _st in self.dug():
            box = self.cell(x, z)
            for side, (dx, dz) in DIRS.items():
                if self.style(x + dx, z + dz) == M.ROCK:
                    self.draw.rectangle(_edge_strip(box, side, width), fill=PALETTE["wall"])

    # --- the pollution zone ---

    def pollution(self) -> None:
        """Tint and outline the part of the dirty chunks this plan shows."""
        dirty = dirty_box()
        if dirty is None:
            return
        xa, xb = max(dirty[0], self.x0), min(dirty[1], self.x1)
        za, zb = max(dirty[2], self.z0), min(dirty[3], self.z1)
        if xa > xb or za > zb:
            return
        l, t, r, b = self.box(xa, xb, za, zb)
        self.draw.rectangle((l, t, r, b), fill=PALETTE["rust"] + (20,))
        dashed_rect(self.draw, (l + 1, t + 1, r - 1, b - 1), PALETTE["rust"] + (200,), 9, 6, 2)
        self.pollution_label = (l, b)

    def pollution_tag(self) -> None:
        """The pollution zone's caption, over everything else, in its lower left corner."""
        if not self.pollution_label:
            return
        l, b = self.pollution_label
        fnt = font(13 if self.fine() else 15, True)
        text = _pollution_text()
        w, h = text_size(fnt, text)
        self.draw.rounded_rectangle((l + 4, b - h - 14, l + w + 16, b - 4), radius=4,
                                    fill=PALETTE["paper"] + (235,), outline=PALETTE["rust"])
        text_at(self.draw, (l + 10, b - h - 9), text, fnt, PALETTE["rust"])

    # --- floor marks ---

    def _mark_service(self, mark, _room, _detail: bool) -> None:
        """A service core: a ruled grey block."""
        l, t, r, b = self.of(mark)
        self.draw.rectangle((l, t, r, b), fill=SERVICE_FILL)
        for k in range(int(t), int(b), 4):
            self.draw.line([(l, k), (r, k)], fill=SERVICE_LINE)

    def _mark_circle(self, mark, _room, detail: bool) -> None:
        """A dashed ring, named at its top on a detail sheet."""
        cx, cy = self.center(*mark.box)
        radius = (mark.radius + 0.5) * self.s
        dashed_circle(self.draw, cx, cy, radius, PALETTE["mark"] + (190,), 2 if detail else 1)
        if mark.short and detail:
            text_center(self.draw, cx, cy - radius + 10, mark.short, font(12, True), PALETTE["ink"])

    def _mark_well(self, mark, room, detail: bool) -> None:
        """A sky well's name, above the well when the room has space there."""
        l, t, _r, b = self.of(mark)
        fnt = font(14 if detail else 11, True)
        text = (mark.short or "Sky well").upper()
        _w, h = text_size(fnt, text)
        y = t - h - 7 if mark.z0 - room.z0 >= 3 else b + 5
        halo(self.draw, (l, y), text, fnt, SKY_INK)

    def _mark_box(self, mark, _room, detail: bool) -> None:
        """A dashed box with its name in the corner."""
        l, t, r, b = self.of(mark)
        dashed_rect(self.draw, (l + 1, t + 1, r - 1, b - 1), PALETTE["mark"] + (190,), 5, 4, 1)
        if not mark.short:
            return
        fnt = fit(mark.short, r - l - 6, b - t - 4, False, 14 if detail else 11, 9)
        if fnt:
            halo(self.draw, (l + 4, t + 2), mark.short, fnt, PALETTE["ink"])

    def _mark_name(self, mark, _room, detail: bool) -> None:
        """A name painted on the floor, such as an aisle's."""
        self.painted(mark.x0, mark.z0, mark.short, mark.vertical, detail)

    def _off_sheet(self, box: tuple) -> bool:
        """Whether a footprint lies wholly outside the region drawn."""
        l, t, r, b = box
        return r < 0 or b < 0 or l > self.w or t > self.h

    def marks(self, detail: bool) -> None:
        """Every floor mark of this floor. Marks for detail sheets are left off the overview."""
        painters = {"text": self._mark_name, "service": self._mark_service, "circle": self._mark_circle,
                    "well": self._mark_well}
        for mark in L.MARKS:
            room = ROOM_BY_ID[mark.room]
            if room.floor != self.floor or (mark.detail and not detail) or self._off_sheet(self.of(mark)):
                continue
            painters.get(mark.shape, self._mark_box)(mark, room, detail)

    # --- multiblocks ---

    def _keep_clear(self, pad) -> None:
        """The air a controller needs in front of it, when that is more than one block."""
        cells = M.pad_front(pad, depth=0)
        xs = [c[0] for c in cells]
        zs = [c[1] for c in cells]
        kl, kt, kr, kb = self.box(min(xs), max(xs), min(zs), max(zs))
        self.draw.rectangle((kl, kt, kr, kb), fill=KEEP_CLEAR_FILL)
        dashed_rect(self.draw, (kl + 1, kt + 1, kr - 1, kb - 1), PALETTE["mark"] + (200,), 4, 3, 1)
        fnt = fit("keep clear", kr - kl - 4, kb - kt - 4, False, 11, 7)
        if fnt:
            text_center(self.draw, (kl + kr) / 2, (kt + kb) / 2, "keep clear", fnt, PALETTE["muted"])

    def _shell(self, pad, outline: tuple, width: int) -> None:
        """A shell: its ring of wall, the open floor inside, and its door."""
        for x, z in M.pad_blocks(pad):
            self.draw.rectangle(self.cell(x, z), fill=PALETTE["shell"])
        self.draw.rectangle(self.of(pad), outline=outline, width=width)
        il, it, ir, ib = self.box(pad.x0 + 1, pad.x1 - 1, pad.z0 + 1, pad.z1 - 1)
        self.draw.rectangle((il - 1, it - 1, ir + 1, ib + 1), outline=PALETTE["wall"], width=1)
        if pad.door:
            self.draw.rectangle(self.cell(*pad.door), fill=FILLS["door"])

    def _altar_tiers(self, pad, detail: bool) -> None:
        """The footprints of the smaller altars inside a T5 blood altar."""
        l, t, _r, _b = self.of(pad)
        cx, cy = self.center(*pad.box)
        for size, tier in ALTAR_TIERS:
            half = size * self.s / 2
            dashed_rect(self.draw, (cx - half, cy - half, cx + half, cy + half), ALTAR_INK + (200,), 5, 4, 1)
            if detail:
                halo(self.draw, (cx - half + 3, cy - half + 2), tier, font(11, True), ALTAR_INK)
        if detail:
            halo(self.draw, (l + 4, t + 3), "T5", font(11, True), ALTAR_INK)

    def _pad(self, pad, detail: bool) -> None:
        """One multiblock's footprint. A rust outline means it pollutes."""
        spec = MULTIS[pad.key]
        if detail and spec.front_air[0] > 1:
            self._keep_clear(pad)
        outline = PALETTE["rust"] if spec.pollution else PALETTE["wall"]
        width = 2 if (spec.pollution or detail) else 1
        if spec.shell:
            self._shell(pad, outline, width)
        else:
            self.draw.rectangle(self.of(pad), fill=PALETTE["pad"], outline=outline, width=width)
        if pad.key == BLOOD_ALTAR:
            self._altar_tiers(pad, detail)
        self.notch(pad)

    def _shell_label(self, group: list) -> None:
        """A shell's name, along the bottom of the floor inside it."""
        xa, xb, za, zb = cluster_box(group)
        il, _it, ir, ib = self.box(xa + 1, xb - 1, za + 1, zb - 1)
        label = MULTIS[group[0].key].short
        fnt = fit(label, ir - il, self.s * 1.2, True, 15, 8)
        if fnt:
            halo(self.draw, (il + 3, ib - self.s + 2), label, fnt, PALETTE["ink"])

    def _cluster_name(self, group: list) -> None:
        """A cluster's name in the middle of it, without the count when the count does not fit."""
        l, t, r, b = self.box(*cluster_box(group))
        short = MULTIS[group[0].key].short
        label = counted(cluster_count(group), short)
        fnt = fit(label, r - l - 4, b - t - 4, True, 16, 8)
        if fnt is None:
            label = short
            fnt = fit(label, r - l - 2, b - t - 2, True, 14, 7)
        if fnt:
            text_center(self.draw, *self.center(*cluster_box(group)), label, fnt, PALETTE["ink"])

    def _cluster_label(self, group: list, detail: bool) -> None:
        """One label for a cluster: a badge on the overview, its name on a detail sheet."""
        spec = MULTIS[group[0].key]
        if not detail:
            self.badge(*self.center(*cluster_box(group)), counted(cluster_count(group), spec.short))
        elif spec.shell:
            self._shell_label(group)
        else:
            self._cluster_name(group)

    def pads(self, detail: bool) -> None:
        """Every multiblock of this floor, then one label per wallshared cluster."""
        for pad in L.PADS:
            if M.floor_of(pad.y) == self.floor:
                self._pad(pad, detail)
        for group in pad_clusters():
            if M.floor_of(group[0].y) == self.floor:
                self._cluster_label(group, detail)

    def notch(self, pad) -> None:
        """A black tab on the controller face of each module."""
        for x0, x1, z0, z1, front in M.modules(pad):
            self.draw.rectangle(_tab(self.box(x0, x1, z0, z1), front, max(2, self.s // 3)), fill=PALETTE["ink"])

    def badge(self, cx, cy, label: str) -> None:
        """A dark pill with a short name in it."""
        fnt = font(10, True)
        w, _h = text_size(fnt, label)
        rx = max(7, w // 2 + 5)
        ry = 7
        self.draw.rounded_rectangle((cx - rx, cy - ry, cx + rx, cy + ry), radius=ry, fill=PALETTE["ink"])
        text_middle(self.draw, cx, cy, label, fnt, PALETTE["paper"])

    # --- machines ---

    def _tier_tag(self, m, body: tuple) -> None:
        """A machine's voltage in a corner away from its front, when it is not MV."""
        l, t, r, b = body
        fnt = font(max(7, min(9, self.s // 4)), True)
        tw, th = text_size(fnt, m.tier)
        if m.face == "e":
            at = l + 1, b - th
        elif m.face == "s":
            at = r - tw - 1, t + 1
        else:
            at = r - tw - 1, b - th
        self.draw.text(at, m.tier, font=fnt, fill=WHITE)

    def _machine(self, m, detail: bool) -> None:
        """One machine: a square in its group's color, with a white edge on its front."""
        inset = 1 if self.fine() else 2
        color = GROUP_COLORS[SINGLES[m.code].group]
        l, t, r, b = self.cell(m.x, m.z)
        body = (l + inset, t + inset, r - inset, b - inset)
        self.draw.rectangle(body, fill=color, outline=PALETTE["wall"] if detail else None)
        self.draw.rectangle(_edge_strip(body, m.face, max(1, self.s // 7) + 1), fill=MACHINE_FRONT)
        if not detail:
            return
        if m.tier != M.DEFAULT_TIER:
            self._tier_tag(m, body)
        fnt = fit(m.code, r - l - 2 * inset - 2, b - t - 2 * inset - 2, True, 11, 7)
        if fnt:
            text_center(self.draw, (l + r) / 2, (t + b) / 2 + 1, m.code, fnt, WHITE, ring=color)

    def machines(self, detail: bool) -> None:
        """Every machine of this floor that is in the region drawn."""
        for m in M.machines():
            if M.floor_of(m.y) == self.floor and self.inside(m.x, m.z):
                self._machine(m, detail)

    # --- rooms ---

    def _code_badge(self, room, detail: bool) -> tuple:
        """A room's code in its top left corner. Returns the badge's box."""
        l, t, _r, _b = self.of(room)
        fnt = font(12 if not detail else 13, True)
        bw, bh = text_size(fnt, room.code)
        bl, bt = max(l, 0) + 4, max(t, 0) + 4
        badge = (bl, bt, bl + bw + 10, bt + bh + 8)
        self.draw.rounded_rectangle(badge, radius=4, fill=PALETTE["ink"])
        text_at(self.draw, (bl + 5, bt + 4), room.code, fnt, PALETTE["paper"])
        return badge

    def _room_name(self, room, at: tuple, badge: tuple, detail: bool) -> tuple:
        """A room's name, moved clear of its code badge. Returns the name's center X and its bottom Y."""
        l, _t, r, _b = self.of(room)
        cx, cy = self.center(at[0], at[0], at[1], at[1])
        fnt = fit(room.name, (r - l) - 12, 40, True, 15 if not detail else 18, 9) or font(9, True)
        w, h = text_size(fnt, room.name)
        if cx - w / 2 < badge[2] + 6 and cy - h / 2 < badge[3] + 2 and cy + h / 2 > badge[1]:
            cx = badge[2] + 8 + w / 2
        cx = min(max(cx, l + w / 2 + 4), r - w / 2 - 4)
        text_center(self.draw, cx, cy, room.name, fnt, PALETTE["ink"])
        return cx, cy + h / 2

    def _height_tag(self, room, cx, below, detail: bool) -> None:
        """A room's height and air span under its name, when it differs from its floor's."""
        height = room.y1 - room.y0 + 1
        if height == L.FLOOR[room.floor].height:
            return
        l, _t, r, _b = self.of(room)
        tag = f"{height} high, air Y {room.y0}–{room.y1}"
        fnt = fit(tag, (r - l) - 12, 16, False, 11 if not detail else 13, 8)
        if fnt:
            _w, th = text_size(fnt, tag)
            text_center(self.draw, cx, below + th / 2 + 5, tag, fnt, PALETTE["muted"])

    def rooms(self, detail: bool) -> None:
        """Each room's code badge, name, and tags. A name never covers its badge."""
        for room in L.ROOMS:
            at = _label_cell(room)
            if room.floor != self.floor or not self.inside(*at):
                continue
            badge = self._code_badge(room, detail)
            cx, below = self._room_name(room, at, badge, detail)
            self._height_tag(room, cx, below, detail)
            if room.grade:
                _l, t, r, _b = self.of(room)
                self.roof_tag(room, r, t, detail)

    def roof_tag(self, room, r, t, detail: bool) -> None:
        """What closes a room at grade, in its top right corner."""
        text = "GLASS ROOF" if room.roof == "glass" else "BUILD THE ROOF"
        fnt = font(11 if detail else 9, True)
        w, h = text_size(fnt, text)
        color = PALETTE["glass"] if room.roof == "glass" else PALETTE["ground"]
        box = (r - w - 12, t + 4, r - 4, t + h + 10)
        self.draw.rounded_rectangle(box, radius=3, fill=PALETTE["paper"] + (230,), outline=color)
        text_at(self.draw, (box[0] + 4, box[1] + 3), text, fnt, color)

    # --- lifts ---

    def lifts(self, detail: bool) -> None:
        """Each lift that stops here: a dark block with an arrow up and an arrow down."""
        for lift in L.LIFTS:
            if self.floor not in lift.floors or not self.inside(lift.x, lift.z):
                continue
            l, t, r, b = self.cell(lift.x, lift.z)
            pad = 1 if self.fine() else 2
            self.draw.rectangle((l - pad, t - pad, r + pad, b + pad), fill=PALETTE["ink"])
            cx, cy = (l + r) / 2, (t + b) / 2
            k = max(2.0, self.s * 0.32)
            self.draw.polygon([(cx, cy - k - 1), (cx - k, cy - 1), (cx + k, cy - 1)], fill=PALETTE["paper"])
            self.draw.polygon([(cx, cy + k + 1), (cx - k, cy + 1), (cx + k, cy + 1)], fill=PALETTE["paper"])
            if detail:
                halo(self.draw, (r + pad + 4, t - 2), lift.label.upper(), font(12, True), PALETTE["ink"])

    # --- the at-grade line ---

    def _clear_below(self, x: int, z: int, room_cells: set) -> bool:
        """Whether the ten blocks ending at a cell, three rows down, are free of rooms, so a caption fits."""
        return all((x - k, z + j) not in room_cells for k in range(10) for j in range(1, 4))

    def grade_line(self) -> None:
        """Dashed line where the entrance floor's ceiling comes within COVER blocks of the ground."""
        top = L.shown_floor().air[1]
        pen = PALETTE["ground"] + (220,)
        width = 2 if self.fine() else 3
        spot = None
        room_cells = {cell for room in L.ROOMS for cell in room.cells()}
        for x in range(self.x0, self.x1 + 1):
            for z in range(self.z0, self.z1 + 1):
                here = _at_grade(x, z, top)
                l, t, r, b = self.cell(x, z)
                if z < self.z1 and _at_grade(x, z + 1, top) != here:
                    dashed(self.draw, (l, b + 0.5), (r + 1, b + 0.5), pen, 4, 3, width)
                    fits = self._clear_below(x, z, room_cells) and x <= self.x1 - 2
                    if fits and (spot is None or x > spot[0]):
                        spot = (x, z, l, b)
                if x < self.x1 and _at_grade(x + 1, z, top) != here:
                    dashed(self.draw, (r + 0.5, t), (r + 0.5, b + 1), pen, 4, 3, width)
        self.grade_label = spot

    def grade_tag(self) -> None:
        """The at-grade line's caption, under the easternmost stretch with room for it."""
        if not self.grade_label:
            return
        x, z, _l, b = self.grade_label
        fnt = font(12 if self.fine() else 14, True)
        w, _h = text_size(fnt, GRADE_TEXT)
        halo(self.draw, (self.cell(x, z)[2] - w, b + 4), GRADE_TEXT, fnt, PALETTE["ground"])

    # --- names and notes ---

    def streets(self, detail: bool) -> None:
        """Each street's name, painted where the plan puts it."""
        for street in L.STREETS:
            if street.floor != self.floor or not street.label:
                continue
            x, z = street.label_at or (street.x0 + 1, (street.z0 + street.z1) // 2)
            self.painted(x, z, street.label, street.label_vertical, detail)

    def _painted_upright(self, x: int, z: int, text: str, fnt) -> None:
        """Text turned a quarter left, centered on a cell."""
        w, h = text_size(fnt, text)
        tmp, pen = overlay(w + 10, h + 10)
        pen.text((5, 3), text, font=fnt, fill=PALETTE["muted"])
        tmp = tmp.rotate(90, expand=True, resample=Image.Resampling.BICUBIC)
        cx, cy = self.center(x, x, z, z)
        self.img.paste(tmp, (round(cx * PIXELS - tmp.size[0] / 2), round(cy * PIXELS - tmp.size[1] / 2)), tmp)

    def painted(self, x: int, z: int, text: str, vertical: bool, detail: bool) -> None:
        """A name painted on the floor: a street's, or an aisle's. Vertical text is centered on its cell."""
        if not self.inside(x, z):
            return
        fnt = font(12 if not detail else 14, True)
        if vertical:
            self._painted_upright(x, z, text, fnt)
        else:
            l, t, _r, _b = self.cell(x, z)
            halo(self.draw, (l, t), text, fnt, PALETTE["muted"])

    def callouts(self, sheet_id: str) -> None:
        """The boxed notes the plan puts on this sheet."""
        for c in L.CALLOUTS:
            if sheet_id not in c["sheets"]:
                continue
            l, t, r, b = self.box(c["x0"], c["x1"], c["z0"], c["z1"])
            dashed_rect(self.draw, (l, t, r, b), PALETTE["cut"] + (200,), 7, 5, 1)
            halo(self.draw, (l + 6, t + 6), c["title"], font(13, True), PALETTE["ink"])
            halo(self.draw, (l + 6, t + 24), c["body"], font(12), PALETTE["muted"])

    def cuts(self) -> None:
        """Where each section cuts through this plan, with the cut's letter."""
        tone = PALETTE["cut"] + (150,)
        for name, axis, value, _caption in L.CUTS:
            if axis == "x" and self.x0 <= value <= self.x1:
                px = (value - self.x0 + 0.5) * self.s
                dashed(self.draw, (px, 0), (px, self.h), tone, 4, 9, 1)
                halo(self.draw, (px + 3, 3), name, font(14, True), PALETTE["cut"])
            if axis == "z" and self.z0 <= value <= self.z1:
                py = (value - self.z0 + 0.5) * self.s
                dashed(self.draw, (0, py), (self.w, py), tone, 4, 9, 1)
                halo(self.draw, (3, py - 18), name, font(14, True), PALETTE["cut"])


def draw_plan(grid: dict, sheet: dict, region: tuple, scale: int, floor: str, level: int, detail: bool) -> Plan:
    """A plan with every layer a sheet shows, bottom layer first. The pipe crawl shows only what is dug."""
    p = Plan(grid, region, scale, floor, level)
    crawl = floor == BASEMENT
    p.cells()
    p.hatch_well()
    p.stairs()
    p.grid_lines()
    if not crawl:
        p.pollution()
    p.chunk_squares()
    p.walls()
    if not crawl:
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
