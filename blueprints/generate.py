"""Audit the plan and draw the sheets.

    py -3 generate.py

Writes editor/data.js first. A failed audit goes to out/audit.txt and leaves the old sheets.
"""

from __future__ import annotations

import hashlib
import html
import json
import os
import time
from pathlib import Path

import catalog
from schema import LayoutError

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
OUT = ROOT / "out"
EDITOR_DATA = HERE / "editor" / "data.js"
PROJECT = ROOT / "launcher" / "Gregmatics.csproj"


def replace(tmp: Path, path: Path) -> None:
    """Move a finished file into place. An image viewer holding the old file can block it briefly."""
    for _attempt in range(10):
        try:
            os.replace(tmp, path)
            return
        except PermissionError:
            time.sleep(0.3)
    os.replace(tmp, path)


def save_text(path: Path, text: str) -> None:
    tmp = path.with_name(f"_tmp-{path.name}")
    tmp.write_text(text, encoding="utf-8", newline="\n")
    replace(tmp, path)


def save_image(img, path: Path) -> None:
    tmp = path.with_name(f"_tmp-{path.name}")
    img.save(tmp, optimize=True)
    replace(tmp, path)


def fail(problems: list[str]) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    save_text(OUT / "audit.txt", "Audit failed\n" + "\n".join(problems) + "\n")
    raise SystemExit("Audit failed\n" + "\n".join(problems))


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


def app_version() -> str:
    """The program version. It is the Version property in the launcher project."""
    import xml.etree.ElementTree as ET

    root = ET.parse(PROJECT).getroot()
    for node in root.iter("Version"):
        line = (node.text or "").strip()
        parts = line.split(".")
        if len(parts) == 3 and all(part.isdigit() for part in parts):
            return line
    raise SystemExit(f"{PROJECT.name} needs a Version like 0.1.0")


def write_editor_data(text: str) -> None:
    base = {
        "app": app_version(),
        "version": hashlib.sha1(text.encode("utf-8")).hexdigest()[:12],
        "layout": json.loads(text),
        "catalog": {
            "multis": {key: editor_multi(m) for key, m in catalog.MULTIS.items()},
            "singles": {code: {"name": s.name, "group": s.group, "pollution": s.pollution}
                        for code, s in catalog.SINGLES.items()},
            "groups": dict(catalog.GROUPS),
            "elevator": catalog.ELEVATOR["reach"],
            "voltage": list(catalog.VOLTAGE),
            "selectable": list(catalog.SELECTABLE),
        },
    }
    script = ("// Written from the plan and catalog/. Do not edit; run py -3 generate.py for the sheets.\n"
              "window.BASE = " + json.dumps(base, ensure_ascii=False) + ";\n")
    save_text(EDITOR_DATA, script)


def write_index(entries, L) -> None:
    x0, x1, z0, z1 = L.SQUARE
    entry = next(s for s in L.STREETS if s.style == "entry")
    floors = ", ".join(f"{f.name.lower()} Y={f.slab}" for f in L.FLOORS)
    dirty = sorted(L.DIRTY, key=lambda n: (L.COLUMNS.index(n[0]), int(n[1:])))
    figures = "".join(
        "<figure>"
        f"<img src=\"{html.escape(name)}\" alt=\"{html.escape(title)}\">"
        f"<figcaption><strong>{html.escape(title)}.</strong> {html.escape(blurb)}</figcaption>"
        "</figure>"
        for name, title, blurb in entries
    )
    page = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Gregmatics</title>
<style>
body {{ margin: 0; background: #e8e3d9; color: #1b2430; font-family: "Segoe UI", sans-serif; }}
main {{ max-width: 1800px; margin: 0 auto; padding: 32px 20px 80px; }}
h1 {{ font-size: 30px; margin: 0 0 8px; }}
p {{ line-height: 1.45; max-width: 75ch; }}
a {{ color: #1b2430; }}
figure {{ margin: 28px 0; background: #f4f1ea; padding: 10px; border: 1px solid #d5cec2; }}
img {{ width: 100%; height: auto; display: block; }}
figcaption {{ margin-top: 8px; color: #3e4a59; }}
</style>
</head>
<body>
<main>
<h1>Gregmatics</h1>
<p>Floor plans for a GregTech New Horizons 2.9.0 base, MV going on HV.</p>
<p>Working square ({x0}, {z0}) to ({x1}, {z1}), dug into the mountain. Floor slabs: {html.escape(floors)}.
The entrance is the {entry.x1 - entry.x0 + 1}-wide walk at X {entry.x0}..{entry.x1}, just north of the square.
Polluting machines stay in chunks {dirty[0]}–{dirty[-1]} on every floor.</p>
<p>To move a room or add a floor, use the editor described in the project README.
Save writes the plan, then <code>py -3 generate.py</code> redraws the sheets.</p>
{figures}
</main>
</body>
</html>
"""
    save_text(OUT / "index.html", page)


def main() -> None:
    try:
        import layout as L
        text = L.read_text()
    except LayoutError as err:
        raise SystemExit(str(err))
    OUT.mkdir(parents=True, exist_ok=True)
    try:
        json.loads(text)
    except json.JSONDecodeError as err:
        fail([f"The plan is not valid JSON: line {err.lineno}, column {err.colno}: {err.msg}"])
    write_editor_data(text)
    print("wrote editor/data.js")

    try:
        import audit
        import model
        import render
    except LayoutError as err:
        fail([str(err)])
    try:
        grid = model.build()
    except RuntimeError as err:
        fail([f"plan: {err}"])
    errors = audit.audit(grid)
    if errors:
        fail(errors)
    report = OUT / "audit.txt"
    if report.exists():
        report.unlink()

    total = len(L.SHEETS) + 1
    written = []
    for index, sheet in enumerate(L.SHEETS, start=1):
        name = f"{sheet['id']}.png"
        draw = render.terrain_sheet if sheet["kind"] == "terrain" else render.sheet_image
        save_image(draw(grid, sheet, index, total), OUT / name)
        written.append((name, sheet["title"], sheet["blurb"]))
        print(f"wrote {name}")
    name = f"{total:02d}-sections.png"
    save_image(render.sections(grid), OUT / name)
    cuts = [cut[0] for cut in L.CUTS]
    written.append((name, "Sections", f"Cuts {cuts[0]}–{cuts[-1]} through every floor, the pipe crawl, the "
                                      "shafts, the tall rooms, and the ground line."))
    print(f"wrote {name}")
    keep = {n for n, _t, _b in written}
    for stale in OUT.glob("*.png"):
        if stale.name not in keep:
            stale.unlink()
    write_index(written, L)
    print("wrote index.html")


if __name__ == "__main__":
    main()
