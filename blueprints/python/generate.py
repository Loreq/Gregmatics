"""Audit the plan and draw the sheets.

    py -3 python/generate.py

Writes editor/data.js first. A failed audit goes to out/audit.txt and leaves the old sheets.
"""

from __future__ import annotations

import html
import json
import xml.etree.ElementTree as ET
from pathlib import Path

import catalog
from files import fingerprint, save_image, save_text
from schema import LayoutError

# This file lives in python/. The editor and the catalog are beside that folder.
HERE = Path(__file__).resolve().parent.parent
ROOT = HERE.parent
OUT = ROOT / "out"
EDITOR_DATA = HERE / "editor" / "data.js"
PROJECT = ROOT / "launcher" / "Gregmatics.csproj"
AUDIT_REPORT = "audit.txt"

DATA_HEADER = "// Written from the plan and catalog/. Do not edit; run py -3 python/generate.py for the sheets.\n"
SECTIONS_BLURB = "through every floor, the pipe crawl, the shafts, the tall rooms, and the ground line."

INDEX_STYLE = """\
body { margin: 0; background: #e8e3d9; color: #1b2430; font-family: "Segoe UI", sans-serif; }
main { max-width: 1800px; margin: 0 auto; padding: 32px 20px 80px; }
h1 { font-size: 30px; margin: 0 0 8px; }
p { line-height: 1.45; max-width: 75ch; }
a { color: #1b2430; }
figure { margin: 28px 0; background: #f4f1ea; padding: 10px; border: 1px solid #d5cec2; }
img { width: 100%; height: auto; display: block; }
figcaption { margin-top: 8px; color: #3e4a59; }
"""


def fail(problems: list[str]) -> None:
    """Write what is wrong to out/audit.txt and stop."""
    report = "Audit failed\n" + "\n".join(problems)
    save_text(OUT / AUDIT_REPORT, report + "\n")
    raise SystemExit(report)


# --- editor/data.js ---

def app_version() -> str:
    """The program version. It is the Version property in the launcher project."""
    root = ET.parse(PROJECT).getroot()
    for node in root.iter("Version"):
        line = (node.text or "").strip()
        parts = line.split(".")
        if len(parts) == 3 and all(part.isdigit() for part in parts):
            return line
    raise SystemExit(f"{PROJECT.name} needs a Version like 0.1.0")


def editor_multi(m) -> dict:
    """What the editor reads about one multiblock. The size rules are sent only when it has them."""
    entry = {"name": m.name, "short": m.short, "tier": m.tier, "size": list(m.size),
             "pollution": m.pollution, "shell": m.shell, "sky": m.sky, "share": m.share}
    if m.span:
        entry["span"] = list(m.span)
    if m.square:
        entry["square"] = True
    if m.odd:
        entry["odd"] = True
    if m.fits:
        entry["fits"] = [list(item) for item in m.fits]
    if m.note:
        entry["note"] = m.note
    return entry


def editor_single(s) -> dict:
    """What the editor reads about one singleblock machine."""
    return {"name": s.name, "group": s.group, "pollution": s.pollution}


def editor_catalog() -> dict:
    """The part of the catalog the editor needs."""
    return {
        "multis": {key: editor_multi(m) for key, m in catalog.MULTIS.items()},
        "singles": {code: editor_single(s) for code, s in catalog.SINGLES.items()},
        "groups": dict(catalog.GROUPS),
        "elevator": catalog.ELEVATOR["reach"],
        "voltage": list(catalog.VOLTAGE),
        "selectable": list(catalog.SELECTABLE),
    }


def write_editor_data(text: str | None) -> None:
    """Write editor/data.js: the program version, the plan, and the catalog, for the page to load."""
    base = {
        "app": app_version(),
        "version": fingerprint(text) if text else "",
        "layout": json.loads(text) if text else None,
        "catalog": editor_catalog(),
    }
    save_text(EDITOR_DATA, DATA_HEADER + "window.BASE = " + json.dumps(base, ensure_ascii=False) + ";\n")


# --- out/index.html ---

def _figures(entries: list) -> str:
    """One figure per sheet: the image, its title, and its blurb."""
    return "".join(
        "<figure>"
        f"<img src=\"{html.escape(name)}\" alt=\"{html.escape(title)}\">"
        f"<figcaption><strong>{html.escape(title)}.</strong> {html.escape(blurb)}</figcaption>"
        "</figure>"
        for name, title, blurb in entries
    )


