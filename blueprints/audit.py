"""Checks that the plan can be built and walked, and that it follows the pack's rules."""

from __future__ import annotations

import layout as L
import model as M
from catalog import ELEVATOR, MULTIS, SINGLES
from schema import DIRS

LIFT_REACH = ELEVATOR["reach"]

ROOMS = {room.id: room for room in L.ROOMS}
FLOORS = tuple(M.FLOORS)


def check_shapes(errors):
    for street in L.STREETS:
        wide = street.x1 - street.x0 + 1
        deep = street.z1 - street.z0 + 1
        if street.style == "entry":
            if wide < 3:
                errors.append(f"street {street.id} is narrower than 3")
            continue
        if min(wide, deep) < 3:
            errors.append(f"street {street.id} is narrower than 3")
    for door in L.DOORS:
        w, d = door.x1 - door.x0 + 1, door.z1 - door.z0 + 1
        if min(w, d) != 1 or max(w, d) < 3:
            errors.append(f"door {door.id} is {w}×{d}; want a 1-deep slit, 3 or more wide")
    for pad in L.PADS:
        spec = MULTIS[pad.key]
        # A wallshared row is judged one module at a time.
        wide, deep = M.module_size(pad)
        high = M.pad_height(pad)
        if not spec.allows(wide, deep, high):
            errors.append(f"pad {pad.num} {spec.name} is {wide}×{deep}×{high}; the wiki size is {spec.size_text()}")
        if spec.shell and not pad.door:
            errors.append(f"pad {pad.num} {spec.name} needs a door cell")
    for m in M.machines():
        if m.code not in SINGLES:
            errors.append(f"wall {m.wall} slot {m.index} has unknown machine {m.code}")


def check_doors(grid, errors):
    for door in L.DOORS:
        level = (door.y0 + door.y1) // 2
        vertical = door.x0 == door.x1
        for x, z in M.iter_rect(door.x0, door.x1, door.z0, door.z1):
            if vertical:
                sides = (M.style_at(grid, x - 1, z, level), M.style_at(grid, x + 1, z, level))
            else:
                sides = (M.style_at(grid, x, z - 1, level), M.style_at(grid, x, z + 1, level))
            if "rock" in sides:
                errors.append(f"door {door.id} at {x},{z} opens onto rock ({sides[0]} / {sides[1]})")
                break


def stair_ends(stair, depth=3):
    """Stair cells in the first and last `depth` rows of the climb."""
    cells = list(M.iter_rect(stair.x0, stair.x1, stair.z0, stair.z1))
    if stair.low in "ns":
        rows = range(stair.z0, stair.z1 + 1)
        pick = (lambda c: c[1])
    else:
        rows = range(stair.x0, stair.x1 + 1)
        pick = (lambda c: c[0])
    ordered = list(rows) if stair.low in "nw" else list(reversed(rows))
    low_rows, high_rows = set(ordered[:depth]), set(ordered[-depth:])
    return [c for c in cells if pick(c) in low_rows], [c for c in cells if pick(c) in high_rows]


def check_stairs(grid, errors):
    for stair in L.STAIRS:
        low_cells, high_cells = stair_ends(stair)
        cells = set(M.iter_rect(stair.x0, stair.x1, stair.z0, stair.z1))

        def landing(zone, floor):
            for x, z in zone:
                for dx, dz in DIRS.values():
                    nxt = (x + dx, z + dz)
                    if nxt not in cells and M.floor_style(grid, *nxt, floor) in M.WALKABLE:
                        return True
            return False

        bottom, top = stair.floors
        if not landing(low_cells, bottom):
            errors.append(f"{stair.id} has no {bottom}-floor landing at its low end")
        if not landing(high_cells, top):
            errors.append(f"{stair.id} has no {top}-floor landing at its high end")
        for door in L.DOORS:
            touching = [
                (x + ddx, z + ddz)
                for x, z in M.iter_rect(door.x0, door.x1, door.z0, door.z1)
                for ddx, ddz in DIRS.values()
                if (x + ddx, z + ddz) in cells
            ]
            if not touching:
                continue
            floor = M.floor_of(door.y0)
            if floor not in stair.floors:
                errors.append(f"door {door.id} opens into {stair.id} between floors")
                continue
            allowed = set(low_cells if floor == bottom else high_cells)
            if not all(cell in allowed for cell in touching):
                end = "low" if floor == bottom else "high"
                errors.append(f"door {door.id} meets {stair.id} away from its {end} end")


