"""Load the plan. A zone names its floor or room. Y comes from that floor.

A plan is one .gregmatic file: the joined text dumps() writes. The files live in
%APPDATA%\\Gregmatics unless settings.json points somewhere else.
"""

from __future__ import annotations

import itertools
import json
import os
import re
from pathlib import Path
from typing import Iterator

from catalog import GROUPS, MULTIS, SELECTABLE, SINGLES, SLOT
from files import TEMP_PREFIX, fingerprint, save_text
from schema import Box, Door, Floor, LayoutError, Lift, Mark, Pad, Room, Shaft, Stair, Street, Trench, Wall

FOOTPRINT = ("x0", "x1", "z0", "z1")

# Lists of plain values shorter than this stay on one line. editor/core/core.js uses the same width.
INLINE = 100

SIDES = ("n", "s", "e", "w")
IDENT = re.compile(r"^[a-z0-9][a-z0-9_-]*$")
HEX = re.compile(r"^#[0-9A-Fa-f]{6}$")
BASE_STYLES = ("rock", "corridor", "entry", "door", "trench", "stair", "well")
SHAPES = ("box", "circle", "well", "service", "text")
ROOFS = ("rock", "glass", "built")
SHEET_KINDS = ("overview", "detail", "terrain")
TOP_LEVEL = ("site", "palette", "floors", "rooms", "streets", "doors", "stairs", "shafts", "lifts", "trenches",
             "pads", "walls", "marks", "callouts", "cuts", "sheets")
# The pipe crawl's layer name. A floor cannot take it as its id.
CRAWL_ID = "crawl"
# A machine row writes an empty slot, and that slot's tier, like this.
EMPTY_SLOT = "-"
# Minecraft 1.7.10 builds from Y 0 through 255.
WORLD_BOTTOM, WORLD_TOP = 0, 255


# --- the plan's text ---

def dumps(value, indent: int = 0) -> str:
    """The plan's text: one key per line, and short lists of plain values on one line.

    editor/core/core.js writes the same text, so saving from either side changes only what moved.
    """
    if isinstance(value, dict):
        return _dumps_object(value, indent)
    if isinstance(value, (list, tuple)):
        return _dumps_list(value, indent)
    return json.dumps(value, ensure_ascii=False)


def _dumps_object(value: dict, indent: int) -> str:
    """An object, one key per line."""
    if not value:
        return "{}"
    inner = "  " * (indent + 1)
    items = [f"{inner}{json.dumps(k, ensure_ascii=False)}: {dumps(v, indent + 1)}" for k, v in value.items()]
    return "{\n" + ",\n".join(items) + "\n" + "  " * indent + "}"


def _dumps_list(value, indent: int) -> str:
    """A list: on one line when it is short and plain, otherwise one item per line."""
    if not value:
        return "[]"
    flat = _inline(value)
    if flat is not None:
        return flat
    inner = "  " * (indent + 1)
    items = [inner + dumps(v, indent + 1) for v in value]
    return "[\n" + ",\n".join(items) + "\n" + "  " * indent + "]"


def _inline(value) -> str | None:
    """A list of plain values on one line, or None when it holds a list or an object, or runs too long."""
    if any(isinstance(v, (dict, list, tuple)) for v in value):
        return None
    flat = "[" + ", ".join(json.dumps(v, ensure_ascii=False) for v in value) + "]"
    return flat if len(flat) <= INLINE else None


def ended(text: str) -> str:
    """Text that ends with a newline, the way a plan is stored."""
    return text if text.endswith("\n") else text + "\n"


# --- where the plans are kept ---

PLAN_SUFFIX = ".gregmatic"
DEFAULT_PLAN = "Gregmatics.gregmatic"
SETTINGS_NAME = "settings.json"
_SLUG_DROP = re.compile(r"[^a-z0-9]")


def home_dir() -> Path:
    """The folder that always holds settings.json, under Roaming AppData."""
    base = os.environ.get("APPDATA") or str(Path.home() / "AppData" / "Roaming")
    path = Path(base) / "Gregmatics"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _stored_settings() -> dict:
    """settings.json as it is on disk. A missing file, or one that is not an object, reads as empty."""
    path = home_dir() / SETTINGS_NAME
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as err:
        raise LayoutError(f"settings.json is not valid JSON: line {err.lineno}: {err.msg}") from None
    return data if isinstance(data, dict) else {}


def _filled(value) -> bool:
    """Whether a stored setting is text with something in it."""
    return isinstance(value, str) and bool(value.strip())


def _settings() -> dict:
    """The plan folder, the open plan's file name, and whether edits save themselves."""
    stored = _stored_settings()
    folder = stored["folder"] if _filled(stored.get("folder")) else str(home_dir())
    current = Path(stored["current"]).name if _filled(stored.get("current")) else DEFAULT_PLAN
    if not current.lower().endswith(PLAN_SUFFIX):
        current += PLAN_SUFFIX
    return {"folder": folder, "current": current, "autosave": bool(stored.get("autosave", True))}


def _stored_edited() -> str:
    """The file name of the plan last saved, or empty when none has been."""
    name = _stored_settings().get("edited") or ""
    if not _filled(name):
        return ""
    name = Path(name).name
    if not name.lower().endswith(PLAN_SUFFIX):
        name += PLAN_SUFFIX
    return name


def _write_settings(folder: str, current: str, autosave: bool | None = None, edited: str | None = None) -> None:
    """Store the plan folder, the open plan, and the plan last saved. Autosave and the last save keep their values unless one is given."""
    if autosave is None:
        autosave = _settings()["autosave"]
    if edited is None:
        edited = _stored_edited()
    body = {"folder": folder, "current": Path(current).name, "autosave": bool(autosave)}
    if edited:
        body["edited"] = Path(edited).name
    save_text(home_dir() / SETTINGS_NAME, dumps(body) + "\n")


