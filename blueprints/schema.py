"""Record types. Coordinates are world X and Z, both ends inside. Y comes from the floor."""

from dataclasses import dataclass

DIRS = {"n": (0, -1), "s": (0, 1), "e": (1, 0), "w": (-1, 0)}


class LayoutError(ValueError):
    """The plan has a record the model cannot use."""


@dataclass(frozen=True)
class Floor:
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
        return self.slab + 1, self.slab + self.height

    @property
    def walk(self) -> int:
        """Head height: the Y a floor plan is cut at."""
        return self.slab + 2


@dataclass(frozen=True)
class Room:
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
class Street:
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
class Door:
    id: str
    floor: str
    x0: int
    x1: int
    z0: int
    z1: int
    y0: int
    y1: int


@dataclass(frozen=True)
class Stair:
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
class Shaft:
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


@dataclass(frozen=True)
class Trench:
    id: str
    x0: int
    x1: int
    z0: int
    z1: int


@dataclass(frozen=True)
class Pad:
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


@dataclass(frozen=True)
class Mark:
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
    code: str
    x: int
    z: int
    y: int
    face: str
    wall: str
    index: int
    room: str
    tier: str
