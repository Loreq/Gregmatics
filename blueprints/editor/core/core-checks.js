/* The checks the editor runs after every change. Each one adds what it finds to a Survey as
   { text, kind, index, layer, slot }, so a click on a problem can select the thing and open its floor.
   They are quick and cover what a drag can break. audit.py checks the dug cells before the sheets are drawn. */
(function (root) {
  "use strict";

  const Core = root.Core;
  const {
    STEP, voltageRank, planTier, multiOpen, gap, inside, sameBox, pokesOut,
    floorById, roomById, chunkName, chunkCell,
    layerName, bandProblem, inner,
    rowSlots, wallSlots, machinesOn, padBlocks, padSizeProblem,
    boxOf, nameOf, boundsFor,
  } = Core;

  // Every list of the plan that takes up floor, in the order problems are reported.
  const PLACED_KINDS = ["rooms", "streets", "doors", "stairs", "shafts", "lifts", "trenches", "marks", "pads", "walls"];
  const NEIGHBORS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  // Blocks an OpenBlocks elevator reaches when the catalog does not say.
  const ELEVATOR_REACH = 20;
  // Rows at each end of a stair that count as its landing.
  const STAIR_END_ROWS = 3;

  // ---- cells ----

  /** Call fn(x, z, key) for every cell of a box. */
  function eachCell(box, fn) {
    for (let x = box.x0; x <= box.x1; x += 1) {
      for (let z = box.z0; z <= box.z1; z += 1) fn(x, z, `${x},${z}`);
    }
  }

  /** Cells a person can stand in on a floor: rooms, streets, stairs that reach it, and doors. Each maps to a name. */
  function walkCells(layout, floorId) {
    const cells = new Map();
    const add = (box, label) => eachCell(box, (x, z, key) => {
      if (!cells.has(key)) cells.set(key, label);
    });
    for (const r of layout.rooms) if (r.floor === floorId) add(r, r.name);
    for (const s of layout.streets) if (s.floor === floorId) add(s, nameOf("streets", s));
    for (const s of layout.stairs) if (s.floors.includes(floorId)) add(s, s.id);
    for (const d of layout.doors) if (d.floor === floorId) add(d, d.id);
    return cells;
  }

  /** Cells the pipe crawl has: the trenches, and under every street of its floor that keeps a trench. */
  function crawlCells(layout, crawl) {
    const cells = new Map();
    const add = (box, label) => eachCell(box, (x, z, key) => cells.set(key, label));
    if (!crawl) return cells;
    for (const t of layout.trenches) {
      if (Core.trenchCrawl(layout, t) === crawl) add(t, t.id);
    }
    for (const s of layout.streets) {
      if (s.floor === crawl.under && s.trench !== false) add(s, `under ${nameOf("streets", s)}`);
    }
    return cells;
  }

  /** The cells joined to a starting cell, walking side to side. Each is marked as seen. */
  function joinedCells(cells, start, seen) {
    const piece = [];
    const queue = [start];
    seen.add(start);
    while (queue.length) {
      const cur = queue.pop();
      piece.push(cur);
      const [x, z] = cur.split(",").map(Number);
      for (const next of [`${x + 1},${z}`, `${x - 1},${z}`, `${x},${z + 1}`, `${x},${z - 1}`]) {
        if (cells.has(next) && !seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    return piece;
  }

  /** The connected pieces of a set of cells, largest first. */
  function pieces(cells) {
    const seen = new Set();
    const out = [];
    for (const key of cells.keys()) {
      if (!seen.has(key)) out.push(joinedCells(cells, key, seen));
    }
    return out.sort((a, b) => b.length - a.length);
  }

  /** The cells of a stair's low end and of its high end: the three rows nearest each. */
  function stairEnds(stair) {
    const alongZ = stair.low === "n" || stair.low === "s";
    const first = alongZ ? stair.z0 : stair.x0;
    const last = alongZ ? stair.z1 : stair.x1;
    const rows = [];
    for (let v = first; v <= last; v += 1) rows.push(v);
    const ordered = stair.low === "n" || stair.low === "w" ? rows : rows.reverse();
    const pick = (wanted) => {
      const out = [];
      eachCell(stair, (x, z) => {
        if (wanted.has(alongZ ? z : x)) out.push([x, z]);
      });
      return out;
    };
    return [pick(new Set(ordered.slice(0, STAIR_END_ROWS))), pick(new Set(ordered.slice(-STAIR_END_ROWS)))];
  }

  // ---- what the checks share ----

  /** One run of the checks: the plan, the catalog, the problems found, and lookups worked out once. */
  class Survey {
    constructor(layout, catalog) {
      this.layout = layout;
      this.catalog = catalog;
      this.out = [];
      this.rooms = new Map(layout.rooms.map((r, index) => [r.id, { r, index }]));
      this.walked = new Map();
    }

    /** Record a problem. `kind` and `index` name the thing to select, `layer` the floor to open. */
    note(text, kind, index, layer, slot) {
      this.out.push({ text, kind, index, layer, slot });
    }

    /** The cells a person can stand in on a floor. */
    walk(floorId) {
      let cells = this.walked.get(floorId);
      if (!cells) {
        cells = walkCells(this.layout, floorId);
        this.walked.set(floorId, cells);
      }
      return cells;
    }

    /** The floor a room's contents are on, or undefined when the room is gone. */
    floorOf(roomId) {
      return (this.rooms.get(roomId) || { r: {} }).r.floor;
    }

    /** The name the catalog's lists use for a multiblock. */
    short(pad) {
      return (this.catalog.multis[pad.key] || {}).short || pad.key;
    }
  }

  // ---- the stack and the footprints ----

  /** Floors and the crawl keep two solid blocks between them. */
  function checkBands(survey) {
    const problem = bandProblem(survey.layout, survey.layout.floors);
    if (problem) survey.note(problem, null, null, null);
  }

  /** Two crawlspaces with no floor between them. Each stays under its floor. */
  function checkCrawlNeighbors(survey) {
    const upper = Core.adjacentCrawls(survey.layout);
    if (upper) survey.note("Two crawlspaces cannot be next to each other.", null, null, upper.id);
  }

  /** The floor a record shows on: the crawl for a trench, else its floor, its first floor, or its room's. */
  function layerOf(layout, kind, z) {
    if (kind === "trenches") {
      const crawl = Core.trenchCrawl(layout, z);
      return crawl ? Core.crawlLayerId(crawl) : null;
    }
    return z.floor || (z.floors ? z.floors[0] : null) || (roomById(layout, z.room) || {}).floor;
  }

  /** Everything stays inside its floor's footprint. */
  function checkBounds(survey) {
    const { layout, catalog } = survey;
    const site = inner(layout);
    for (const kind of PLACED_KINDS) {
      layout[kind].forEach((z, index) => {
        const box = boxOf(kind, z);
        const bounds = boundsFor(layout, kind, z);
        if (!pokesOut(box, bounds)) return;
        const what = sameBox(bounds, site) ? "reaches the rim" : "sits outside this floor";
        survey.note(`${nameOf(kind, z, catalog)} ${what}`, kind, index, layerOf(layout, kind, z));
      });
    }
  }

  // ---- rooms and streets, floor by floor ----

  /** Two rooms keep a wall between them. */
  function checkRoomPair(survey, floor, first, second) {
    const a = first.z;
    const b = second.z;
    const gx = gap(a.x0, a.x1, b.x0, b.x1);
    const gz = gap(a.z0, a.z1, b.z0, b.z1);
    if (gx < 0 && gz < 0) {
      survey.note(`${b.name} overlaps ${a.name}`, "rooms", second.index, floor.id);
    } else if ((gx < 0 && gz < 1) || (gz < 0 && gx < 1)) {
      survey.note(`${b.name} touches ${a.name} with no wall`, "rooms", second.index, floor.id);
    }
  }

  /** A room stays off a street, with a wall one block thick between them. */
  function checkRoomStreet(survey, floor, room, street) {
    const a = room.z;
    const gx = gap(a.x0, a.x1, street.x0, street.x1);
    const gz = gap(a.z0, a.z1, street.z0, street.z1);
    if (gx < 0 && gz < 0) {
      survey.note(`${a.name} overlaps ${nameOf("streets", street)}`, "rooms", room.index, floor.id);
    } else if ((gx < 0 && gz === 2) || (gz < 0 && gx === 2)) {
      survey.note(`${a.name} is 2 blocks from ${nameOf("streets", street)}; walls are 1 block`, "rooms", room.index, floor.id);
    }
  }

  /** Every part of a floor can be walked to from the rest. Separate entrances are ways in. */
  function checkReach(survey, floor) {
    const cells = survey.walk(floor.id);
    const parts = pieces(cells);
    if (parts.length > 1 && parts.every((part) => part.every((key) => cells.get(key) === "Entrance"))) return;
    for (const part of parts.slice(1)) {
      survey.note(`${cells.get(part[0])} is cut off from the rest of the floor`, null, null, floor.id);
    }
  }

  /** The rooms and streets of each floor, and whether the floor is in one piece. */
  function checkFloors(survey) {
    const { layout } = survey;
    for (const floor of layout.floors) {
      const rooms = layout.rooms.map((z, index) => ({ z, index })).filter((r) => r.z.floor === floor.id);
      const streets = layout.streets.filter((s) => s.floor === floor.id);
      rooms.forEach((room, i) => {
        for (const other of rooms.slice(i + 1)) checkRoomPair(survey, floor, room, other);
        for (const street of streets) checkRoomStreet(survey, floor, room, street);
      });
      checkReach(survey, floor);
    }
  }

  // ---- doors, stairs, and lifts ----

  /** The rooms, streets, and stairs a door on this floor can open onto. */
  function openZones(layout, floorId) {
    return [
      ...layout.rooms.filter((r) => r.floor === floorId),
      ...layout.streets.filter((s) => s.floor === floorId),
      ...layout.stairs.filter((s) => s.floors.includes(floorId)),
    ];
  }

  /** What is wrong with a door, or "". A door is one block deep, in a wall, with open floor on both sides. */
  function doorProblem(layout, door) {
    const wide = door.x1 - door.x0 + 1;
    const deep = door.z1 - door.z0 + 1;
    if (Math.min(wide, deep) !== 1 || Math.max(wide, deep) < 3) {
      return `${door.id} is ${wide}×${deep}; a door is 1 deep and 3 or more wide`;
    }
    const zones = openZones(layout, door.floor);
    const isOpen = (x, z) => zones.some((zone) => inside(zone, x, z));
    for (let x = door.x0; x <= door.x1; x += 1) {
      for (let z = door.z0; z <= door.z1; z += 1) {
        if (isOpen(x, z)) return `${door.id} sits inside a room or street; doors go in the wall`;
        const sides = wide === 1 ? [[x - 1, z], [x + 1, z]] : [[x, z - 1], [x, z + 1]];
        if (!sides.every(([sx, sz]) => isOpen(sx, sz))) return `${door.id} opens onto rock`;
      }
    }
    return "";
  }

  /** Every door is a door. */
  function checkDoors(survey) {
    survey.layout.doors.forEach((door, index) => {
      const problem = doorProblem(survey.layout, door);
      if (problem) survey.note(problem, "doors", index, door.floor);
    });
  }

  /** Whether one end of a stair has floor to step onto beside it. */
  function stairLands(survey, stair, cells, floorId) {
    const walk = survey.walk(floorId);
    return cells.some(([x, z]) => NEIGHBORS.some(([dx, dz]) => {
      const nx = x + dx;
      const nz = z + dz;
      return !inside(stair, nx, nz) && walk.has(`${nx},${nz}`);
    }));
  }

  /** Every stair joins floors that exist, with a landing at each end. */
  function checkStairs(survey) {
    const { layout } = survey;
    const floorIds = new Set(layout.floors.map((f) => f.id));
    layout.stairs.forEach((s, index) => {
      if (!s.floors.every((f) => floorIds.has(f))) {
        survey.note(`${s.id} names a floor that does not exist`, "stairs", index, null);
        return;
      }
      const [low, high] = stairEnds(s);
      const [bottom, top] = s.floors;
      if (!stairLands(survey, s, low, bottom)) {
        survey.note(`${s.id} has no landing at its low end on the ${layerName(layout, bottom)}`, "stairs", index, bottom);
      }
      if (!stairLands(survey, s, high, top)) {
        survey.note(`${s.id} has no landing at its high end on the ${layerName(layout, top)}`, "stairs", index, top);
      }
    });
  }

  /** Every lift stops on open floor, and no two stops are farther apart than an elevator reaches. */
  function checkLifts(survey) {
    const { layout, catalog } = survey;
    const reach = (catalog && catalog.elevator) || ELEVATOR_REACH;
    layout.lifts.forEach((lift, index) => {
      const name = nameOf("lifts", lift);
      for (const f of lift.floors) {
        if (!survey.walk(f).has(`${lift.x},${lift.z}`)) {
          survey.note(`${name} has no landing on the ${layerName(layout, f)}`, "lifts", index, f);
        }
      }
      const slabs = lift.floors.map((f) => (floorById(layout, f) || { slab: 0 }).slab);
      for (let i = 1; i < slabs.length; i += 1) {
        const rise = slabs[i] - slabs[i - 1];
        if (rise > reach) {
          survey.note(`${name}: ${rise} blocks between stops; an elevator reaches ${reach}`, "lifts", index, lift.floors[i]);
        }
      }
    });
  }

  // ---- what stands in the rooms ----

  /** Whether both corners of a box are in a room. */
  function cornersInside(room, rec) {
    return inside(room, rec.x0, rec.z0) && inside(room, rec.x1, rec.z1);
  }

  /** Multiblocks, machine rows, and areas stay inside their rooms. One whose room is gone is not judged. */
  function checkContents(survey) {
    const { layout, catalog, rooms } = survey;
    layout.pads.forEach((p, index) => {
      const room = rooms.get(p.room);
      if (room && !cornersInside(room.r, p)) {
        survey.note(`Multiblock ${nameOf("pads", p, catalog)} sticks out of ${room.r.name}`, "pads", index, room.r.floor);
      }
    });
    layout.walls.forEach((w, index) => {
      const room = rooms.get(w.room);
      if (room && wallSlots(w).some((slot) => !inside(room.r, slot.x, slot.z))) {
        survey.note(`Machine row ${w.id} sticks out of ${room.r.name}`, "walls", index, room.r.floor);
      }
    });
    layout.marks.forEach((m, index) => {
      const room = rooms.get(m.room);
      if (room && !cornersInside(room.r, m)) {
        survey.note(`Area ${nameOf("marks", m)} sticks out of ${room.r.name}`, "marks", index, room.r.floor);
      }
    });
  }

  /** Every multiblock is a size the wiki allows. */
  function checkSizes(survey) {
    survey.layout.pads.forEach((p, index) => {
      const spec = survey.catalog.multis[p.key];
      const problem = spec ? padSizeProblem(p, spec) : "";
      if (problem) survey.note(problem, "pads", index, survey.floorOf(p.room));
    });
  }

  /** No two multiblocks on a floor overlap, unless both share walls. */
  function checkPadOverlaps(survey, floor, pads) {
    pads.forEach((first, i) => {
      for (const second of pads.slice(i + 1)) {
        const a = first.p;
        const b = second.p;
        if (gap(a.x0, a.x1, b.x0, b.x1) < 0 && gap(a.z0, a.z1, b.z0, b.z1) < 0 && !(a.share && b.share)) {
          survey.note(`${survey.short(a)} overlaps ${survey.short(b)}`, "pads", first.index, floor.id);
        }
      }
    });
  }

  /** The cells multiblocks block on a floor, each mapped to the multiblock's short name. */
  function padCellsOf(survey, pads) {
    const cells = new Map();
    for (const { p } of pads) {
      for (const cell of padBlocks(p, survey.catalog)) cells.set(cell, survey.short(p));
    }
    return cells;
  }

  /** The cells a machine cannot face on a floor: multiblocks, machines, and service cores. */
  function blockedCells(survey, floor, padCells, machines) {
    const blocked = new Set(padCells.keys());
    for (const m of machines) blocked.add(`${m.x},${m.z}`);
    for (const mark of survey.layout.marks) {
      if (mark.shape !== "service" || survey.floorOf(mark.room) !== floor.id) continue;
      eachCell(mark, (x, z, key) => blocked.add(key));
    }
    return blocked;
  }

  /** Every machine stands clear of the multiblocks, with open floor in front of it. */
  function checkMachines(survey, floor, padCells) {
    const machines = machinesOn(survey.layout, floor.id);
    const blocked = blockedCells(survey, floor, padCells, machines);
    const walk = survey.walk(floor.id);
    for (const m of machines) {
      const name = (survey.catalog.singles[m.code] || { name: m.code }).name;
      const here = `${m.x},${m.z}`;
      if (padCells.has(here)) {
        survey.note(`${name} in ${m.wall.id} sits on multiblock ${padCells.get(here)}`, "machines", m.index, floor.id, m.slot);
        continue;
      }
      const step = STEP[m.face];
      const front = `${m.x + step[0]},${m.z + step[1]}`;
      if (!walk.has(front) || blocked.has(front)) {
        survey.note(`${name} in ${m.wall.id} faces a wall or a machine`, "machines", m.index, floor.id, m.slot);
      }
    }
  }

  /** The multiblocks and machines of each floor against each other. */
  function checkEquipment(survey) {
    const { layout } = survey;
    for (const floor of layout.floors) {
      const pads = [];
      layout.pads.forEach((p, index) => {
        if (survey.floorOf(p.room) === floor.id) pads.push({ p, index });
      });
      checkPadOverlaps(survey, floor, pads);
      checkMachines(survey, floor, padCellsOf(survey, pads));
    }
  }

  // ---- tiers and pollution ----

  /** Placed multiblocks and machines above a tier. Nothing here is removed. */
  function overTier(layout, catalog, cap) {
    const out = [];
    if (!layout || !catalog) return out;
    const limit = voltageRank(cap);
    layout.pads.forEach((pad, index) => {
      const spec = catalog.multis[pad.key];
      if (!spec || multiOpen(spec, cap)) return;
      const room = roomById(layout, pad.room);
      out.push({ kind: "pads", index, layer: room && room.floor, text: `${spec.name} needs ${spec.tier}` });
    });
    layout.walls.forEach((wall, index) => {
      const room = roomById(layout, wall.room);
      for (const slot of rowSlots(wall)) {
        if (slot.code === "-" || voltageRank(slot.tier) <= limit) continue;
        const spec = catalog.singles[slot.code];
        out.push({
          kind: "machines", index, slot: slot.slot, layer: room && room.floor,
          text: `${spec ? spec.name : slot.code} needs ${slot.tier}`,
        });
      }
    });
    return out;
  }

  /** Nothing placed is above the plan's tier. */
  function checkTier(survey) {
    const { layout, catalog } = survey;
    for (const item of overTier(layout, catalog, planTier(layout))) {
      survey.note(item.text, item.kind, item.index, item.layer, item.slot);
    }
  }

  /** Record a polluter outside the dirty chunks against its room. */
  function notePollution(survey, text, roomId) {
    const room = survey.rooms.get(roomId);
    survey.note(text, "rooms", room ? room.index : null, room ? room.r.floor : null);
  }

  /** Every polluting multiblock and machine stands in a dirty chunk. A row is reported once. */
  function checkPollution(survey) {
    const { layout, catalog } = survey;
    const dirty = new Set(layout.site.dirty);
    const clean = (x, z) => !dirty.has(chunkName(layout, x, z));
    layout.pads.forEach((p) => {
      const spec = catalog.multis[p.key];
      if (!spec || !spec.pollution) return;
      const outside = [[p.x0, p.z0], [p.x1, p.z0], [p.x0, p.z1], [p.x1, p.z1]].find(([x, z]) => clean(x, z));
      if (outside) {
        notePollution(survey, `${spec.name} pollutes outside the dirty chunks, at ${chunkName(layout, ...outside)}`, p.room);
      }
    });
    layout.walls.forEach((w) => {
      const polluter = wallSlots(w).find((slot) => {
        const spec = catalog.singles[slot.code];
        return spec && spec.pollution && clean(slot.x, slot.z);
      });
      if (polluter) notePollution(survey, `${catalog.singles[polluter.code].name} in ${w.id} pollutes outside the dirty chunks`, w.room);
    });
  }

  /** Whether a room has a chunk beside or on a dirty one. */
  function nearDirt(room, dirtyChunks) {
    for (let cx = room.x0 >> 4; cx <= room.x1 >> 4; cx += 1) {
      for (let cz = room.z0 >> 4; cz <= room.z1 >> 4; cz += 1) {
        if (dirtyChunks.some(([dx, dz]) => Math.abs(cx - dx) + Math.abs(cz - dz) < 2)) return true;
      }
    }
    return false;
  }

  /** Every clean room keeps a chunk between itself and the dirty block. */
  function checkCleanRooms(survey) {
    const { layout } = survey;
    const dirtyChunks = [...new Set(layout.site.dirty)].map((name) => chunkCell(layout, name));
    layout.rooms.forEach((r, index) => {
      if (r.clean && nearDirt(r, dirtyChunks)) {
        survey.note(`${r.name} is a clean room within one chunk of the dirty block`, "rooms", index, r.floor);
      }
    });
  }

  // ---- the crawl ----

  /** Every trench joins the rest of the pipe crawl. */
  function checkCrawl(survey) {
    for (const crawl of Core.crawlRecords(survey.layout)) {
      const cells = crawlCells(survey.layout, crawl);
      for (const part of pieces(cells).slice(1)) {
        survey.note(`${cells.get(part[0])} is cut off from the other trenches`, null, null, Core.crawlLayerId(crawl));
      }
    }
  }

  // The checks in the order their problems are listed. The second group needs the catalog.
  const PLAN_CHECKS = [checkBands, checkCrawlNeighbors, checkBounds, checkFloors, checkDoors, checkStairs, checkLifts, checkContents];
  const CATALOG_CHECKS = [checkSizes, checkEquipment, checkTier, checkPollution, checkCleanRooms];

  /** Problems a move can cause. Each item is { text, kind, index, layer, slot }. */
  function check(layout, catalog) {
    const survey = new Survey(layout, catalog);
    for (const part of PLAN_CHECKS) part(survey);
    if (catalog) for (const part of CATALOG_CHECKS) part(survey);
    checkCrawl(survey);
    return survey.out;
  }

  Object.assign(Core, { overTier, walkCells, check });
})(typeof window !== "undefined" ? window : globalThis);