def autosave() -> bool:
    """Whether the editor writes each edit without being asked."""
    return _settings()["autosave"]


def set_autosave(enabled: bool) -> bool:
    """Turn autosave on or off, and say what it is now."""
    settings = _settings()
    enabled = bool(enabled)
    _write_settings(settings["folder"], settings["current"], enabled)
    return enabled


def plan_folder() -> Path:
    """The folder the plans are kept in. It is made if it is missing."""
    folder = Path(_settings()["folder"])
    folder.mkdir(parents=True, exist_ok=True)
    return folder


def current_file() -> Path:
    """The open plan's file, whether or not it exists."""
    settings = _settings()
    return Path(settings["folder"]) / settings["current"]


def current_name() -> str:
    """The open plan's file name without its ending."""
    return current_file().stem


def _gregmatic_files(folder: Path) -> list[Path]:
    """The plans in a folder, by name. Files still being written are left out."""
    if not folder.is_dir():
        return []
    found = [path for path in folder.glob(f"*{PLAN_SUFFIX}") if path.is_file() and not path.name.startswith(TEMP_PREFIX)]
    return sorted(found, key=lambda path: path.name.lower())


def plan_names() -> list[str]:
    """The file name of every plan in the plan folder."""
    return [path.name for path in _gregmatic_files(plan_folder())]


def read_gregmatic(path: Path) -> str:
    """One plan's text."""
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as err:
        raise LayoutError(f"Could not read {path.name}: {err}") from None
    return ended(text)


def write_gregmatic(path: Path, text: str) -> None:
    """Write one plan, and remember it as the one last edited. A file already holding the same text is left alone."""
    text = ended(text)
    if not _holds(path, text):
        save_text(path, text)
    _write_settings(str(path.parent), path.name, edited=path.name)


def _holds(path: Path, text: str) -> bool:
    """Whether a file already has exactly this text. A file that cannot be read does not."""
    if not path.exists():
        return False
    try:
        return path.read_text(encoding="utf-8") == text
    except OSError:
        return False


def file_slug(name: str) -> str:
    """Lowercase, spaces become underscores, and every other character is dropped."""
    text = str(name).strip()
    if text.lower().endswith(PLAN_SUFFIX):
        text = text[: -len(PLAN_SUFFIX)].strip()
    words = (_SLUG_DROP.sub("", word) for word in text.lower().split())
    return "_".join(word for word in words if word) or "plan"


def _slug_stem(slug: str) -> tuple[str, int | None]:
    """A slug split into its name and the number it ends with, if it ends with one."""
    if "_" in slug:
        head, tail = slug.rsplit("_", 1)
        if head and tail.isdigit():
            return head, int(tail)
    return slug, None


def free_filename(name: str, current: str | None = None) -> str:
    """The file for this floorplan name. A taken name becomes name_1, then name_2."""
    slug = file_slug(name)
    taken = {path.name.lower() for path in _gregmatic_files(plan_folder())}
    # The open file is not a duplicate of itself.
    taken.discard((current or "").lower())
    exact = f"{slug}{PLAN_SUFFIX}"
    if exact.lower() not in taken:
        return exact
    stem, number = _slug_stem(slug)
    for n in itertools.count((number or 0) + 1):
        candidate = f"{stem}_{n}{PLAN_SUFFIX}"
        if candidate.lower() not in taken:
            return candidate


def create_plan(name: str, text: str) -> str:
    """Write a new plan beside the others and open it. The previous file stays."""
    filename = free_filename(name)
    folder = plan_folder()
    path = folder / filename
    if path.exists():
        raise LayoutError(f"{filename} already exists")
    text = ended(text)
    parse(text)
    write_gregmatic(path, text)
    _write_settings(str(folder), filename)
    return filename


def rename_current(name: str) -> str:
    """Rename the open file from the floorplan name. The current file is not a duplicate of itself."""
    src = current_file()
    filename = free_filename(name, current=src.name)
    dest = src.with_name(filename)
    if dest.resolve() == src.resolve():
        return src.name
    if dest.exists():
        raise LayoutError(f"{filename} already exists")
    src.replace(dest)
    edited = _stored_edited()
    if edited.lower() == src.name.lower():
        edited = dest.name
    _write_settings(str(plan_folder()), dest.name, edited=edited)
    return dest.name


def open_plan(name: str) -> str:
    """Make a plan in the plan folder the open one."""
    filename = Path(name).name
    if not (plan_folder() / filename).is_file():
        raise LayoutError(f"No plan named {filename}")
    _write_settings(str(plan_folder()), filename)
    return filename


def ensure_current() -> Path:
    """The plan last saved, or the newest file when that one is gone."""
    chosen = _open_last()
    if chosen is None:
        raise LayoutError(f"No plan in {plan_folder()}")
    return chosen


def _open_last() -> Path | None:
    """The plan to open, or None when the folder has no plan. The one last saved wins."""
    folder = plan_folder()
    edited = _stored_edited()
    if edited:
        path = folder / edited
        if path.is_file():
            if current_file().name.lower() != edited.lower():
                _write_settings(str(folder), edited, edited=edited)
            return path
    current = current_file()
    if current.is_file():
        return current
    found = _gregmatic_files(folder)
    if not found:
        return None
    newest = max(found, key=lambda path: path.stat().st_mtime)
    _write_settings(str(folder), newest.name, edited=newest.name)
    return newest


def move_plans(dest: Path) -> str:
    """Point the library at dest and move every .gregmatic file there."""
    dest = Path(dest)
    dest.mkdir(parents=True, exist_ok=True)
    src = plan_folder().resolve()
    target = dest.resolve()
    if target == src:
        return str(target)
    if src in target.parents:
        raise LayoutError("Choose a folder that is not inside the current one.")
    files = _gregmatic_files(src)
    for path in files:
        if (target / path.name).exists():
            raise LayoutError(f"{path.name} is already in that folder")
    for path in files:
        path.replace(target / path.name)
    _write_settings(str(target), _settings()["current"])
    return str(target)


