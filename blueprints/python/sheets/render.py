"""Lay the sheets out. Pillow, one square per block, no SVG.

pen.py draws in layout pixels and planview.py paints a plan. This file puts a plan on a sheet with
its rulers, its key, and its notes, and draws the sections and the mountain sheet.
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass

import layout as L
import model as M
from catalog import GROUPS, MULTIS, SINGLES
from .pen import PALETTE, canvas, dashed, dashed_rect, device, fit, font, halo, text_center, text_size, wrap
from .planview import (BASEMENT, CHUNK, CHUNK_BLUE, CHUNK_TINT, FILLS, GROUP_COLORS, Plan, cluster_count, counted,
                      draw_plan, pad_clusters)

STYLE_NAMES = {room.style: room.name for room in L.ROOMS}
STYLE_NAMES.update({"corridor": "Street", "entry": "Entrance", "door": "Door", "trench": "Pipe trench",
                    "stair": "Stairs", "well": "Shaft to the sky"})
# The order the color key lists what is dug, after the rooms.
STYLE_ORDER = ("corridor", "entry", "door", "stair", "trench", "well")

# Where a plan sits on its sheet, and the panel of notes to its right.
LEFT, TOP = 96, 176
PANEL_WIDTH = 460
PANEL_GAP = 30
OVERVIEW_SCALE = 8
NOTE_LINE = 19
KEY_COLUMN = 210
KEY_ROW = 24
SWATCH_EDGE = (170, 160, 146)
SHAFT_FILL = (90, 150, 190, 200)


# --- what every sheet has ---

def masthead(draw, subtitle: str = "GTNH 2.9.0 · MV → HV") -> None:
    """The project's name across the top of a sheet."""
    draw.text((32, 20), "Gregmatics", font=font(16, True), fill=PALETTE["ink"])
    draw.text((156, 20), subtitle, font=font(16), fill=PALETTE["muted"])


def _title_block(draw, title: str, beside: str, below: str) -> None:
    """A sheet's title, the line beside it, and the line that says how to read the drawing."""
    masthead(draw)
    draw.text((32, 46), title, font=font(30, True), fill=PALETTE["ink"])
    tw, _ = text_size(font(30, True), title)
    draw.text((52 + tw, 58), beside, font=font(15), fill=PALETTE["muted"])
    draw.text((32, 92), below, font=font(13), fill=PALETTE["muted"])


def _mount(img, draw, p: Plan) -> None:
    """Paste a plan onto its sheet, frame it, and put the rulers round it."""
    img.paste(p.img, device(LEFT, TOP))
    draw.rectangle((LEFT - 1, TOP - 1, LEFT + p.w, TOP + p.h), outline=PALETTE["wall"])
    axes(draw, (LEFT, TOP), p)
    edges(draw, (LEFT, TOP), p)


def _note_lines(sheet: dict) -> list:
    """A sheet's blurb and notes, wrapped to the panel, with a blank line after each."""
    lines = []
    for note in [sheet["blurb"], *sheet.get("notes", [])]:
        lines += wrap(note, font(14), PANEL_WIDTH - 30) + [""]
    return lines


def _notes_block(draw, px, py, lines: list):
    """The panel's heading and the notes under it. Returns the Y below them."""
    draw.text((px, py), "How to read this sheet", font=font(16, True), fill=PALETTE["ink"])
    py += 28
    for line in lines:
        draw.text((px, py), line, font=font(14), fill=PALETTE["ink"])
        py += NOTE_LINE
    return py


def _heading(draw, px, py, text: str):
    """A panel heading. Returns the Y its rows start at."""
    draw.text((px, py), text, font=font(14, True), fill=PALETTE["ink"])
    return py + 24


# --- rulers ---

def _chunk_starts(low: int, high: int) -> list:
    """The first block of each chunk between two coordinates."""
    return [v for v in range(low, high + 1) if v % CHUNK == 0]


def _chunk_spans(low: int, high: int) -> list:
    """(chunk, first block, last block) for the part of each chunk between two coordinates."""
    chunks = sorted({v >> 4 for v in range(low, high + 1)})
    return [(c, max(c * CHUNK, low), min(c * CHUNK + CHUNK - 1, high)) for c in chunks]


def _chunk_marks(draw, origin: tuple, p: Plan) -> None:
    """A blue square and the coordinate at the first column, and the first row, of each chunk."""
    ox, oy = origin
    tick = font(11)
    for x in _chunk_starts(p.x0, p.x1):
        left = ox + (x - p.x0) * p.s
        draw.rectangle((left, oy - p.s, left + p.s - 1, oy - 1), fill=CHUNK_BLUE)
        text_center(draw, left + p.s / 2, oy - p.s - 12, str(x), tick, PALETTE["ink"])
    for z in _chunk_starts(p.z0, p.z1):
        top = oy + (z - p.z0) * p.s
        draw.rectangle((ox - p.s, top, ox - 1, top + p.s - 1), fill=CHUNK_BLUE)
        w, _h = text_size(tick, str(z))
        text_center(draw, ox - p.s - 6 - w / 2, top + p.s / 2, str(z), tick, PALETTE["ink"])


