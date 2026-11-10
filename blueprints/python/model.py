"""Voxel model of the base: per-column spans of air, tagged with what dug them."""

from __future__ import annotations

import math
from collections import deque
from dataclasses import replace
from typing import Iterator

import layout as L
from catalog import MULTIS
from schema import DIRS, OPPOSITE, Machine, Pad

# The style of a cell nothing has dug.
ROCK = "rock"
ROOM_STYLES = {room.style for room in L.ROOMS}
STREET_STYLES = {"corridor", "entry"}
WALKABLE = ROOM_STYLES | STREET_STYLES | {"door", "stair", "trench"}
# The voltage of a machine whose row stores none.
DEFAULT_TIER = "MV"

FLOORS = L.FLOOR
ROOM_FLOOR = {room.id: room.floor for room in L.ROOMS}


# --- cells and spans ---

def iter_rect(x0: int, x1: int, z0: int, z1: int) -> Iterator[tuple]:
    """Every (x, z) between two corners, whichever way round they are given."""
    for x in range(min(x0, x1), max(x0, x1) + 1):
        for z in range(min(z0, z1), max(z0, z1) + 1):
            yield x, z


def neighbors(x: int, z: int) -> list:
    """The four cells that share an edge with a cell."""
    return [(x + dx, z + dz) for dx, dz in DIRS.values()]


def step(x: int, z: int, side: str, count: int = 1) -> tuple:
    """The cell `count` blocks from a cell toward a side."""
    dx, dz = DIRS[side]
    return x + dx * count, z + dz * count


def merge(spans) -> list:
    """Spans of one column, bottom to top, with touching spans of the same style joined."""
    out = []
    for y0, y1, style in sorted(spans):
        if y1 < y0:
            continue
        if out and out[-1][2] == style and y0 <= out[-1][1] + 1:
            out[-1] = (out[-1][0], max(out[-1][1], y1), style)
        else:
            out.append((y0, y1, style))
    return out


def style_at(grid: dict, x: int, z: int, y: int) -> str:
    """What dug a block, or rock."""
    for y0, y1, style in grid.get((x, z), ()):
        if y0 <= y <= y1:
            return style
    return ROCK


def floor_style(grid: dict, x: int, z: int, floor: str) -> str:
    """Style at a floor's walking height, ignoring tall rooms that start on the floor below."""
    level = FLOORS[floor]
    y, start = level.walk, level.air[0]
    for y0, y1, style in grid.get((x, z), ()):
        if y0 <= y <= y1:
            if style in ("stair", "well") or y0 >= start:
                return style
            return ROCK
    return ROCK


# --- digging ---

def place(grid: dict, x: int, z: int, y0: int, y1: int, style: str) -> None:
    """Dig y0..y1 at a column that has nothing there yet."""
    spans = list(grid.get((x, z), ()))
    for a, b, existing in spans:
        if not (y1 < a or y0 > b):
            raise RuntimeError(f"{style} overlaps {existing} at {x},{z} y={max(y0, a)}..{min(y1, b)}")
    spans.append((y0, y1, style))
    grid[(x, z)] = merge(spans)


def carve(grid: dict, x: int, z: int, y0: int, y1: int, style: str, allowed=(), force: bool = False) -> None:
    """Dig y0..y1 at a column. Cutting through another style is an error unless it is allowed or forced."""
    kept = []
    for a, b, existing in grid.get((x, z), ()):
        if y1 < a or y0 > b:
            kept.append((a, b, existing))
            continue
        if not force and existing != style and existing not in allowed:
            raise RuntimeError(f"{style} cuts through {existing} at {x},{z} y={y0}..{y1}")
        kept += _left_of(a, b, existing, y0, y1)
    kept.append((y0, y1, style))
    grid[(x, z)] = merge(kept)


def _left_of(a: int, b: int, style: str, y0: int, y1: int) -> list:
    """What remains of a span a..b below and above a cut at y0..y1."""
    left = []
    if a < y0:
        left.append((a, y0 - 1, style))
    if b > y1:
        left.append((y1 + 1, b, style))
    return left


