"""Voxel model of the base: per-column spans of air, tagged with what dug them."""

from __future__ import annotations

import math
from collections import deque

import layout as L
from catalog import MULTIS
from schema import DIRS, Machine

ROOM_STYLES = {room.style for room in L.ROOMS}
STREET_STYLES = {"corridor", "entry"}
WALKABLE = ROOM_STYLES | STREET_STYLES | {"door", "stair", "trench"}


def iter_rect(x0, x1, z0, z1):
    for x in range(min(x0, x1), max(x0, x1) + 1):
        for z in range(min(z0, z1), max(z0, z1) + 1):
            yield x, z


def merge(spans):
    out = []
    for y0, y1, style in sorted(spans):
        if y1 < y0:
            continue
        if out and out[-1][2] == style and y0 <= out[-1][1] + 1:
            out[-1] = (out[-1][0], max(out[-1][1], y1), style)
        else:
            out.append((y0, y1, style))
    return out


def style_at(grid, x, z, y) -> str:
    for y0, y1, style in grid.get((x, z), ()):
        if y0 <= y <= y1:
            return style
    return "rock"


FLOORS = L.FLOOR
ROOM_FLOOR = {room.id: room.floor for room in L.ROOMS}


def floor_style(grid, x, z, floor: str) -> str:
    """Style at a floor's walking height, ignoring tall rooms that start on the floor below."""
    level = FLOORS[floor]
    y, start = level.walk, level.air[0]
    for y0, y1, style in grid.get((x, z), ()):
        if y0 <= y <= y1:
            if style in ("stair", "well") or y0 >= start:
                return style
            return "rock"
    return "rock"


def place(grid, x, z, y0, y1, style) -> None:
    spans = list(grid.get((x, z), ()))
    for a, b, existing in spans:
        if not (y1 < a or y0 > b):
            raise RuntimeError(f"{style} overlaps {existing} at {x},{z} y={max(y0, a)}..{min(y1, b)}")
    spans.append((y0, y1, style))
    grid[(x, z)] = merge(spans)


def carve(grid, x, z, y0, y1, style, allowed=(), force=False) -> None:
    kept = []
    for a, b, existing in grid.get((x, z), ()):
        if y1 < a or y0 > b:
            kept.append((a, b, existing))
            continue
        if not force and existing != style and existing not in allowed:
            raise RuntimeError(f"{style} cuts through {existing} at {x},{z} y={y0}..{y1}")
        if a < y0:
            kept.append((a, y0 - 1, existing))
        if b > y1:
            kept.append((y1 + 1, b, existing))
    kept.append((y0, y1, style))
    grid[(x, z)] = merge(kept)


def door_meets_street(grid, door) -> bool:
    level = (door.y0 + door.y1) // 2
    for x, z in iter_rect(door.x0, door.x1, door.z0, door.z1):
        for dx, dz in DIRS.values():
            if style_at(grid, x + dx, z + dz, level) in STREET_STYLES:
                return True
    return False


def build() -> dict:
    grid: dict = {}
    for room in L.ROOMS:
        for x, z in iter_rect(room.x0, room.x1, room.z0, room.z1):
            place(grid, x, z, room.y0, room.y1, room.style)
    crawl = L.CRAWL["air"]
    for street in L.STREETS:
        for x, z in iter_rect(street.x0, street.x1, street.z0, street.z1):
            carve(grid, x, z, street.y0, street.y1, street.style, street.carve)
            if street.trench:
                carve(grid, x, z, *crawl, "trench")
    for trench in L.TRENCHES:
        for x, z in iter_rect(trench.x0, trench.x1, trench.z0, trench.z1):
            carve(grid, x, z, *crawl, "trench", ("trench",))
    for door in L.DOORS:
        if door.floor == L.CRAWL["under"] and door_meets_street(grid, door):
            for x, z in iter_rect(door.x0, door.x1, door.z0, door.z1):
                carve(grid, x, z, *crawl, "trench", ("trench",))
        level = (door.y0 + door.y1) // 2
        for x, z in iter_rect(door.x0, door.x1, door.z0, door.z1):
            found = style_at(grid, x, z, level)
            if found != "rock":
                raise RuntimeError(f"door {door.id} at {x},{z} sits on {found}")
            place(grid, x, z, door.y0, door.y1, "door")
    for stair in L.STAIRS:
        for x, z in iter_rect(stair.x0, stair.x1, stair.z0, stair.z1):
            carve(grid, x, z, stair.y0, stair.y1, "stair", force=True)
    for shaft in L.SHAFTS:
        for x, z in iter_rect(shaft.x0, shaft.x1, shaft.z0, shaft.z1):
            carve(grid, x, z, shaft.y0, math.ceil(surface(x, z)), "well", force=True)
    return grid


