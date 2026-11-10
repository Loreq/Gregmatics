"""Checks that the plan can be built and walked, and that it follows the pack's rules."""

from __future__ import annotations

from functools import cached_property

import layout as L
import model as M
from catalog import ELEVATOR, MULTIS, SINGLES
from schema import DIRS

LIFT_REACH = ELEVATOR["reach"]

ROOMS = {room.id: room for room in L.ROOMS}
FLOORS = tuple(M.FLOORS)
ENTRY = next(street for street in L.STREETS if street.style == "entry")

# A street is this wide, and a door at least this long.
MIN_WIDTH = 3
# Solid blocks kept between two bands of air.
MIN_SOLID = 2
# Stair cells this many rows in from each end count as that end.
STAIR_END_ROWS = 3
# A stair's air is this high at its low end, then rises with the climb.
STAIR_HEADROOM = 5
# An advanced muffler needs this many blocks of air over it.
MUFFLER_AIR = 3
# The wall check stops after the first floor with more problems than this.
WALL_REPORT_LIMIT = 6
# A clean room sits at least this many chunk steps from a dirty chunk.
CLEAN_STEPS = 2
AIR_FILTER = "eaf"
POLLUTION_ALARM = "PDD"
FUEL_LOADER = "FUL"


class Survey:
    """The grid, and the answers several checks ask of it. Each is worked out once."""

    def __init__(self, grid: dict) -> None:
        self.grid = grid

    @cached_property
    def walkable(self) -> dict:
        """The cells a player can stand on, by floor."""
        return {floor: M.walkable(self.grid, floor) for floor in FLOORS}

    @cached_property
    def wet(self) -> set:
        """The (x, z, y) cells rain reaches."""
        return M.sky_exposed(self.grid)

    @cached_property
    def machines(self) -> list:
        """Every machine of every row."""
        return M.machines()


# --- shapes ---

def _street_widths() -> list[str]:
    """A street is at least three wide. The entrance is measured across its mouth only."""
    problems = []
    for street in L.STREETS:
        wide, deep = street.size
        narrow = wide < MIN_WIDTH if street.style == "entry" else min(wide, deep) < MIN_WIDTH
        if narrow:
            problems.append(f"street {street.id} is narrower than {MIN_WIDTH}")
    return problems


def _door_shapes() -> list[str]:
    """A door is one block deep and at least three long."""
    problems = []
    for door in L.DOORS:
        w, d = door.size
        if min(w, d) != 1 or max(w, d) < MIN_WIDTH:
            problems.append(f"door {door.id} is {w}×{d}; want a 1-deep slit, 3 or more wide")
    return problems


def _pad_shapes() -> list[str]:
    """A multiblock is a size the wiki allows, and a shell has its door. A wallshared row is judged one module at a time."""
    problems = []
    for pad in L.PADS:
        spec = MULTIS[pad.key]
        wide, deep = M.module_size(pad)
        high = M.pad_height(pad)
        if not spec.allows(wide, deep, high):
            problems.append(f"pad {pad.num} {spec.name} is {wide}×{deep}×{high}; the wiki size is {spec.size_text()}")
        if spec.shell and not pad.door:
            problems.append(f"pad {pad.num} {spec.name} needs a door cell")
    return problems


def _unknown_machines() -> list[str]:
    """Every machine code is one the catalog knows."""
    return [f"wall {m.wall} slot {m.index} has unknown machine {m.code}" for m in M.machines() if m.code not in SINGLES]


def check_shapes(_survey: Survey) -> list[str]:
    """Streets, doors, and multiblocks have a size that can be built."""
    return _street_widths() + _door_shapes() + _pad_shapes() + _unknown_machines()


# --- doors ---

def _door_sides(grid: dict, door, x: int, z: int, level: int) -> tuple:
    """The styles on the two sides one block of a door joins."""
    if door.x0 == door.x1:
        return M.style_at(grid, x - 1, z, level), M.style_at(grid, x + 1, z, level)
    return M.style_at(grid, x, z - 1, level), M.style_at(grid, x, z + 1, level)


def _door_onto_rock(grid: dict, door) -> list[str]:
    """The first block of a door with rock on one side."""
    level = (door.y0 + door.y1) // 2
    for x, z in door.cells():
        sides = _door_sides(grid, door, x, z, level)
        if M.ROCK in sides:
            return [f"door {door.id} at {x},{z} opens onto rock ({sides[0]} / {sides[1]})"]
    return []


