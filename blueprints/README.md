# Blueprints

```
py -3 -m pip install -r requirements.txt
py -3 generate.py
```

Pillow draws the sheets. On Windows, Gregmatics opens in its own window.

## Files

| File | Holds |
| --- | --- |
| `%APPDATA%\Gregmatics` | The plans. Each one is a `.gregmatic` file. `settings.json` there remembers the folder and the open file. Not part of the repository. |
| `layout.py` | Loads the open `.gregmatic` file, checks every record, and works out each zone's Y from its floor. |
| `schema.py` | The record types. |
| `catalog/` | GTNH 2.9.0 machine facts as JSON. Multiblocks are one file per tier in `catalog/multiblocks/`. Machines are one file per group in `catalog/machines/`, because a machine's voltage is set when you place it. `groups.json` names the groups. `elevator.json` is the elevator reach. |
| `catalog.py` | Loads `catalog/`, keeps the voltage order, and says which sizes a multiblock may be built at. Its docstring lists the fields. The editor lists the GTNH 2.9.0 quest tabs, from Tier 0 Stone Age through Tier 12 UMV. |
| `model.py` | Turns the plan into per-column spans of air, names chunks, and blends the ground estimate. |
| `audit.py` | The checks. |
| `render.py` | Draws the PNG sheets with Pillow. No SVG. |
| `generate.py` | Writes `editor/data.js`, runs the audit, then draws `out/`. |
| `desktop.py` | The Gregmatics window. Save and refresh go through it to the open `.gregmatic` file. No server. |
| `editor/` | The Gregmatics page. `app.js` draws the plan, `view3d.js` is the view-only 3D, `core.js` holds the data rules shared with the Python side, and `data.js` is written by Save and by `generate.py`. |
| `../out/` | The sheets and `index.html`, in the project folder. Written by `generate.py`. |

## The plan

- `site`: the square, the 1-block rim, the sheet's edges, the chunk letters, the dirty chunks, the minimum rock cover, the ground estimate per chunk, and the pipe crawl under its floor.
- `palette`: the fills for rock, streets, doors, stairs, trenches, and shafts, and a color for each machine group. Each room has its own `color`.
- Each floor is `id`, `name`, `slab`, `height`, `pen`, an optional footprint (`x0`, `x1`, `z0`, `z1`), and the rooms, streets, doors, shafts, pads, machine rows, and areas on that floor. Air runs from slab + 1 to slab + height. With no footprint, the main floor fills the site inside the rim, and every other floor fills the main floor. The stack order follows those slabs and heights.
- Rooms, streets, and doors name their `floor`. A room may set its own `height`. Stairs name the two floors they join, bottom first.
- Pads, machine walls, floor marks, and shafts name their `room`, so they follow it to any floor and move with it.
- A machine wall's `codes` is one code per slot, in order, and `-` leaves a slot empty: `"PKG UPK - - TRF"`.
- `sheets` name the floor they cut, or `crawl` for the pipe basement. Detail sheets add a `region` and a `scale`.

A floor's Y only lives on the floor. Change its slab and everything on it moves with it.

## The editor

On Windows, open `Gregmatics.exe` in the project folder, or run `py -3 desktop.py` here. The window reads the open `.gregmatic` file. Save writes that file and `editor/data.js`. Run `generate.py` to redraw the sheets into `out/`.

The tools are in the [project README](../README.md).

- With Select, Ctrl+click adds to the selection. R turns the selection, the arrow keys nudge it, and Delete removes it. A group moves, turns, copies, and deletes together. Ctrl+S saves. Ctrl+C copies, Ctrl+X cuts, Ctrl+V pastes, and Ctrl+D duplicates. Copying a room copies what is in it. Paste puts the copy beside the last one, on the floor you are looking at; pasting a cut puts it back on the cells it left. Drop a machine on another to swap them. A room's panel lists what is in it.
- Lock, on a room's panel, keeps that room where it is. A locked room can still be selected. It does not drag, resize, or nudge, and its corner fields stay closed. Turn Lock off to move it.
- Unsaved edits stay in the browser until you save. If the plan changes underneath them, they are set aside, and the page offers to bring them back.
- The Checks panel catches what an edit usually breaks: overlapping or wall-less rooms, doors onto rock, stairs without a landing, cut-off rooms, overlapping multiblocks, a multiblock the wiki does not allow at that size, machines facing a wall or another machine, polluters outside the dirty chunks, and clean rooms too close to them. Click a check to go to it. The full audit still runs in `generate.py`.
- Export PNG draws the floor on screen, unaudited. The sheets come from `generate.py`.

## The audit

`generate.py` stops before drawing if anything fails, writes `out/audit.txt`, and leaves the old sheets alone. It checks that:

- every record in the plan is complete, and every floor or room it names exists;
- floor air, and the pipe crawl, stay inside Y 0 through 255;
- each floor is one walkable piece, and so is the pipe crawl;
- doors open both ways, and walls are 1 block;
- every multiblock is a size the wiki allows, counted one module at a time in a wallshared row;
- every machine fits its room, faces a walkable cell, and stays out of the rain;
- mufflers and turbines have their air;
- polluters sit in the dirty chunks under the air filter, on any floor, and pollution alarms sit there too;
- the clean rooms are at least two chunk steps from the dirty block;
- the launch pad has open sky straight up and a fuel loader touching it;
- stairs land at their bottom end on the lower floor and their top end on the upper one;
- every dug room, street, and stair keeps 5 blocks of rock overhead by the ground estimate, and rooms marked at grade really are;
- the lift lands on each floor it serves, and no hop is longer than an elevator reaches.

One square is one block, north is up, X grows east, and Z grows south. Both ends of every range are inside it.