def _dirty_sentence(L) -> str:
    """Where polluting machines stay, or nothing when the plan sets no dirty chunks aside."""
    dirty = sorted(L.DIRTY, key=lambda name: (L.COLUMNS.index(L.chunk_parts(name)[0]), L.chunk_parts(name)[1]))
    return f"\nPolluting machines stay in chunks {dirty[0]}–{dirty[-1]} on every floor." if dirty else ""


def _site_summary(L) -> str:
    """The paragraph that says where the base is: its square, its floors, its entrance, and its dirty chunks."""
    x0, x1, z0, z1 = L.SQUARE
    entries = [street for street in L.STREETS if street.style == "entry"]
    floors = ", ".join(f"{floor.name.lower()} Y={floor.slab}" for floor in L.FLOORS)
    listed = ", ".join(f"X {street.x0}..{street.x1}" for street in entries)
    mouth = f"\nEntrances at {listed}, just north of the square." if listed else ""
    return (f"<p>Working square ({x0}, {z0}) to ({x1}, {z1}), dug into the mountain. Floor slabs: {html.escape(floors)}."
            f"{mouth}{_dirty_sentence(L)}</p>")


def _index_page(summary: str, figures: str) -> str:
    """The page that shows every sheet, one under another."""
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Gregmatics</title>
<style>
{INDEX_STYLE}</style>
</head>
<body>
<main>
<h1>Gregmatics</h1>
<p>Floor plans for a GregTech New Horizons 2.9.0 base, MV going on HV.</p>
{summary}
<p>To move a room or add a floor, use the editor described in the project README.
Save writes the plan, then <code>py -3 generate.py</code> redraws the sheets.</p>
{figures}
</main>
</body>
</html>
"""


def write_index(entries: list, L) -> None:
    """Write out/index.html from (file, title, blurb) for each sheet."""
    save_text(OUT / "index.html", _index_page(_site_summary(L), _figures(entries)))


# --- the run ---

def _load_plan():
    """The layout module, with the open plan loaded. A plan the loader rejects ends the run with its message."""
    try:
        import layout
    except LayoutError as err:
        raise SystemExit(str(err))
    return layout


def _checked_grid() -> dict:
    """The dug model, once it builds and passes the audit. A pass clears an old audit report."""
    import audit
    import model
    try:
        grid = model.build()
    except RuntimeError as err:
        fail([f"plan: {err}"])
    problems = audit.audit(grid)
    if problems:
        fail(problems)
    (OUT / AUDIT_REPORT).unlink(missing_ok=True)
    return grid


def _draw_sheet(render, grid: dict, sheet: dict, index: int, total: int) -> tuple:
    """Draw one sheet. Returns its (file, title, blurb)."""
    name = f"{sheet['id']}.png"
    draw = render.terrain_sheet if sheet["kind"] == "terrain" else render.sheet_image
    save_image(draw(grid, sheet, index, total), OUT / name)
    print(f"wrote {name}")
    return name, sheet["title"], sheet["blurb"]


def _draw_sections(render, grid: dict, number: int, cuts: list) -> tuple:
    """Draw the sections sheet, the last of the set. Returns its (file, title, blurb)."""
    name = f"{number:02d}-sections.png"
    save_image(render.sections(grid), OUT / name)
    print(f"wrote {name}")
    return name, "Sections", f"Cuts {cuts[0][0]}–{cuts[-1][0]} {SECTIONS_BLURB}"


def _draw_sheets(L, grid: dict) -> list:
    """Draw every sheet into out/. A plan with no cuts has no sections sheet."""
    import sheets.render as render
    total = len(L.SHEETS) + (1 if L.CUTS else 0)
    written = [_draw_sheet(render, grid, sheet, index, total) for index, sheet in enumerate(L.SHEETS, start=1)]
    if L.CUTS:
        written.append(_draw_sections(render, grid, total, L.CUTS))
    return written


def _drop_stale(written: list) -> None:
    """Delete sheets left over from a plan that had more of them."""
    keep = {name for name, _title, _blurb in written}
    for stale in OUT.glob("*.png"):
        if stale.name not in keep:
            stale.unlink()


def main() -> None:
    """Check the plan, then draw its sheets. A plan that fails leaves the old sheets alone."""
    L = _load_plan()
    OUT.mkdir(parents=True, exist_ok=True)
    write_editor_data(L.TEXT)
    print("wrote editor/data.js")
    written = _draw_sheets(L, _checked_grid())
    _drop_stale(written)
    write_index(written, L)
    print("wrote index.html")


if __name__ == "__main__":
    main()