def check_walls(grid, errors):
    for floor in FLOORS:
        reported = 0
        for (x, z) in list(grid):
            here = M.floor_style(grid, x, z, floor)
            if here not in M.ROOM_STYLES:
                continue
            for dx, dz in DIRS.values():
                other = M.floor_style(grid, x + dx, z + dz, floor)
                if other in M.ROOM_STYLES and other != here:
                    errors.append(f"{here} touches {other} at {x},{z} with no wall")
                    reported += 1
                    break
                if other == "rock":
                    mid = M.floor_style(grid, x + 2 * dx, z + 2 * dz, floor)
                    far = M.floor_style(grid, x + 3 * dx, z + 3 * dz, floor)
                    if mid == "rock" and far in M.STREET_STYLES:
                        errors.append(f"{here} is two blocks from a street at {x},{z}; use a 1-block wall")
                        reported += 1
                        break
            if reported > 6:
                return


def check_bounds(grid, errors):
    x0, x1, z0, z1 = L.INNER
    for (x, z), spans in grid.items():
        for _a, _b, style in spans:
            if style == "well":
                continue
            if style == "entry":
                if z >= L.SQUARE[2]:
                    errors.append(f"entrance is inside the square at {x},{z}")
                continue
            inside = x0 <= x <= x1 and z0 <= z <= z1
            entry = next(s for s in L.STREETS if s.style == "entry")
            spine_mouth = z == L.SQUARE[2] and entry.x0 <= x <= entry.x1 and style in ("corridor", "trench")
            if not inside and not spine_mouth:
                errors.append(f"{style} reaches the rim or beyond at {x},{z}")
                return


def check_floors(grid, errors):
    for (x, z), spans in grid.items():
        for (a0, a1, sa), (b0, b1, sb) in zip(spans, spans[1:]):
            if {"stair", "well"} & {sa, sb}:
                continue
            gap = b0 - a1 - 1
            if gap < 2:
                errors.append(f"only {gap} solid between {sa} and {sb} at {x},{z}")
                return


def check_connectivity(grid, errors):
    for floor in FLOORS:
        cells = M.walkable(grid, floor)
        parts = M.components(cells)
        if len(parts) > 1:
            sizes = sorted((len(p), sorted(p)[0]) for p in parts)
            errors.append(f"{floor} floor splits into {len(parts)} walkable pieces: {sizes[:4]}")
    y = L.CRAWL["walk"]
    pipes = M.components({(x, z) for (x, z) in grid if M.style_at(grid, x, z, y) == "trench"})
    if len(pipes) != 1:
        errors.append(f"{L.CRAWL['name'].lower()} splits into {len(pipes)} pieces: {sorted(len(p) for p in pipes)}")


def check_pads(grid, errors):
    # Keyed by floor, because two floors can hold multiblocks over the same X and Z.
    blocks = {}
    for pad in L.PADS:
        spec = MULTIS[pad.key]
        room = ROOMS[pad.room]
        top = pad.y + M.pad_height(pad) - 1
        for x, z in M.pad_cells(pad):
            if M.style_at(grid, x, z, pad.y) != room.style or M.style_at(grid, x, z, top) != room.style:
                errors.append(f"pad {pad.num} {spec.name} does not fit inside {room.name} at {x},{z}")
                break
            # Advanced muffler needs 3 blocks of air.
            if spec.muffler and any(M.style_at(grid, x, z, top + k) != room.style for k in (1, 2, 3)):
                errors.append(f"pad {pad.num} {spec.name} lacks 3 blocks of air over its muffler at {x},{z}")
                break
        floor = M.floor_of(pad.y)
        for cell in M.pad_blocks(pad):
            other = blocks.get((floor, cell))
            if other and not (other.share and pad.share):
                errors.append(f"pad {pad.num} overlaps pad {other.num} at {cell}")
                break
            blocks[(floor, cell)] = pad
    floor_cells = {floor: M.walkable(grid, floor) for floor in FLOORS}
    for pad in L.PADS:
        spec = MULTIS[pad.key]
        floor = M.floor_of(pad.y)
        inside = set(M.pad_cells(pad))
        for mx0, mx1, mz0, mz1, front in M.modules(pad):
            sub = type("Mod", (), {"key": pad.key, "x0": mx0, "x1": mx1, "z0": mz0, "z1": mz1, "front": front})()
            for cell in M.pad_front(sub, depth=0):
                if cell in inside:
                    continue
                if cell not in floor_cells[floor]:
                    errors.append(f"pad {pad.num} {spec.name} needs clear floor in front of its controller at {cell}")
                    break
        if spec.side_air:
            ring = set()
            for x, z in M.pad_cells(pad):
                for dx, dz in DIRS.values():
                    ring.add((x + dx, z + dz))
            ring -= set(M.pad_cells(pad))
            for cell in ring:
                if cell not in floor_cells[floor]:
                    errors.append(f"pad {pad.num} {spec.name} needs air beside its mufflers at {cell}")
                    break
        if spec.shell:
            dx, dz = DIRS[pad.front]
            outside = (pad.door[0] + dx, pad.door[1] + dz)
            inside = (pad.door[0] - dx, pad.door[1] - dz)
            for cell in (outside, inside):
                if cell not in floor_cells[floor]:
                    errors.append(f"pad {pad.num} {spec.name} door does not open at {cell}")