def _trench_at(grid: dict, x: int, z: int) -> None:
    """Dig the pipe crawl under one cell."""
    carve(grid, x, z, *L.CRAWL["air"], "trench")


def door_meets_street(grid: dict, door) -> bool:
    """Whether a door opens onto a street, so the pipes under the street can pass under the door."""
    level = (door.y0 + door.y1) // 2
    return any(style_at(grid, nx, nz, level) in STREET_STYLES for x, z in door.cells() for nx, nz in neighbors(x, z))


def _dig_rooms(grid: dict) -> None:
    """Rooms go in first, so everything after them is checked against them."""
    for room in L.ROOMS:
        for x, z in room.cells():
            place(grid, x, z, room.y0, room.y1, room.style)


def _dig_streets(grid: dict) -> None:
    """Streets, each with its trench in the crawl when it carries one."""
    for street in L.STREETS:
        for x, z in street.cells():
            carve(grid, x, z, street.y0, street.y1, street.style, street.carve)
            if street.trench:
                _trench_at(grid, x, z)


def _dig_trenches(grid: dict) -> None:
    """The runs of the pipe crawl that are not under a street."""
    for trench in L.TRENCHES:
        for x, z in trench.cells():
            _trench_at(grid, x, z)


def _dig_doors(grid: dict) -> None:
    """Doors go through rock only. One on the crawl's floor that meets a street carries the pipes through."""
    for door in L.DOORS:
        if door.floor == L.CRAWL["under"] and door_meets_street(grid, door):
            for x, z in door.cells():
                _trench_at(grid, x, z)
        level = (door.y0 + door.y1) // 2
        for x, z in door.cells():
            found = style_at(grid, x, z, level)
            if found != ROCK:
                raise RuntimeError(f"door {door.id} at {x},{z} sits on {found}")
            place(grid, x, z, door.y0, door.y1, "door")


def _dig_stairs(grid: dict) -> None:
    """Stairs cut through whatever is there, from the bottom floor's air to the top floor's ceiling."""
    for stair in L.STAIRS:
        for x, z in stair.cells():
            carve(grid, x, z, stair.y0, stair.y1, "stair", force=True)


def _dig_shafts(grid: dict) -> None:
    """Shafts cut from above their room up through the ground."""
    for shaft in L.SHAFTS:
        for x, z in shaft.cells():
            carve(grid, x, z, shaft.y0, math.ceil(surface(x, z)), "well", force=True)


def build() -> dict:
    """Dig the whole plan: (x, z) to that column's spans of air, each as (y0, y1, style)."""
    grid: dict = {}
    _dig_rooms(grid)
    _dig_streets(grid)
    _dig_trenches(grid)
    _dig_doors(grid)
    _dig_stairs(grid)
    _dig_shafts(grid)
    return grid


# --- machines and multiblocks ---

def _slot_tier(wall, slot: int) -> str:
    """The voltage of one slot of a machine row."""
    return DEFAULT_TIER if not wall.tiers or wall.tiers[slot] == "-" else wall.tiers[slot]


def _row_machines(wall) -> Iterator[Machine]:
    """The machines of one row. Slot `i` stands `i` steps along the row from its origin."""
    dx, dz = DIRS[wall.along]
    for slot, code in enumerate(wall.codes):
        if code is not None:
            yield Machine(code, wall.x + dx * slot, wall.z + dz * slot, wall.y, wall.face, wall.id, slot,
                          wall.room, _slot_tier(wall, slot))


def machines() -> list[Machine]:
    """Every machine of every row."""
    return [machine for wall in L.WALLS for machine in _row_machines(wall)]


def pad_height(pad) -> int:
    """How tall a multiblock is: its own height, or the catalog's."""
    return pad.h or MULTIS[pad.key].size[2]


def pad_cells(pad) -> list:
    """Every cell of a multiblock's footprint."""
    return list(pad.cells())


def module_size(pad) -> tuple:
    """Width and depth of one wallshared module. A pad with no neighbors is one module."""
    span_x, span_z = pad.size
    return (span_x - 1) // (pad.wx or 1) + 1, (span_z - 1) // (pad.wz or 1) + 1


