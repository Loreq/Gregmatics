"""Record types. Coordinates are world X and Z, both ends inside. Y comes from the floor."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterator

# One step toward each side, as (dx, dz). North is -Z.
DIRS = {"n": (0, -1), "s": (0, 1), "e": (1, 0), "w": (-1, 0)}
OPPOSITE = {"n": "s", "s": "n", "e": "w", "w": "e"}

# A footprint as (x0, x1, z0, z1).
Box = tuple


class LayoutError(ValueError):
    """The plan has a record the model cannot use."""


def cells_in(box: Box) -> Iterator[tuple]:
    """Every (x, z) in a footprint, column by column."""
    x0, x1, z0, z1 = box
    for x in range(x0, x1 + 1):
        for z in range(z0, z1 + 1):
            yield x, z


class Boxed:
    """A record with a footprint: x0..x1 by z0..z1."""

    @property
    def box(self) -> Box:
        """The footprint as (x0, x1, z0, z1)."""
        return self.x0, self.x1, self.z0, self.z1

    @property
    def size(self) -> tuple:
        """Blocks across X, then blocks across Z."""
        return self.x1 - self.x0 + 1, self.z1 - self.z0 + 1

    def cells(self) -> Iterator[tuple]:
        """Every (x, z) the footprint covers."""
        return cells_in(self.box)


@dataclass(frozen=True)
class Floor:
    """One storey: its slab, its air, and the outline it is drawn with."""

    id: str
    name: str
    # The solid block under the floor. Air starts one above it.
    slab: int
    # Standard room, street, and door height. Rooms may set their own.
    height: int = 5
    # Outline color of this floor on the sheets, and when it shows through on another floor.
    pen: str = "#282C32"
    # Optional footprint, both ends inside. Omitted means the whole plan: the site, inside the
    # rim, for the main floor, and that floor's footprint for every other floor.
    x0: int | None = None
    x1: int | None = None
    z0: int | None = None
    z1: int | None = None

    @property
    def air(self) -> tuple:
        """The lowest and highest Y of the floor's standard air."""
        return self.slab + 1, self.slab + self.height

    @property
    def walk(self) -> int:
        """Head height: the Y a floor plan is cut at."""
        return self.slab + 2

    @property
    def span(self) -> Box | None:
        """The footprint the plan gives this floor, or None when it leaves it out."""
        return None if self.x0 is None else (self.x0, self.x1, self.z0, self.z1)


@dataclass(frozen=True)
class Room(Boxed):
    """A dug room. Its id is also the tag its cells carry in the model."""

    id: str
    floor: str
    name: str
    code: str
    color: str
    x0: int
    x1: int
    z0: int
    z1: int
    y0: int
    y1: int
    label_at: tuple
    # Clean rooms must sit at least two chunk steps from a dirty chunk.
    clean: bool = False
    # At grade: the ground over part of the room is too thin to be the roof.
    grade: bool = False
    # What closes the top of a room at grade: "glass" lets the sky in, "built" is solid.
    roof: str = "rock"

    @property
    def style(self) -> str:
        """The tag a room's cells carry in the voxel model."""
        return self.id


@dataclass(frozen=True)
class Street(Boxed):
    """A walkway, or the entrance when its style is "entry"."""

    id: str
    floor: str
    x0: int
    x1: int
    z0: int
    z1: int
    y0: int
    y1: int
    style: str = "corridor"
    # A pipe trench runs under it in the crawl.
    trench: bool = True
    carve: tuple = ()
    label: str = ""
    label_at: tuple = ()
    label_vertical: bool = False


@dataclass(frozen=True)
class Door(Boxed):
    """An opening through the one-block wall between two spaces."""

    id: str
    floor: str
    x0: int
    x1: int
    z0: int
    z1: int
    y0: int
    y1: int


@dataclass(frozen=True)
class Stair(Boxed):
    """A climb between two floors, with the same footprint on both."""

    id: str
    x0: int
    x1: int
    z0: int
    z1: int
    y0: int
    y1: int
    # Side of the footprint where the stair starts at the bottom.
    low: str
    # The floor at the bottom of the climb, then the floor at the top.
    floors: tuple = ("main", "upper")


@dataclass(frozen=True)
class Shaft(Boxed):
    """Open to the sky: dug from just above its room's ceiling up through the ground."""

    id: str
    room: str
    floor: str
    x0: int
    x1: int
    z0: int
    z1: int
    y0: int
    label: str = ""
    # "glass" at the top lets the sky in and keeps the rain out. Rockets need it left open.
    cap: str = ""


@dataclass(frozen=True)
class Lift:
    """One elevator block per floor, all at the same X and Z."""

    id: str
    x: int
    z: int
    floors: tuple
    label: str = ""

    @property
    def box(self) -> Box:
        """The one block the lift stands on."""
        return self.x, self.x, self.z, self.z


@dataclass(frozen=True)
class Trench(Boxed):
    """A run of the pipe crawl."""

    id: str
    x0: int
    x1: int
    z0: int
    z1: int
    # The crawlspace this run is dug in. Empty means the only one, or the one named crawl.
    crawl: str = ""


@dataclass(frozen=True)
class Pad(Boxed):
    """A multiblock's footprint, or a wallshared row of them."""

    num: int
    key: str
    room: str
    x0: int
    x1: int
    z0: int
    z1: int
    y: int
    front: str = "n"
    h: int = 0
    share: bool = False
    # Modules along X and along Z. A shared wall is one block, so each added module grows by size − 1.
    wx: int = 1
    wz: int = 1
    # "x" or "z" when the far rank faces the opposite way.
    flip: str = ""
    # Shell structures (the cleanroom) are walls only; this cell is their door.
    door: tuple = ()
    label: str = ""


@dataclass(frozen=True)
class Wall:
    """A row of singleblock machines, one per slot."""

    id: str
    room: str
    x: int
    z: int
    along: str
    face: str
    codes: tuple
    y: int
    # One voltage per slot, parallel to codes. Empty means every machine is MV.
    tiers: tuple = ()
    title: str = ""

    @property
    def box(self) -> Box:
        """The cells the row covers, empty slots included."""
        dx, dz = DIRS[self.along]
        last = max(1, len(self.codes)) - 1
        xe, ze = self.x + dx * last, self.z + dz * last
        return min(self.x, xe), max(self.x, xe), min(self.z, ze), max(self.z, ze)


@dataclass(frozen=True)
class Mark(Boxed):
    """Something painted on a room's floor: an area, a ring, a service core, or a name."""

    room: str
    x0: int
    x1: int
    z0: int
    z1: int
    label: str
    short: str = ""
    # "box", "circle", "well", "service", or "text" (a painted name, such as an aisle's).
    shape: str = "box"
    radius: int = 0
    vertical: bool = False
    # Only drawn on detail sheets.
    detail: bool = False


@dataclass(frozen=True)
class Machine:
    """One singleblock machine: a filled slot of a machine row."""

    code: str
    x: int
    z: int
    y: int
    face: str
    wall: str
    index: int
    room: str
    tier: str