def check_doors(survey: Survey) -> list[str]:
    """Every door opens both ways."""
    return [problem for door in L.DOORS for problem in _door_onto_rock(survey.grid, door)]


# --- stairs ---

def stair_ends(stair, depth: int = STAIR_END_ROWS) -> tuple:
    """Stair cells in the first and last `depth` rows of the climb."""
    along_z = stair.low in "ns"
    rows = list(range(stair.z0, stair.z1 + 1) if along_z else range(stair.x0, stair.x1 + 1))
    ordered = rows if stair.low in "nw" else rows[::-1]
    low_rows, high_rows = set(ordered[:depth]), set(ordered[-depth:])
    axis = 1 if along_z else 0
    cells = list(stair.cells())
    return [c for c in cells if c[axis] in low_rows], [c for c in cells if c[axis] in high_rows]


def _lands(grid: dict, stair, end_cells: list, floor: str) -> bool:
    """Whether some cell beside one end of a stair, and outside it, can be walked on that floor."""
    own = set(stair.cells())
    return any(nxt not in own and M.floor_style(grid, *nxt, floor) in M.WALKABLE
               for x, z in end_cells for nxt in M.neighbors(x, z))


def _stair_landings(grid: dict, stair) -> list[str]:
    """A stair lands on its bottom floor at the low end and on its top floor at the high end."""
    low_cells, high_cells = stair_ends(stair)
    bottom, top = stair.floors
    problems = []
    if not _lands(grid, stair, low_cells, bottom):
        problems.append(f"{stair.id} has no {bottom}-floor landing at its low end")
    if not _lands(grid, stair, high_cells, top):
        problems.append(f"{stair.id} has no {top}-floor landing at its high end")
    return problems


def _door_at_stair(door, stair) -> list[str]:
    """A door may meet a stair only at the end that is on the door's own floor."""
    own = set(stair.cells())
    touching = [nxt for x, z in door.cells() for nxt in M.neighbors(x, z) if nxt in own]
    if not touching:
        return []
    floor = M.floor_of(door.y0)
    if floor not in stair.floors:
        return [f"door {door.id} opens into {stair.id} between floors"]
    low_cells, high_cells = stair_ends(stair)
    at_bottom = floor == stair.floors[0]
    allowed = set(low_cells if at_bottom else high_cells)
    if all(cell in allowed for cell in touching):
        return []
    return [f"door {door.id} meets {stair.id} away from its {'low' if at_bottom else 'high'} end"]


def check_stairs(survey: Survey) -> list[str]:
    """Stairs land at both ends, and doors meet them only there."""
    problems = []
    for stair in L.STAIRS:
        problems += _stair_landings(survey.grid, stair)
        for door in L.DOORS:
            problems += _door_at_stair(door, stair)
    return problems


# --- walls ---

def _street_two_away(grid: dict, x: int, z: int, dx: int, dz: int, floor: str) -> bool:
    """Whether a second block of rock, and then a street, lie past the rock beside a room cell."""
    mid = M.floor_style(grid, x + 2 * dx, z + 2 * dz, floor)
    far = M.floor_style(grid, x + 3 * dx, z + 3 * dz, floor)
    return mid == M.ROCK and far in M.STREET_STYLES


def _wall_problem(grid: dict, x: int, z: int, floor: str) -> str:
    """What is wrong with the walls around one room cell, or ""."""
    here = M.floor_style(grid, x, z, floor)
    if here not in M.ROOM_STYLES:
        return ""
    for dx, dz in DIRS.values():
        other = M.floor_style(grid, x + dx, z + dz, floor)
        if other in M.ROOM_STYLES and other != here:
            return f"{here} touches {other} at {x},{z} with no wall"
        if other == M.ROCK and _street_two_away(grid, x, z, dx, dz, floor):
            return f"{here} is two blocks from a street at {x},{z}; use a 1-block wall"
    return ""


def _wall_problems(grid: dict, floor: str) -> list[str]:
    """The wall problems of one floor, up to one past the report limit."""
    found = []
    for x, z in list(grid):
        problem = _wall_problem(grid, x, z, floor)
        if problem:
            found.append(problem)
        if len(found) > WALL_REPORT_LIMIT:
            break
    return found


