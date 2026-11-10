"""Load the plan. A zone names its floor or room. Y comes from that floor.

A plan is one .gregmatic file: the joined text dumps() writes. The files live in
%APPDATA%\\Gregmatics unless settings.json points somewhere else.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import time
from pathlib import Path

from catalog import GROUPS, MULTIS, SELECTABLE, SINGLES, SLOT
from schema import DIRS, Door, Floor, LayoutError, Lift, Mark, Pad, Room, Shaft, Stair, Street, Trench, Wall

FOOTPRINT = ("x0", "x1", "z0", "z1")

# Lists of plain values shorter than this stay on one line. editor/core.js uses the same width.
INLINE = 100

SIDES = ("n", "s", "e", "w")
IDENT = re.compile(r"^[a-z0-9][a-z0-9_-]*$")
HEX = re.compile(r"^#[0-9A-Fa-f]{6}$")
BASE_STYLES = ("rock", "corridor", "entry", "door", "trench", "stair", "well")
SHAPES = ("box", "circle", "well", "service", "text")
TOP_LEVEL = ("site", "palette", "floors", "rooms", "streets", "doors", "stairs", "shafts", "lifts", "trenches",
             "pads", "walls", "marks", "callouts", "cuts", "sheets")


def dumps(value, indent: int = 0) -> str:
    """The plan's text: one key per line, and short lists of plain values on one line.

    editor/core.js writes the same text, so saving from either side changes only what moved.
    """
    pad = "  " * indent
    inner = "  " * (indent + 1)
    if isinstance(value, dict):
        if not value:
            return "{}"
        items = [f"{inner}{json.dumps(k, ensure_ascii=False)}: {dumps(v, indent + 1)}" for k, v in value.items()]
        return "{\n" + ",\n".join(items) + "\n" + pad + "}"
    if isinstance(value, (list, tuple)):
        if not value:
            return "[]"
        if all(not isinstance(v, (dict, list, tuple)) for v in value):
            flat = "[" + ", ".join(json.dumps(v, ensure_ascii=False) for v in value) + "]"
            if len(flat) <= INLINE:
                return flat
        items = [inner + dumps(v, indent + 1) for v in value]
        return "[\n" + ",\n".join(items) + "\n" + pad + "]"
    return json.dumps(value, ensure_ascii=False)


def _save_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f"_tmp-{path.name}")
    tmp.write_text(text, encoding="utf-8", newline="\n")
    for _attempt in range(10):
        try:
            os.replace(tmp, path)
            return
        except PermissionError:
            time.sleep(0.3)
    os.replace(tmp, path)


PLAN_SUFFIX = ".gregmatic"
DEFAULT_PLAN = "Gregmatics.gregmatic"
SETTINGS_NAME = "settings.json"


def home_dir() -> Path:
    """The folder that always holds settings.json, under Roaming AppData."""
    base = os.environ.get("APPDATA")
    if not base:
        base = str(Path.home() / "AppData" / "Roaming")
    path = Path(base) / "Gregmatics"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _settings() -> dict:
    folder = str(home_dir())
    current = DEFAULT_PLAN
    path = home_dir() / SETTINGS_NAME
    if path.exists():
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as err:
            raise LayoutError(f"settings.json is not valid JSON: line {err.lineno}: {err.msg}") from None
        if isinstance(data, dict):
            if isinstance(data.get("folder"), str) and data["folder"].strip():
                folder = data["folder"]
            if isinstance(data.get("current"), str) and data["current"].strip():
                current = Path(data["current"]).name
            if "autosave" in data:
                autosave = bool(data["autosave"])
            else:
                autosave = True
        else:
            autosave = True
    else:
        autosave = True
    if not current.lower().endswith(PLAN_SUFFIX):
        current += PLAN_SUFFIX
    return {"folder": folder, "current": current, "autosave": autosave}


def _write_settings(folder: str, current: str, autosave: bool | None = None) -> None:
    if autosave is None:
        autosave = _settings()["autosave"]
    text = dumps({"folder": folder, "current": Path(current).name, "autosave": bool(autosave)}) + "\n"
    _save_text(home_dir() / SETTINGS_NAME, text)


def set_autosave(enabled: bool) -> bool:
    settings = _settings()
    enabled = bool(enabled)
    _write_settings(settings["folder"], settings["current"], enabled)
    return enabled


def plan_folder() -> Path:
    folder = Path(_settings()["folder"])
    folder.mkdir(parents=True, exist_ok=True)
    return folder


def current_file() -> Path:
    settings = _settings()
    return Path(settings["folder"]) / settings["current"]


def current_name() -> str:
    return current_file().stem


def _gregmatic_files(folder: Path) -> list[Path]:
    if not folder.is_dir():
        return []
    found = [path for path in folder.glob(f"*{PLAN_SUFFIX}") if path.is_file() and not path.name.startswith("_tmp-")]
    return sorted(found, key=lambda path: path.name.lower())


def read_gregmatic(path: Path) -> str:
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as err:
        raise LayoutError(f"Could not read {path.name}: {err}") from None
    if not text.endswith("\n"):
        text += "\n"
    return text


def write_gregmatic(path: Path, text: str) -> None:
    """Write one plan. A file already holding the same text is left alone."""
    if not text.endswith("\n"):
        text += "\n"
    if path.exists():
        try:
            if path.read_text(encoding="utf-8") == text:
                return
        except OSError:
            pass
    _save_text(path, text)


def file_slug(name: str) -> str:
    """Lowercase, spaces become underscores, and every other character is dropped."""
    text = str(name).strip()
    if text.lower().endswith(PLAN_SUFFIX):
        text = text[: -len(PLAN_SUFFIX)].strip()
    chars = []
    gap = False
    for ch in text.lower():
        if ("a" <= ch <= "z") or ("0" <= ch <= "9"):
            if gap and chars:
                chars.append("_")
            gap = False
            chars.append(ch)
        elif ch.isspace():
            gap = True
    slug = "".join(chars).strip("_")
    return slug or "plan"


def _slug_stem(slug: str) -> tuple[str, int | None]:
    if "_" in slug:
        head, tail = slug.rsplit("_", 1)
        if head and tail.isdigit():
            return head, int(tail)
    return slug, None


def free_filename(name: str, current: str | None = None) -> str:
    """The file for this floorplan name. A taken name becomes name_1, then name_2."""
    slug = file_slug(name)
    taken = {path.name.lower() for path in _gregmatic_files(plan_folder())}
    ignore = (current or "").lower()

    def used(filename: str) -> bool:
        return filename.lower() != ignore and filename.lower() in taken

    exact = f"{slug}{PLAN_SUFFIX}"
    if not used(exact):
        return exact
    stem, number = _slug_stem(slug)
    n = number or 0
    while True:
        n += 1
        candidate = f"{stem}_{n}{PLAN_SUFFIX}"
        if not used(candidate):
            return candidate


def plan_names() -> list[str]:
    return [path.name for path in _gregmatic_files(plan_folder())]


def create_plan(name: str, text: str) -> str:
    """Write a new plan beside the others and open it. The previous file stays."""
    filename = free_filename(name)
    folder = plan_folder()
    path = folder / filename
    if path.exists():
        raise LayoutError(f"{filename} already exists")
    if not text.endswith("\n"):
        text += "\n"
    parse(text)
    write_gregmatic(path, text)
    _write_settings(str(folder), filename)
    return filename


def rename_current(name: str) -> str:
    """Rename the open file from the floorplan name. The current file is not a duplicate of itself."""
    filename = free_filename(name, current=current_file().name)
    src = current_file()
    dest = src.with_name(filename)
    if dest.resolve() == src.resolve():
        return src.name
    if dest.exists():
        raise LayoutError(f"{filename} already exists")
    src.replace(dest)
    _write_settings(str(plan_folder()), dest.name)
    return dest.name


def open_plan(name: str) -> str:
    filename = Path(name).name
    path = plan_folder() / filename
    if not path.is_file():
        raise LayoutError(f"No plan named {filename}")
    _write_settings(str(plan_folder()), filename)
    return filename


def ensure_current() -> Path:
    """The open plan. The folder's files are the only place a plan is stored."""
    path = current_file()
    if path.is_file():
        return path
    folder = plan_folder()
    found = _gregmatic_files(folder)
    if found:
        _write_settings(str(folder), found[0].name)
        return found[0]
    raise LayoutError(f"No plan in {folder}")


