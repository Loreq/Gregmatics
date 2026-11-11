# Blueprints

```
py -3 -m pip install -r python/requirements.txt
py -3 python/generate.py
```

Pillow draws the sheets. On Windows, Gregmatics opens in its own window.

## Files

| File | Holds |
| --- | --- |
| `%APPDATA%\Gregmatics` | The plans. Each one is a `.gregmatic` file. `settings.json` there remembers the folder and the open file. Not part of the repository. |
| `../launcher/Gregmatics.csproj` | The program version is the `Version` property. Settings reads it. |
| `../launcher/Program.cs` | The window. As `start.exe` it reads the editor in this folder. As the released `Gregmatics.exe` it reads the editor packed inside the file. |
| `../build.cmd` | Builds `start.exe` and `release\Gregmatics.exe`. |
| `catalog/` | GTNH 2.9.0 machine facts as JSON. Multiblocks are one file per tier in `catalog/multiblocks/`. Machines are one file per group in `catalog/machines/`, because a machine's voltage is set when you place it. `groups.json` names the groups. `elevator.json` is the elevator reach. |
| `python/` | The program. Run the commands above from this folder. |
| `python/layout.py` | Loads the open `.gregmatic` file, checks every record, and works out each zone's Y from its floor. |
| `python/schema.py` | The record types. |
| `python/catalog.py` | Loads `catalog/`, keeps the voltage order, and says which sizes a multiblock may be built at. Its docstring lists the fields. The editor lists the GTNH 2.9.0 quest tabs, from Tier 0 Stone Age through Tier 12 UMV. |
| `python/model.py` | Turns the plan into per-column spans of air, names chunks, and blends the ground estimate. |
| `python/audit.py` | The checks. |
| `python/files.py` | Writes text and pictures to a temporary file, then swaps it into place, so a file is never left half written. |
| `python/sheets/` | The drawing. `pen.py` is Pillow in layout pixels, `planview.py` paints one floor, and `render.py` lays a sheet out around it. PNG only, no SVG. |
| `python/generate.py` | Writes `editor/data.js`, runs the audit, then draws `out/`. |
| `python/desktop.py` | The Gregmatics window. Save and refresh go through it to the open `.gregmatic` file. No server. |
| `python/requirements.txt` | Pillow and pywebview. |
| `editor/` | The Gregmatics page. `index.html`, `editor.css`, and `data.js` stay at the top. The scripts are in `core/`, `view3d/`, and `app/`, listed under [The editor's scripts](#the-editors-scripts). `data.js` is written by Save and by `generate.py`. |
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

On Windows, open `start.exe` in the project folder, or run `py -3 python/desktop.py` here. The release is `Gregmatics.exe`, one file, with the editor and the catalog inside it. The window reads the open `.gregmatic` file. Save writes that file and, from the project folder, `editor/data.js`. Run `py -3 python/generate.py` to redraw the sheets into `out/`.

The tools are in the [project README](../README.md).

- With Select, Ctrl+click adds to the selection. R turns the selection, the arrow keys nudge it, and Delete removes it. A group moves, turns, copies, and deletes together. Ctrl+S saves. Ctrl+C copies, Ctrl+X cuts, Ctrl+V pastes, and Ctrl+D duplicates. Copying a room copies what is in it. Paste puts the copy beside the last one, on the floor you are looking at; pasting a cut puts it back on the cells it left. Drop a machine on another to swap them. A room's panel lists what is in it.
- Lock, on a room's panel, keeps that room where it is. A locked room can still be selected. It does not drag, resize, or nudge, and its corner fields stay closed. Turn Lock off to move it.
- Unsaved edits stay in the browser until you save. If the plan changes underneath them, they are set aside, and the page offers to bring them back.
- The Checks panel catches what an edit usually breaks: overlapping or wall-less rooms, doors onto rock, stairs without a landing, cut-off rooms, overlapping multiblocks, a multiblock the wiki does not allow at that size, machines facing a wall or another machine, polluters outside the dirty chunks, and clean rooms too close to them. Click a check to go to it. The full audit still runs in `generate.py`.
- Export PNG draws the floor on screen, unaudited. The sheets come from `generate.py`.

## The editor's scripts

The page is plain scripts with no build step, grouped in folders. `index.html` loads them in the order below, and `build.cmd` ships every file under `editor/` except `data.js`. A new script needs a `<script>` line in `index.html`. A new file under `app/` also needs its empty name added in `app/app-state.js`, and it goes in the folder for its subject.

`core/` holds the data rules and never touches the page. Each file adds its functions to one object, `Core`, and the Python side follows the same rules.

| File | Holds |
| --- | --- |
| `core/core.js` | Constants, tiers, the text a plan is saved as, boxes, lookups, and chunks. |
| `core/core-floors.js` | Each floor's air, seating a new floor in the stack, and footprints. |
| `core/core-rows.js` | Machine rows: slots and cells, and placing, moving, turning, and swapping a machine. |
| `core/core-pads.js` | Multiblocks: the controller's side, the modules of a wallshared row, turning, and changing type. |
| `core/core-sizes.js` | The sizes the wiki allows a multiblock, and fitting one to them. |
| `core/core-zones.js` | What is on a layer, how far a thing may move, and moving, renaming, and deleting. |
| `core/core-clipboard.js` | Copying things and pasting the copies. |
| `core/core-checks.js` | The Checks panel's checks. |

The 3D view is four objects, one a file. Only `View3D` is used by the page.

| File | Holds |
| --- | --- |
| `view3d/view3d-mesh.js` | `Mesh3D`: triangles and the outlines drawn over them. |
| `view3d/view3d-camera.js` | `Camera3D`: the camera, its matrices, and what a pixel points at. |
| `view3d/view3d-scene.js` | `Scene3D`: the plan as shapes, labels, and things to pick. |
| `view3d/view3d.js` | `View3D`: drawing with WebGL, the mouse, and the name tags. |

The page itself is `App`, in `app/`. `app-state.js` and `app.js` sit at the top of it. The rest is split by subject: `view`, `paint`, `tools`, `edit`, `panels`, `dialogs`, and `files`. `app-state.js` makes `App`, with the shared state and helpers and one empty name for each file below. Each file fills its own name, such as `App.Sel`. Inside a file, a plain call goes to that file or to a helper from `app-state.js`. A call through a name, such as `Panels.refresh()`, goes to another file.

| File | Name | Holds |
| --- | --- | --- |
| `app/app-state.js` | `App` | The loaded data, the editor's state, and small helpers for the plan, the page, and boxes. |
| `app/edit/app-select.js` | `Sel` | The selection. |
| `app/edit/app-history.js` | `History` | `change()` and `commit()`, undo and redo, the browser's draft, and showing a whole new plan. |
| `app/files/app-files.js` | `Files` | Messages to the desktop window, starting up, opening a plan, and the plan folder. |
| `app/files/app-newplan.js` | `NewPlan` | File → New. |
| `app/files/app-save.js` | `Save` | Saving, autosave, and the Saved toast. |
| `app/view/app-view.js` | `View` | Blocks to pixels and back, fitting, sliding, and zooming. |
| `app/view/app-space.js` | `Space` | Switching between the plan and the 3D view. |
| `app/paint/app-paint.js` | `Paint` | The ground, the rulers, each frame, and Export PNG. |
| `app/paint/app-paint-zones.js` | `PaintZones` | Rooms, streets, doors, stairs, shafts, lifts, their names, and the floors above and below. |
| `app/paint/app-paint-contents.js` | `PaintContents` | Areas, multiblocks, and machines. |
| `app/paint/app-paint-overlay.js` | `Overlay` | The hover outline, the selection, and the preview of what a tool would make. |
| `app/tools/app-tools.js` | `Tools` | The `TOOLS` table and the icons. |
| `app/tools/app-hit.js` | `Hit` | What is under the pointer, and the handles of the selected thing. |
| `app/tools/app-draw.js` | `Draw` | The draw tools: Room, Street, Door, Stair, Area, Trench. |
| `app/tools/app-place.js` | `Place` | The place tools: Multiblock and Machine. |
| `app/edit/app-machines.js` | `Machines` | Moving machines, and keeping them selected while their rows are renumbered. |
| `app/edit/app-edit.js` | `Edit` | Nudging, turning, and deleting the selection. |
| `app/edit/app-clipboard.js` | `Clip` | Copy, cut, paste, and duplicate. |
| `app/tools/app-pointer.js` | `Pointer` | Pressing, dragging, and releasing on the plan. |
| `app/tools/app-keys.js` | `Keys` | The keyboard shortcuts. |
| `app/dialogs/app-dialogs.js` | `Dialogs` | The question asked before something is thrown away. |
| `app/dialogs/app-floor-dialog.js` | `FloorDialog` | Adding a floor, editing one, and editing the pipe crawl. |
| `app/dialogs/app-bounds.js` | `Bounds` | The compass picture a floor's footprint is typed into. |
| `app/dialogs/app-settings.js` | `Settings` | File → Settings. |
| `app/panels/app-panels.js` | `Panels` | `refresh()`, the menu bar, the tool bar, and the line that says what is under the pointer. |
| `app/panels/app-lists.js` | `Lists` | The Checks list and the list of what is on the floor. |
| `app/panels/app-picker.js` | `Picker` | The catalog picker. |
| `app/panels/app-stack.js` | `Stack` | The floors column, and moving from one floor to another. |
| `app/panels/app-form.js` | `Form` | The rows of the selection panel. |
| `app/panels/app-fields.js` | `Fields` | The selection panel: one set of fields for each kind of thing. |
| `app/app.js` | | Adds every listener and starts the editor. It loads last. |

Functions are kept short, and each one has a one-line header saying what it does: a docstring in Python, `/** */` in the scripts, and `/// <summary>` in the launcher. A number or a color with a meaning has a name at the top of its file.

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
