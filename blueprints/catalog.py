"""GTNH 2.9.0 machine facts, loaded from catalog/.

Add a multiblock by putting an object in catalog/multiblocks/<tier>.json.
The file name is the tier in lower case: stone.json, lv.json, ev.json.
A structure with no voltage tier goes in other.json, with "tier": "-".
A new tier is a new file, named from the voltage list below.

Add a machine by putting an object in catalog/machines/<group>.json.
A machine's voltage is chosen when it is placed, so these files are grouped
by what the machine does. A new group needs a name in groups.json and a file.

Size is [width, depth, height]: the one size, or the size a new one is placed at.
A structure the wiki gives a range for also has span: [low, high] for both sides
and then for the height, or [low, high] for width, depth, and height when only one
side grows. square keeps the two sides equal, and odd keeps each side odd. A
structure with only a few legal sizes lists them in fits. A turn swaps width and
depth, so either way round is legal.

Pollution on a multiblock is gibbl/s with a basic LV muffler. muffler is true when
the structure has a muffler hatch. front_air is [depth, width] of air in front of
the controller.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

DIR = Path(__file__).resolve().parent / "catalog"

# GTNH 2.9.0 quest tabs, in QuestLinesOrder.txt order on the 2.9.0 tag.
# Tier 0 is Stone Age, Tier 0.5 is Steam, Tier 1 is LV, and Tier 12 is UMV.
VOLTAGE = ("Stone", "Steam", "LV", "MV", "HV", "EV", "IV", "LuV", "ZPM", "UV", "UHV", "UEV", "UIV", "UMV")
SELECTABLE = VOLTAGE
SLOT = VOLTAGE[VOLTAGE.index("LV"):]
_TIER_BY_FILE = {name.lower(): name for name in VOLTAGE}
_TIER_BY_FILE["other"] = "-"


class CatalogError(ValueError):
    """A catalog JSON file cannot be loaded."""


@dataclass(frozen=True)
class Multi:
    key: str
    name: str
    short: str
    tier: str
    size: tuple
    pollution: int = 0
    muffler: bool = False
    source: str = ""
    gt: bool = True
    shell: bool = False
    # Blocks of air the controller face needs, as (depth, width).
    front_air: tuple = (1, 1)
    # Ring of air around the footprint at the side faces (EAF mufflers).
    side_air: bool = False
    # Shares a wall with another of itself, so a run is one structure.
    share: bool = False
    # Must have open sky straight above (rocket launch pads).
    sky: bool = False
    note: str = ""
    # (low, high) for both sides and then the height, or for width, depth, and height.
    span: tuple = ()
    # The two sides have to match.
    square: bool = False
    # Each side has to be an odd number.
    odd: bool = False
    # The only legal (width, depth, height) sizes.
    fits: tuple = ()

    def ranges(self) -> tuple:
        """Width, depth, and height from span, each as (low, high)."""
        s = self.span
        if len(s) == 4:
            return (s[0], s[1]), (s[0], s[1]), (s[2], s[3])
        return (s[0], s[1]), (s[2], s[3]), (s[4], s[5])

    def allows(self, wide: int, deep: int, high: int) -> bool:
        """Whether one module can be built this size. A turn swaps width and depth."""
        if self.fits:
            return (wide, deep, high) in self.fits or (deep, wide, high) in self.fits
        if not self.span:
            return sorted((wide, deep)) == sorted(self.size[:2]) and high == self.size[2]
        x, z, h = self.ranges()
        if self.square and wide != deep:
            return False
        if not h[0] <= high <= h[1]:
            return False

        def fits_side(n: int, side: tuple) -> bool:
            return side[0] <= n <= side[1] and (not self.odd or n % 2 == 1)

        return (fits_side(wide, x) and fits_side(deep, z)) or (fits_side(wide, z) and fits_side(deep, x))

    def size_text(self) -> str:
        """The legal sizes, written the way editor/core.js sizeText writes them."""
        if self.fits:
            return ", ".join("×".join(map(str, item)) for item in self.fits)
        if not self.span:
            return "×".join(map(str, self.size))

        def part(side: tuple, odd: bool) -> str:
            low, high = side
            if low == high:
                return str(low)
            if odd:
                return "/".join(str(n) for n in range(low, high + 1) if n % 2 == 1)
            return f"{low}–{high}"

        x, z, h = self.ranges()
        if self.square:
            return f"{part(x, self.odd)} square × {part(h, False)}"
        return f"{part(x, self.odd)}×{part(z, self.odd)}×{part(h, False)}"


@dataclass(frozen=True)
class Single:
    code: str
    name: str
    group: str
    amps: int = 1
    pollution: bool = False
    gt: bool = True
    note: str = ""


def _read(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as err:
        raise CatalogError(f"{path.relative_to(DIR.parent)} is not valid JSON: line {err.lineno}: {err.msg}") from None


def _where(path: Path, index: int, label: str) -> str:
    return f"{path.relative_to(DIR.parent)}[{index}] {label}"


def _need(row: dict, field: str, where: str):
    if field not in row:
        raise CatalogError(f"{where}: missing {field}")
    return row[field]


def _str(value, where: str, field: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise CatalogError(f"{where}: {field} should be text")
    return value


def _bool(value, where: str, field: str) -> bool:
    if not isinstance(value, bool):
        raise CatalogError(f"{where}: {field} should be true or false")
    return value


def _int(value, where: str, field: str, low: int = 0) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < low:
        raise CatalogError(f"{where}: {field} should be a whole number of at least {low}")
    return value


def _triple(value, where: str, field: str) -> tuple:
    if not isinstance(value, list) or len(value) != 3:
        raise CatalogError(f"{where}: {field} should be three whole numbers")
    return tuple(_int(n, where, field, low=1) for n in value)


def _span(value, where: str) -> tuple:
    if not isinstance(value, list) or len(value) not in (4, 6):
        raise CatalogError(f"{where}: span should be four or six whole numbers")
    nums = tuple(_int(n, where, "span", low=1) for n in value)
    if any(nums[i] > nums[i + 1] for i in range(0, len(nums), 2)):
        raise CatalogError(f"{where}: span should list each low before its high")
    return nums


def _fits(value, where: str) -> tuple:
    if not isinstance(value, list) or not value:
        raise CatalogError(f"{where}: fits should list one or more sizes")
    return tuple(_triple(item, where, "fits") for item in value)


def _pair(value, where: str, field: str) -> tuple:
    if not isinstance(value, list) or len(value) != 2:
        raise CatalogError(f"{where}: {field} should be two whole numbers")
    return tuple(_int(n, where, field, low=1) for n in value)


def _known(row: dict, allowed: set, where: str) -> None:
    extra = [key for key in row if key not in allowed]
    if extra:
        raise CatalogError(f"{where}: unknown field {extra[0]}")


_MULTI_FIELDS = {
    "key", "name", "short", "tier", "size", "pollution", "muffler", "source",
    "gt", "shell", "front_air", "side_air", "sky", "share", "note", "span", "square", "odd", "fits",
}
_SINGLE_FIELDS = {"code", "name", "group", "amps", "pollution", "gt", "note"}
_ELEVATOR_FIELDS = {"reach", "solid", "source"}


def _tier_name(stem: str) -> str:
    try:
        return _TIER_BY_FILE[stem]
    except KeyError:
        known = ", ".join(name.lower() for name in VOLTAGE)
        raise CatalogError(
            f"catalog/multiblocks/{stem}.json is not a tier file. Use {known}, or other.json."
        ) from None


def _load_groups() -> dict:
    path = DIR / "groups.json"
    data = _read(path)
    if not isinstance(data, dict) or not data:
        raise CatalogError("catalog/groups.json should be an object of group id to name")
    groups = {}
    for key, name in data.items():
        if not isinstance(key, str) or not isinstance(name, str) or not name.strip():
            raise CatalogError(f"catalog/groups.json: {key!r} needs a name")
        groups[key] = name
    return groups


def _load_multis() -> dict:
    folder = DIR / "multiblocks"
    paths = {_tier_name(path.stem): path for path in folder.glob("*.json")}
    order = [name for name in VOLTAGE if name in paths]
    if "-" in paths:
        order.append("-")
    multis = {}
    for tier in order:
        path = paths[tier]
        rows = _read(path)
        if not isinstance(rows, list):
            raise CatalogError(f"{path.relative_to(DIR.parent)} should be a list")
        for index, row in enumerate(rows):
            if not isinstance(row, dict):
                raise CatalogError(f"{path.relative_to(DIR.parent)}[{index}] should be an object")
            key = _str(_need(row, "key", _where(path, index, "?")), _where(path, index, "?"), "key")
            where = _where(path, index, key)
            _known(row, _MULTI_FIELDS, where)
            got = _str(_need(row, "tier", where), where, "tier")
            if got != tier:
                raise CatalogError(f"{where}: tier is {got}, this file is for {tier}")
            if key in multis:
                raise CatalogError(f"{where}: key {key} is already used")
            air = _pair(row["front_air"], where, "front_air") if "front_air" in row else (1, 1)
            note = row.get("note") or ""
            if note and not isinstance(note, str):
                raise CatalogError(f"{where}: note should be text")
            span = _span(row["span"], where) if "span" in row else ()
            if "fits" in row and "span" in row:
                raise CatalogError(f"{where}: use span or fits, not both")
            fits = _fits(row["fits"], where) if "fits" in row else ()
            if not span and ("square" in row or "odd" in row):
                raise CatalogError(f"{where}: square and odd describe a span")
            multi = Multi(
                key=key,
                name=_str(_need(row, "name", where), where, "name"),
                short=_str(_need(row, "short", where), where, "short"),
                tier=tier,
                size=_triple(_need(row, "size", where), where, "size"),
                pollution=_int(row.get("pollution", 0), where, "pollution"),
                muffler=_bool(row.get("muffler", False), where, "muffler"),
                source=_str(row["source"], where, "source") if row.get("source") else "",
                gt=_bool(row.get("gt", True), where, "gt"),
                shell=_bool(row.get("shell", False), where, "shell"),
                front_air=air,
                side_air=_bool(row.get("side_air", False), where, "side_air"),
                share=_bool(row.get("share", False), where, "share"),
                sky=_bool(row.get("sky", False), where, "sky"),
                note=note,
                span=span,
                square=_bool(row.get("square", False), where, "square"),
                odd=_bool(row.get("odd", False), where, "odd"),
                fits=fits,
            )
            if not multi.allows(*multi.size):
                placed = "×".join(map(str, multi.size))
                raise CatalogError(f"{where}: size {placed} is not one of the sizes it allows ({multi.size_text()})")
            multis[key] = multi
    return multis


def _load_singles(groups: dict) -> dict:
    folder = DIR / "machines"
    singles = {}
    seen_files = set()
    for group in groups:
        path = folder / f"{group}.json"
        if not path.exists():
            raise CatalogError(f"catalog/machines/{group}.json is missing. Add it, or take {group} out of groups.json.")
        seen_files.add(path.name)
        rows = _read(path)
        if not isinstance(rows, list):
            raise CatalogError(f"{path.relative_to(DIR.parent)} should be a list")
        for index, row in enumerate(rows):
            if not isinstance(row, dict):
                raise CatalogError(f"{path.relative_to(DIR.parent)}[{index}] should be an object")
            code = _str(_need(row, "code", _where(path, index, "?")), _where(path, index, "?"), "code")
            where = _where(path, index, code)
            _known(row, _SINGLE_FIELDS, where)
            got = _str(_need(row, "group", where), where, "group")
            if got != group:
                raise CatalogError(f"{where}: group is {got}, this file is for {group}")
            if code in singles:
                raise CatalogError(f"{where}: code {code} is already used")
            note = row.get("note") or ""
            if note and not isinstance(note, str):
                raise CatalogError(f"{where}: note should be text")
            singles[code] = Single(
                code=code,
                name=_str(_need(row, "name", where), where, "name"),
                group=group,
                amps=_int(row.get("amps", 1), where, "amps", low=1),
                pollution=_bool(row.get("pollution", False), where, "pollution"),
                gt=_bool(row.get("gt", True), where, "gt"),
                note=note,
            )
    extra = [path.name for path in folder.glob("*.json") if path.name not in seen_files]
    if extra:
        raise CatalogError(
            "catalog/machines has files with no group in groups.json: " + ", ".join(sorted(extra))
        )
    return singles


def _load_elevator() -> dict:
    path = DIR / "elevator.json"
    row = _read(path)
    if not isinstance(row, dict):
        raise CatalogError("catalog/elevator.json should be an object")
    _known(row, _ELEVATOR_FIELDS, "catalog/elevator.json")
    return {
        "reach": _int(_need(row, "reach", "catalog/elevator.json"), "catalog/elevator.json", "reach", low=1),
        "solid": _int(_need(row, "solid", "catalog/elevator.json"), "catalog/elevator.json", "solid", low=0),
        "source": _str(_need(row, "source", "catalog/elevator.json"), "catalog/elevator.json", "source"),
    }


GROUPS = _load_groups()
MULTIS = _load_multis()
SINGLES = _load_singles(GROUPS)
ELEVATOR = _load_elevator()
