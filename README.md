![](launcher/Gregmatics.ico)

# Gregmatics

Create floorplans for [GregTech New Horizons](https://github.com/GTNewHorizons/GT-New-Horizons-Modpack) - [2.9.0](https://github.com/GTNewHorizons/GT-New-Horizons-Modpack/releases/tag/2.9.0)

Download Gregmatics.exe and open it. That file is the whole program. It uses the Microsoft Edge WebView2 runtime, which Windows already has when Edge is installed.

## Floors

The list on the left runs from the top of the base down. Click a floor to edit that plan.

Edit on a band opens the name, the slab, and the height. Delete there removes that floor once the rooms and streets are gone. A crawlspace stays, hung under the floor above it. A plan keeps one floor. Delete on a crawlspace removes it and the trenches dug in it. `+` in a gap adds a floor there. If that floor would land on one above it, the floors above move up, leaving two solid blocks between them.

File → Settings sets the floorplan baseline. The square shows a compass, and the arrows run out to its edges. Faint lines behind it stay square, like blocks, and get finer as the baseline covers more ground. Each corner has an X box and a Z box. Those boxes take whole numbers. A number past the opposite side turns the compass, and that corner keeps the number. Save applies the baseline, the name, the tier, and autosave. Closing with unsaved edits asks you to save or exit. A floor's Y is set when you add it, and it is required.

A new plan starts with one floor and no pipe crawl. When you add a floor, and a floor is already there, Crawlspace adds a crawlspace in that spot instead of a floor. It hangs under the floor above it. Two crawlspaces with no floor between them are named in Checks. The hatched band is a crawlspace. Trenches are drawn there. The cube at the top of the list opens the 3D view. Drag to turn, right-drag to slide, scroll to zoom. Double-click something to frame it, or double-click empty ground to fit the base. Escape, or the cube again, returns to the plan.

## Tools

![Select](assets/select.png)

Click a block to select it. Click the same spot again to reach what is under it. Ctrl+click adds to the selection.

Drag moves the selection. A locked room stays where it is. When only one resizable thing is selected, drag a handle to resize it. Arrow keys nudge. R turns. Delete removes. A group moves, turns, copies, and deletes together.

Ctrl+C copies, Ctrl+X cuts, Ctrl+V pastes, and Ctrl+D duplicates. Copying a room copies the pads, machines, marks, and shafts in it. Paste lands beside the last copy, on the floor you are looking at. Paste a cut and it returns to the cells it left. Drop one machine onto another to swap them.

![Room](assets/room.png)

Drag out a room, or click once for a 9×9.

The panel sets the name, the color, and the height. Move a room and its pads, machine rows, marks, and shafts come with it. Resize leaves those where they are. Delete the room and they go too.

Lock, on that panel, holds the room. You can still select it. It will not drag, resize, or nudge, and the corner fields stay closed. Turn Lock off to move it.

![Street](assets/street.png)

Drag out a street. A click makes a default length.

Where two streets meet, the shared edge stays open. A street can carry a trench in the pipe crawl under it. Entrance, on that panel, makes that street a way in. Any number of streets can be an entrance. Turn it off and the street stays, as an ordinary street.

![Door](assets/door.png)

Click a wall between two rooms for a door 3 blocks wide, or drag along the wall for a longer one. Both sides need a room. The panel sets which way it faces.

![Stair](assets/stair.png)

Drag from the bottom step. The stair climbs to the next floor up. From the top floor it goes down. Both ends need a landing on a walkable cell of that floor.

![Area](assets/area.png)

Drag inside a room to mark a spot, such as water or bees. Shape, label, and whether it shows only on a detail sheet are in the panel.

![Multiblock](assets/multiblock.png)

Pick one from the list. Type to search. Click to place it, and press R to turn it. If it does not fit, the preview goes dashed and red.

A multiblock whose wiki size is a range can be changed after it is placed. Select it and drag a handle, or set its width, depth, and height on the panel. A square has one side to set. The size stays inside that range and inside the room.

A wallshared row is one multiblock. Drag a handle, or set Across and Ranks, to add modules that share a wall. The size fields then change every module in the row.

If a multiblock is a size the wiki does not allow, Checks says so. Fit to size, on its panel, moves it to the nearest size that is allowed.

It stays locked until File → Settings raises the tier far enough. Tiers follow the 2.9.0 quest book, from Tier 0 Stone Age and Tier 0.5 Steam through Tier 12 UMV. A muffler and a turbine need open air in front.

![Machine](assets/machine.png)

Pick one from the list. Click for a single machine, or drag to lay a row. R turns it. Every machine in the row faces the same way. Click a machine to replace it. Drop one onto another to swap them.

Each machine has its own voltage, up to the plan's tier. A new one starts at MV. It has to face a cell you can walk on, and it cannot stand in the rain.

![Trench](assets/trench.png)

Switch to the pipe crawl, then drag out a trench.

Edit on the crawl sets which floor it hangs under, the gap, and the height. The trench stays inside that floor's footprint.

## Plans

Plans are `.gregmatic` files in the Gregmatics folder under AppData. Opening Gregmatics brings back the plan last saved. With no plan yet, the New dialog opens; closing it leaves File → New and File → Load, and the rest of the window waits. An edit writes itself after a short pause. Turn Autosave off in File → Settings and the file waits for Ctrl+S or File → Save. Unsaved stays in the header until that write finishes.

File → New asks for a floorplan name and the first floor's box, then adds another file at Stone, with one empty floor and no crawlspace or entrance. The box starts at 256 by 256, from 0 through 255. The file name is the floorplan name in lowercase, with spaces as underscores. A name already used becomes `_1`, then `_2`. File → Load opens a plan, and the dialog starts in that folder. Settings shows that file name under the floorplan name. Save in that sheet applies the name, the tier, and autosave. The tier choices are the quest book tabs, Tier 0 Stone Age through Tier 12 UMV. A multiblock stays locked until the plan reaches its tier. Export PNG saves the floor on screen. The printed sheets are drawn separately, from `blueprints/`, into `out/`.
