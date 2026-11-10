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
from typing import Iterator

# The JSON lives in blueprints/catalog, beside this python folder.
DIR = Path(__file__).resolve().parent.parent / "catalog"

# GTNH 2.9.0 quest tabs, in QuestLinesOrder.txt order on the 2.9.0 tag.
# Tier 0 is Stone Age, Tier 0.5 is Steam, Tier 1 is LV, and Tier 12 is UMV.
VOLTAGE = ("Stone", "Steam", "LV", "MV", "HV", "EV", "IV", "LuV", "ZPM", "UV", "UHV", "UEV", "UIV", "UMV")
SELECTABLE = VOLTAGE
SLOT = VOLTAGE[VOLTAGE.index("LV"):]
# The tier of a structure that has no voltage. Those are filed in other.json.
NO_TIER = "-"
_TIER_BY_FILE = {name.lower(): name for name in VOLTAGE}
_TIER_BY_FILE["other"] = NO_TIER
_ELEVATOR_FILE = "catalog/elevator.json"


class CatalogError(ValueError):
    """A catalog JSON file cannot be loaded."""


def _within(n: int, side: tuple, odd: bool) -> bool:
    """Whether a length sits in a (low, high) range, and is odd when it has to be."""
    return side[0] <= n <= side[1] and (not odd or n % 2 == 1)


def _range_text(side: tuple, odd: bool) -> str:
    """A (low, high) range in a few characters: 5, 3–9, or 3/5/7 when only odd lengths count."""
    low, high = side
    if low == high:
        return str(low)
    if odd:
        return "/".join(str(n) for n in range(low, high + 1) if n % 2 == 1)
    return f"{low}–{high}"


def _times(numbers) -> str:
    """Numbers joined the way a size is written: 3×3×4."""
    return "×".join(map(str, numbers))


@dataclass(frozen=True)
class Multi:
    """One multiblock: its name, its tier, and the sizes the wiki allows it."""

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
        return self._in_span(wide, deep, high)

    def _in_span(self, wide: int, deep: int, high: int) -> bool:
        """Whether a size sits inside the ranges of span, either way round."""
        x, z, h = self.ranges()
        if self.square and wide != deep:
            return False
        if not h[0] <= high <= h[1]:
            return False
        direct = _within(wide, x, self.odd) and _within(deep, z, self.odd)
        turned = _within(wide, z, self.odd) and _within(deep, x, self.odd)
        return direct or turned

    def size_text(self) -> str:
        """The legal sizes, written the way editor/core/core-sizes.js sizeText writes them."""
        if self.fits:
            return ", ".join(_times(item) for item in self.fits)
        if not self.span:
            return _times(self.size)
        x, z, h = self.ranges()
        high = _range_text(h, False)
        if self.square:
            return f"{_range_text(x, self.odd)} square × {high}"
        return f"{_range_text(x, self.odd)}×{_range_text(z, self.odd)}×{high}"


@dataclass(frozen=True)
class Single:
    """One singleblock machine. Its voltage is chosen when it is placed."""

    code: str
    name: str
    group: str
    amps: int = 1
    pollution: bool = False
    gt: bool = True
    note: str = ""


# --- reading one value ---

def _read(path: Path):
    """A catalog file as parsed JSON."""
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as err:
        raise CatalogError(f"{_shown(path)} is not valid JSON: line {err.lineno}: {err.msg}") from None


def _shown(path: Path) -> str:
    """A catalog file the way a message names it, from the catalog folder down."""
    return str(path.relative_to(DIR.parent))


def _where(path: Path, index: int, label: str) -> str:
    """The row a message is about: its file, its place in the list, and its key or code."""
    return f"{_shown(path)}[{index}] {label}"


def _need(row: dict, field: str, where: str):
    """A field the row has to have."""
    if field not in row:
        raise CatalogError(f"{where}: missing {field}")
    return row[field]


def _str(value, where: str, field: str) -> str:
    """Text that is not blank."""
    if not isinstance(value, str) or not value.strip():
        raise CatalogError(f"{where}: {field} should be text")
    return value


def _bool(value, where: str, field: str) -> bool:
    """True or false, and nothing that merely acts like one."""
    if not isinstance(value, bool):
        raise CatalogError(f"{where}: {field} should be true or false")
    return value


def _int(value, where: str, field: str, low: int = 0) -> int:
    """A whole number of at least `low`."""
    if isinstance(value, bool) or not isinstance(value, int) or value < low:
        raise CatalogError(f"{where}: {field} should be a whole number of at least {low}")
    return value


def _flag(row: dict, where: str, field: str, default: bool = False) -> bool:
    """An optional true-or-false field."""
    return _bool(row.get(field, default), where, field)