def _chunk_names(draw, origin: tuple, p: Plan) -> None:
    """Each chunk column's letter along the top, and each chunk row's number down the side."""
    ox, oy = origin
    chunk_font = font(14, True)
    widest = max((text_size(font(11), str(z))[0] for z in _chunk_starts(p.z0, p.z1)), default=0)
    for cx, xa, xb in _chunk_spans(p.x0, p.x1):
        letter = M.chunk_letter(cx)
        if xb - xa >= 3 and letter:
            mid = ox + ((xa + xb + 1) / 2 - p.x0) * p.s
            text_center(draw, mid, oy - p.s - 12, letter, chunk_font, PALETTE["ink"], PALETTE["paper"])
    for cz, za, zb in _chunk_spans(p.z0, p.z1):
        number = M.chunk_number(cz)
        if zb - za >= 3 and number:
            mid = oy + ((za + zb + 1) / 2 - p.z0) * p.s
            text_center(draw, ox - p.s - 18 - widest, mid, str(number), chunk_font, PALETTE["ink"], PALETTE["paper"])


def axes(draw, origin: tuple, p: Plan) -> None:
    """The first column and first row of each chunk, with the in-game coordinate.

    The marked square is a multiple of 16, and the number is that block.
    The Z number is the square itself.
    """
    _chunk_marks(draw, origin, p)
    _chunk_names(draw, origin, p)


def edges(draw, origin: tuple, p: Plan) -> None:
    """A frame on the four edges of the sheet, labeled with the block there.

    West and east are X. North and south are Z.
    """
    ox, oy = origin
    ink = PALETTE["cut"]
    fnt = font(13, True)
    draw.rectangle((ox - 4, oy - 4, ox + p.w + 3, oy + p.h + 3), outline=ink, width=2)
    mid = ox + p.w / 2
    for y, z in ((oy - p.s - 30, p.z0), (oy + p.h + 14, p.z1)):
        text_center(draw, ox, y, f"X {p.x0}", fnt, ink)
        text_center(draw, mid, y, f"Z {z}", fnt, ink)
        text_center(draw, ox + p.w, y, f"X {p.x1}", fnt, ink)


# --- the color key and the schedule ---

def legend_styles(p: Plan) -> list:
    """The styles a plan shows, rooms first, in the order the key lists them."""
    present = {style for _x, _z, style in p.dug()}
    order = [room.style for room in L.ROOMS] + list(STYLE_ORDER)
    return [style for style in order if style in present]


def machines_in(p: Plan) -> list:
    """The machine codes a plan shows, each once, in the order they are met."""
    found = []
    for m in M.machines():
        if M.floor_of(m.y) == p.floor and p.inside(m.x, m.z) and m.code not in found:
            found.append(m.code)
    return found