def _module_front(pad, i: int, j: int) -> str:
    """The way one module of a row faces. A rank behind the first faces the other way."""
    front = pad.front
    if pad.flip == "x" and i:
        front = OPPOSITE[front]
    if pad.flip == "z" and j:
        front = OPPOSITE[front]
    return front


def modules(pad) -> list:
    """Each wallshared module as (x0, x1, z0, z1, controller face). One module is the pad itself."""
    mw, md = module_size(pad)
    out = []
    for i in range(pad.wx or 1):
        for j in range(pad.wz or 1):
            x0 = pad.x0 + i * (mw - 1)
            z0 = pad.z0 + j * (md - 1)
            out.append((x0, x0 + mw - 1, z0, z0 + md - 1, _module_front(pad, i, j)))
    return out


def module_pads(pad) -> list[Pad]:
    """Each wallshared module as a pad of its own, so one module can be asked what a whole pad is."""
    return [replace(pad, x0=x0, x1=x1, z0=z0, z1=z1, front=front, wx=1, wz=1, flip="")
            for x0, x1, z0, z1, front in modules(pad)]


def _on_edge(pad, x: int, z: int) -> bool:
    """Whether a cell is on the outer ring of a footprint."""
    return x in (pad.x0, pad.x1) or z in (pad.z0, pad.z1)


def pad_blocks(pad) -> list:
    """Cells a player cannot walk through. Shells are walls only, with one door."""
    if not MULTIS[pad.key].shell:
        return pad_cells(pad)
    door = tuple(pad.door)
    return [(x, z) for x, z in pad.cells() if _on_edge(pad, x, z) and (x, z) != door]


def _front_cell(pad, out: int, off: int) -> tuple:
    """The cell `out` blocks from the controller face and `off` blocks along it from the middle."""
    cx = (pad.x0 + pad.x1) // 2
    cz = (pad.z0 + pad.z1) // 2
    if pad.front == "n":
        return cx + off, pad.z0 - out
    if pad.front == "s":
        return cx + off, pad.z1 + out
    if pad.front == "e":
        return pad.x1 + out, cz + off
    return pad.x0 - out, cz + off


def pad_front(pad, depth: int = 1) -> list:
    """Cells in front of the controller face, `depth` deep and centered. Depth 0 asks for the air the catalog wants."""
    deep, wide = MULTIS[pad.key].front_air if depth == 0 else (depth, 1)
    half = wide // 2
    return [_front_cell(pad, out, off) for out in range(1, deep + 1) for off in range(-half, half + 1)]


# --- walking ---

def floor_of(y: int) -> str:
    """The floor whose standard air band holds y, or "other". Bands never overlap."""
    for floor in L.FLOORS:
        if floor.air[0] <= y <= floor.air[1]:
            return floor.id
    return "other"


def obstacles(floor: str) -> set:
    """Cells of a floor that something stands on: multiblocks, machines, and service cores."""
    blocked = set()
    for pad in L.PADS:
        if floor_of(pad.y) == floor:
            blocked.update(pad_blocks(pad))
    for m in machines():
        if floor_of(m.y) == floor:
            blocked.add((m.x, m.z))
    for mark in L.MARKS:
        if mark.shape == "service" and ROOM_FLOOR[mark.room] == floor:
            blocked.update(mark.cells())
    return blocked


def walkable(grid: dict, floor: str) -> set:
    """Cells of a floor a player can stand on."""
    blocked = obstacles(floor)
    return {cell for cell in grid if cell not in blocked and floor_style(grid, *cell, floor) in WALKABLE}


def _flood(start: tuple, cells: set, seen: set) -> set:
    """The piece of `cells` reachable from a cell, marking each cell seen as it is reached."""
    bag = set()
    queue = deque([start])
    seen.add(start)
    while queue:
        x, z = queue.popleft()
        bag.add((x, z))
        for nxt in neighbors(x, z):
            if nxt in cells and nxt not in seen:
                seen.add(nxt)
                queue.append(nxt)
    return bag