def check_walls(survey: Survey) -> list[str]:
    """Walls between rooms, and between a room and a street, are one block."""
    problems = []
    for floor in FLOORS:
        found = _wall_problems(survey.grid, floor)
        problems += found
        if len(found) > WALL_REPORT_LIMIT:
            break
    return problems


# --- the rim and the floors ---

def _inside_rim(x: int, z: int) -> bool:
    """Whether a cell is inside the working square's rim."""
    x0, x1, z0, z1 = L.INNER
    return x0 <= x <= x1 and z0 <= z <= z1


def _spine_mouth(x: int, z: int, style: str) -> bool:
    """Whether a cell is the street, or its trench, running out through the rim to the entrance."""
    return z == L.SQUARE[2] and ENTRY.x0 <= x <= ENTRY.x1 and style in ("corridor", "trench")


def _bounds_problem(x: int, z: int, style: str) -> str:
    """What is wrong with where one dug cell sits, or ""."""
    if style == "well":
        return ""
    if style == "entry":
        return f"entrance is inside the square at {x},{z}" if z >= L.SQUARE[2] else ""
    if _inside_rim(x, z) or _spine_mouth(x, z, style):
        return ""
    return f"{style} reaches the rim or beyond at {x},{z}"


def check_bounds(survey: Survey) -> list[str]:
    """Nothing but the entrance leaves the rim. The first cell that does ends the check."""
    problems = []
    for (x, z), spans in survey.grid.items():
        for _y0, _y1, style in spans:
            problem = _bounds_problem(x, z, style)
            if problem:
                problems.append(problem)
            if problem and style != "entry":
                return problems
    return problems


def _thin_floor(x: int, z: int, lower: tuple, upper: tuple) -> str:
    """What is wrong with the rock between two spans of a column, or ""."""
    _a0, a1, below = lower
    b0, _b1, above = upper
    if {"stair", "well"} & {below, above}:
        return ""
    gap = b0 - a1 - 1
    return f"only {gap} solid between {below} and {above} at {x},{z}" if gap < MIN_SOLID else ""


def check_floors(survey: Survey) -> list[str]:
    """Two solid blocks stay between floors. The first thin spot ends the check."""
    for (x, z), spans in survey.grid.items():
        for lower, upper in zip(spans, spans[1:]):
            problem = _thin_floor(x, z, lower, upper)
            if problem:
                return [problem]
    return []


def _crawl_pieces(grid: dict) -> list[str]:
    """The pipe crawl is one connected run."""
    y = L.CRAWL["walk"]
    pipes = M.components({(x, z) for (x, z) in grid if M.style_at(grid, x, z, y) == "trench"})
    if len(pipes) == 1:
        return []
    return [f"{L.CRAWL['name'].lower()} splits into {len(pipes)} pieces: {sorted(len(p) for p in pipes)}"]


def check_connectivity(survey: Survey) -> list[str]:
    """Each floor is one walkable piece, and so is the pipe crawl."""
    problems = []
    for floor in FLOORS:
        parts = M.components(survey.walkable[floor])
        if len(parts) > 1:
            sizes = sorted((len(p), sorted(p)[0]) for p in parts)
            problems.append(f"{floor} floor splits into {len(parts)} walkable pieces: {sizes[:4]}")
    return problems + _crawl_pieces(survey.grid)


# --- multiblocks ---

def _pad_in_room(grid: dict, pad) -> list[str]:
    """A multiblock sits inside its room from floor to top, with air over a muffler. The first bad cell is reported."""
    spec = MULTIS[pad.key]
    room = ROOMS[pad.room]
    top = pad.y + M.pad_height(pad) - 1
    for x, z in pad.cells():
        if M.style_at(grid, x, z, pad.y) != room.style or M.style_at(grid, x, z, top) != room.style:
            return [f"pad {pad.num} {spec.name} does not fit inside {room.name} at {x},{z}"]
        if spec.muffler and any(M.style_at(grid, x, z, top + k) != room.style for k in range(1, MUFFLER_AIR + 1)):
            return [f"pad {pad.num} {spec.name} lacks 3 blocks of air over its muffler at {x},{z}"]
    return []


def _pad_overlap(pad, taken: dict) -> list[str]:
    """A multiblock stands on no other. `taken` maps (floor, cell) to the pad there and is filled as pads are checked."""
    # Keyed by floor, because two floors can hold multiblocks over the same X and Z.
    floor = M.floor_of(pad.y)
    for cell in M.pad_blocks(pad):
        other = taken.get((floor, cell))
        if other and not (other.share and pad.share):
            return [f"pad {pad.num} overlaps pad {other.num} at {cell}"]
        taken[(floor, cell)] = pad
    return []


