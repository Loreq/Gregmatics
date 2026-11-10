/* Zones: the things a floor is made of, and what stands in its rooms.
   A zone is a room, street, door, stair, shaft, lift, or trench. A room's contents are its multiblocks
   (pads), machine rows (walls), and floor marks. Every record is named by its kind, the plan's list
   it lives in, and most are a box. A lift is one cell, and a machine row a start cell and a run. */
(function (root) {
  "use strict";

  const Core = root.Core;
  const {
    CRAWL, STEP, containsBox, pokesOut, orderedBox, shiftBox, shiftRecord, assignBox, middleCell,
    floorById, roomById, onFloor, roomAt, codesOf, frontCell,
    inner, hasSpan, spanOf, mainFloor, isMain, floorBox, floorLimit,
  } = Core;

  const IDENT = /^[a-z0-9][a-z0-9_-]*$/;
  // Ids a room or a floor cannot take: the model uses them for what dug a cell.
  const RESERVED = new Set(["rock", "corridor", "entry", "door", "trench", "stair", "well", CRAWL]);
  // What a room carries with it, in the order the plan lists it.
  const ROOM_CONTENTS = ["pads", "walls", "marks", "shafts"];
  // The zones of a floor in drawing order, big areas first, each with the test that puts one on a floor.
  const FLOOR_ZONES = [
    ["rooms", (layout, z, layer) => z.floor === layer],
    ["streets", (layout, z, layer) => z.floor === layer],
    ["shafts", (layout, z, layer) => onFloor(layout, z.room, layer)],
    ["stairs", (layout, z, layer) => z.floors.includes(layer)],
    ["doors", (layout, z, layer) => z.floor === layer],
    ["lifts", (layout, z, layer) => z.floors.includes(layer)],
  ];
  // Every kind that takes up floor, for asking what a footprint would leave outside.
  const FOOTPRINT_KINDS = ["rooms", "streets", "doors", "shafts", "pads", "walls", "marks", "stairs", "lifts", "trenches"];

  // ---- what is on a floor ----

  /** Editable zones on a layer, in drawing order: big areas first, small things on top. The crawl has only trenches. */
  function zonesOn(layout, layer) {
    const out = [];
    const tests = layer === CRAWL ? [["trenches", () => true]] : FLOOR_ZONES;
    for (const [kind, test] of tests) {
      layout[kind].forEach((z, index) => {
        if (test(layout, z, layer)) out.push({ kind, index, z });
      });
    }
    return out;
  }

  /** Floor marks, multiblocks, and machine rows in the rooms of a layer. */
  function contentsOn(layout, layer) {
    const out = [];
    for (const kind of ["marks", "pads", "walls"]) {
      layout[kind].forEach((rec, index) => {
        if (onFloor(layout, rec.room, layer)) out.push({ kind, index, z: rec });
      });
    }
    return out;
  }

  /** What one room holds: its multiblocks, machine rows, marks, and shafts. */
  function contentsOf(layout, roomId) {
    const out = {};
    for (const kind of ROOM_CONTENTS) out[kind] = layout[kind].filter((item) => item.room === roomId);
    return out;
  }

  // ---- one record ----

  /** The box a machine row covers: from its start cell along its run. An empty row is its start cell. */
  function rowBox(wall) {
    const n = Math.max(1, codesOf(wall).length);
    const step = STEP[wall.along];
    const xe = wall.x + step[0] * (n - 1);
    const ze = wall.z + step[1] * (n - 1);
    return { x0: Math.min(wall.x, xe), x1: Math.max(wall.x, xe), z0: Math.min(wall.z, ze), z1: Math.max(wall.z, ze) };
  }

  /** The box any record covers. */
  function boxOf(kind, z) {
    if (kind === "lifts") return { x0: z.x, x1: z.x, z0: z.z, z1: z.z };
    if (kind === "walls") return rowBox(z);
    return { x0: z.x0, x1: z.x1, z0: z.z0, z1: z.z1 };
  }

  /** A multiblock's name: how many modules, what it is, and its label. */
  function padName(pad, catalog) {
    const spec = catalog && catalog.multis[pad.key];
    const name = spec ? spec.name : pad.key;
    const count = (pad.wx || 1) * (pad.wz || 1);
    const titled = count > 1 ? `${count}× ${name}` : name;
    return pad.label ? `${titled} (${pad.label})` : titled;
  }

  /** The name a record goes by in lists and messages. One with no name of its own goes by its id. */
  function nameOf(kind, z, catalog) {
    if (kind === "rooms") return z.name;
    if (kind === "streets" && z.label) return z.label.charAt(0) + z.label.slice(1).toLowerCase();
    if (kind === "streets" && z.style === "entry") return "Entrance";
    if ((kind === "shafts" || kind === "lifts") && z.label) return z.label;
    if (kind === "marks") return z.short || z.label || "Area";
    if (kind === "pads") return padName(z, catalog);
    if (kind === "walls") return z.title ? `${z.id} ${z.title}` : `Row ${z.id}`;
    return z.id;
  }

  /** The cell that says which room a multiblock, row, or mark is in: a row's start, else the middle. */
  function anchorCell(kind, rec) {
    return kind === "walls" ? [rec.x, rec.z] : middleCell(rec);
  }

  // ---- where a record may be ----

  /**
   * The box a zone may use on a floor with this footprint. A floor that reaches the north rim lets the
   * entrance run north to the sheet's edge, and a street in line with the entrance run north through the rim.
   */
  function zoneLimit(layout, kind, z, footprint) {
    const box = footprint || inner(layout);
    const reachesNorth = box.z0 <= inner(layout).z0;
    if (!reachesNorth || kind !== "streets" || !z) return box;
    if (z.style === "entry") return { x0: box.x0, x1: box.x1, z0: layout.site.sheet.z0, z1: box.z1 };
    if (!Number.isInteger(z.x0)) return box;
    const entry = layout.streets.find((s) => s.style === "entry");
    if (entry && z.floor === entry.floor && z.x0 >= entry.x0 && z.x1 <= entry.x1) {
      return { x0: box.x0, x1: box.x1, z0: layout.site.square.z0, z1: box.z1 };
    }
    return box;
  }

  /** The part every one of some boxes covers. */
  function sharedBox(boxes) {
    return {
      x0: Math.max(...boxes.map((b) => b.x0)),
      x1: Math.min(...boxes.map((b) => b.x1)),
      z0: Math.max(...boxes.map((b) => b.z0)),
      z1: Math.min(...boxes.map((b) => b.z1)),
    };
  }

  /** The footprint of the floor the pipe crawl hangs under. */
  function crawlBox(layout) {
    const under = floorById(layout, layout.site.crawl.under);
    return under ? floorBox(layout, under) : inner(layout);
  }

  /** The floor a record is on, by its own floor or its room's, or null. */
  function floorOfRecord(layout, z) {
    if (z && z.floor) return floorById(layout, z.floor);
    const room = z && z.room ? roomById(layout, z.room) : null;
    return room ? floorById(layout, room.floor) : null;
  }

  /** The box a record must stay inside: its floor's footprint. A stair or lift gets what all its floors share. */
  function boundsFor(layout, kind, z) {
    if (kind === "stairs" || kind === "lifts") {
      const ids = (z && z.floors) || [];
      const boxes = ids.map((id) => floorById(layout, id)).filter(Boolean).map((floor) => floorBox(layout, floor));
      return boxes.length ? sharedBox(boxes) : inner(layout);
    }
    if (kind === "trenches") return crawlBox(layout);
    const floor = floorOfRecord(layout, z);
    return zoneLimit(layout, kind, z, floor ? floorBox(layout, floor) : inner(layout));
  }

  /** The largest part of (dx, dz) that keeps a box inside the bounds. A box too big for them moves freely. */
  function clampDelta(box, dx, dz, bounds) {
    let cx = dx;
    let cz = dz;
    if (box.x1 - box.x0 <= bounds.x1 - bounds.x0) {
      cx = Math.max(bounds.x0 - box.x0, Math.min(bounds.x1 - box.x1, dx));
    }
    if (box.z1 - box.z0 <= bounds.z1 - bounds.z0) {
      cz = Math.max(bounds.z0 - box.z0, Math.min(bounds.z1 - box.z1, dz));
    }
    return [cx, cz];
  }

  // ---- a floor's footprint against what is on it ----

  /** Whether a record belongs to a floor. Trenches belong to the floor the crawl hangs under. */
  function zoneOnFloor(layout, floorId, kind, z) {
    if (kind === "trenches") return layout.site.crawl.under === floorId;
    if (kind === "stairs" || kind === "lifts") return Array.isArray(z.floors) && z.floors.includes(floorId);
    if (z.floor) return z.floor === floorId;
    return z.room ? onFloor(layout, z.room, floorId) : false;
  }

  /** A message naming the first thing on a floor that a footprint would leave outside, or "". */
  function floorContentsOutside(layout, floorId, footprint, label) {
    for (const kind of FOOTPRINT_KINDS) {
      for (const z of layout[kind] || []) {
        if (!zoneOnFloor(layout, floorId, kind, z)) continue;
        const bounds = kind === "stairs" || kind === "lifts" ? footprint : zoneLimit(layout, kind, z, footprint);
        if (pokesOut(boxOf(kind, z), bounds)) return `${nameOf(kind, z)} sits outside ${label}.`;
      }
    }
    return "";
  }

  /** What is wrong with a box as a box, or "". */
  function boxProblem(box) {
    if (![box.x0, box.x1, box.z0, box.z1].every((n) => Number.isInteger(n))) return "X and Z are whole numbers.";
    if (box.x0 > box.x1 || box.z0 > box.z1) return "X0..X1 and Z0..Z1 run from low to high.";
    return "";
  }

  /** The message for a footprint that passes what its floor is allowed, or "". */
  function limitProblem(layout, floor, box) {
    if (containsBox(floorLimit(layout, floor), box)) return "";
    const main = mainFloor(layout);
    const name = floor.name || "This floor";
    return !main || isMain(layout, floor) ? `${name} stays inside the site.` : `${name} stays inside ${main.name}.`;
  }

  /** What a smaller main floor would leave outside on the floors that fit inside it, or "". */
  function otherFloorsProblem(layout, floor, box) {
    for (const other of layout.floors) {
      if (other.id === floor.id) continue;
      if (hasSpan(other)) {
        if (!containsBox(box, spanOf(other))) return `${other.name} stays inside this floor.`;
      } else {
        const hit = floorContentsOutside(layout, other.id, box, other.name);
        if (hit) return hit;
      }
    }
    return "";
  }

  /** A problem with this footprint for a floor, or "". The box is both ends inside. */
  function spanProblem(layout, floor, box) {
    return boxProblem(box)
      || limitProblem(layout, floor, box)
      || floorContentsOutside(layout, floor.id, box, "this floor")
      || (isMain(layout, floor) ? otherFloorsProblem(layout, floor, box) : "");
  }

  // ---- moving and resizing ----

  /** Slide one record. A lift or a machine row moves its start cell, anything else its box. */
  function shiftZone(kind, rec, dx, dz) {
    if (!dx && !dz) return;
    if (kind === "lifts" || kind === "walls") {
      rec.x += dx;
      rec.z += dz;
      return;
    }
    shiftRecord(rec, dx, dz);
  }

  /** Slide everything a room holds along with it. */
  function shiftContents(layout, roomId, dx, dz) {
    for (const pad of layout.pads) {
      if (pad.room !== roomId) continue;
      shiftBox(pad, dx, dz);
      if (Array.isArray(pad.door)) pad.door = [pad.door[0] + dx, pad.door[1] + dz];
    }
    for (const wall of layout.walls) {
      if (wall.room !== roomId) continue;
      wall.x += dx;
      wall.z += dz;
    }
    for (const mark of layout.marks) if (mark.room === roomId) shiftBox(mark, dx, dz);
    for (const shaft of layout.shafts) if (shaft.room === roomId) shiftBox(shaft, dx, dz);
  }

  /** Move a zone. A room takes its multiblocks, machine rows, marks, and shafts along. */
  function moveZone(layout, kind, z, dx, dz) {
    if (!dx && !dz) return;
    shiftZone(kind, z, dx, dz);
    if (kind === "rooms") shiftContents(layout, z.id, dx, dz);
  }

  /** The radius of a circle mark: half its shorter side, at least 1. */
  function circleRadius(mark) {
    return Math.max(1, Math.floor(Math.min(mark.x1 - mark.x0, mark.z1 - mark.z0) / 2));
  }

  /** Set a record's box. Contents stay put. A label is pulled back inside, and a circle or a shell's door follows. */
  function setBox(kind, z, box) {
    if (kind === "lifts") {
      const corner = orderedBox(box);
      z.x = corner.x0;
      z.z = corner.z0;
      return;
    }
    assignBox(z, box);
    if (kind === "marks" && z.shape === "circle") z.radius = circleRadius(z);
    if (kind === "pads" && Array.isArray(z.door)) z.door = frontCell(z);
  }

  /** Add a floor mark to a room. Returns its index. */
  function addMark(layout, room, box, short) {
    layout.marks.push({ room, label: short, short, x0: box.x0, x1: box.x1, z0: box.z0, z1: box.z1 });
    return layout.marks.length - 1;
  }

  /** After a multiblock, row, or mark is dragged, it belongs to the room it now sits in. */
  function rehome(layout, kind, rec) {
    const room = roomById(layout, rec.room);
    if (!room) return;
    const [x, z] = anchorCell(kind, rec);
    const target = roomAt(layout, room.floor, x, z);
    if (target && target.room.id !== rec.room) rec.room = target.room.id;
  }

  // ---- ids ----

  /** Text as an id: lowercase, with runs of anything else as one dash. */
  function slug(text) {
    return String(text).toLowerCase().replace(/[^a-z0-9_]+/g, "-").replace(/^[-_]+|[-_]+$/g, "") || "zone";
  }

  /** The ids a new record of this kind cannot take. */
  function takenIds(layout, kind) {
    const list = kind === "floors" ? layout.floors : layout[kind];
    const ids = new Set(list.map((z) => z.id));
    if (kind === "floors" || kind === "rooms") RESERVED.forEach((id) => ids.add(id));
    return ids;
  }

  /** An id made from some text that no record of this kind has: the slug, or the slug with -2, -3, ... */
  function uniqueId(layout, kind, base) {
    const taken = takenIds(layout, kind);
    const stem = slug(base);
    let id = stem;
    for (let n = 2; taken.has(id); n += 1) id = `${stem}-${n}`;
    return id;
  }

  /** Point everything in a room at the room's new id. */
  function repointRoom(layout, old, id) {
    for (const kind of ROOM_CONTENTS) {
      for (const item of layout[kind]) if (item.room === old) item.room = id;
    }
  }

  /** Point everything on a floor at the floor's new id. */
  function repointFloor(layout, old, id) {
    for (const list of [layout.rooms, layout.streets, layout.doors, layout.sheets]) {
      for (const item of list) if (item.floor === old) item.floor = id;
    }
    for (const list of [layout.stairs, layout.lifts]) {
      for (const item of list) item.floors = item.floors.map((f) => (f === old ? id : f));
    }
    if (layout.site.crawl.under === old) layout.site.crawl.under = id;
  }

  /** Rename a zone or floor, and every record that points at it. Returns a problem, or "". */
  function rename(layout, kind, z, id) {
    if (id === z.id) return "";
    if (!IDENT.test(id)) return "Use lowercase letters, digits, - or _.";
    if (takenIds(layout, kind).has(id)) return `${id} is already taken.`;
    if (kind === "rooms") repointRoom(layout, z.id, id);
    if (kind === "floors") repointFloor(layout, z.id, id);
    z.id = id;
    return "";
  }

  /** Delete a zone. A room takes its multiblocks, machine rows, marks, and shafts with it. */
  function deleteZone(layout, kind, index) {
    const z = layout[kind][index];
    if (kind === "rooms") {
      for (const list of ROOM_CONTENTS) layout[list] = layout[list].filter((item) => item.room !== z.id);
    }
    layout[kind].splice(index, 1);
  }

  Object.assign(Core, {
    ROOM_CONTENTS,
    zonesOn, contentsOn, contentsOf, boxOf, nameOf, anchorCell,
    boundsFor, crawlBox, clampDelta, spanProblem,
    shiftZone, moveZone, circleRadius, setBox, addMark, rehome,
    uniqueId, rename, deleteZone,
  });
})(typeof window !== "undefined" ? window : globalThis);