def machines() -> list[Machine]:
    out = []
    for wall in L.WALLS:
        dx, dz = DIRS[wall.along]
        for i, code in enumerate(wall.codes):
            if code is None:
                continue
            tier = "MV" if not wall.tiers or wall.tiers[i] == "-" else wall.tiers[i]
            out.append(Machine(code, wall.x + dx * i, wall.z + dz * i, wall.y, wall.face, wall.id, i,
                               wall.room, tier))
    return out


def pad_height(pad) -> int:
    return pad.h or MULTIS[pad.key].size[2]


def pad_cells(pad):
    return list(iter_rect(pad.x0, pad.x1, pad.z0, pad.z1))


def module_size(pad) -> tuple:
    """Width and depth of one wallshared module. A pad with no neighbors is one module."""
    span_x = pad.x1 - pad.x0 + 1
    span_z = pad.z1 - pad.z0 + 1
    return (span_x - 1) // (pad.wx or 1) + 1, (span_z - 1) // (pad.wz or 1) + 1


def modules(pad):
    """Each wallshared module as (x0, x1, z0, z1, controller face). One module is the pad itself."""
    wx = pad.wx or 1
    wz = pad.wz or 1
    mw, md = module_size(pad)
    step_x = mw - 1
    step_z = md - 1
    opposite = {"n": "s", "s": "n", "e": "w", "w": "e"}
    out = []
    for i in range(wx):
        for j in range(wz):
            front = pad.front
            if pad.flip == "x" and i:
                front = opposite[front]
            if pad.flip == "z" and j:
                front = opposite[front]
            x0 = pad.x0 + i * step_x
            z0 = pad.z0 + j * step_z
            out.append((x0, x0 + mw - 1, z0, z0 + md - 1, front))
    return out


def pad_blocks(pad):
    """Cells a player cannot walk through. Shells are walls only, with one door."""
    if not MULTIS[pad.key].shell:
        return pad_cells(pad)
    ring = []
    for x, z in pad_cells(pad):
        edge = x in (pad.x0, pad.x1) or z in (pad.z0, pad.z1)
        if edge and (x, z) != tuple(pad.door):
            ring.append((x, z))
    return ring


def pad_front(pad, depth=1):
    """Cells in front of the controller face, `depth` deep and centered."""
    spec = MULTIS[pad.key]
    d, w = spec.front_air if depth == 0 else (depth, 1)
    cx = (pad.x0 + pad.x1) // 2
    cz = (pad.z0 + pad.z1) // 2
    cells = []
    half = w // 2
    for step in range(1, d + 1):
        for off in range(-half, half + 1):
            if pad.front == "n":
                cells.append((cx + off, pad.z0 - step))
            elif pad.front == "s":
                cells.append((cx + off, pad.z1 + step))
            elif pad.front == "e":
                cells.append((pad.x1 + step, cz + off))
            else:
                cells.append((pad.x0 - step, cz + off))
    return cells


def floor_of(y: int) -> str:
    """The floor whose standard air band holds y, or "other". Bands never overlap."""
    for floor in L.FLOORS:
        if floor.air[0] <= y <= floor.air[1]:
            return floor.id
    return "other"


def obstacles(floor: str) -> set:
    blocked = set()
    for pad in L.PADS:
        if floor_of(pad.y) == floor:
            blocked.update(pad_blocks(pad))
    for m in machines():
        if floor_of(m.y) == floor:
            blocked.add((m.x, m.z))
    for mark in L.MARKS:
        if mark.shape == "service" and ROOM_FLOOR[mark.room] == floor:
            blocked.update(iter_rect(mark.x0, mark.x1, mark.z0, mark.z1))
    return blocked