def _front_blocked(pad, walk: set) -> list[str]:
    """Each module has clear floor in front of its controller. One blocked cell is reported per module."""
    spec = MULTIS[pad.key]
    inside = set(pad.cells())
    problems = []
    for module in M.module_pads(pad):
        blocked = [cell for cell in M.pad_front(module, depth=0) if cell not in inside and cell not in walk]
        if blocked:
            problems.append(f"pad {pad.num} {spec.name} needs clear floor in front of its controller at {blocked[0]}")
    return problems


def _ring_around(pad) -> set:
    """The cells that touch a footprint from outside."""
    ring = set()
    for x, z in pad.cells():
        for dx, dz in DIRS.values():
            ring.add((x + dx, z + dz))
    ring -= set(pad.cells())
    return ring


def _side_air_blocked(pad, walk: set) -> list[str]:
    """A structure with mufflers on its sides has open floor all round it."""
    spec = MULTIS[pad.key]
    if not spec.side_air:
        return []
    for cell in _ring_around(pad):
        if cell not in walk:
            return [f"pad {pad.num} {spec.name} needs air beside its mufflers at {cell}"]
    return []


def _shell_door_blocked(pad, walk: set) -> list[str]:
    """A shell's door has open floor on both sides of it."""
    spec = MULTIS[pad.key]
    if not spec.shell or not pad.door:
        return []
    outside = M.step(*pad.door, pad.front)
    inside = M.step(*pad.door, pad.front, -1)
    return [f"pad {pad.num} {spec.name} door does not open at {cell}" for cell in (outside, inside) if cell not in walk]


def check_pads(survey: Survey) -> list[str]:
    """Multiblocks fit their rooms, stand clear of each other, and can be reached."""
    problems = []
    taken: dict = {}
    for pad in L.PADS:
        problems += _pad_in_room(survey.grid, pad) + _pad_overlap(pad, taken)
    for pad in L.PADS:
        walk = survey.walkable[M.floor_of(pad.y)]
        problems += _front_blocked(pad, walk) + _side_air_blocked(pad, walk) + _shell_door_blocked(pad, walk)
    return problems


# --- machines ---

def _pads_by_cell() -> dict:
    """(x, z, floor) to the multiblock blocking that cell. Another floor can use the same X and Z."""
    cells = {}
    for pad in L.PADS:
        floor = M.floor_of(pad.y)
        for x, z in M.pad_blocks(pad):
            cells[(x, z, floor)] = pad
    return cells


def _service_cells() -> set:
    """Every (x, z, floor) inside a service core."""
    cells = set()
    for mark in L.MARKS:
        if mark.shape == "service":
            floor = M.ROOM_FLOOR[mark.room]
            cells.update((x, z, floor) for x, z in mark.cells())
    return cells


def _machine_problems(survey: Survey, m, pads: dict, service: set, seen: dict) -> list[str]:
    """What is wrong with one machine. `seen` maps each cell to the machine already there."""
    room = ROOMS[m.room]
    name = f"{m.code} in wall {m.wall}"
    if M.style_at(survey.grid, m.x, m.z, m.y) != room.style:
        return [f"{name} is outside {room.name} at {m.x},{m.z}"]
    floor = M.floor_of(m.y)
    key = (m.x, m.z, floor)
    problems = []
    if key in seen:
        problems.append(f"{name} overlaps {seen[key]} at {m.x},{m.z}")
    seen[key] = f"{m.code} ({m.wall})"
    if key in pads:
        problems.append(f"{name} sits on pad {pads[key].num}")
    if key in service:
        problems.append(f"{name} sits in a service core")
    front = M.step(m.x, m.z, m.face)
    if front not in survey.walkable[floor]:
        problems.append(f"{name} faces a blocked cell at {front}")
    return problems


def check_machines(survey: Survey) -> list[str]:
    """Machines stand in their rooms, one to a cell, facing a cell that can be walked."""
    pads = _pads_by_cell()
    service = _service_cells()
    seen: dict = {}
    return [problem for m in survey.machines for problem in _machine_problems(survey, m, pads, service, seen)]