def _triple(value, where: str, field: str) -> tuple:
    """A size: three whole numbers of at least 1."""
    if not isinstance(value, list) or len(value) != 3:
        raise CatalogError(f"{where}: {field} should be three whole numbers")
    return tuple(_int(n, where, field, low=1) for n in value)


def _pair(value, where: str, field: str) -> tuple:
    """Two whole numbers of at least 1."""
    if not isinstance(value, list) or len(value) != 2:
        raise CatalogError(f"{where}: {field} should be two whole numbers")
    return tuple(_int(n, where, field, low=1) for n in value)


def _span(value, where: str) -> tuple:
    """Four or six whole numbers, each low before its high."""
    if not isinstance(value, list) or len(value) not in (4, 6):
        raise CatalogError(f"{where}: span should be four or six whole numbers")
    nums = tuple(_int(n, where, "span", low=1) for n in value)
    if any(nums[i] > nums[i + 1] for i in range(0, len(nums), 2)):
        raise CatalogError(f"{where}: span should list each low before its high")
    return nums


def _fits(value, where: str) -> tuple:
    """One or more sizes."""
    if not isinstance(value, list) or not value:
        raise CatalogError(f"{where}: fits should list one or more sizes")
    return tuple(_triple(item, where, "fits") for item in value)


def _note(row: dict, where: str) -> str:
    """An optional note. Missing reads as no note."""
    note = row.get("note") or ""
    if note and not isinstance(note, str):
        raise CatalogError(f"{where}: note should be text")
    return note


def _known(row: dict, allowed: set, where: str) -> None:
    """Reject a field the loader does not know, so a typo is not silently dropped."""
    extra = [key for key in row if key not in allowed]
    if extra:
        raise CatalogError(f"{where}: unknown field {extra[0]}")


# --- reading one row ---

_MULTI_FIELDS = {
    "key", "name", "short", "tier", "size", "pollution", "muffler", "source",
    "gt", "shell", "front_air", "side_air", "sky", "share", "note", "span", "square", "odd", "fits",
}
_SINGLE_FIELDS = {"code", "name", "group", "amps", "pollution", "gt", "note"}
_ELEVATOR_FIELDS = {"reach", "solid", "source"}


def _rows(path: Path) -> Iterator[tuple]:
    """Each object of a catalog list, with its place in the list."""
    rows = _read(path)
    if not isinstance(rows, list):
        raise CatalogError(f"{_shown(path)} should be a list")
    for index, row in enumerate(rows):
        if not isinstance(row, dict):
            raise CatalogError(f"{_shown(path)}[{index}] should be an object")
        yield index, row


def _named(row: dict, path: Path, index: int, field: str) -> tuple:
    """A row's key or code, and the label later messages use for the row."""
    unnamed = _where(path, index, "?")
    name = _str(_need(row, field, unnamed), unnamed, field)
    return name, _where(path, index, name)


def _filed_under(row: dict, where: str, field: str, expected: str) -> None:
    """A row has to name the tier or group its file is for."""
    got = _str(_need(row, field, where), where, field)
    if got != expected:
        raise CatalogError(f"{where}: {field} is {got}, this file is for {expected}")


def _fresh(name: str, taken: dict, where: str, field: str) -> None:
    """A key or code may be used once."""
    if name in taken:
        raise CatalogError(f"{where}: {field} {name} is already used")


def _size_rules(row: dict, where: str) -> tuple:
    """The span and the fits of a row. A structure has one, the other, or neither."""
    span = _span(row["span"], where) if "span" in row else ()
    if "fits" in row and "span" in row:
        raise CatalogError(f"{where}: use span or fits, not both")
    fits = _fits(row["fits"], where) if "fits" in row else ()
    if not span and ("square" in row or "odd" in row):
        raise CatalogError(f"{where}: square and odd describe a span")
    return span, fits


def _multi(key: str, row: dict, where: str, tier: str) -> Multi:
    """One multiblock from its row."""
    air = _pair(row["front_air"], where, "front_air") if "front_air" in row else (1, 1)
    note = _note(row, where)
    span, fits = _size_rules(row, where)
    multi = Multi(
        key=key,
        name=_str(_need(row, "name", where), where, "name"),
        short=_str(_need(row, "short", where), where, "short"),
        tier=tier,
        size=_triple(_need(row, "size", where), where, "size"),
        pollution=_int(row.get("pollution", 0), where, "pollution"),
        muffler=_flag(row, where, "muffler"),
        source=_str(row["source"], where, "source") if row.get("source") else "",
        gt=_flag(row, where, "gt", True),
        shell=_flag(row, where, "shell"),
        front_air=air,
        side_air=_flag(row, where, "side_air"),
        share=_flag(row, where, "share"),
        sky=_flag(row, where, "sky"),
        note=note,
        span=span,
        square=_flag(row, where, "square"),
        odd=_flag(row, where, "odd"),
        fits=fits,
    )
    _check_placed_size(multi, where)
    return multi