def read_text() -> str:
    """The open plan's text."""
    return read_gregmatic(ensure_current())


def rgb(color: str) -> tuple:
    """A #RRGGBB color as (red, green, blue)."""
    return tuple(int(color[i:i + 2], 16) for i in (1, 3, 5))


# --- reading one value ---

def _fields(row, where: str, required, optional=()) -> None:
    """A record has every required field and none the loader does not know."""
    if not isinstance(row, dict):
        raise LayoutError(f"{where} should be an object")
    for key in row:
        if key not in required and key not in optional:
            raise LayoutError(f"{where}: unknown field {key!r}")
    for key in required:
        if key not in row:
            raise LayoutError(f"{where}: missing {key!r}")


def _int(value, where: str, key: str, low: int | None = None) -> int:
    """A whole number, and at least `low` when one is given."""
    if isinstance(value, bool) or not isinstance(value, int):
        raise LayoutError(f"{where}: {key} should be a whole number, not {value!r}")
    if low is not None and value < low:
        raise LayoutError(f"{where}: {key} should be at least {low}")
    return value


def _str(value, where: str, key: str, empty: bool = False) -> str:
    """Text. It may be blank only when `empty` says so."""
    if not isinstance(value, str) or (not empty and not value.strip()):
        raise LayoutError(f"{where}: {key} should be text")
    return value


def _label(row: dict, where: str, key: str = "label") -> str:
    """An optional piece of text that may be left blank."""
    return _str(row.get(key, ""), where, key, True)


def _bool(value, where: str, key: str) -> bool:
    """True or false, and nothing that merely acts like one."""
    if not isinstance(value, bool):
        raise LayoutError(f"{where}: {key} should be true or false")
    return value


def _flag(row: dict, where: str, key: str, default: bool = False) -> bool:
    """An optional true-or-false field."""
    return _bool(row.get(key, default), where, key)


def _choice(value, where: str, key: str, options):
    """One of a fixed set of values."""
    if value not in options:
        raise LayoutError(f"{where}: {key} is {value!r}; use one of {', '.join(map(str, options))}")
    return value


def _ident(value, where: str, key: str = "id") -> str:
    """An id: lowercase letters, digits, - or _."""
    if not isinstance(value, str) or not IDENT.match(value):
        raise LayoutError(f"{where}: {key} {value!r} should be lowercase letters, digits, - or _")
    return value


def _hex(value, where: str, key: str) -> str:
    """A #RRGGBB color, in upper case."""
    if not isinstance(value, str) or not HEX.match(value):
        raise LayoutError(f"{where}: {key} {value!r} should be a color like #E6DAC0")
    return value.upper()


def _point(value, where: str, key: str) -> tuple:
    """A cell as (x, z)."""
    if not isinstance(value, list) or len(value) != 2:
        raise LayoutError(f"{where}: {key} should be [x, z]")
    return _int(value[0], where, key), _int(value[1], where, key)


def _box(row: dict, where: str) -> Box:
    """A record's footprint, each side running from low to high."""
    x0, x1, z0, z1 = (_int(row[k], where, k) for k in FOOTPRINT)
    if x0 > x1 or z0 > z1:
        raise LayoutError(f"{where}: x0..x1 and z0..z1 should run from low to high")
    return x0, x1, z0, z1


def _name(kind: str, i: int, row) -> str:
    """The label a record's messages carry: its list, its place, and its id or number."""
    rid = row.get("id", row.get("num")) if isinstance(row, dict) else None
    return f"{kind}[{i}]" + (f" {rid!r}" if rid is not None else "")


def _each(rows, kind: str, named: bool = True) -> Iterator[tuple]:
    """Each record of a list, with the label its messages carry."""
    for i, row in enumerate(rows):
        yield (_name(kind, i, row) if named else f"{kind}[{i}]"), row


def _unique(items, kind: str, key: str) -> None:
    """No two records of a list share an id or a number."""
    seen = set()
    for item in items:
        value = getattr(item, key) if not isinstance(item, dict) else item[key]
        if value in seen:
            raise LayoutError(f"{kind}: {key} {value!r} is used twice")
        seen.add(value)


def _ref(value, table: dict, where: str, key: str):
    """The record a field points at."""
    if value not in table:
        known = ", ".join(sorted(table)) if len(table) < 12 else f"{len(table)} known ids"
        raise LayoutError(f"{where}: {key} {value!r} is not one of {known}")
    return table[value]


# --- the site, the palette, and the floors ---

def chunk_parts(name: str) -> tuple | None:
    """The column letters and row of a chunk name such as E6 or AA12, or None."""
    if not isinstance(name, str) or len(name) < 2:
        return None
    split = 0
    while split < len(name) and "A" <= name[split] <= "Z":
        split += 1
    if split == 0 or split == len(name) or not name[split:].isdigit():
        return None
    return name[:split], int(name[split:])


def _columns(value) -> tuple:
    """The chunk column names. A string is one letter each; a list names them, such as AA."""
    if isinstance(value, str) and value:
        return tuple(value)
    if isinstance(value, list) and value:
        return tuple(_str(item, "site", "columns") for item in value)
    raise LayoutError("site.columns should name the chunk columns")