# --- pollution ---

def _polluters(machines: list) -> list[tuple]:
    """(name, x, z) for every cell that makes pollution: multiblocks first, then machines."""
    found = []
    for pad in L.PADS:
        if MULTIS[pad.key].pollution:
            found += [(f"pad {pad.num} {MULTIS[pad.key].name}", x, z) for x, z in pad.cells()]
    found += [(f"{m.code} in wall {m.wall}", m.x, m.z) for m in machines if SINGLES[m.code].pollution]
    return found


def _outside_dirty(polluters: list) -> list[str]:
    """The first polluter outside the dirty chunks."""
    for name, x, z in polluters:
        if M.chunk_name(x, z) not in L.DIRTY:
            return [f"{name} pollutes outside the dirty chunks, at {M.chunk_name(x, z)}"]
    return []


def _near_dirt(room, dirty_chunks: set) -> list[str]:
    """The first cell of a clean room that is too few chunk steps from a dirty chunk."""
    for x, z in room.cells():
        cx, cz = M.chunk(x, z)
        steps = min((abs(cx - dx) + abs(cz - dz) for dx, dz in dirty_chunks), default=CLEAN_STEPS)
        if steps < CLEAN_STEPS:
            return [f"{room.name} is within one chunk of the dirty block at {M.chunk_name(x, z)}"]
    return []


def _clean_rooms_near_dirt() -> list[str]:
    """Clean rooms stay two chunk steps from the dirty chunks."""
    dirty_chunks = {M.chunk(*M.chunk_bounds(name)[0::2]) for name in L.DIRTY}
    return [problem for room in L.ROOMS if room.clean for problem in _near_dirt(room, dirty_chunks)]


