![](launcher/Gregmatics.ico)

# Gregmatics

Gregmatics is a floorplan program for [GregTech New Horizons](https://github.com/GTNewHorizons/GT-New-Horizons-Modpack) [2.9.0](https://github.com/GTNewHorizons/GT-New-Horizons-Modpack/releases/tag/2.9.0).

Open Gregmatics.exe. It needs the Microsoft Edge WebView2 runtime. If that runtime is missing, Gregmatics asks you to install it, then open the program again.

## Features

- Floors and pipe crawls for a base: rooms, streets, doors, stairs, and marked areas
- A catalog of multiblocks and machines, capped at the plan's quest-book tier
- Trenches in the pipe crawl
- Checks that name what is wrong, and a click that takes you there
- A 3D view of the whole base
- Export PNG of the floor on screen, at a fixed scale
- Plans saved as `.gregmatic` files, with autosave and revert
- A check for a newer GitHub release, with install and restart

## The window

The floors run down the left, from the top of the base to the bottom. The plan is in the middle. The tools run across the top.

On the right, Passthrough and Contents sit above undo, redo, copy, and paste. Passthrough draws the outlines of the floors above and below. Contents draws what stands in the rooms. For Multiblock and Machine, the catalog list sits above the selection. Under that are Checks, then On this floor.

Click a floor to show it. The pen on its band opens the name, the Y, the height, and the outline. Y is required. Delete waits until the rooms, streets, doors, stairs, and lifts on that floor are gone. A plan keeps one floor. A crawlspace stays, hung under a floor that remains. `+` in a gap adds a floor there. If that floor would meet one above it, the floors above move up, leaving two solid blocks between them.

When a floor is already there, Crawlspace in the add dialog adds a crawlspace in that spot. It hangs under the floor above it. The hatched band is a crawlspace. Two crawlspaces with no floor between them show up in Checks. Delete on a crawlspace removes it and the trenches in it.

Checks lists what is wrong, this floor first. Click a line to go to it. When nothing is wrong, the list says None. On this floor names the rooms, streets, doors, stairs, shafts, and lifts you are looking at. On a crawlspace it names the trenches.

## Plans

Plans are `.gregmatic` files in the Gregmatics folder under Roaming AppData. Library, in File → Settings, can move that folder with Change, and the plans move with it.

Opening Gregmatics brings back the plan you last saved or loaded. When that file is gone, it opens the newest plan in the folder. Unsaved edits of that same save come back on the plan. If the file changed under those edits, they are set aside and the page offers to restore them. With no plan yet, the New dialog opens. Close it, and File → New, File → Load, and Help → Check for updates stay available.

File → New asks for a floorplan name and the first floor's footprint. The footprint starts at 256 by 256, from 0 through 255. The new plan is Stone, with one empty floor and no crawlspace. The file name is that name in lowercase. Spaces become underscores, and any other character is dropped. An empty result is named plan. A name already in use becomes `_1`, then `_2`.

File → Load opens a plan from the plan folder. A file from somewhere else is copied into that folder.

With Autosave on, an edit writes itself after a short pause. Turn Autosave off in File → Settings and the file waits for File → Save or Ctrl+S. The header shows Unsaved until that write finishes. File → Revert puts the plan back to the last save. It asks first, and it is there only while the plan differs from that save.

## Tools

On a floor the bar is Select, Room, Street, Door, Stair, Area, Multiblock, and Machine. Keys 1 through 8 pick them, in that order. On a crawlspace the bar is Select and Trench. Key 9 picks Trench.

![Select](assets/select.png)

Click a block to select it. Click the same spot again to reach what is under it. Ctrl+click adds to the selection. Drag moves the selection. A locked room stays where it is. When one resizable thing is selected, drag a handle to resize it. Arrow keys nudge, and Delete removes.

R turns a machine, a multiblock, or a machine row, and a group of those turns together. A group moves, copies, and deletes together. Ctrl+C copies, Ctrl+X cuts, Ctrl+V pastes, and Ctrl+D duplicates. Copying a room copies what is in it. Paste lands beside the last copy, on the floor you are looking at. A cut that has not been pasted yet can land back on the cells it left. A trench stays in its crawlspace. A stair or a lift keeps the floors it joins.

![Room](assets/room.png)

Drag out a room, or click once for a 9×9. The panel sets the name, the color, and the height. Move a room and its multiblocks, machine rows, areas, and shafts come with it. Resize leaves those where they are. Delete the room and they go too.

Lock, on that panel, holds the room. You can still select it. It will not drag, resize, or nudge, and the corner fields stay closed. Turn Lock off to move it.

![Street](assets/street.png)

Drag out a street. A click makes a short one. Where two streets meet, the shared edge stays open. A street on the floor over a crawl gets a trench under it, and the panel can turn that trench off. Entrance makes the street a way in. Any number of streets can be an entrance. Turn Entrance off and the street remains an ordinary street.

![Door](assets/door.png)

Click a wall for a door 3 blocks wide, or drag along the wall for a longer one. Both sides need open floor: a room or a street.

![Stair](assets/stair.png)

Drag from the bottom step. The stair climbs to the next floor up. On the top floor, drag from the top step and it goes down. The panel sets which end you step on at the bottom. Each end needs a landing on open floor.

![Area](assets/area.png)

Drag inside a room to mark a spot, such as water or bees. The panel sets the shape, the label, and Detail only. Detail only leaves the mark off an overview sheet. The plan and Export PNG still show it.

![Multiblock](assets/multiblock.png)

Pick one from the list. Type to search, and sort A to Z, Z to A, by tier, or by size. Click to place it, and press R to turn it. The panel sets which way the controller faces. The preview is a green ring when it fits, and a dashed rust ring when the spot is blocked.

The list offers the multiblocks the plan's tier allows. File → Settings sets that tier, from Tier 0 - Stone Age and Tier 0.5 - Steam through Tier 12 - UMV. One already placed above the tier stays where it is, and Checks names the tier it needs.

When the wiki size is a range, drag a handle, or set the width, depth, and height. A square has one side. The size stays inside that range and inside the room. A wallshared row is one multiblock: drag a handle, or set Across and Ranks, to add modules that share a wall. The size fields set every module in the row. If the size is one the wiki does not allow, Checks says so. Fit to size moves it to the nearest size that is allowed.

![Machine](assets/machine.png)

Pick one from the list. Type to search, and sort the same way as multiblocks. Click for one machine, or drag to lay a row. R turns it, and every machine in the row faces the same way. The panel sets that facing. It needs open floor in front of it. Click a machine to replace it. Drop one machine onto another to swap them. A group stays put when a machine in it would land on another machine.

A new machine takes the plan's tier. Stone and Steam start it at LV. On those plans the list says Electric machines start at Tier 1. From LV on, you can set each machine from LV up through the plan's tier.

![Trench](assets/trench.png)

Switch to the pipe crawl, then drag out a trench. The pen on that band sets which floor the crawl hangs under, the gap, and the height. The trench stays inside that floor's footprint.

## Settings

File → Settings holds the plan name, the tier, autosave, chunk borders, pollution, the plan folder, updates, and the baseline. The file name sits under the plan name. Save renames the file to match, and applies the tier, autosave, chunk borders, pollution, and whether Gregmatics looks for a newer release when it opens. Chunk borders and Pollution draw those lines on the plan.

The tier choices are the quest book tabs, Tier 0 - Stone Age through Tier 12 - UMV. Lowering the tier leaves everything in place. Checks then names what sits above it.

The baseline is the plan's footprint. The square shows a compass, and the arrows run out to its edges. The grid stays square, like blocks. Each corner has an X box and a Z box. Those boxes take whole numbers. A number past the opposite side turns the compass, and that corner keeps the number. Save applies the baseline. Close the dialog with edits still in it, and Gregmatics asks you to save or exit.

## The 3D view

The cube at the top of the floor list opens the 3D view. Drag to turn, right-drag to slide, and scroll to zoom. Zooming in pulls the view toward the pointer. Double-click something to frame it, or double-click empty ground to fit the base. The name under the pointer shows at the lower left. Each floor and crawlspace has a box, so you can hide it. Escape, or the cube again, returns to the plan.

## Export PNG

File → Export PNG downloads the floor on screen: the whole sheet at one scale.

## Check for updates

Help → Check for updates looks for a newer GitHub release of Gregmatics.exe. When one is out, the dialog shows the date and the notes. Install and restart puts that release in place of the program that is running and opens it again. The same dialog opens on launch when a newer release is out. Updates, in File → Settings, can turn that launch check off.