def components(cells: set) -> list[set]:
    """Cells grouped into pieces that touch along an edge."""
    seen: set = set()
    return [_flood(start, cells, seen) for start in cells if start not in seen]


def open_cells(grid: dict, y: int) -> set:
    """Every cell that is not rock at one Y."""
    return {(x, z) for (x, z) in grid if style_at(grid, x, z, y) != ROCK}


# --- chunks ---

def chunk(x: int, z: int) -> tuple:
    """The chunk a block is in, as (chunk X, chunk Z)."""
    return x >> 4, z >> 4


# The chunk holding the square's north-west corner is A1.
CHUNK_X0, CHUNK_Z0 = chunk(L.SQUARE[0], L.SQUARE[2])


def chunk_letter(cx: int) -> str:
    """A chunk column's letter, or "" off the grid."""
    col = cx - CHUNK_X0
    return L.COLUMNS[col] if 0 <= col < len(L.COLUMNS) else ""


def chunk_number(cz: int) -> int:
    """A chunk row's number, or 0 off the grid."""
    row = cz - CHUNK_Z0 + 1
    return row if 1 <= row <= len(L.TERRAIN) else 0


def chunk_name(x: int, z: int) -> str:
    """The name of the chunk a block is in, such as E6."""
    cx, cz = chunk(x, z)
    return f"{chunk_letter(cx) or '?'}{cz - CHUNK_Z0 + 1}"


def chunk_bounds(name: str) -> tuple:
    """The blocks of a named chunk, as (x0, x1, z0, z1)."""
    cx = L.COLUMNS.index(name[0]) + CHUNK_X0
    cz = int(name[1:]) - 1 + CHUNK_Z0
    return cx * 16, cx * 16 + 15, cz * 16, cz * 16 + 15


# --- the ground ---

TERRAIN = L.TERRAIN
_A1 = chunk_bounds("A1")
_X_CENTER = (_A1[0] + _A1[1]) / 2
_Z_CENTER = (_A1[2] + _A1[3]) / 2


def _between_centers(value: float, center: float, count: int) -> tuple:
    """The chunk center a coordinate sits after, and how far it is toward the next one, 0 to 1."""
    u = (value - center) / 16
    i = min(max(int(math.floor(u)), 0), count - 2)
    return i, min(max(u - i, 0.0), 1.0)


def surface(x: float, z: float) -> float:
    """Estimated ground Y over a block, blended between chunk centers."""
    c, s = _between_centers(x, _X_CENTER, len(TERRAIN[0]))
    r, t = _between_centers(z, _Z_CENTER, len(TERRAIN))
    top = TERRAIN[r][c] * (1 - s) + TERRAIN[r][c + 1] * s
    bottom = TERRAIN[r + 1][c] * (1 - s) + TERRAIN[r + 1][c + 1] * s
    return top * (1 - t) + bottom * t


def cover(x: int, z: int, top: int) -> float:
    """Blocks of rock between an air column topping out at `top` and the ground."""
    return surface(x, z) - top


# --- lifts and rain ---

def lift_gaps(grid: dict, lift) -> list[tuple]:
    """(lower floor, upper floor, blocks apart, solid blocks between) for each hop of a lift."""
    out = []
    for low, high in zip(lift.floors, lift.floors[1:]):
        a, b = FLOORS[low].slab, FLOORS[high].slab
        solid = sum(1 for y in range(a + 1, b) if style_at(grid, lift.x, lift.z, y) == ROCK)
        out.append((low, high, b - a, solid))
    return out


def _rain_column(grid: dict, x: int, z: int, top: int) -> Iterator[tuple]:
    """The open blocks rain falls through from `top` down to the first solid one."""
    y = top
    while style_at(grid, x, z, y) != ROCK:
        yield x, z, y
        y -= 1


def sky_exposed(grid: dict) -> set:
    """(x, z, y) cells that rain can reach, falling down from an open shaft."""
    wet = set()
    for shaft in L.SHAFTS:
        if not shaft.cap:
            for x, z in shaft.cells():
                wet.update(_rain_column(grid, x, z, shaft.y0 - 1))
    return wet