def walkable(grid, floor: str) -> set:
    blocked = obstacles(floor)
    cells = set()
    for (x, z) in grid:
        if (x, z) in blocked:
            continue
        if floor_style(grid, x, z, floor) in WALKABLE:
            cells.add((x, z))
    return cells


def components(cells: set) -> list[set]:
    seen = set()
    out = []
    for start in cells:
        if start in seen:
            continue
        bag = set()
        queue = deque([start])
        seen.add(start)
        while queue:
            x, z = queue.popleft()
            bag.add((x, z))
            for dx, dz in DIRS.values():
                nxt = (x + dx, z + dz)
                if nxt in cells and nxt not in seen:
                    seen.add(nxt)
                    queue.append(nxt)
        out.append(bag)
    return out


def open_cells(grid, y: int) -> set:
    return {(x, z) for (x, z) in grid if style_at(grid, x, z, y) != "rock"}


def chunk(x: int, z: int) -> tuple:
    return x >> 4, z >> 4


# The chunk holding the square's north-west corner is A1.
CHUNK_X0, CHUNK_Z0 = chunk(L.SQUARE[0], L.SQUARE[2])


def chunk_letter(cx: int) -> str:
    col = cx - CHUNK_X0
    return L.COLUMNS[col] if 0 <= col < len(L.COLUMNS) else ""


def chunk_number(cz: int) -> int:
    row = cz - CHUNK_Z0 + 1
    return row if 1 <= row <= len(L.TERRAIN) else 0


def chunk_name(x: int, z: int) -> str:
    cx, cz = chunk(x, z)
    return f"{chunk_letter(cx) or '?'}{cz - CHUNK_Z0 + 1}"


def chunk_bounds(name: str) -> tuple:
    cx = L.COLUMNS.index(name[0]) + CHUNK_X0
    cz = int(name[1:]) - 1 + CHUNK_Z0
    return cx * 16, cx * 16 + 15, cz * 16, cz * 16 + 15


TERRAIN = L.TERRAIN
_A1 = chunk_bounds("A1")
_X_CENTER = (_A1[0] + _A1[1]) / 2
_Z_CENTER = (_A1[2] + _A1[3]) / 2


def surface(x: float, z: float) -> float:
    """Estimated ground Y over a block, blended between chunk centers."""
    def split(value, center, count):
        u = (value - center) / 16
        i = min(max(int(math.floor(u)), 0), count - 2)
        return i, min(max(u - i, 0.0), 1.0)

    c, s = split(x, _X_CENTER, len(TERRAIN[0]))
    r, t = split(z, _Z_CENTER, len(TERRAIN))
    top = TERRAIN[r][c] * (1 - s) + TERRAIN[r][c + 1] * s
    bottom = TERRAIN[r + 1][c] * (1 - s) + TERRAIN[r + 1][c + 1] * s
    return top * (1 - t) + bottom * t


def cover(x: int, z: int, top: int) -> float:
    """Blocks of rock between an air column topping out at `top` and the ground."""
    return surface(x, z) - top


def lift_gaps(grid, lift) -> list[tuple]:
    """(lower floor, upper floor, blocks apart, solid blocks between) for each hop of a lift."""
    out = []
    for low, high in zip(lift.floors, lift.floors[1:]):
        a, b = FLOORS[low].slab, FLOORS[high].slab
        solid = sum(1 for y in range(a + 1, b) if style_at(grid, lift.x, lift.z, y) == "rock")
        out.append((low, high, b - a, solid))
    return out


def sky_exposed(grid) -> set:
    """(x, z, y) cells that rain can reach, falling down from an open shaft."""
    wet = set()
    for shaft in L.SHAFTS:
        if shaft.cap:
            continue
        for x, z in iter_rect(shaft.x0, shaft.x1, shaft.z0, shaft.z1):
            y = shaft.y0 - 1
            while style_at(grid, x, z, y) != "rock":
                wet.add((x, z, y))
                y -= 1
    return wet