def pads_in(p: Plan) -> list:
    """The multiblocks whose middle is on a plan."""
    return [pad for pad in L.PADS
            if M.floor_of(pad.y) == p.floor and p.inside((pad.x0 + pad.x1) // 2, (pad.z0 + pad.z1) // 2)]


def _color_key(draw, p: Plan, styles: list) -> None:
    """A swatch and a name for each style the plan shows, in columns under it."""
    columns = max(1, p.w // KEY_COLUMN)
    ky = TOP + p.h + 34
    draw.text((LEFT, ky), "Colors", font=font(13, True), fill=PALETTE["ink"])
    for i, style in enumerate(styles):
        sx, sy = LEFT + (i % columns) * KEY_COLUMN, ky + 22 + (i // columns) * KEY_ROW
        draw.rectangle((sx, sy, sx + 16, sy + 16), fill=FILLS[style], outline=SWATCH_EDGE)
        draw.text((sx + 22, sy - 1), STYLE_NAMES.get(style, style), font=font(13), fill=PALETTE["ink"])


def _key_height(p: Plan, styles: list) -> int:
    """How tall the color key under a plan is."""
    columns = max(1, p.w // KEY_COLUMN)
    return 40 + ((len(styles) + columns - 1) // columns) * KEY_ROW


SYMBOLS = [
    ("pad", "Multiblock footprint, named on the drawing"),
    ("rust", "Rust outline: this multiblock pollutes"),
    ("notch", "Black tab: the controller face"),
    ("machine", "Colored square: singleblock; the white edge is its front"),
    ("dashed", "Dashed box: a floor mark, not a wall"),
    ("lift", "Lift: an elevator block on every floor it serves"),
]


def _symbol_pad(draw, x, y, kind: str) -> None:
    """A multiblock footprint, with a rust outline or a controller tab when the row is about one."""
    outline = PALETTE["rust"] if kind == "rust" else PALETTE["wall"]
    draw.rectangle((x, y + 1, x + 16, y + 15), fill=PALETTE["pad"], outline=outline, width=2)
    if kind == "notch":
        draw.rectangle((x + 5, y + 1, x + 11, y + 4), fill=PALETTE["ink"])


def _symbol_machine(draw, x, y, _kind: str) -> None:
    """A singleblock with its white front edge."""
    draw.rectangle((x + 1, y + 2, x + 15, y + 15), fill=GROUP_COLORS["form"])
    draw.rectangle((x + 1, y + 13, x + 15, y + 15), fill=(255, 255, 255))


def _symbol_lift(draw, x, y, _kind: str) -> None:
    """A lift block with its two arrows."""
    draw.rectangle((x + 2, y + 2, x + 14, y + 14), fill=PALETTE["ink"])
    draw.polygon([(x + 8, y + 3), (x + 4, y + 7), (x + 12, y + 7)], fill=PALETTE["paper"])
    draw.polygon([(x + 8, y + 13), (x + 4, y + 9), (x + 12, y + 9)], fill=PALETTE["paper"])


def _symbol_dashed(draw, x, y, _kind: str) -> None:
    """A floor mark's dashed box."""
    dashed_rect(draw, (x, y + 1, x + 16, y + 15), PALETTE["mark"], 3, 2, 1)


_SYMBOL_PAINTERS = {"pad": _symbol_pad, "rust": _symbol_pad, "notch": _symbol_pad, "machine": _symbol_machine,
                    "lift": _symbol_lift}


def symbol(draw, x, y, kind: str) -> None:
    """One row of the symbol key: the symbol, then what it means."""
    _SYMBOL_PAINTERS.get(kind, _symbol_dashed)(draw, x, y, kind)
    draw.text((x + 24, y), dict(SYMBOLS)[kind], font=font(13), fill=PALETTE["muted"])


def _pad_line(group: list) -> str:
    """One cluster as the schedule lists it: its count, name, size, label, and whether it pollutes."""
    lead = group[0]
    spec = MULTIS[lead.key]
    w, d = lead.size
    count = cluster_count(group)
    extra = f" · {lead.label}" if lead.label and count == 1 else ""
    smoke = " · pollutes" if spec.pollution else ""
    return counted(count, spec.name) + f" {w}×{d}×{M.pad_height(lead)}{extra}{smoke}"


def _pad_rows(p: Plan) -> list:
    """The multiblocks a plan shows, one wrapped entry per cluster."""
    shown = {pad.num for pad in pads_in(p)}
    if not shown:
        return []
    rows = [("Multiblocks", "head", 24)]
    for group in pad_clusters():
        group = [pad for pad in group if pad.num in shown]
        if group:
            rows += [(line, "text", 18) for line in wrap(_pad_line(group), font(13), 440)]
    return rows


def _machine_rows(p: Plan, detail: bool) -> list:
    """The machines a plan shows by group: each code on a detail sheet, the names in a line on an overview."""
    codes = machines_in(p)
    if not codes:
        return []
    groups: dict = {}
    for code in codes:
        groups.setdefault(SINGLES[code].group, []).append(code)
    rows = [("Machines", "head", 24)]
    for group, members in groups.items():
        color = GROUP_COLORS[group]
        if detail:
            rows += [((code, SINGLES[code].name, color), "chip", 18) for code in members]
        else:
            rows.append(((GROUPS[group], color), "group", 18))
            names = ", ".join(SINGLES[code].name for code in members)
            rows += [(f"    {line}", "text", 17) for line in wrap(names, font(13), 420)]
    return rows


def _symbol_rows(p: Plan) -> list:
    """The symbol key. The lift's row is left out of a plan that shows no lift."""
    if p.floor == BASEMENT:
        return []
    has_lift = any(p.floor in lift.floors and p.inside(lift.x, lift.z) for lift in L.LIFTS)
    rows = [("Symbols", "head", 24)]
    rows += [(kind, "symbol", 20) for kind, _label in SYMBOLS if kind != "lift" or has_lift]
    return rows


def _wall_rows(p: Plan) -> list:
    """Each machine row a detail sheet shows, slot by slot."""
    walls = [wall for wall in L.WALLS if M.floor_of(wall.y) == p.floor and p.inside(wall.x, wall.z)]
    if not walls:
        return []
    rows = [("Walls, in order", "head", 24)]
    for wall in walls:
        codes = " ".join(code or "·" for code in wall.codes)
        rows += [(f"{wall.id}  {wall.title}", "text", 17), (f"      {codes}", "text", 18)]
    return rows


def schedule(p: Plan, detail: bool) -> list:
    """The panel's lists as (content, kind, height) rows: multiblocks, machines, symbols, and machine rows."""
    rows = _pad_rows(p) + _machine_rows(p, detail) + _symbol_rows(p)
    if detail:
        rows += _wall_rows(p)
    return rows


def _swatch(draw, px, py, color: tuple) -> None:
    """A machine group's color chip."""
    draw.rectangle((px, py + 3, px + 14, py + 15), fill=color, outline=PALETTE["wall"])


def _row_head(draw, px, py, text: str) -> None:
    """A heading in the schedule."""
    draw.text((px, py + 4), text, font=font(14, True), fill=PALETTE["ink"])


def _row_chip(draw, px, py, content: tuple) -> None:
    """A machine: its group's chip, its code, and its name."""
    code, label, color = content
    _swatch(draw, px, py, color)
    draw.text((px + 20, py), code, font=font(13, True), fill=PALETTE["ink"])
    draw.text((px + 60, py), label, font=font(13), fill=PALETTE["muted"])


def _row_group(draw, px, py, content: tuple) -> None:
    """A machine group: its chip and its name."""
    name, color = content
    _swatch(draw, px, py, color)
    draw.text((px + 20, py), name, font=font(13, True), fill=PALETTE["ink"])


def _row_text(draw, px, py, text: str) -> None:
    """A plain line of the schedule."""
    draw.text((px, py), text, font=font(13), fill=PALETTE["muted"])


_ROW_PAINTERS = {"head": _row_head, "chip": _row_chip, "group": _row_group, "symbol": symbol}


def _schedule_block(draw, px, py, rows: list) -> None:
    """Paint the schedule's rows down the panel."""
    for content, kind, height in rows:
        _ROW_PAINTERS.get(kind, _row_text)(draw, px, py, content)
        py += height


# --- a floor's sheet ---

def _sheet_region(sheet: dict) -> tuple:
    """The (region, scale) a sheet draws: its own on a detail sheet, the whole sheet area otherwise."""
    if sheet["kind"] == "detail":
        return tuple(sheet["region"]), sheet["scale"]
    return (L.X_MIN, L.X_MAX, L.Z_MIN, L.Z_MAX), OVERVIEW_SCALE


def sheet_image(grid: dict, sheet: dict, index: int, total: int):
    """One floor's sheet: the plan, its color key, and the panel that says how to read it."""
    detail = sheet["kind"] == "detail"
    floor, level = L.sheet_level(sheet)
    region, scale = _sheet_region(sheet)
    p = draw_plan(grid, sheet, region, scale, floor, level, detail)
    styles = legend_styles(p)
    notes = _note_lines(sheet)
    rows = schedule(p, detail)
    panel_h = 40 + len(notes) * NOTE_LINE + sum(height for _c, _k, height in rows) + 40
    width = LEFT + p.w + PANEL_GAP + PANEL_WIDTH
    height = max(TOP + p.h + _key_height(p, styles) + 46, TOP + panel_h)
    img, draw = canvas(width, height, PALETTE["paper"])
    _title_block(draw, sheet["title"], f"Cut at Y={level}    Sheet {index} of {total}",
                 "1 square = 1 block · north is up · blue squares are a chunk's first column and row")
    _mount(img, draw, p)
    _color_key(draw, p, styles)
    px = LEFT + p.w + PANEL_GAP
    _schedule_block(draw, px, _notes_block(draw, px, TOP, notes), rows)
    return img.convert("RGB")


# --- sections ---

SECTION_SCALE = 6
SECTION_MARGIN = 92
SECTION_LABEL = 44
SECTION_GAP = 44
LEVEL_LINE = (176, 150, 126, 150)
# A run of one style smaller than this many blocks gets no name on a section.
NAMED_RUN = 30


def level_lines() -> list[tuple]:
    """(Y, what it is) for the dashed lines on the sections: each floor's slab and ceiling, and the crawl."""
    lines = []
    for floor in L.FLOORS:
        lines.append((floor.slab, floor.name.lower()))
        lines.append((floor.air[1], f"{floor.name.lower()} ceiling"))
    for crawl in L.CRAWLS:
        lines.append((crawl["air"][0], crawl["name"].lower()))
    return sorted(lines)


@dataclass(frozen=True)
class Cut:
    """One section through the base: the columns it passes, the ground over them, and where it is drawn."""

    axis: str
    at: int
    cols: list
    ground: list
    top: float
    y0: int
    y1: int

    def style(self, grid: dict, col: int, y: int) -> str:
        """What dug the block at one column of the cut."""
        return M.style_at(grid, self.at, col, y) if self.axis == "x" else M.style_at(grid, col, self.at, y)

    def left(self, i: int):
        """The left edge of a column, in pixels."""
        return SECTION_MARGIN + i * SECTION_SCALE

    def row(self, y):
        """The top edge of a Y, in pixels."""
        return self.top + (self.y1 - y) * SECTION_SCALE

    @property
    def right(self):
        """The right edge of the last column."""
        return SECTION_MARGIN + len(self.cols) * SECTION_SCALE

    @property
    def height(self) -> int:
        """How tall the section is, in pixels."""
        return (self.y1 - self.y0 + 1) * SECTION_SCALE


def _section_band() -> tuple:
    """The lowest and highest Y the sections show."""
    y0 = min(floor.slab for floor in L.FLOORS) - 4
    y1 = max(100, max(floor.air[1] for floor in L.FLOORS) + 19)
    return y0, y1


def _cut_columns(axis: str) -> list:
    """The coordinates a cut runs through: Z along a cut at one X, X along a cut at one Z."""
    return list(range(L.Z_MIN, L.Z_MAX + 1)) if axis == "x" else list(range(L.X_MIN, L.X_MAX + 1))


def _cut_ground(axis: str, at: int, cols: list) -> list:
    """The estimated ground Y over each column of a cut."""
    return [M.surface(at, c) if axis == "x" else M.surface(c, at) for c in cols]


def _cut_heading(draw, name: str, axis: str, at: int, caption: str, top, width):
    """A cut's letter and what it passes through. Returns the Y its drawing starts at."""
    draw.text((SECTION_MARGIN, top), f"Cut {name}", font=font(18, True), fill=PALETTE["cut"])
    looking = (f"X={at}, looking east; north is on the left" if axis == "x"
               else f"Z={at}, looking north; west is on the left")
    lines = wrap(f"{caption}. {looking}.", font(14), width - SECTION_MARGIN - 96)
    for k, line in enumerate(lines):
        draw.text((SECTION_MARGIN + 76, top + 4 + 18 * k), line, font=font(14), fill=PALETTE["ink"])
    return top + SECTION_LABEL + 18 * (len(lines) - 1)


def _cut_fill(style: str, y: int, ground) -> tuple:
    """The color of one block of a section: what dug it, sky above the ground, or rock."""
    if style != M.ROCK:
        return FILLS[style]
    return PALETTE["sky"] if y > ground else FILLS[M.ROCK]


def _cut_cells(draw, grid: dict, cut: Cut) -> dict:
    """Paint every block of a section. Returns the style at each (column index, Y)."""
    ss = SECTION_SCALE
    samples = {}
    for y in range(cut.y0, cut.y1 + 1):
        py = cut.row(y)
        for i, c in enumerate(cut.cols):
            style = cut.style(grid, c, y)
            samples[(i, y)] = style
            box = (cut.left(i), py, cut.left(i + 1) - 1, py + ss - 1)
            draw.rectangle(box, fill=_cut_fill(style, y, cut.ground[i]))
            if c % CHUNK == 0:
                draw.rectangle(box, fill=CHUNK_TINT)
    return samples


def _cut_ground_line(draw, cut: Cut) -> None:
    """The ground estimate as a brown line, broken where it leaves the top of the frame."""
    ss = SECTION_SCALE
    run = []
    for i, g in enumerate(cut.ground + [cut.y1 + 1]):
        if g <= cut.y1 + 0.5:
            run.append((SECTION_MARGIN + (i + 0.5) * ss, cut.top + (cut.y1 - g + 0.5) * ss))
            continue
        if len(run) > 1:
            draw.line(run, fill=PALETTE["ground"], width=2)
        run = []
    if max(cut.ground) > cut.y1:
        halo(draw, (SECTION_MARGIN + 6, cut.top + 4), f"Ground up to ≈Y {max(cut.ground):.0f}, above the frame",
             font(12, True), PALETTE["ground"])


def _cut_levels(draw, cut: Cut) -> None:
    """A dashed line and its Y at each floor's slab and ceiling, and at the crawl."""
    for mark, _what in level_lines():
        py = cut.row(mark) + SECTION_SCALE / 2
        dashed(draw, (SECTION_MARGIN, py), (cut.right, py), LEVEL_LINE, 5, 8, 1)
        draw.text((18, py - 8), f"Y{mark}", font=font(12), fill=PALETTE["muted"])


def _cut_chunk_marks(draw, cut: Cut) -> None:
    """A blue square and the coordinate under the first column of each chunk."""
    ss = SECTION_SCALE
    below = cut.top + cut.height
    for i, c in enumerate(cut.cols):
        if c % CHUNK == 0:
            left = cut.left(i)
            draw.rectangle((left, below + 4, left + ss - 1, below + 3 + ss), fill=CHUNK_BLUE)
            text_center(draw, left + ss / 2, below + ss + 16, str(c), font(11), PALETTE["ink"])


def _run(samples: dict, start: tuple, seen: set) -> list:
    """The blocks of a section that join one block and share its style."""
    style = samples[start]
    bag = []
    queue = deque([start])
    seen.add(start)
    while queue:
        col, y = queue.popleft()
        bag.append((col, y))
        for nxt in ((col + 1, y), (col - 1, y), (col, y + 1), (col, y - 1)):
            if nxt not in seen and samples.get(nxt) == style:
                seen.add(nxt)
                queue.append(nxt)
    return bag


def _name_run(draw, bag: list, style: str, left, top, ss, y1) -> None:
    """A run's name in the middle of it, when a font small enough fits."""
    cols = [c for c, _ in bag]
    ys = [y for _, y in bag]
    w = (max(cols) - min(cols) + 1) * ss - 4
    h = (max(ys) - min(ys) + 1) * ss - 2
    name = STYLE_NAMES.get(style, style)
    fnt = fit(name, w, h, True, 13, 8)
    if fnt:
        cx = left + (min(cols) + max(cols) + 1) / 2 * ss
        cy = top + (y1 - (min(ys) + max(ys)) / 2) * ss + ss / 2
        text_center(draw, cx, cy, name, fnt, PALETTE["ink"])


def label_runs(draw, samples: dict, left, top, ss, y1) -> None:
    """Name each large run of one style on a section. Rock and doors go unnamed."""
    seen: set = set()
    for key, style in samples.items():
        if key in seen or style in (M.ROCK, "door"):
            continue
        bag = _run(samples, key, seen)
        if len(bag) >= NAMED_RUN:
            _name_run(draw, bag, style, left, top, ss, y1)


def _section(draw, grid: dict, cut: Cut) -> None:
    """One section: its blocks, the ground, the level lines, the chunk marks, and the names."""
    samples = _cut_cells(draw, grid, cut)
    _cut_ground_line(draw, cut)
    draw.rectangle((SECTION_MARGIN - 1, cut.top - 1, cut.right, cut.top + cut.height), outline=PALETTE["wall"])
    _cut_levels(draw, cut)
    _cut_chunk_marks(draw, cut)
    label_runs(draw, samples, SECTION_MARGIN, cut.top, SECTION_SCALE, cut.y1)


def _sections_title(draw, y0: int, y1: int) -> None:
    """The sections sheet's title and the range it shows."""
    masthead(draw, "GTNH 2.9.0")
    draw.text((32, 46), "Sections", font=font(30, True), fill=PALETTE["ink"])
    names = [cut[0] for cut in L.CUTS]
    span = f"{names[0]}–{names[-1]}" if len(names) > 1 else names[0]
    draw.text((200, 58), f"Cuts {span}, Y={y0} to Y={y1}. The brown line is the estimated ground.", font=font(15),
              fill=PALETTE["muted"])


def sections(grid: dict):
    """Every cut through the base, one under another."""
    y0, y1 = _section_band()
    sec_h = (y1 - y0 + 1) * SECTION_SCALE
    length = max(L.X_MAX - L.X_MIN, L.Z_MAX - L.Z_MIN) + 1
    width = SECTION_MARGIN + length * SECTION_SCALE + 60
    height = 120 + len(L.CUTS) * (SECTION_LABEL + 18 + sec_h + SECTION_GAP) + 30
    img, draw = canvas(width, height, PALETTE["paper"])
    _sections_title(draw, y0, y1)
    top = 110
    for name, axis, at, caption in L.CUTS:
        top = _cut_heading(draw, name, axis, at, caption, top, width)
        cols = _cut_columns(axis)
        _section(draw, grid, Cut(axis, at, cols, _cut_ground(axis, at, cols), top, y0, y1))
        top += sec_h + SECTION_GAP
    legend = "Dashed lines: " + ", ".join(f"Y{y} {what}" for y, what in level_lines()) + "."
    for k, line in enumerate(wrap(legend, font(13), width - SECTION_MARGIN - 40)):
        draw.text((SECTION_MARGIN, top - 10 + 18 * k), line, font=font(13), fill=PALETTE["muted"])
    return img.convert("RGB")


# --- the mountain sheet ---

# Ground colors, one band per 9 blocks, matching the contour screenshot's bands.
BAND_BASE, BAND_STEP = 71, 9
BAND_STOPS = [(71, (204, 226, 196)), (110, (226, 233, 200)), (150, (240, 232, 204)), (185, (236, 220, 192)),
              (222, (224, 204, 176))]
CONTOUR_LINE = (124, 100, 76, 120)
TERRAIN_CHUNK_LINE = (150, 132, 108, 70)
TERRAIN_SCALE = 5
PROFILE_SCALE = 3
# The band of Y the profiles show, from below the lowest floor to above the summit.
PROFILE_Y0, PROFILE_Y1 = 40, 226
PROFILE_GAP = 70
PROFILE_MARKS = {100, 150, 200, 220}
PROFILE_LINE = (150, 130, 106, 110)
THIN_ROOFS = 6


def band(y) -> int:
    """Which color band a ground height falls in."""
    return int((y - BAND_BASE) // BAND_STEP)


def band_color(y) -> tuple:
    """The color of a ground height's band, blended between the stops."""
    mid = BAND_BASE + BAND_STEP * band(y) + BAND_STEP / 2
    for (ya, ca), (yb, cb) in zip(BAND_STOPS, BAND_STOPS[1:]):
        if mid <= yb or (yb, cb) == BAND_STOPS[-1]:
            t = min(max((mid - ya) / (yb - ya), 0.0), 1.0)
            return tuple(round(a + (b - a) * t) for a, b in zip(ca, cb))
    return BAND_STOPS[0][1]


def _ground_bands(p: Plan) -> None:
    """Color every block by its ground height, with a contour line where the band changes."""
    heights = {(x, z): M.surface(x, z) for x in range(p.x0, p.x1 + 1) for z in range(p.z0, p.z1 + 1)}
    for (x, z), y in heights.items():
        p.draw.rectangle(p.cell(x, z), fill=band_color(y))
    for (x, z), y in heights.items():
        l, t, r, b = p.cell(x, z)
        if (x + 1, z) in heights and band(heights[(x + 1, z)]) != band(y):
            p.draw.line([(r, t), (r, b)], fill=CONTOUR_LINE)
        if (x, z + 1) in heights and band(heights[(x, z + 1)]) != band(y):
            p.draw.line([(l, b), (r, b)], fill=CONTOUR_LINE)


def _room_outline(p: Plan, room, entrance) -> None:
    """A room in its floor's pen: solid on the entrance floor, dashed on the others, tinted at grade."""
    floor = L.FLOOR[room.floor]
    l, t, r, b = p.of(room)
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
        cx, cy = p.center(*room.box)
        text_center(p.draw, cx, cy + (10 if floor.slab > entrance.slab else 0), room.code, fnt, pen)


def _ground_estimates(p: Plan) -> None:
    """The estimated ground Y of each chunk, in its corner."""
    for r, row in enumerate(M.TERRAIN):
        for c, value in enumerate(row):
            xa, _xb, za, _zb = M.chunk_bounds(f"{L.COLUMNS[c]}{r + 1}")
            l, t, _r, _b = p.cell(max(xa, p.x0), max(za, p.z0))
            halo(p.draw, (l + 4, t + 3), f"≈{value}", font(11, True), PALETTE["ground"])


def terrain_plan(grid: dict, scale: int) -> Plan:
    """The whole site from above: the ground's height, and every floor's rooms over it."""
    entrance = L.shown_floor()
    p = Plan(grid, (L.X_MIN, L.X_MAX, L.Z_MIN, L.Z_MAX), scale, entrance.id, entrance.walk)
    _ground_bands(p)
    p.chunk_lines(TERRAIN_CHUNK_LINE)
    p.chunk_squares()
    order = [floor.id for floor in L.FLOORS]
    for room in sorted(L.ROOMS, key=lambda room: order.index(room.floor)):
        _room_outline(p, room, entrance)
    for shaft in L.SHAFTS:
        p.draw.rectangle(p.of(shaft), fill=SHAFT_FILL)
    for lift in L.LIFTS:
        l, t, r, b = p.cell(lift.x, lift.z)
        p.draw.rectangle((l - 2, t - 2, r + 2, b + 2), fill=PALETTE["ink"])
    p.grade_line()
    _ground_estimates(p)
    p.grade_tag()
    return p


def _profile_fill(style: str, y: int, ground):
    """The color of one block of a profile, or None where it is left as rock."""
    if style != M.ROCK:
        return FILLS[style]
    return PALETTE["sky"] if y > ground else None


def long_section(grid: dict, x: int, ss: int, y0: int, y1: int) -> tuple:
    """North–south profile at one X, from below the lower floor to above the summit."""
    cols = list(range(L.Z_MIN, L.Z_MAX + 1))
    img, draw = canvas(len(cols) * ss, (y1 - y0 + 1) * ss, FILLS[M.ROCK])
    ground = [M.surface(x, z) for z in cols]
    for i, z in enumerate(cols):
        for y in range(y0, y1 + 1):
            fill = _profile_fill(M.style_at(grid, x, z, y), y, ground[i])
            if fill is not None:
                py = (y1 - y) * ss
                draw.rectangle((i * ss, py, (i + 1) * ss - 1, py + ss - 1), fill=fill)
    draw.line([((i + 0.5) * ss, (y1 - g + 0.5) * ss) for i, g in enumerate(ground)], fill=PALETTE["ground"],
              width=2)
    for lift in L.LIFTS:
        if lift.x == x:
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


def _thin_roofs() -> list:
    """(blocks of rock, room) for the rooms with the least rock over them, thinnest first."""
    covers = [(min(M.cover(x, z, room.y1) for x, z in room.cells()), room) for room in L.ROOMS]
    return sorted(covers, key=lambda item: item[0])[:THIN_ROOFS]


def _swatch_box(px, py) -> tuple:
    """Where a key row's swatch goes."""
    return px, py + 2, px + 16, py + 14


def _key_solid(pen: tuple):
    """A swatch painter: a solid outline, as rooms on the entrance floor are drawn."""
    return lambda draw, px, py: draw.rectangle(_swatch_box(px, py), outline=pen, width=2)


def _key_dashed(pen: tuple):
    """A swatch painter: a dashed outline, as rooms on the other floors are drawn."""
    return lambda draw, px, py: dashed_rect(draw, _swatch_box(px, py), pen, 4, 3, 2)


def _key_fill(color: tuple):
    """A swatch painter: a filled square."""
    return lambda draw, px, py: draw.rectangle(_swatch_box(px, py), fill=color)


def _key_grade(draw, px, py) -> None:
    """A swatch: the dashed at-grade line."""
    dashed(draw, (px, py + 8), (px + 16, py + 8), PALETTE["ground"], 4, 3, 2)


def _terrain_keys(p: Plan) -> list:
    """(swatch painter, text) for each line and fill the mountain sheet uses."""
    entrance = L.shown_floor()
    roofs = {room.roof for room in L.ROOMS if room.grade}
    keys = [(_key_solid(L.rgb(entrance.pen)), f"{entrance.name} room, Y={entrance.slab}")]
    keys += [(_key_dashed(L.rgb(f.pen)), f"{f.name} room, Y={f.slab}") for f in reversed(L.FLOORS) if f.id != entrance.id]
    keys.append((_key_fill(SHAFT_FILL), "Shaft to the sky"))
    if "glass" in roofs:
        keys.append((_key_fill(PALETTE["glass"] + (90,)), "At grade, glass roof"))
    if "built" in roofs:
        keys.append((_key_fill(PALETTE["ground"] + (80,)), "At grade, build a solid roof"))
    if p.grade_label:
        keys.append((_key_grade, f"{entrance.name} reaches grade past here"))
    return keys


def _keys_block(draw, px, py, keys: list):
    """The key to the sheet's lines and fills. Returns the Y below it."""
    py = _heading(draw, px, py, "Lines and fills")
    for paint, text in keys:
        paint(draw, px, py)
        draw.text((px + 24, py), text, font=font(13), fill=PALETTE["muted"])
        py += 20
    return py + 8


def _bands_block(draw, px, py):
    """The key to the ground's color bands. Returns the Y below it."""
    py = _heading(draw, px, py, "Ground height")
    for k in range(0, 17, 2):
        ya = BAND_BASE + BAND_STEP * k
        draw.rectangle(_swatch_box(px, py), fill=band_color(ya + 1), outline=SWATCH_EDGE)
        draw.text((px + 24, py), f"Y {ya}–{ya + BAND_STEP - 1}", font=font(13), fill=PALETTE["muted"])
        py += 18
    return py + 8


def _roof_note(room, least) -> str:
    """What a room has overhead: its rock, or the roof it needs at grade."""
    if not room.grade:
        return f"{least:.0f}"
    return "at grade, glass roof" if room.roof == "glass" else "at grade, build the roof"


def _roofs_block(draw, px, py, thin: list):
    """The rooms with the least rock overhead. Returns the Y below them."""
    py = _heading(draw, px, py, "Thinnest roofs, blocks of rock over the ceiling")
    for least, room in thin:
        draw.text((px, py), f"{room.name}", font=font(13), fill=PALETTE["ink"])
        draw.text((px + 200, py), _roof_note(room, least), font=font(13), fill=PALETTE["muted"])
        py += 18
    return py


def _checks_block(draw, px, py, checks: list) -> None:
    """Where to read the real ground before digging a shaft."""
    if not checks:
        return
    py = _heading(draw, px, py + 8, "Read the ground with F3 before digging")
    for line in checks:
        draw.text((px, py), line, font=font(13), fill=PALETTE["muted"])
        py += 18


def _profile(img, draw, x: int, section, ground: list, sx, top) -> None:
    """One north–south profile with its heading, its Y lines, and its chunk coordinates."""
    ss, y1 = PROFILE_SCALE, PROFILE_Y1
    sec_w = (L.Z_MAX - L.Z_MIN + 1) * ss
    sec_h = (PROFILE_Y1 - PROFILE_Y0 + 1) * ss
    draw.text((sx, top - 44), f"Profile at X={x}", font=font(16, True), fill=PALETTE["cut"])
    draw.text((sx, top - 22), f"Ground from ≈Y {ground[0]:.0f} at the north edge to ≈Y {ground[-1]:.0f} at "
                              "the south edge", font=font(12), fill=PALETTE["muted"])
    img.paste(section, device(sx, top))
    draw.rectangle((sx - 1, top - 1, sx + sec_w, top + sec_h), outline=PALETTE["wall"])
    for mark in sorted({floor.slab for floor in L.FLOORS} | PROFILE_MARKS):
        yy = top + (y1 - mark) * ss + ss / 2
        dashed(draw, (sx, yy), (sx + sec_w, yy), PROFILE_LINE, 4, 6, 1)
        draw.text((sx - 40, yy - 8), f"Y{mark}", font=font(11), fill=PALETTE["muted"])
    for i, z in enumerate(range(L.Z_MIN, L.Z_MAX + 1)):
        if z % CHUNK == 0:
            text_center(draw, sx + (i + 0.5) * ss, top + sec_h + 12, str(z), font(10), PALETTE["ink"])


def _terrain_panel(draw, px, notes: list, keys: list, thin: list, checks: list) -> None:
    """The mountain sheet's panel: its notes, its keys, the thinnest roofs, and the shaft checks."""
    py = _notes_block(draw, px, TOP, notes)
    py = _keys_block(draw, px, py, keys)
    py = _bands_block(draw, px, py)
    py = _roofs_block(draw, px, py, thin)
    _checks_block(draw, px, py, checks)


def _terrain_panel_height(notes: list, keys: list, thin: list, checks: list) -> int:
    """How tall the mountain sheet's panel is."""
    return (28 + len(notes) * NOTE_LINE + 24 + len(keys) * 20 + 32 + 9 * 18 + 32 + len(thin) * 18
            + 32 + len(checks) * 18)


def terrain_sheet(grid: dict, sheet: dict, index: int, total: int):
    """The mountain sheet: every floor over the ground's height, and profiles through the summit."""
    p = terrain_plan(grid, TERRAIN_SCALE)
    profiles = [(x, *long_section(grid, x, PROFILE_SCALE, PROFILE_Y0, PROFILE_Y1)) for x in sheet.get("profiles", ())]
    notes, keys, thin, checks = _note_lines(sheet), _terrain_keys(p), _thin_roofs(), shaft_checks()
    sec_w = (L.Z_MAX - L.Z_MIN + 1) * PROFILE_SCALE
    sec_h = (PROFILE_Y1 - PROFILE_Y0 + 1) * PROFILE_SCALE
    width = max(LEFT + p.w + PANEL_GAP + PANEL_WIDTH, LEFT + len(profiles) * (sec_w + PROFILE_GAP) + 40)
    sec_top = max(TOP + p.h, TOP + _terrain_panel_height(notes, keys, thin, checks)) + 90
    height = sec_top + sec_h + 110
    img, draw = canvas(width, height, PALETTE["paper"])
    _title_block(draw, sheet["title"], f"Every floor    Sheet {index} of {total}",
                 "Plan: 1 square = 1 block, north is up, colors are ground height · profiles: north is "
                 "on the left")
    _mount(img, draw, p)
    _terrain_panel(draw, LEFT + p.w + PANEL_GAP, notes, keys, thin, checks)
    for n, (x, section, ground) in enumerate(profiles):
        _profile(img, draw, x, section, ground, LEFT + n * (sec_w + PROFILE_GAP), sec_top)
    draw.text((LEFT, height - 40), "Profiles show what each floor cuts at that X, from Y 40 up to Y 226. Blue is "
                                   "open air above the estimated ground.", font=font(13), fill=PALETTE["muted"])
    return img.convert("RGB")