def check_machines(grid, errors):
    # Every lookup here is (x, z, floor): another floor can use the same X and Z.
    pad_cells = {}
    for pad in L.PADS:
        floor = M.floor_of(pad.y)
        for x, z in M.pad_blocks(pad):
            pad_cells[(x, z, floor)] = pad
    seen = {}
    service = set()
    for mark in L.MARKS:
        if mark.shape == "service":
            floor = M.ROOM_FLOOR[mark.room]
            service.update((x, z, floor) for x, z in M.iter_rect(mark.x0, mark.x1, mark.z0, mark.z1))
    floor_cells = {floor: M.walkable(grid, floor) for floor in FLOORS}
    for m in M.machines():
        room = ROOMS[m.room]
        if M.style_at(grid, m.x, m.z, m.y) != room.style:
            errors.append(f"{m.code} in wall {m.wall} is outside {room.name} at {m.x},{m.z}")
            continue
        key = (m.x, m.z, M.floor_of(m.y))
        if key in seen:
            errors.append(f"{m.code} in wall {m.wall} overlaps {seen[key]} at {m.x},{m.z}")
        seen[key] = f"{m.code} ({m.wall})"
        if key in pad_cells:
            errors.append(f"{m.code} in wall {m.wall} sits on pad {pad_cells[key].num}")
        if key in service:
            errors.append(f"{m.code} in wall {m.wall} sits in a service core")
        dx, dz = DIRS[m.face]
        front = (m.x + dx, m.z + dz)
        if front not in floor_cells[M.floor_of(m.y)]:
            errors.append(f"{m.code} in wall {m.wall} faces a blocked cell at {front}")