def _site(site) -> dict:
    """The working square, the sheet's edges, the chunk grid, and the ground estimate."""
    _fields(site, "site", ("square", "sheet", "rim", "columns", "dirty", "cover", "terrain"), ("tier", "name", "crawl", "crawls"))
    if "tier" in site:
        _choice(site["tier"], "site", "tier", SELECTABLE)
    if "name" in site:
        _str(site["name"], "site", "name")
    for key in ("square", "sheet"):
        _fields(site[key], f"site.{key}", FOOTPRINT)
    square = _box(site["square"], "site.square")
    sheet = _box(site["sheet"], "site.sheet")
    rim = _int(site["rim"], "site", "rim", low=0)
    columns = _columns(site["columns"])
    terrain = _terrain(site["terrain"], columns)
    dirty = _dirty(site["dirty"], columns, len(terrain))
    cover = _int(site["cover"], "site", "cover", low=0)
    return {
        "SQUARE": square, "SHEET": sheet,
        "INNER": (square[0] + rim, square[1] - rim, square[2] + rim, square[3] - rim),
        "X_MIN": sheet[0], "X_MAX": sheet[1], "Z_MIN": sheet[2], "Z_MAX": sheet[3],
        "COLUMNS": columns, "DIRTY": dirty, "COVER": cover, "TERRAIN": terrain,
    }


def _terrain(terrain, columns: tuple) -> list:
    """The ground estimate: one row per chunk row, one Y per chunk column."""
    if not isinstance(terrain, list) or not terrain:
        raise LayoutError("site.terrain should be a list of rows")
    for r, row in enumerate(terrain, start=1):
        if not isinstance(row, list) or len(row) != len(columns):
            raise LayoutError(f"site.terrain row {r} should have {len(columns)} numbers, one per chunk column")
        for value in row:
            _int(value, f"site.terrain row {r}", "ground Y")
    return [list(row) for row in terrain]


def _dirty(names, columns: tuple, rows: int) -> set:
    """The chunks that may hold polluting machines."""
    dirty = set()
    for name in names:
        if not _is_chunk(name, columns, rows):
            raise LayoutError(f"site.dirty: {name!r} is not a chunk like E6")
        dirty.add(name)
    return dirty


def _is_chunk(name, columns: tuple, rows: int) -> bool:
    """Whether a name is a column and a row number that are both on the chunk grid."""
    parts = chunk_parts(name) if isinstance(name, str) else None
    return parts is not None and parts[0] in columns and 1 <= parts[1] <= rows


def _palette(palette) -> dict:
    """The fill of each kind of dug cell, and the color of each machine group."""
    _fields(palette, "palette", (*BASE_STYLES, "groups"))
    fills = {key: _hex(palette[key], "palette", key) for key in BASE_STYLES}
    groups = palette["groups"]
    _fields(groups, "palette.groups", tuple(GROUPS))
    return {"PALETTE": fills, "GROUP_COLORS": {key: _hex(groups[key], "palette.groups", key) for key in GROUPS}}


def _floors(rows) -> dict:
    """The floors, lowest first, and the same floors by id."""
    floors = [_floor(row, where) for where, row in _each(rows, "floors")]
    if not floors:
        raise LayoutError("floors: there should be at least one floor")
    _unique(floors, "floors", "id")
    floors.sort(key=lambda floor: floor.slab)
    by_id = {floor.id: floor for floor in floors}
    if CRAWL_ID in by_id:
        raise LayoutError("floors: 'crawl' is the pipe crawl's name; give the floor another id")
    return {"FLOORS": floors, "FLOOR": by_id}


def _floor(row, where: str) -> Floor:
    """One floor."""
    _fields(row, where, ("id", "name", "slab"), ("height", "pen", *FOOTPRINT))
    x0, x1, z0, z1 = _own_span(row, where)
    return Floor(id=_ident(row["id"], where), name=_str(row["name"], where, "name"),
                 slab=_int(row["slab"], where, "slab"),
                 height=_int(row.get("height", 5), where, "height", low=1),
                 pen=_hex(row.get("pen", "#282C32"), where, "pen"),
                 x0=x0, x1=x1, z0=z0, z1=z1)


def _own_span(row: dict, where: str) -> tuple:
    """A floor's own footprint, or four Nones when the plan leaves it out."""
    given = [key for key in FOOTPRINT if key in row]
    if not given:
        return None, None, None, None
    if len(given) != 4:
        raise LayoutError(f"{where}: a footprint needs x0, x1, z0, and z1 together")
    return _box(row, where)


def _crawls(site, floors: list, floor_by_id: dict) -> list:
    """Every crawlspace. site.crawl is one; site.crawls is a list. A plan has one of those, or neither."""
    if "crawl" in site and "crawls" in site:
        raise LayoutError("site: a plan has crawl or crawls, not both")
    if "crawls" in site:
        rows = site["crawls"]
        if not isinstance(rows, list):
            raise LayoutError("site.crawls should be a list")
        pairs = [(f"site.crawls.{i}", row) for i, row in enumerate(rows)]
    elif "crawl" in site:
        pairs = [("site.crawl", site["crawl"])]
    else:
        pairs = []
    crawls = []
    used = set()
    for where, row in pairs:
        crawl = _one_crawl(row, where, floor_by_id, used)
        used.add(crawl["id"])
        crawls.append(crawl)
    _check_air(floors, [crawl["air"] for crawl in crawls])
    return crawls


def _one_crawl(row, where: str, floor_by_id: dict, used: set) -> dict:
    """One crawlspace: the floor it hangs under, and its band of air."""
    _fields(row, where, ("name", "under", "below", "height"), ("id",))
    under = _ref(row["under"], floor_by_id, where, "under")
    top = under.slab - _int(row["below"], where, "below", low=1)
    air = (top - _int(row["height"], where, "height", low=2) + 1, top)
    if "id" in row:
        ident = _ident(row["id"], where)
    elif not used:
        ident = CRAWL_ID
    else:
        number = 2
        while f"{CRAWL_ID}-{number}" in used:
            number += 1
        ident = f"{CRAWL_ID}-{number}"
    if ident in used:
        raise LayoutError(f"{where}: id {ident!r} is already a crawlspace")
    return {"id": ident, "name": row["name"], "under": under.id, "air": air, "walk": air[0] + 1}