def _check_placed_size(multi: Multi, where: str) -> None:
    """The size a new one is placed at has to be one of the sizes it allows."""
    if not multi.allows(*multi.size):
        raise CatalogError(
            f"{where}: size {_times(multi.size)} is not one of the sizes it allows ({multi.size_text()})"
        )


def _single(code: str, row: dict, where: str, group: str) -> Single:
    """One singleblock machine from its row."""
    note = _note(row, where)
    return Single(
        code=code,
        name=_str(_need(row, "name", where), where, "name"),
        group=group,
        amps=_int(row.get("amps", 1), where, "amps", low=1),
        pollution=_flag(row, where, "pollution"),
        gt=_flag(row, where, "gt", True),
        note=note,
    )


# --- reading the files ---

def _tier_name(stem: str) -> str:
    """The tier a multiblock file is for, from its name."""
    try:
        return _TIER_BY_FILE[stem]
    except KeyError:
        known = ", ".join(name.lower() for name in VOLTAGE)
        raise CatalogError(
            f"catalog/multiblocks/{stem}.json is not a tier file. Use {known}, or other.json."
        ) from None


def _tier_files() -> list:
    """(tier, file) for every multiblock file, in voltage order with other.json last."""
    paths = {_tier_name(path.stem): path for path in (DIR / "multiblocks").glob("*.json")}
    order = [name for name in VOLTAGE if name in paths]
    if NO_TIER in paths:
        order.append(NO_TIER)
    return [(tier, paths[tier]) for tier in order]


def _load_groups() -> dict:
    """Machine group id to its name, in the order the editor lists them."""
    data = _read(DIR / "groups.json")
    if not isinstance(data, dict) or not data:
        raise CatalogError("catalog/groups.json should be an object of group id to name")
    groups = {}
    for key, name in data.items():
        if not isinstance(key, str) or not isinstance(name, str) or not name.strip():
            raise CatalogError(f"catalog/groups.json: {key!r} needs a name")
        groups[key] = name
    return groups


def _load_multis() -> dict:
    """Every multiblock by key, lowest tier first."""
    multis = {}
    for tier, path in _tier_files():
        for index, row in _rows(path):
            key, where = _named(row, path, index, "key")
            _known(row, _MULTI_FIELDS, where)
            _filed_under(row, where, "tier", tier)
            _fresh(key, multis, where, "key")
            multis[key] = _multi(key, row, where, tier)
    return multis


def _load_singles(groups: dict) -> dict:
    """Every singleblock machine by code, one file per group."""
    folder = DIR / "machines"
    singles = {}
    for group in groups:
        path = folder / f"{group}.json"
        if not path.exists():
            raise CatalogError(f"catalog/machines/{group}.json is missing. Add it, or take {group} out of groups.json.")
        for index, row in _rows(path):
            code, where = _named(row, path, index, "code")
            _known(row, _SINGLE_FIELDS, where)
            _filed_under(row, where, "group", group)
            _fresh(code, singles, where, "code")
            singles[code] = _single(code, row, where, group)
    _check_no_stray_files(folder, groups)
    return singles


def _check_no_stray_files(folder: Path, groups: dict) -> None:
    """Every machine file has to belong to a group, or its machines would never load."""
    expected = {f"{group}.json" for group in groups}
    extra = [path.name for path in folder.glob("*.json") if path.name not in expected]
    if extra:
        raise CatalogError(
            "catalog/machines has files with no group in groups.json: " + ", ".join(sorted(extra))
        )


def _load_elevator() -> dict:
    """How far an elevator reaches, and through how much solid block."""
    row = _read(DIR / "elevator.json")
    if not isinstance(row, dict):
        raise CatalogError(f"{_ELEVATOR_FILE} should be an object")
    _known(row, _ELEVATOR_FIELDS, _ELEVATOR_FILE)
    return {
        "reach": _int(_need(row, "reach", _ELEVATOR_FILE), _ELEVATOR_FILE, "reach", low=1),
        "solid": _int(_need(row, "solid", _ELEVATOR_FILE), _ELEVATOR_FILE, "solid", low=0),
        "source": _str(_need(row, "source", _ELEVATOR_FILE), _ELEVATOR_FILE, "source"),
    }


GROUPS = _load_groups()
MULTIS = _load_multis()
SINGLES = _load_singles(GROUPS)
ELEVATOR = _load_elevator()