def move_plans(dest: Path) -> str:
    """Point the library at dest and move every .gregmatic file there."""
    dest = Path(dest)
    dest.mkdir(parents=True, exist_ok=True)
    src = plan_folder().resolve()
    target = dest.resolve()
    if target == src:
        return str(target)
    if target == src or src in target.parents:
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
    return read_gregmatic(ensure_current())


def rgb(color: str) -> tuple:
    return tuple(int(color[i:i + 2], 16) for i in (1, 3, 5))


# --- reading one record ---

def _fields(row, where, required, optional=()):
    if not isinstance(row, dict):
        raise LayoutError(f"{where} should be an object")
    for key in row:
        if key not in required and key not in optional:
            raise LayoutError(f"{where}: unknown field {key!r}")
    for key in required:
        if key not in row:
            raise LayoutError(f"{where}: missing {key!r}")


def _int(value, where, key, low=None):
    if isinstance(value, bool) or not isinstance(value, int):
        raise LayoutError(f"{where}: {key} should be a whole number, not {value!r}")
    if low is not None and value < low:
        raise LayoutError(f"{where}: {key} should be at least {low}")
    return value


def _str(value, where, key, empty=False):
    if not isinstance(value, str) or (not empty and not value.strip()):
        raise LayoutError(f"{where}: {key} should be text")
    return value