def _check_air(floors: list, crawl_airs: list) -> None:
    """Every band of air stays inside the world."""
    for floor in floors:
        if floor.air[0] < WORLD_BOTTOM or floor.air[1] > WORLD_TOP:
            raise LayoutError(f"{floor.name}: air stays inside Y 0 through 255")
    for air in crawl_airs:
        if air[0] < WORLD_BOTTOM or air[1] > WORLD_TOP:
            raise LayoutError("site.crawl: air stays inside Y 0 through 255")


# --- zones: what is dug ---

def _rooms(rows, floors: dict) -> list:
    """The rooms. A room's id is its tag in the model, so it cannot be one the model already uses."""
    rooms = [_room(row, where, floors) for where, row in _each(rows, "rooms")]
    _unique(rooms, "rooms", "id")
    clash = {room.id for room in rooms} & set(BASE_STYLES)
    if clash:
        raise LayoutError(f"rooms: {sorted(clash)[0]!r} is a reserved name; give the room another id")
    return rooms


def _room(row, where: str, floors: dict) -> Room:
    """One room. Its air starts at its floor's and runs as high as the room asks."""
    _fields(row, where, ("id", "floor", "name", "code", "color", *FOOTPRINT),
            ("height", "label_at", "clean", "grade", "roof", "locked"))
    floor = _ref(row["floor"], floors, where, "floor")
    x0, x1, z0, z1 = _box(row, where)
    height = _int(row.get("height", floor.height), where, "height", low=2)
    if "locked" in row:
        _bool(row["locked"], where, "locked")
    label = _point(row["label_at"], where, "label_at") if "label_at" in row else ((x0 + x1) // 2, (z0 + z1) // 2)
    return Room(id=_ident(row["id"], where), floor=floor.id, name=_str(row["name"], where, "name"),
                code=_str(row["code"], where, "code"), color=_hex(row["color"], where, "color"),
                x0=x0, x1=x1, z0=z0, z1=z1, y0=floor.air[0], y1=floor.air[0] + height - 1,
                label_at=label, clean=_flag(row, where, "clean"), grade=_flag(row, where, "grade"),
                roof=_choice(row.get("roof", "rock"), where, "roof", ROOFS))


def _streets(rows, floors: dict) -> list:
    """The streets, the entrance among them."""
    streets = [_street(row, where, floors) for where, row in _each(rows, "streets")]
    _unique(streets, "streets", "id")
    return streets


def _street(row, where: str, floors: dict) -> Street:
    """One street."""
    _fields(row, where, ("id", "floor", *FOOTPRINT), ("style", "trench", "carve", "label", "label_at", "label_vertical"))
    floor = _ref(row["floor"], floors, where, "floor")
    x0, x1, z0, z1 = _box(row, where)
    return Street(id=_ident(row["id"], where), floor=floor.id, x0=x0, x1=x1, z0=z0, z1=z1,
                  y0=floor.air[0], y1=floor.air[1],
                  style=_choice(row.get("style", "corridor"), where, "style", ("corridor", "entry")),
                  trench=_flag(row, where, "trench", True),
                  carve=tuple(row.get("carve", ())), label=_label(row, where),
                  label_at=_point(row["label_at"], where, "label_at") if "label_at" in row else (),
                  label_vertical=_flag(row, where, "label_vertical"))


def _entrance(streets: list) -> Street | None:
    """The first entrance street, or None when no street is the way in."""
    return next((street for street in streets if street.style == "entry"), None)


def _doors(rows, floors: dict) -> list:
    """The doors."""
    doors = [_door(row, where, floors) for where, row in _each(rows, "doors")]
    _unique(doors, "doors", "id")
    return doors


def _door(row, where: str, floors: dict) -> Door:
    """One door, as tall as its floor."""
    _fields(row, where, ("id", "floor", *FOOTPRINT))
    floor = _ref(row["floor"], floors, where, "floor")
    x0, x1, z0, z1 = _box(row, where)
    return Door(id=_ident(row["id"], where), floor=floor.id, x0=x0, x1=x1, z0=z0, z1=z1,
                y0=floor.air[0], y1=floor.air[1])


def _stairs(rows, floors: dict) -> list:
    """The stairs."""
    stairs = [_stair(row, where, floors) for where, row in _each(rows, "stairs")]
    _unique(stairs, "stairs", "id")
    return stairs


def _stair(row, where: str, floors: dict) -> Stair:
    """One stair, open from the bottom floor's air to the top floor's ceiling."""
    _fields(row, where, ("id", "floors", "low", *FOOTPRINT))
    bottom, top = _stair_floors(row["floors"], where, floors)
    x0, x1, z0, z1 = _box(row, where)
    return Stair(id=_ident(row["id"], where), x0=x0, x1=x1, z0=z0, z1=z1, y0=bottom.air[0],
                 y1=top.air[1], low=_choice(row["low"], where, "low", SIDES),
                 floors=(bottom.id, top.id))


def _stair_floors(pair, where: str, floors: dict) -> tuple:
    """The two floors a stair joins, bottom first."""
    if not isinstance(pair, list) or len(pair) != 2:
        raise LayoutError(f"{where}: floors should be [bottom floor, top floor]")
    bottom = _ref(pair[0], floors, where, "floors")
    top = _ref(pair[1], floors, where, "floors")
    if bottom.slab >= top.slab:
        raise LayoutError(f"{where}: floors should list the bottom floor first")
    return bottom, top


def _shafts(rows, rooms: dict) -> list:
    """The shafts to the sky."""
    shafts = [_shaft(row, where, rooms) for where, row in _each(rows, "shafts")]
    _unique(shafts, "shafts", "id")
    return shafts


def _shaft(row, where: str, rooms: dict) -> Shaft:
    """One shaft, starting just above its room's ceiling."""
    _fields(row, where, ("id", "room", *FOOTPRINT), ("label", "cap"))
    room = _ref(row["room"], rooms, where, "room")
    x0, x1, z0, z1 = _box(row, where)
    return Shaft(id=_ident(row["id"], where), room=room.id, floor=room.floor, x0=x0, x1=x1, z0=z0, z1=z1,
                 y0=room.y1 + 1, label=_label(row, where),
                 cap=_choice(row.get("cap", ""), where, "cap", ("", "glass")))


def _lifts(rows, floors: dict) -> list:
    """The lifts."""
    lifts = [_lift(row, where, floors) for where, row in _each(rows, "lifts")]
    _unique(lifts, "lifts", "id")
    return lifts


def _lift(row, where: str, floors: dict) -> Lift:
    """One lift and the floors it stops at, bottom to top."""
    _fields(row, where, ("id", "x", "z", "floors"), ("label",))
    stops = [_ref(f, floors, where, "floors") for f in row["floors"]]
    if [f.slab for f in stops] != sorted(f.slab for f in stops) or len(stops) < 2:
        raise LayoutError(f"{where}: floors should list two or more floors, bottom to top")
    return Lift(id=_ident(row["id"], where), x=_int(row["x"], where, "x"), z=_int(row["z"], where, "z"),
                floors=tuple(f.id for f in stops), label=_label(row, where))


def _trenches(rows, crawl_ids: set) -> list:
    """The runs of the pipe crawl."""
    trenches = [_trench(row, where, crawl_ids) for where, row in _each(rows, "trenches")]
    _unique(trenches, "trenches", "id")
    return trenches


def _trench(row, where: str, crawl_ids: set) -> Trench:
    """One trench."""
    _fields(row, where, ("id", *FOOTPRINT), ("crawl",))
    x0, x1, z0, z1 = _box(row, where)
    named = _ident(row["crawl"], where) if "crawl" in row else ""
    if named and named not in crawl_ids:
        raise LayoutError(f"{where}: {named} is not a crawlspace")
    return Trench(id=_ident(row["id"], where), x0=x0, x1=x1, z0=z0, z1=z1, crawl=named)


# --- contents: what stands in a room ---

def _pads(rows, rooms: dict) -> list:
    """The multiblocks."""
    pads = [_pad(row, where, rooms) for where, row in _each(rows, "pads")]
    _unique(pads, "pads", "num")
    return pads


def _pad(row, where: str, rooms: dict) -> Pad:
    """One multiblock, standing on its room's floor."""
    _fields(row, where, ("num", "key", "room", *FOOTPRINT, "front"),
            ("h", "share", "door", "label", "wx", "wz", "flip"))
    room = _ref(row["room"], rooms, where, "room")
    _ref(row["key"], MULTIS, where, "key")
    x0, x1, z0, z1 = _box(row, where)
    return Pad(num=_int(row["num"], where, "num", low=1), key=row["key"], room=room.id, x0=x0, x1=x1, z0=z0,
               z1=z1, y=room.y0, front=_choice(row["front"], where, "front", SIDES),
               h=_int(row.get("h", 0), where, "h", low=0), share=_flag(row, where, "share"),
               wx=_int(row.get("wx", 1), where, "wx", low=1), wz=_int(row.get("wz", 1), where, "wz", low=1),
               flip=_choice(row["flip"], where, "flip", ("x", "z")) if row.get("flip") else "",
               door=_point(row["door"], where, "door") if "door" in row else (),
               label=_label(row, where))


def _walls(rows, rooms: dict) -> list:
    """The machine rows."""
    walls = [_wall(row, where, rooms) for where, row in _each(rows, "walls")]
    _unique(walls, "walls", "id")
    return walls


def _wall(row, where: str, rooms: dict) -> Wall:
    """One machine row, standing on its room's floor."""
    _fields(row, where, ("id", "room", "x", "z", "along", "face", "codes"), ("title", "tiers"))
    room = _ref(row["room"], rooms, where, "room")
    codes = _codes(row["codes"], where)
    tiers = _tiers(row["tiers"], codes, where) if "tiers" in row else ()
    return Wall(id=_str(row["id"], where, "id"), room=room.id, x=_int(row["x"], where, "x"),
                z=_int(row["z"], where, "z"), along=_choice(row["along"], where, "along", SIDES),
                face=_choice(row["face"], where, "face", SIDES), codes=codes, y=room.y0, tiers=tiers,
                title=_label(row, where, "title"))


def _codes(text, where: str) -> tuple:
    """One machine code per slot. An empty slot reads as None."""
    codes = tuple(None if code == EMPTY_SLOT else code for code in _str(text, where, "codes").split())
    for code in codes:
        if code is not None:
            _ref(code, SINGLES, where, "codes")
    return codes


def _tiers(text, codes: tuple, where: str) -> tuple:
    """One voltage per slot. A row that is MV throughout keeps none."""
    parts = tuple(_str(text, where, "tiers").split())
    if len(parts) != len(codes):
        raise LayoutError(f"{where}: tiers should have one entry per slot")
    cleaned = [_slot_tier(part, code, where) for part, code in zip(parts, codes)]
    return tuple(cleaned) if any(part not in ("MV", EMPTY_SLOT) for part in cleaned) else ()


def _slot_tier(part: str, code, where: str) -> str:
    """The voltage of one slot. An empty slot has none."""
    if code is not None:
        return _choice(part, where, "tiers", SLOT)
    if part != EMPTY_SLOT:
        raise LayoutError(f"{where}: an empty slot's tier is '-'")
    return EMPTY_SLOT


def _marks(rows, rooms: dict) -> list:
    """The floor marks."""
    return [_mark(row, where, rooms) for where, row in _each(rows, "marks", named=False)]


def _mark(row, where: str, rooms: dict) -> Mark:
    """One floor mark."""
    _fields(row, where, ("room", "label", *FOOTPRINT), ("short", "shape", "radius", "vertical", "detail"))
    room = _ref(row["room"], rooms, where, "room")
    x0, x1, z0, z1 = _box(row, where)
    return Mark(room=room.id, x0=x0, x1=x1, z0=z0, z1=z1, label=_label(row, where),
                short=_label(row, where, "short"),
                shape=_choice(row.get("shape", "box"), where, "shape", SHAPES),
                radius=_int(row.get("radius", 0), where, "radius", low=0),
                vertical=_flag(row, where, "vertical"), detail=_flag(row, where, "detail"))


# --- sheets: what is drawn ---

def _sheets(rows, floors: dict, crawl_ids: set) -> list:
    """The sheets, as the plain records the plan gives."""
    sheets = [_sheet(row, where, floors, crawl_ids) for where, row in _each(rows, "sheets")]
    _unique(sheets, "sheets", "id")
    return sheets


def _sheet(row, where: str, floors: dict, crawl_ids: set) -> dict:
    """One sheet. Only what the drawing relies on is checked."""
    _fields(row, where, ("id", "kind", "title", "blurb"), ("floor", "region", "scale", "cuts", "profiles", "notes"))
    kind = _choice(row["kind"], where, "kind", SHEET_KINDS)
    if kind != "terrain" and row.get("floor") not in crawl_ids:
        _ref(row.get("floor"), floors, where, "floor")
    if kind == "detail":
        _check_detail(row, where)
    return row


def _check_detail(row: dict, where: str) -> None:
    """A detail sheet names the region it draws and the scale it draws it at."""
    region = row.get("region")
    if not isinstance(region, list) or len(region) != 4:
        raise LayoutError(f"{where}: region should be [x0, x1, z0, z1]")
    _int(row.get("scale"), where, "scale", low=2)


def _callouts(rows) -> list:
    """The boxed notes drawn over a sheet, each with the set of sheets it appears on."""
    return [_callout(row, where) for where, row in _each(rows, "callouts", named=False)]


def _callout(row, where: str) -> dict:
    """One callout."""
    _fields(row, where, ("title", "body", *FOOTPRINT, "sheets"))
    _box(row, where)
    return {**row, "sheets": set(row["sheets"])}


def _cuts(rows) -> list:
    """The section cuts, each as (name, axis, where it cuts, caption)."""
    return [_cut(row, where) for where, row in _each(rows, "cuts", named=False)]


def _cut(row, where: str) -> tuple:
    """One section cut."""
    _fields(row, where, ("name", "axis", "at", "caption"))
    return (_str(row["name"], where, "name"), _choice(row["axis"], where, "axis", ("x", "z")),
            _int(row["at"], where, "at"), _str(row["caption"], where, "caption"))


# --- footprints: everything stays inside its floor ---

def _main_floor(floors: list) -> Floor:
    """The floor the others fit inside: the one with id main, or the lowest."""
    for floor in floors:
        if floor.id == "main":
            return floor
    return min(floors, key=lambda floor: (floor.slab, floor.id))


def _floor_box(floor: Floor, floors: list, inner: Box) -> Box:
    """The footprint a floor draws in. Omitted means the main floor's, and the main floor means the site."""
    if floor.span is not None:
        return floor.span
    main = _main_floor(floors)
    if floor.id != main.id and main.span is not None:
        return main.span
    return inner


def _floor_limit(floor: Floor, floors: list, inner: Box) -> Box:
    """The largest footprint a floor may have: the site for the main floor, the main floor for the rest."""
    main = _main_floor(floors)
    if floor.id == main.id:
        return inner
    return _floor_box(main, floors, inner)


def _contains(box: Box, limit: Box) -> bool:
    """Whether a footprint lies inside a limit."""
    return box[0] >= limit[0] and box[1] <= limit[1] and box[2] >= limit[2] and box[3] <= limit[3]


def _street_limit(street: Street, box: Box, plan: dict) -> Box:
    """How far north a street may run. An entrance may sit north of the rim. A street in line with one may cross the rim."""
    if box[2] > plan["INNER"][2]:
        return box
    if street.style == "entry":
        return (box[0], box[1], plan["SHEET"][2], box[3])
    lined = any(other.style == "entry" and other.floor == street.floor and street.x0 >= other.x0 and street.x1 <= other.x1
                for other in plan["STREETS"])
    if lined:
        return (box[0], box[1], plan["SQUARE"][2], box[3])
    return box


def _check_floor_span(floor: Floor, floors: list, inner: Box) -> None:
    """A floor's own footprint stays inside the site, or inside the main floor."""
    if floor.span is None or _contains(floor.span, _floor_limit(floor, floors, inner)):
        return
    main = _main_floor(floors)
    if floor.id == main.id:
        raise LayoutError(f"{floor.name} stays inside the site")
    raise LayoutError(f"{floor.name} stays inside {main.name}")


def _zones_on(floor: Floor, box: Box, plan: dict) -> Iterator[tuple]:
    """(label, footprint, limit) for each dug zone of a floor."""
    for room in plan["ROOMS"]:
        if room.floor == floor.id:
            yield room.name, room.box, box
    for street in plan["STREETS"]:
        if street.floor == floor.id:
            yield street.label or street.id, street.box, _street_limit(street, box, plan)
    for door in plan["DOORS"]:
        if door.floor == floor.id:
            yield door.id, door.box, box
    for shaft in plan["SHAFTS"]:
        if shaft.floor == floor.id:
            yield shaft.label or shaft.id, shaft.box, box
    for stair in plan["STAIRS"]:
        if floor.id in stair.floors:
            yield stair.id, stair.box, box
    for lift in plan["LIFTS"]:
        if floor.id in lift.floors:
            yield lift.label or lift.id, lift.box, box
    for crawl in plan["CRAWLS"]:
        if floor.id != crawl["under"]:
            continue
        for trench in plan["TRENCHES"]:
            if trench_owner(trench, plan["CRAWLS"]) is crawl:
                yield trench.id, trench.box, box


def _contents_on(floor: Floor, box: Box, plan: dict) -> Iterator[tuple]:
    """(label, footprint, limit) for everything standing in a floor's rooms."""
    room_floor = {room.id: room.floor for room in plan["ROOMS"]}
    for pad in plan["PADS"]:
        if room_floor.get(pad.room) == floor.id:
            yield pad.label or pad.key, pad.box, box
    for wall in plan["WALLS"]:
        if room_floor.get(wall.room) == floor.id:
            yield wall.title or wall.id, wall.box, box
    for mark in plan["MARKS"]:
        if room_floor.get(mark.room) == floor.id:
            yield mark.short or mark.label or "area", mark.box, box


def _check_footprints(plan: dict) -> None:
    """A floor's footprint stays inside the main plan, and everything on it stays inside the footprint."""
    floors = plan["FLOORS"]
    for floor in floors:
        _check_floor_span(floor, floors, plan["INNER"])
        box = _floor_box(floor, floors, plan["INNER"])
        for label, footprint, limit in itertools.chain(_zones_on(floor, box, plan), _contents_on(floor, box, plan)):
            if not _contains(footprint, limit):
                raise LayoutError(f"{label} sits outside {floor.name}")


# --- the whole file ---

def _json(text: str):
    """The plan's text as parsed JSON."""
    try:
        return json.loads(text)
    except json.JSONDecodeError as err:
        raise LayoutError(f"The plan is not valid JSON: line {err.lineno}, column {err.colno}: {err.msg}") from None


def trench_owner(trench, crawls: list):
    """The crawlspace a trench is dug in, or None."""
    if trench.crawl:
        return next((crawl for crawl in crawls if crawl["id"] == trench.crawl), None)
    if len(crawls) == 1:
        return crawls[0]
    return next((crawl for crawl in crawls if crawl["id"] == CRAWL_ID), None)


def crawl_under(floor_id: str, crawls: list):
    """The crawlspace hanging under a floor, or None."""
    return next((crawl for crawl in crawls if crawl["under"] == floor_id), None)


def parse(text: str) -> dict:
    """Every record of a plan, checked, under the names this module exports."""
    data = _json(text)
    _fields(data, "plan", TOP_LEVEL)
    plan = {**_site(data["site"]), **_palette(data["palette"]), **_floors(data["floors"])}
    floors = plan["FLOOR"]
    crawls = _crawls(data["site"], plan["FLOORS"], floors)
    plan["CRAWLS"] = crawls
    crawl_ids = {crawl["id"] for crawl in crawls}
    plan["ROOMS"] = _rooms(data["rooms"], floors)
    rooms = {room.id: room for room in plan["ROOMS"]}
    plan["STREETS"] = _streets(data["streets"], floors)
    entry = _entrance(plan["STREETS"])
    plan["ENTRANCE_FLOOR"] = entry.floor if entry else None
    plan["DOORS"] = _doors(data["doors"], floors)
    plan["STAIRS"] = _stairs(data["stairs"], floors)
    plan["SHAFTS"] = _shafts(data["shafts"], rooms)
    plan["LIFTS"] = _lifts(data["lifts"], floors)
    plan["TRENCHES"] = _trenches(data["trenches"], crawl_ids)
    plan["PADS"] = _pads(data["pads"], rooms)
    plan["WALLS"] = _walls(data["walls"], rooms)
    plan["MARKS"] = _marks(data["marks"], rooms)
    plan["SHEETS"] = _sheets(data["sheets"], floors, crawl_ids)
    plan["CALLOUTS"] = _callouts(data["callouts"])
    plan["CUTS"] = _cuts(data["cuts"])
    _check_footprints(plan)
    return plan


TEXT = read_text()
VERSION = fingerprint(TEXT)
_P = parse(TEXT)

SQUARE = _P["SQUARE"]
INNER = _P["INNER"]
SHEET = _P["SHEET"]
X_MIN, X_MAX, Z_MIN, Z_MAX = _P["X_MIN"], _P["X_MAX"], _P["Z_MIN"], _P["Z_MAX"]
COLUMNS = _P["COLUMNS"]
DIRTY = _P["DIRTY"]
COVER = _P["COVER"]
TERRAIN = _P["TERRAIN"]
PALETTE = _P["PALETTE"]
GROUP_COLORS = _P["GROUP_COLORS"]
FLOORS = _P["FLOORS"]
FLOOR = _P["FLOOR"]
CRAWLS = _P["CRAWLS"]
ENTRANCE_FLOOR = _P["ENTRANCE_FLOOR"]
ROOMS = _P["ROOMS"]
STREETS = _P["STREETS"]
DOORS = _P["DOORS"]
STAIRS = _P["STAIRS"]
SHAFTS = _P["SHAFTS"]
LIFTS = _P["LIFTS"]
TRENCHES = _P["TRENCHES"]
PADS = _P["PADS"]
WALLS = _P["WALLS"]
MARKS = _P["MARKS"]
CALLOUTS = _P["CALLOUTS"]
CUTS = _P["CUTS"]
SHEETS = _P["SHEETS"]


def shown_floor():
    """The entrance's floor, or the main floor when no street is the entrance."""
    if ENTRANCE_FLOOR and ENTRANCE_FLOOR in FLOOR:
        return FLOOR[ENTRANCE_FLOOR]
    for floor in FLOORS:
        if floor.id == "main":
            return floor
    return FLOORS[0]


def sheet_level(sheet: dict) -> tuple:
    """(floor id, or "basement" for the pipe crawl; the Y the plan is cut at) for a sheet."""
    for crawl in CRAWLS:
        if sheet.get("floor") == crawl["id"]:
            return "basement", crawl["walk"]
    floor = FLOOR[sheet["floor"]]
    return floor.id, floor.walk