def check_pollution(grid, errors):
    dirty = L.DIRTY
    polluters = []
    for pad in L.PADS:
        if MULTIS[pad.key].pollution:
            polluters += [(f"pad {pad.num} {MULTIS[pad.key].name}", x, z) for x, z in M.pad_cells(pad)]
    for m in M.machines():
        if SINGLES[m.code].pollution:
            polluters.append((f"{m.code} in wall {m.wall}", m.x, m.z))
    for name, x, z in polluters:
        if M.chunk_name(x, z) not in dirty:
            errors.append(f"{name} pollutes outside the dirty chunks, at {M.chunk_name(x, z)}")
            break
    dirty_xy = {M.chunk(*M.chunk_bounds(c)[0::2]) for c in dirty}
    for room in L.ROOMS:
        if not room.clean:
            continue
        for x, z in M.iter_rect(room.x0, room.x1, room.z0, room.z1):
            cx, cz = M.chunk(x, z)
            steps = min(abs(cx - dx) + abs(cz - dz) for dx, dz in dirty_xy)
            if steps < 2:
                errors.append(f"{room.name} is within one chunk of the dirty block at {M.chunk_name(x, z)}")
                break
    covered = set()
    for pad in L.PADS:
        if pad.key != "eaf":
            continue
        cx, cz = M.chunk((pad.x0 + pad.x1) // 2, (pad.z0 + pad.z1) // 2)
        covered |= {(cx + i, cz + j) for i in (-1, 0, 1) for j in (-1, 0, 1)}
    for name, x, z in polluters:
        if M.chunk(x, z) not in covered:
            errors.append(f"{name} is outside the air filter's 3×3 chunks")
            break
    for m in M.machines():
        if m.code == "PDD" and M.chunk_name(m.x, m.z) not in dirty:
            errors.append(f"pollution alarm in wall {m.wall} reads chunk {M.chunk_name(m.x, m.z)}, "
                          "outside the dirty block, so it only sounds after pollution spreads")


def check_rain(grid, errors):
    wet = M.sky_exposed(grid)
    for pad in L.PADS:
        if not MULTIS[pad.key].gt:
            continue
        for x, z in M.pad_cells(pad):
            if any((x, z, y) in wet for y in range(pad.y, pad.y + M.pad_height(pad))):
                errors.append(f"pad {pad.num} {MULTIS[pad.key].name} is under open sky")
                break
    for m in M.machines():
        if SINGLES[m.code].gt and (m.x, m.z, m.y) in wet:
            errors.append(f"{m.code} in wall {m.wall} is under open sky")


def check_launch(grid, errors):
    wet = M.sky_exposed(grid)
    loaders = [m for m in M.machines() if m.code == "FUL"]
    for pad in L.PADS:
        spec = MULTIS[pad.key]
        if not spec.sky:
            continue
        if not all((x, z, pad.y) in wet for x, z in M.pad_cells(pad)):
            errors.append(f"pad {pad.num} {spec.name} is not under an open shaft to the sky")
        cells = set(M.pad_cells(pad))
        touching = [m for m in loaders
                    if any((m.x + dx, m.z + dz) in cells for dx, dz in DIRS.values()) and m.y == pad.y]
        if not touching:
            errors.append(f"pad {pad.num} {spec.name} has no fuel loader touching it")


def stair_tops(stair):
    """(x, z, top of the air) along a stair: 5 high at the low end, rising to y1 at the high end."""
    low_cells, _high = stair_ends(stair, depth=1)
    along_z = stair.low in "ns"
    start = low_cells[0][1] if along_z else low_cells[0][0]
    length = (stair.z1 - stair.z0 if along_z else stair.x1 - stair.x0) or 1
    low_top = stair.y0 + 4
    for x, z in M.iter_rect(stair.x0, stair.x1, stair.z0, stair.z1):
        step = abs((z if along_z else x) - start) / length
        yield x, z, low_top + (stair.y1 - low_top) * step


def check_cover(errors):
    spaces = [(room.name, room.x0, room.x1, room.z0, room.z1, room.y1, room.grade) for room in L.ROOMS]
    spaces += [(f"street {s.id}", s.x0, s.x1, s.z0, s.z1, s.y1, False) for s in L.STREETS]
    for name, x0, x1, z0, z1, top, grade in spaces:
        thinnest = min((M.cover(x, z, top), x, z) for x, z in M.iter_rect(x0, x1, z0, z1))
        if grade and thinnest[0] >= L.COVER:
            errors.append(f"{name} is marked at grade but keeps {thinnest[0]:.0f} blocks of rock overhead")
        elif not grade and thinnest[0] < L.COVER:
            errors.append(f"{name} has {thinnest[0]:.0f} blocks of rock over its ceiling at "
                          f"{thinnest[1]},{thinnest[2]}; it needs {L.COVER}, or mark it at grade")
    for stair in L.STAIRS:
        thinnest = min((M.surface(x, z) - top, x, z) for x, z, top in stair_tops(stair))
        if thinnest[0] < L.COVER:
            errors.append(f"{stair.id} has {thinnest[0]:.0f} blocks of rock over it at {thinnest[1]},{thinnest[2]}")


def check_lifts(grid, errors):
    floor_cells = {floor: M.walkable(grid, floor) for floor in FLOORS}
    for lift in L.LIFTS:
        for floor in lift.floors:
            if (lift.x, lift.z) not in floor_cells[floor]:
                errors.append(f"lift {lift.id} has no walkable landing on the {floor} floor at {lift.x},{lift.z}")
        for low, high, apart, _solid in M.lift_gaps(grid, lift):
            if apart > LIFT_REACH:
                errors.append(f"lift {lift.id} is {apart} blocks from {low} to {high}; an elevator reaches "
                              f"{LIFT_REACH}")


def audit(grid) -> list[str]:
    errors: list[str] = []
    check_shapes(errors)
    check_doors(grid, errors)
    check_stairs(grid, errors)
    check_walls(grid, errors)
    check_bounds(grid, errors)
    check_floors(grid, errors)
    check_connectivity(grid, errors)
    check_pads(grid, errors)
    check_machines(grid, errors)
    check_pollution(grid, errors)
    check_rain(grid, errors)
    check_launch(grid, errors)
    check_cover(errors)
    check_lifts(grid, errors)
    return errors