def _bool(value, where, key):
    if not isinstance(value, bool):
        raise LayoutError(f"{where}: {key} should be true or false")
    return value


def _choice(value, where, key, options):
    if value not in options:
        raise LayoutError(f"{where}: {key} is {value!r}; use one of {', '.join(map(str, options))}")
    return value


def _ident(value, where, key="id"):
    if not isinstance(value, str) or not IDENT.match(value):
        raise LayoutError(f"{where}: {key} {value!r} should be lowercase letters, digits, - or _")
    return value


def _hex(value, where, key):
    if not isinstance(value, str) or not HEX.match(value):
        raise LayoutError(f"{where}: {key} {value!r} should be a color like #E6DAC0")
    return value.upper()


def _point(value, where, key):
    if not isinstance(value, list) or len(value) != 2:
        raise LayoutError(f"{where}: {key} should be [x, z]")
    return _int(value[0], where, key), _int(value[1], where, key)


def _box(row, where):
    x0, x1, z0, z1 = (_int(row[k], where, k) for k in ("x0", "x1", "z0", "z1"))
    if x0 > x1 or z0 > z1:
        raise LayoutError(f"{where}: x0..x1 and z0..z1 should run from low to high")
    return x0, x1, z0, z1


def _name(kind, i, row):
    rid = row.get("id", row.get("num")) if isinstance(row, dict) else None
    return f"{kind}[{i}]" + (f" {rid!r}" if rid is not None else "")


def _unique(items, kind, key):
    seen = set()
    for item in items:
        value = getattr(item, key) if not isinstance(item, dict) else item[key]
        if value in seen:
            raise LayoutError(f"{kind}: {key} {value!r} is used twice")
        seen.add(value)


def _ref(value, table, where, key):
    if value not in table:
        known = ", ".join(sorted(table)) if len(table) < 12 else f"{len(table)} known ids"
        raise LayoutError(f"{where}: {key} {value!r} is not one of {known}")
    return table[value]


def _main_floor(floors):
    for floor in floors:
        if floor.id == "main":
            return floor
    return min(floors, key=lambda floor: (floor.slab, floor.id))


def _floor_box(floor, floors, inner):
    """The footprint a floor draws in. Omitted means the main floor's, and the main floor means the site."""
    if floor.x0 is not None:
        return (floor.x0, floor.x1, floor.z0, floor.z1)
    main = _main_floor(floors)
    if floor.id != main.id and main.x0 is not None:
        return (main.x0, main.x1, main.z0, main.z1)
    return inner


def _floor_limit(floor, floors, inner):
    main = _main_floor(floors)
    if floor.id == main.id:
        return inner
    return _floor_box(main, floors, inner)