def _filtered_chunks() -> set:
    """The chunks an air filter scrubs: its own and the eight around it."""
    covered = set()
    for pad in L.PADS:
        if pad.key == AIR_FILTER:
            cx, cz = M.chunk((pad.x0 + pad.x1) // 2, (pad.z0 + pad.z1) // 2)
            covered |= {(cx + i, cz + j) for i in (-1, 0, 1) for j in (-1, 0, 1)}
    return covered


def _outside_filter(polluters: list) -> list[str]:
    """The first polluter no air filter reaches."""
    covered = _filtered_chunks()
    for name, x, z in polluters:
        if M.chunk(x, z) not in covered:
            return [f"{name} is outside the air filter's 3×3 chunks"]
    return []


def _stray_alarms(machines: list) -> list[str]:
    """A pollution alarm reads only its own chunk, so it belongs in a dirty one."""
    return [f"pollution alarm in wall {m.wall} reads chunk {M.chunk_name(m.x, m.z)}, "
            "outside the dirty block, so it only sounds after pollution spreads"
            for m in machines if m.code == POLLUTION_ALARM and M.chunk_name(m.x, m.z) not in L.DIRTY]


def check_pollution(survey: Survey) -> list[str]:
    """Polluters sit in the dirty chunks under the air filter, and clean rooms sit away from them."""
    polluters = _polluters(survey.machines)
    return (_outside_dirty(polluters) + _clean_rooms_near_dirt() + _outside_filter(polluters)
            + _stray_alarms(survey.machines))


# --- rain and rockets ---

def _pad_in_rain(pad, wet: set) -> bool:
    """Whether rain reaches any block of a multiblock."""
    return any((x, z, y) in wet for x, z in pad.cells() for y in range(pad.y, pad.y + M.pad_height(pad)))


def check_rain(survey: Survey) -> list[str]:
    """GT machines stay out of the rain."""
    problems = [f"pad {pad.num} {MULTIS[pad.key].name} is under open sky"
                for pad in L.PADS if MULTIS[pad.key].gt and _pad_in_rain(pad, survey.wet)]
    problems += [f"{m.code} in wall {m.wall} is under open sky"
                 for m in survey.machines if SINGLES[m.code].gt and (m.x, m.z, m.y) in survey.wet]
    return problems


def _touches(machine, cells: set) -> bool:
    """Whether a machine stands beside one of some cells."""
    return any(nxt in cells for nxt in M.neighbors(machine.x, machine.z))


def _launch_problems(pad, survey: Survey, loaders: list) -> list[str]:
    """A launch pad has open sky straight up and a fuel loader touching it."""
    spec = MULTIS[pad.key]
    cells = set(pad.cells())
    problems = []
    if not all((x, z, pad.y) in survey.wet for x, z in pad.cells()):
        problems.append(f"pad {pad.num} {spec.name} is not under an open shaft to the sky")
    if not any(_touches(m, cells) and m.y == pad.y for m in loaders):
        problems.append(f"pad {pad.num} {spec.name} has no fuel loader touching it")
    return problems


def check_launch(survey: Survey) -> list[str]:
    """Rockets can leave, and can be fuelled."""
    loaders = [m for m in survey.machines if m.code == FUEL_LOADER]
    return [problem for pad in L.PADS if MULTIS[pad.key].sky for problem in _launch_problems(pad, survey, loaders)]


# --- rock overhead ---

def stair_tops(stair):
    """(x, z, top of the air) along a stair: 5 high at the low end, rising to y1 at the high end."""
    low_cells, _high = stair_ends(stair, depth=1)
    along_z = stair.low in "ns"
    start = low_cells[0][1] if along_z else low_cells[0][0]
    length = (stair.z1 - stair.z0 if along_z else stair.x1 - stair.x0) or 1
    low_top = stair.y0 + STAIR_HEADROOM - 1
    for x, z in stair.cells():
        climbed = abs((z if along_z else x) - start) / length
        yield x, z, low_top + (stair.y1 - low_top) * climbed


def _thinnest(zone, top: int) -> tuple:
    """(blocks of rock, x, z) where the least rock lies over a zone whose air tops out at `top`."""
    return min((M.cover(x, z, top), x, z) for x, z in zone.cells())


def _room_cover(room) -> list[str]:
    """A dug room keeps its rock overhead, and a room marked at grade really is."""
    least, x, z = _thinnest(room, room.y1)
    if room.grade and least >= L.COVER:
        return [f"{room.name} is marked at grade but keeps {least:.0f} blocks of rock overhead"]
    if not room.grade and least < L.COVER:
        return [f"{room.name} has {least:.0f} blocks of rock over its ceiling at {x},{z}; "
                f"it needs {L.COVER}, or mark it at grade"]
    return []


def _street_cover(street) -> list[str]:
    """A street keeps its rock overhead."""
    least, x, z = _thinnest(street, street.y1)
    if least >= L.COVER:
        return []
    return [f"street {street.id} has {least:.0f} blocks of rock over its ceiling at {x},{z}; "
            f"it needs {L.COVER}, or mark it at grade"]


def _stair_cover(stair) -> list[str]:
    """A stair keeps its rock overhead along the whole climb."""
    least, x, z = min((M.surface(x, z) - top, x, z) for x, z, top in stair_tops(stair))
    return [f"{stair.id} has {least:.0f} blocks of rock over it at {x},{z}"] if least < L.COVER else []


def check_cover(_survey: Survey) -> list[str]:
    """Everything dug keeps enough rock over it by the ground estimate."""
    problems = [problem for room in L.ROOMS for problem in _room_cover(room)]
    problems += [problem for street in L.STREETS for problem in _street_cover(street)]
    problems += [problem for stair in L.STAIRS for problem in _stair_cover(stair)]
    return problems


# --- lifts ---

def _lift_problems(survey: Survey, lift) -> list[str]:
    """A lift lands on each floor it serves, and no hop is longer than an elevator reaches."""
    problems = [f"lift {lift.id} has no walkable landing on the {floor} floor at {lift.x},{lift.z}"
                for floor in lift.floors if (lift.x, lift.z) not in survey.walkable[floor]]
    problems += [f"lift {lift.id} is {apart} blocks from {low} to {high}; an elevator reaches {LIFT_REACH}"
                 for low, high, apart, _solid in M.lift_gaps(survey.grid, lift) if apart > LIFT_REACH]
    return problems


def check_lifts(survey: Survey) -> list[str]:
    """Lifts can be used on every floor they stop at."""
    return [problem for lift in L.LIFTS for problem in _lift_problems(survey, lift)]


# --- all of it ---

CHECKS = (check_shapes, check_doors, check_stairs, check_walls, check_bounds, check_floors, check_connectivity,
          check_pads, check_machines, check_pollution, check_rain, check_launch, check_cover, check_lifts)


def audit(grid: dict) -> list[str]:
    """Everything wrong with the plan, in the order the checks run."""
    survey = Survey(grid)
    return [problem for check in CHECKS for problem in check(survey)]
