/* Copy and paste. A clip is a detached copy of one thing: { kind, rec }, with `contents` for a room,
   or { kind: "machines", machine } for one machine out of a row. Pasting finds one offset that lands
   every clip of a group, so the group keeps its arrangement. */
(function (root) {
  "use strict";

  const Core = root.Core;
  const {
    STEP, ROOM_CONTENTS, clone, gap, inside, sameBox, containsBox, boxesOverlap, unionBoxes,
    floorById, roomById, onFloor, roomAt, inner, floorBox,
    codesOf, tierAt, cellOf, slotIn, nextRowId, placeMachine, nextPadNum, padBlocks,
    contentsOn, contentsOf, boxOf, anchorCell, boundsFor, shiftZone, uniqueId,
  } = Core;

  // Kinds that live in a room, so a paste needs a room under it.
  const IN_ROOM = new Set(["marks", "pads", "walls", "shafts", "machines"]);
  // Kinds whose copy takes the original's id with a number after it.
  const KEEPS_ID = new Set(["streets", "doors", "stairs", "lifts", "trenches"]);

  // ---- taking a copy ----

  /** A detached copy. A room includes its multiblocks, machine rows, areas, and shafts. A machine is one slot. */
  function capture(layout, kind, index, slot) {
    if (kind === "machines") {
      const wall = layout.walls[index];
      const [x, z] = cellOf(wall, slot);
      return { kind, machine: { code: codesOf(wall)[slot], face: wall.face, tier: tierAt(wall, slot), x, z } };
    }
    const rec = clone(layout[kind][index]);
    const clip = { kind, rec };
    if (kind === "rooms") {
      const found = contentsOf(layout, rec.id);
      clip.contents = {};
      for (const list of ROOM_CONTENTS) clip.contents[list] = found[list].map(clone);
    }
    return clip;
  }

  /** The footprint of a clip, in the same shape as boxOf. */
  function clipBox(clip) {
    if (clip.kind === "machines") {
      const m = clip.machine;
      return { x0: m.x, x1: m.x, z0: m.z, z1: m.z };
    }
    return boxOf(clip.kind, clip.rec);
  }

  /** Slide a clip, so the next paste steps from where the last one landed. */
  function shiftClip(clip, dx, dz) {
    if (clip.kind === "machines") {
      clip.machine.x += dx;
      clip.machine.z += dz;
      return;
    }
    shiftZone(clip.kind, clip.rec, dx, dz);
    if (clip.kind !== "rooms" || !clip.contents) return;
    for (const list of ROOM_CONTENTS) {
      for (const item of clip.contents[list]) shiftZone(list, item, dx, dz);
    }
  }

  // ---- whether a spot is free ----

  /** A box moved by an offset. */
  function movedBox(box, dx, dz) {
    return { x0: box.x0 + dx, x1: box.x1 + dx, z0: box.z0 + dz, z1: box.z1 + dz };
  }

  /** Whether two rooms have a wall between them: at least one block apart, corners aside. */
  function roomsApart(a, b) {
    const gx = gap(a.x0, a.x1, b.x0, b.x1);
    const gz = gap(a.z0, a.z1, b.z0, b.z1);
    if (gx < 0 && gz < 0) return false;
    if ((gx < 0 && gz < 1) || (gz < 0 && gx < 1)) return false;
    return true;
  }

  /** The footprint of the floor a clip's record is on, by its floor or its room, or null. */
  function hostBox(layout, clip, floorId) {
    const host = floorId ? floorById(layout, floorId) : null;
    if (host) return floorBox(layout, host);
    const room = clip.rec && clip.rec.room ? roomById(layout, clip.rec.room) : null;
    const under = room && floorById(layout, room.floor);
    return under ? floorBox(layout, under) : null;
  }

  /** The box a pasted clip must stay inside when it lands on `box`. */
  function spotBounds(layout, clip, floor, box) {
    if (clip.kind === "trenches") return boundsFor(layout, "trenches", box || {});
    if (clip.kind === "stairs" || clip.kind === "lifts") {
      const ids = clip.rec && clip.rec.floors ? clip.rec.floors.slice() : [];
      return boundsFor(layout, clip.kind, { ...clip.rec, ...box, floors: ids });
    }
    const id = floor || (clip.rec && clip.rec.floor);
    if (clip.kind === "streets") {
      return boundsFor(layout, "streets", {
        ...(clip.rec || {}), ...box, floor: id, style: clip.rec && clip.rec.style,
      });
    }
    return hostBox(layout, clip, id) || inner(layout);
  }

  /** A room-sized spot with a one-block wall to every other room, and no street under it. */
  function roomClear(layout, floor, box) {
    for (const room of layout.rooms) {
      if (room.floor === floor && !roomsApart(box, room)) return false;
    }
    for (const street of layout.streets) {
      if (street.floor === floor && boxesOverlap(box, street)) return false;
    }
    return true;
  }

  /** Whether one machine can stand on a cell: in a room, off every multiblock, in a free slot or none. */
  function machineSpot(layout, catalog, floor, x, z, face) {
    const home = roomAt(layout, floor, x, z);
    if (!home) return false;
    for (const item of contentsOn(layout, floor)) {
      if (item.kind === "pads" && padBlocks(item.z, catalog).includes(`${x},${z}`)) return false;
    }
    const hit = slotIn(layout, home.room.id, x, z);
    if (!hit) return true;
    return hit.code === "-" && layout.walls[hit.index].face === face;
  }

  /** Whether a machine row moved by (dx, dz) starts in a room. Strict: every slot is in that room. */
  function rowSpot(layout, floor, row, dx, dz, strict) {
    const x = row.x + dx;
    const z = row.z + dz;
    const home = roomAt(layout, floor, x, z);
    if (!home) return false;
    const step = STEP[row.along];
    const n = Math.max(1, codesOf(row).length);
    let covered = true;
    for (let i = 0; i < n; i += 1) {
      if (!inside(home.room, x + step[0] * i, z + step[1] * i)) covered = false;
    }
    return covered || !strict;
  }

  /** Whether a footprint's middle is in a room. Strict: all of it is in that room, and a multiblock covers no other. */
  function boxSpot(layout, floor, kind, box, strict) {
    const [x, z] = anchorCell(kind, box);
    const home = roomAt(layout, floor, x, z);
    if (!home) return false;
    if (!containsBox(home.room, box)) return !strict;
    if (!strict || kind !== "pads") return true;
    return !layout.pads.some((pad) => onFloor(layout, pad.room, floor) && boxesOverlap(box, pad));
  }

  /** Whether something that lives in a room has a room where `box` puts it. `at` is where the clip is now. */
  function contentSpot(layout, floor, clip, at, box, strict) {
    if (clip.kind === "walls") return rowSpot(layout, floor, clip.rec, box.x0 - at.x0, box.z0 - at.z0, strict);
    return boxSpot(layout, floor, clip.kind, box, strict);
  }

  /** Whether a clip fits on `box`. Strict rejects overlaps. */
  function spotFree(layout, catalog, clip, floor, at, box, strict) {
    if (!containsBox(spotBounds(layout, clip, floor, box), box)) return false;
    if (clip.kind === "rooms") return Boolean(floor) && (!strict || roomClear(layout, floor, box));
    if (clip.kind === "machines") {
      return Boolean(floor) && machineSpot(layout, catalog, floor, box.x0, box.z0, clip.machine.face);
    }
    if (IN_ROOM.has(clip.kind)) return Boolean(floor) && contentSpot(layout, floor, clip, at, box, strict);
    return true;
  }

  // Whether a record of the clip's kind already stands where the clip was cut from.
  const STANDS_THERE = {
    marks: (layout, clip, floor, at) => layout.marks.some((mark) => onFloor(layout, mark.room, floor) && sameBox(mark, at)),
    shafts: (layout, clip, floor, at) => layout.shafts.some((shaft) => onFloor(layout, shaft.room, floor) && sameBox(shaft, at)),
    walls: (layout, clip, floor) => layout.walls.some((wall) => onFloor(layout, wall.room, floor) && wall.x === clip.rec.x
      && wall.z === clip.rec.z && wall.along === clip.rec.along),
    stairs: (layout, clip, floor, at) => layout.stairs.some((stair) => sameBox(stair, at)),
    lifts: (layout, clip, floor, at) => layout.lifts.some((lift) => lift.x === at.x0 && lift.z === at.z0),
    trenches: (layout, clip, floor, at) => layout.trenches.some((trench) => sameBox(trench, at)),
    doors: (layout, clip, floor, at) => {
      const on = floor || clip.rec.floor;
      return layout.doors.some((door) => door.floor === on && sameBox(door, at));
    },
    streets: (layout, clip, floor, at) => {
      const on = floor || clip.rec.floor;
      return layout.streets.some((street) => street.floor === on && boxesOverlap(street, at));
    },
  };

  /** The cut can land back on its old cells when nothing else is standing there. */
  function originFree(layout, catalog, clip, floor, at) {
    if (!spotFree(layout, catalog, clip, floor, at, at, true)) return false;
    const taken = STANDS_THERE[clip.kind];
    return !(taken && taken(layout, clip, floor, at));
  }

  // ---- finding a spot ----

  /** Offsets that step a footprint aside: east, south, west, north, then one block each way. */
  function pasteSteps(at, margin) {
    const sx = at.x1 - at.x0 + 1 + margin;
    const sz = at.z1 - at.z0 + 1 + margin;
    const steps = [[sx, 0], [0, sz], [-sx, 0], [0, -sz]];
    if (sx !== 1 || sz !== 1) steps.push([1, 0], [0, 1], [-1, 0], [0, -1], [1, 1]);
    const seen = new Set();
    const spots = [];
    for (const [dx, dz] of steps) {
      const key = `${dx},${dz}`;
      if (seen.has(key)) continue;
      seen.add(key);
      spots.push({ dx, dz });
    }
    return spots;
  }

  /**
   * One offset that lands every clip, as { dx, dz }, or null. A cut that was not pasted yet may land
   * back where it was. A spot with no overlaps wins over one that only fits.
   */
  function pasteGroupSpot(layout, catalog, clips, floor, allowOrigin) {
    if (!clips.length) return null;
    const boxes = clips.map((clip) => clipBox(clip));
    const free = (spot, strict) => clips.every((clip, i) => (
      spotFree(layout, catalog, clip, floor, boxes[i], movedBox(boxes[i], spot.dx, spot.dz), strict)));
    if (allowOrigin && clips.every((clip, i) => originFree(layout, catalog, clip, floor, boxes[i]))) {
      return { dx: 0, dz: 0 };
    }
    const margin = clips.some((clip) => clip.kind === "rooms") ? 1 : 0;
    const spots = pasteSteps(unionBoxes(boxes), margin);
    return spots.find((spot) => free(spot, true)) || spots.find((spot) => free(spot, false)) || null;
  }

  // ---- landing a copy ----

  /** Give a copy an id or number of its own, add it to the plan, and return its index. */
  function landRecord(layout, kind, rec) {
    if (KEEPS_ID.has(kind)) rec.id = uniqueId(layout, kind, rec.id);
    if (kind === "shafts") rec.id = uniqueId(layout, "shafts", rec.id || "shaft");
    if (kind === "pads") rec.num = nextPadNum(layout);
    if (kind === "walls") rec.id = nextRowId(layout);
    layout[kind].push(rec);
    return layout[kind].length - 1;
  }

  /** Paste one machine into the room under its new cell. */
  function pasteMachine(layout, catalog, machine, dx, dz, floor) {
    const x = machine.x + dx;
    const z = machine.z + dz;
    const home = roomAt(layout, floor, x, z);
    if (!home) return null;
    placeMachine(layout, catalog, { code: machine.code, x, z, face: machine.face, room: home.room.id, tier: machine.tier });
    const hit = slotIn(layout, home.room.id, x, z);
    return hit ? { kind: "machines", index: hit.index, slot: hit.slot } : null;
  }

  /** Paste a room and everything it held. */
  function pasteRoom(layout, clip, dx, dz, floor) {
    const rec = clone(clip.rec);
    rec.id = uniqueId(layout, "rooms", rec.id);
    if (floor) rec.floor = floor;
    shiftZone("rooms", rec, dx, dz);
    layout.rooms.push(rec);
    const index = layout.rooms.length - 1;
    for (const list of ROOM_CONTENTS) {
      for (const item of clip.contents[list]) {
        const copy = clone(item);
        copy.room = rec.id;
        shiftZone(list, copy, dx, dz);
        landRecord(layout, list, copy);
      }
    }
    return { kind: "rooms", index };
  }

  /** Paste any other record. One that lives in a room joins the room under it, or is not pasted. */
  function pasteRecord(layout, clip, dx, dz, floor) {
    const { kind } = clip;
    const rec = clone(clip.rec);
    shiftZone(kind, rec, dx, dz);
    if ((kind === "streets" || kind === "doors") && floor) rec.floor = floor;
    if (IN_ROOM.has(kind)) {
      const [x, z] = anchorCell(kind, rec);
      const home = roomAt(layout, floor, x, z);
      if (!home) return null;
      rec.room = home.room.id;
    }
    return { kind, index: landRecord(layout, kind, rec) };
  }

  /** Insert a copy shifted by (dx, dz). Returns { kind, index, slot }, or null. */
  function pasteClip(layout, catalog, clip, dx, dz, floor) {
    if (clip.kind === "machines") return pasteMachine(layout, catalog, clip.machine, dx, dz, floor);
    if (clip.kind === "rooms") return pasteRoom(layout, clip, dx, dz, floor);
    return pasteRecord(layout, clip, dx, dz, floor);
  }

  Object.assign(Core, { capture, clipBox, shiftClip, pasteGroupSpot, pasteClip });
})(typeof window !== "undefined" ? window : globalThis);