def _contains(box, limit):
    return box[0] >= limit[0] and box[1] <= limit[1] and box[2] >= limit[2] and box[3] <= limit[3]


def _street_limit(street, box, sheet, square, entry, inner):
    # The entrance mouth may sit north of the rim while this floor still reaches that rim.
    if box[2] > inner[2]:
        return box
    if street.style == "entry":
        return (box[0], box[1], sheet[2], box[3])
    if entry and street.floor == entry.floor and street.x0 >= entry.x0 and street.x1 <= entry.x1:
        return (box[0], box[1], square[2], box[3])
    return box


def _wall_box(wall):
    n = max(1, len(wall.codes))
    dx, dz = DIRS[wall.along]
    xe = wall.x + dx * (n - 1)
    ze = wall.z + dz * (n - 1)
    return min(wall.x, xe), max(wall.x, xe), min(wall.z, ze), max(wall.z, ze)


def _check_footprints(floors, rooms, streets, doors, stairs, shafts, lifts, trenches, pads, walls, marks,
                      inner, sheet, square, crawl_under):
    """A floor's footprint stays inside the main plan, and everything on it stays inside the footprint."""
    if not floors:
        return
    main = _main_floor(floors)
    entry = next((street for street in streets if street.style == "entry"), None)
    room_floor = {room.id: room.floor for room in rooms}

    def reject(floor, label, footprint, limit):
        if not _contains(footprint, limit):
            raise LayoutError(f"{label} sits outside {floor.name}")

    for floor in floors:
        limit = _floor_limit(floor, floors, inner)
        if floor.x0 is not None and not _contains((floor.x0, floor.x1, floor.z0, floor.z1), limit):
            if floor.id == main.id:
                raise LayoutError(f"{floor.name} stays inside the site")
            raise LayoutError(f"{floor.name} stays inside {main.name}")
        box = _floor_box(floor, floors, inner)
        for room in rooms:
            if room.floor == floor.id:
                reject(floor, room.name, (room.x0, room.x1, room.z0, room.z1), box)
        for street in streets:
            if street.floor == floor.id:
                reject(floor, street.label or street.id, (street.x0, street.x1, street.z0, street.z1),
                       _street_limit(street, box, sheet, square, entry, inner))
        for door in doors:
            if door.floor == floor.id:
                reject(floor, door.id, (door.x0, door.x1, door.z0, door.z1), box)
        for shaft in shafts:
            if shaft.floor == floor.id:
                reject(floor, shaft.label or shaft.id, (shaft.x0, shaft.x1, shaft.z0, shaft.z1), box)
        for stair in stairs:
            if floor.id in stair.floors:
                reject(floor, stair.id, (stair.x0, stair.x1, stair.z0, stair.z1), box)
        for lift in lifts:
            if floor.id in lift.floors:
                reject(floor, lift.label or lift.id, (lift.x, lift.x, lift.z, lift.z), box)
        if floor.id == crawl_under:
            for trench in trenches:
                reject(floor, trench.id, (trench.x0, trench.x1, trench.z0, trench.z1), box)
        for pad in pads:
            if room_floor.get(pad.room) == floor.id:
                reject(floor, pad.label or pad.key, (pad.x0, pad.x1, pad.z0, pad.z1), box)
        for wall in walls:
            if room_floor.get(wall.room) == floor.id:
                reject(floor, wall.title or wall.id, _wall_box(wall), box)
        for mark in marks:
            if room_floor.get(mark.room) == floor.id:
                reject(floor, mark.short or mark.label or "area", (mark.x0, mark.x1, mark.z0, mark.z1), box)


# --- the whole file ---

def parse(text: str) -> dict:
    try:
        data = json.loads(text)
    except json.JSONDecodeError as err:
        raise LayoutError(f"The plan is not valid JSON: line {err.lineno}, column {err.colno}: {err.msg}") from None
    _fields(data, "plan", TOP_LEVEL)
    out = {}

    site = data["site"]
    _fields(site, "site", ("square", "sheet", "rim", "columns", "dirty", "cover", "terrain", "crawl"), ("tier", "name"))
    if "tier" in site:
        _choice(site["tier"], "site", "tier", SELECTABLE)
    if "name" in site:
        _str(site["name"], "site", "name")
    for key in ("square", "sheet"):
        _fields(site[key], f"site.{key}", ("x0", "x1", "z0", "z1"))
    square = _box(site["square"], "site.square")
    sheet = _box(site["sheet"], "site.sheet")
    rim = _int(site["rim"], "site", "rim", low=0)
    columns = _str(site["columns"], "site", "columns")
    terrain = site["terrain"]
    if not isinstance(terrain, list) or not terrain:
        raise LayoutError("site.terrain should be a list of rows")
    for r, row in enumerate(terrain, start=1):
        if not isinstance(row, list) or len(row) != len(columns):
            raise LayoutError(f"site.terrain row {r} should have {len(columns)} numbers, one per chunk column")
        for value in row:
            _int(value, f"site.terrain row {r}", "ground Y")
    dirty = set()
    for name in site["dirty"]:
        if (not isinstance(name, str) or len(name) < 2 or name[0] not in columns or not name[1:].isdigit()
                or not 1 <= int(name[1:]) <= len(terrain)):
            raise LayoutError(f"site.dirty: {name!r} is not a chunk like E6")
        dirty.add(name)
    out.update(SQUARE=square, SHEET=sheet, INNER=(square[0] + rim, square[1] - rim, square[2] + rim, square[3] - rim),
               X_MIN=sheet[0], X_MAX=sheet[1], Z_MIN=sheet[2], Z_MAX=sheet[3], COLUMNS=columns, DIRTY=dirty,
               COVER=_int(site["cover"], "site", "cover", low=0), TERRAIN=[list(row) for row in terrain])

    palette = data["palette"]
    _fields(palette, "palette", (*BASE_STYLES, "groups"))
    out["PALETTE"] = {key: _hex(palette[key], "palette", key) for key in BASE_STYLES}
    groups = palette["groups"]
    _fields(groups, "palette.groups", tuple(GROUPS))
    out["GROUP_COLORS"] = {key: _hex(groups[key], "palette.groups", key) for key in GROUPS}

    floors = []
    for i, row in enumerate(data["floors"]):
        where = _name("floors", i, row)
        _fields(row, where, ("id", "name", "slab"), ("height", "pen", *FOOTPRINT))
        span = [key for key in FOOTPRINT if key in row]
        if span and len(span) != 4:
            raise LayoutError(f"{where}: a footprint needs x0, x1, z0, and z1 together")
        x0 = x1 = z0 = z1 = None
        if len(span) == 4:
            x0, x1, z0, z1 = _box(row, where)
        floors.append(Floor(id=_ident(row["id"], where), name=_str(row["name"], where, "name"),
                            slab=_int(row["slab"], where, "slab"),
                            height=_int(row.get("height", 5), where, "height", low=1),
                            pen=_hex(row.get("pen", "#282C32"), where, "pen"),
                            x0=x0, x1=x1, z0=z0, z1=z1))
    if not floors:
        raise LayoutError("floors: there should be at least one floor")
    _unique(floors, "floors", "id")
    floors.sort(key=lambda f: f.slab)
    floor_by_id = {f.id: f for f in floors}
    if "crawl" in floor_by_id:
        raise LayoutError("floors: 'crawl' is the pipe crawl's name; give the floor another id")

    crawl = site["crawl"]
    _fields(crawl, "site.crawl", ("name", "under", "below", "height"))
    under = _ref(crawl["under"], floor_by_id, "site.crawl", "under")
    top = under.slab - _int(crawl["below"], "site.crawl", "below", low=1)
    crawl_air = (top - _int(crawl["height"], "site.crawl", "height", low=2) + 1, top)
    for floor in floors:
        if floor.air[0] < 0 or floor.air[1] > 255:
            raise LayoutError(f"{floor.name}: air stays inside Y 0 through 255")
    if crawl_air[0] < 0 or crawl_air[1] > 255:
        raise LayoutError("site.crawl: air stays inside Y 0 through 255")
    out.update(FLOORS=floors, FLOOR=floor_by_id,
               CRAWL={"name": crawl["name"], "under": under.id, "air": crawl_air, "walk": crawl_air[0] + 1})

    rooms = []
    for i, row in enumerate(data["rooms"]):
        where = _name("rooms", i, row)
        _fields(row, where, ("id", "floor", "name", "code", "color", "x0", "x1", "z0", "z1"),
                ("height", "label_at", "clean", "grade", "roof", "locked"))
        floor = _ref(row["floor"], floor_by_id, where, "floor")
        x0, x1, z0, z1 = _box(row, where)
        height = _int(row.get("height", floor.height), where, "height", low=2)
        if "locked" in row:
            _bool(row["locked"], where, "locked")
        label = _point(row["label_at"], where, "label_at") if "label_at" in row else ((x0 + x1) // 2, (z0 + z1) // 2)
        rooms.append(Room(id=_ident(row["id"], where), floor=floor.id, name=_str(row["name"], where, "name"),
                          code=_str(row["code"], where, "code"), color=_hex(row["color"], where, "color"),
                          x0=x0, x1=x1, z0=z0, z1=z1, y0=floor.air[0], y1=floor.air[0] + height - 1,
                          label_at=label, clean=_bool(row.get("clean", False), where, "clean"),
                          grade=_bool(row.get("grade", False), where, "grade"),
                          roof=_choice(row.get("roof", "rock"), where, "roof", ("rock", "glass", "built"))))
    _unique(rooms, "rooms", "id")
    room_by_id = {r.id: r for r in rooms}
    clash = set(room_by_id) & (set(BASE_STYLES) | {"rock"})
    if clash:
        raise LayoutError(f"rooms: {sorted(clash)[0]!r} is a reserved name; give the room another id")

    streets = []
    for i, row in enumerate(data["streets"]):
        where = _name("streets", i, row)
        _fields(row, where, ("id", "floor", "x0", "x1", "z0", "z1"),
                ("style", "trench", "carve", "label", "label_at", "label_vertical"))
        floor = _ref(row["floor"], floor_by_id, where, "floor")
        x0, x1, z0, z1 = _box(row, where)
        streets.append(Street(id=_ident(row["id"], where), floor=floor.id, x0=x0, x1=x1, z0=z0, z1=z1,
                              y0=floor.air[0], y1=floor.air[1],
                              style=_choice(row.get("style", "corridor"), where, "style", ("corridor", "entry")),
                              trench=_bool(row.get("trench", True), where, "trench"),
                              carve=tuple(row.get("carve", ())), label=_str(row.get("label", ""), where, "label", True),
                              label_at=_point(row["label_at"], where, "label_at") if "label_at" in row else (),
                              label_vertical=_bool(row.get("label_vertical", False), where, "label_vertical")))
    _unique(streets, "streets", "id")
    entries = [s for s in streets if s.style == "entry"]
    if len(entries) != 1:
        raise LayoutError(f"streets: there should be exactly one entrance (style \"entry\"), not {len(entries)}")

    doors = []
    for i, row in enumerate(data["doors"]):
        where = _name("doors", i, row)
        _fields(row, where, ("id", "floor", "x0", "x1", "z0", "z1"))
        floor = _ref(row["floor"], floor_by_id, where, "floor")
        x0, x1, z0, z1 = _box(row, where)
        doors.append(Door(id=_ident(row["id"], where), floor=floor.id, x0=x0, x1=x1, z0=z0, z1=z1,
                          y0=floor.air[0], y1=floor.air[1]))
    _unique(doors, "doors", "id")

    stairs = []
    for i, row in enumerate(data["stairs"]):
        where = _name("stairs", i, row)
        _fields(row, where, ("id", "floors", "low", "x0", "x1", "z0", "z1"))
        pair = row["floors"]
        if not isinstance(pair, list) or len(pair) != 2:
            raise LayoutError(f"{where}: floors should be [bottom floor, top floor]")
        bottom = _ref(pair[0], floor_by_id, where, "floors")
        top_floor = _ref(pair[1], floor_by_id, where, "floors")
        if bottom.slab >= top_floor.slab:
            raise LayoutError(f"{where}: floors should list the bottom floor first")
        x0, x1, z0, z1 = _box(row, where)
        stairs.append(Stair(id=_ident(row["id"], where), x0=x0, x1=x1, z0=z0, z1=z1, y0=bottom.air[0],
                            y1=top_floor.air[1], low=_choice(row["low"], where, "low", SIDES),
                            floors=(bottom.id, top_floor.id)))
    _unique(stairs, "stairs", "id")

    shafts = []
    for i, row in enumerate(data["shafts"]):
        where = _name("shafts", i, row)
        _fields(row, where, ("id", "room", "x0", "x1", "z0", "z1"), ("label", "cap"))
        room = _ref(row["room"], room_by_id, where, "room")
        x0, x1, z0, z1 = _box(row, where)
        shafts.append(Shaft(id=_ident(row["id"], where), room=room.id, floor=room.floor, x0=x0, x1=x1, z0=z0, z1=z1,
                            y0=room.y1 + 1, label=_str(row.get("label", ""), where, "label", True),
                            cap=_choice(row.get("cap", ""), where, "cap", ("", "glass"))))
    _unique(shafts, "shafts", "id")

    lifts = []
    for i, row in enumerate(data["lifts"]):
        where = _name("lifts", i, row)
        _fields(row, where, ("id", "x", "z", "floors"), ("label",))
        stops = [_ref(f, floor_by_id, where, "floors") for f in row["floors"]]
        if [f.slab for f in stops] != sorted(f.slab for f in stops) or len(stops) < 2:
            raise LayoutError(f"{where}: floors should list two or more floors, bottom to top")
        lifts.append(Lift(id=_ident(row["id"], where), x=_int(row["x"], where, "x"), z=_int(row["z"], where, "z"),
                          floors=tuple(f.id for f in stops), label=_str(row.get("label", ""), where, "label", True)))
    _unique(lifts, "lifts", "id")

    trenches = []
    for i, row in enumerate(data["trenches"]):
        where = _name("trenches", i, row)
        _fields(row, where, ("id", "x0", "x1", "z0", "z1"))
        x0, x1, z0, z1 = _box(row, where)
        trenches.append(Trench(id=_ident(row["id"], where), x0=x0, x1=x1, z0=z0, z1=z1))
    _unique(trenches, "trenches", "id")

    pads = []
    for i, row in enumerate(data["pads"]):
        where = _name("pads", i, row)
        _fields(row, where, ("num", "key", "room", "x0", "x1", "z0", "z1", "front"),
                ("h", "share", "door", "label", "wx", "wz", "flip"))
        room = _ref(row["room"], room_by_id, where, "room")
        _ref(row["key"], MULTIS, where, "key")
        x0, x1, z0, z1 = _box(row, where)
        pads.append(Pad(num=_int(row["num"], where, "num", low=1), key=row["key"], room=room.id, x0=x0, x1=x1, z0=z0,
                        z1=z1, y=room.y0, front=_choice(row["front"], where, "front", SIDES),
                        h=_int(row.get("h", 0), where, "h", low=0), share=_bool(row.get("share", False), where, "share"),
                        wx=_int(row.get("wx", 1), where, "wx", low=1), wz=_int(row.get("wz", 1), where, "wz", low=1),
                        flip=_choice(row["flip"], where, "flip", ("x", "z")) if row.get("flip") else "",
                        door=_point(row["door"], where, "door") if "door" in row else (),
                        label=_str(row.get("label", ""), where, "label", True)))
    _unique(pads, "pads", "num")

    walls = []
    for i, row in enumerate(data["walls"]):
        where = _name("walls", i, row)
        _fields(row, where, ("id", "room", "x", "z", "along", "face", "codes"), ("title", "tiers"))
        room = _ref(row["room"], room_by_id, where, "room")
        codes = tuple(None if c == "-" else c for c in _str(row["codes"], where, "codes").split())
        for code in codes:
            if code is not None:
                _ref(code, SINGLES, where, "codes")
        tiers = ()
        if "tiers" in row:
            parts = tuple(_str(row["tiers"], where, "tiers").split())
            if len(parts) != len(codes):
                raise LayoutError(f"{where}: tiers should have one entry per slot")
            cleaned = []
            for part, code in zip(parts, codes):
                if code is None:
                    if part != "-":
                        raise LayoutError(f"{where}: an empty slot's tier is '-'")
                    cleaned.append("-")
                else:
                    cleaned.append(_choice(part, where, "tiers", SLOT))
            if any(part not in ("MV", "-") for part in cleaned):
                tiers = tuple(cleaned)
        walls.append(Wall(id=_str(row["id"], where, "id"), room=room.id, x=_int(row["x"], where, "x"),
                          z=_int(row["z"], where, "z"), along=_choice(row["along"], where, "along", SIDES),
                          face=_choice(row["face"], where, "face", SIDES), codes=codes, y=room.y0, tiers=tiers,
                          title=_str(row.get("title", ""), where, "title", True)))
    _unique(walls, "walls", "id")

    marks = []
    for i, row in enumerate(data["marks"]):
        where = f"marks[{i}]"
        _fields(row, where, ("room", "label", "x0", "x1", "z0", "z1"),
                ("short", "shape", "radius", "vertical", "detail"))
        room = _ref(row["room"], room_by_id, where, "room")
        x0, x1, z0, z1 = _box(row, where)
        marks.append(Mark(room=room.id, x0=x0, x1=x1, z0=z0, z1=z1, label=_str(row["label"], where, "label", True),
                          short=_str(row.get("short", ""), where, "short", True),
                          shape=_choice(row.get("shape", "box"), where, "shape", SHAPES),
                          radius=_int(row.get("radius", 0), where, "radius", low=0),
                          vertical=_bool(row.get("vertical", False), where, "vertical"),
                          detail=_bool(row.get("detail", False), where, "detail")))

    sheets = []
    for i, row in enumerate(data["sheets"]):
        where = _name("sheets", i, row)
        _fields(row, where, ("id", "kind", "title", "blurb"), ("floor", "region", "scale", "cuts", "profiles", "notes"))
        kind = _choice(row["kind"], where, "kind", ("overview", "detail", "terrain"))
        if kind != "terrain":
            if row.get("floor") != "crawl":
                _ref(row.get("floor"), floor_by_id, where, "floor")
        if kind == "detail":
            region = row.get("region")
            if not isinstance(region, list) or len(region) != 4:
                raise LayoutError(f"{where}: region should be [x0, x1, z0, z1]")
            _int(row.get("scale"), where, "scale", low=2)
        sheets.append(row)
    _unique(sheets, "sheets", "id")

    callouts = []
    for i, row in enumerate(data["callouts"]):
        where = f"callouts[{i}]"
        _fields(row, where, ("title", "body", "x0", "x1", "z0", "z1", "sheets"))
        _box(row, where)
        callouts.append({**row, "sheets": set(row["sheets"])})

    cuts = []
    for i, row in enumerate(data["cuts"]):
        where = f"cuts[{i}]"
        _fields(row, where, ("name", "axis", "at", "caption"))
        cuts.append((_str(row["name"], where, "name"), _choice(row["axis"], where, "axis", ("x", "z")),
                     _int(row["at"], where, "at"), _str(row["caption"], where, "caption")))

    _check_footprints(floors, rooms, streets, doors, stairs, shafts, lifts, trenches, pads, walls, marks,
                      out["INNER"], sheet, square, under.id)
    out.update(ROOMS=rooms, STREETS=streets, DOORS=doors, STAIRS=stairs, SHAFTS=shafts, LIFTS=lifts,
               TRENCHES=trenches, PADS=pads, WALLS=walls, MARKS=marks, SHEETS=sheets, CALLOUTS=callouts, CUTS=cuts,
               ENTRANCE_FLOOR=entries[0].floor)
    return out


TEXT = read_text()
VERSION = hashlib.sha1(TEXT.encode("utf-8")).hexdigest()[:12]
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
CRAWL = _P["CRAWL"]
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


def sheet_level(sheet) -> tuple:
    """(floor id, or "basement" for the pipe crawl; the Y the plan is cut at) for a sheet."""
    if sheet.get("floor") == "crawl":
        return "basement", CRAWL["walk"]
    floor = FLOOR[sheet["floor"]]
    return floor.id, floor.walk
