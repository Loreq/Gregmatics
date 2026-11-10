/* Layout data and checks. app.js draws and handles input.
   dumps() matches layout.dumps(). Air is slab + 1 through slab + height.
   A floor's footprint is optional. Omitted, the main floor fills the site and other floors fill the main floor. */
(function (root) {
  "use strict";

  const INLINE = 100;
  const CRAWL = "crawl";
  const IDENT = /^[a-z0-9][a-z0-9_-]*$/;
  // Ids a room or a floor cannot take: the model uses them for what dug a cell.
  const RESERVED = new Set(["rock", "corridor", "entry", "door", "trench", "stair", "well", CRAWL]);
  const KINDS = ["rooms", "streets", "doors", "stairs", "shafts", "lifts", "trenches"];
  const KIND_NAMES = {
    rooms: "Room", streets: "Street", doors: "Door", stairs: "Stair", shafts: "Shaft", lifts: "Lift",
    trenches: "Trench", marks: "Area", pads: "Multiblock", walls: "Machine row", machines: "Machine",
  };
  const KIND_PLURALS = {
    rooms: "Rooms", streets: "Streets", doors: "Doors", stairs: "Stairs", shafts: "Shafts", lifts: "Lifts",
    trenches: "Trenches", marks: "Areas", pads: "Multiblocks", walls: "Machine rows", machines: "Machines",
  };
  const STEP = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] };
  const TURN = { n: "e", e: "s", s: "w", w: "n" };
  // A wallshared row runs at most this many modules each way.
  const MOST_MODULES = 8;
  // Same order as catalog.py. Names are the GTNH 2.9.0 quest tabs. A row with no `tiers` field is MV.
  const VOLTAGE = ["Stone", "Steam", "LV", "MV", "HV", "EV", "IV", "LuV", "ZPM", "UV", "UHV", "UEV", "UIV", "UMV"];
  const QUEST = {
    Stone: "Tier 0 - Stone Age",
    Steam: "Tier 0.5 - Steam",
    LV: "Tier 1 - LV",
    MV: "Tier 2 - MV",
    HV: "Tier 3 - HV",
    EV: "Tier 4 - EV",
    IV: "Tier 5 - IV",
    LuV: "Tier 6 - LuV",
    ZPM: "Tier 7 - ZPM",
    UV: "Tier 8 - UV",
    UHV: "Tier 9 - UHV",
    UEV: "Tier 10 - UEV",
    UIV: "Tier 11 - UIV",
    UMV: "Tier 12 - UMV",
  };
  const SELECTABLE = VOLTAGE.slice();
  const TIERS = VOLTAGE.slice(VOLTAGE.indexOf("LV"));

  function voltageRank(tier) {
    return VOLTAGE.indexOf(tier);
  }

  function tierLabel(tier) {
    return QUEST[tier] || tier;
  }

  function planTier(layout) {
    const tier = layout && layout.site && layout.site.tier;
    return SELECTABLE.includes(tier) ? tier : "MV";
  }

  function multiOpen(spec, cap) {
    const need = voltageRank(spec && spec.tier);
    if (need < 0) return true;
    return need <= voltageRank(planTier({ site: { tier: cap } }));
  }

  /** Placed multiblocks and machines above cap. Nothing here is removed. */
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

  // ---- canonical plan text ----

  function dumps(value, indent = 0) {
    const pad = "  ".repeat(indent);
    const inner = "  ".repeat(indent + 1);
    if (Array.isArray(value)) {
      if (!value.length) return "[]";
      if (value.every((v) => v === null || typeof v !== "object")) {
        const flat = "[" + value.map((v) => JSON.stringify(v)).join(", ") + "]";
        if (flat.length <= INLINE) return flat;
      }
      return "[\n" + value.map((v) => inner + dumps(v, indent + 1)).join(",\n") + "\n" + pad + "]";
    }
    if (value !== null && typeof value === "object") {
      const keys = Object.keys(value).filter((k) => value[k] !== undefined);
      if (!keys.length) return "{}";
      return "{\n" + keys.map((k) => inner + JSON.stringify(k) + ": " + dumps(value[k], indent + 1)).join(",\n")
        + "\n" + pad + "}";
    }
    return JSON.stringify(value);
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  // ---- floors and layers ----

  function floorById(layout, id) {
    return layout.floors.find((f) => f.id === id) || null;
  }

  function floorHeight(floor) {
    return floor.height || 5;
  }

  function floorAir(floor) {
    return [floor.slab + 1, floor.slab + floorHeight(floor)];
  }

  function crawlAir(layout) {
    const crawl = layout.site.crawl;
    const under = floorById(layout, crawl.under);
    if (!under) return null;
    const top = under.slab - crawl.below;
    return [top - crawl.height + 1, top];
  }

  /** Every floor plus the pipe crawl, bottom to top. */
  function layers(layout) {
    const out = layout.floors.map((f) => ({ id: f.id, name: f.name, base: floorAir(f)[0], floor: f }));
    const air = crawlAir(layout);
    if (air) out.push({ id: CRAWL, name: layout.site.crawl.name || "Pipe crawl", base: air[0], crawl: true });
    return out.sort((a, b) => a.base - b.base);
  }

  function layerName(layout, id) {
    const layer = layers(layout).find((l) => l.id === id);
    return layer ? layer.name : id;
  }

  /** Air bands of every floor and the crawl that sit closer than 2 solid blocks. */
  function bandProblem(layout, floors, crawl) {
    const bands = floors.map((f) => ({ air: floorAir(f), name: f.name }));
    crawl = crawl || layout.site.crawl;
    const under = floors.find((f) => f.id === crawl.under);
    if (under) {
      const top = under.slab - crawl.below;
      bands.push({ air: [top - crawl.height + 1, top], name: crawl.name || "Pipe crawl" });
    }
    bands.sort((a, b) => a.air[0] - b.air[0]);
    for (let i = 1; i < bands.length; i += 1) {
      const a = bands[i - 1];
      const b = bands[i];
      if (b.air[0] - a.air[1] - 1 < 2) {
        return `${a.name} (air Y ${a.air[0]}–${a.air[1]}) and ${b.name} (air Y ${b.air[0]}–${b.air[1]}) `
          + "need at least 2 solid blocks between them.";
      }
    }
    return "";
  }

  function floorUse(layout, id) {
    return {
      rooms: layout.rooms.filter((r) => r.floor === id).length,
      streets: layout.streets.filter((s) => s.floor === id).length,
      doors: layout.doors.filter((d) => d.floor === id).length,
      stairs: layout.stairs.filter((s) => s.floors.includes(id)).length,
      lifts: layout.lifts.filter((l) => l.floors.includes(id)).length,
    };
  }

  /** Bands of air from the bottom up: each floor, and the pipe crawl when it has one. */
  function airBands(layout, extra) {
    const bands = layout.floors.map((floor) => ({
      air: floorAir(floor), name: floor.name, floor, crawl: false,
    }));
    const crawl = crawlAir(layout);
    if (crawl) bands.push({ air: crawl, name: layout.site.crawl.name || "Pipe crawl", crawl: true });
    if (extra) bands.push({ air: [extra.slab + 1, extra.slab + extra.height], name: extra.name || "New floor", spec: true });
    bands.sort((a, b) => a.air[0] - b.air[0] || a.air[1] - b.air[1]);
    return bands;
  }

  function shiftFloorAndAbove(layout, floor, dy) {
    if (!dy) return true;
    for (const other of layout.floors) {
      if (other.slab < floor.slab) continue;
      const slab = other.slab + dy;
      if (slab < 1 || slab + floorHeight(other) > 255) return false;
    }
    for (const other of layout.floors) if (other.slab >= floor.slab) other.slab += dy;
    return true;
  }

  /** Move a band up (dy > 0) or, for a floor, down. The crawl moves by tightening its gap, then by lifting its floor. */
  function shiftBand(layout, band, dy) {
    if (!dy) return true;
    if (band.crawl) {
      const crawl = layout.site.crawl;
      if (dy > 0 && crawl.below - dy >= 2) {
        crawl.below -= dy;
        return true;
      }
      const parent = floorById(layout, crawl.under);
      return Boolean(parent) && shiftFloorAndAbove(layout, parent, dy);
    }
    return shiftFloorAndAbove(layout, band.floor, dy);
  }

  /**
   * Seat a new floor at spec.slab. Bands that would sit too close above it move up.
   * spec is not inserted. Returns a problem, or "".
   */
  function seatFloor(layout, spec) {
    const saved = layout.floors.map((floor) => floor.slab);
    const below = layout.site.crawl.below;
    const air0 = spec.slab + 1;
    const air1 = spec.slab + spec.height;
    if (air0 < 0 || air1 > 255) return "Y stays from 0 to 255.";
    const restore = () => {
      layout.floors.forEach((floor, i) => { floor.slab = saved[i]; });
      layout.site.crawl.below = below;
    };
    for (let guard = 0; guard < 40; guard += 1) {
      const bands = airBands(layout, spec);
      let crowded = null;
      for (let i = 1; i < bands.length; i += 1) {
        const gap = bands[i].air[0] - bands[i - 1].air[1] - 1;
        if (gap < 2) {
          crowded = { lower: bands[i - 1], upper: bands[i], dy: 2 - gap };
          break;
        }
      }
      if (!crowded) {
        const crawl = crawlAir(layout);
        if (crawl && (crawl[0] < 0 || crawl[1] > 255)) {
          restore();
          return "The pipe crawl would leave Y 0 through 255.";
        }
        layout.floors.sort((a, b) => a.slab - b.slab);
        return "";
      }
      if (crowded.upper.spec) {
        restore();
        return `${crowded.lower.name} and ${spec.name || "the new floor"} need at least 2 solid blocks between them.`;
      }
      if (!shiftBand(layout, crowded.upper, crowded.dy)) {
        restore();
        return "That stack reaches past the build limit, Y 255.";
      }
    }
    restore();
    return "That stack reaches past the build limit, Y 255.";
  }

  // ---- zones ----

  function roomById(layout, id) {
    return layout.rooms.find((r) => r.id === id) || null;
  }

  /** Editable zones on a layer, in drawing order: big areas first, small things on top. */
  function zonesOn(layout, layer) {
    const out = [];
    const add = (kind, test) => layout[kind].forEach((z, index) => {
      if (test(z)) out.push({ kind, index, z });
    });
    if (layer === CRAWL) {
      add("trenches", () => true);
      return out;
    }
    add("rooms", (z) => z.floor === layer);
    add("streets", (z) => z.floor === layer);
    add("shafts", (z) => {
      const room = roomById(layout, z.room);
      return Boolean(room && room.floor === layer);
    });
    add("stairs", (z) => z.floors.includes(layer));
    add("doors", (z) => z.floor === layer);
    add("lifts", (z) => z.floors.includes(layer));
    return out;
  }

  function boxOf(kind, z) {
    if (kind === "lifts") return { x0: z.x, x1: z.x, z0: z.z, z1: z.z };
    if (kind === "walls") {
      const n = Math.max(1, codesOf(z).length);
      const step = STEP[z.along];
      const xe = z.x + step[0] * (n - 1);
      const ze = z.z + step[1] * (n - 1);
      return { x0: Math.min(z.x, xe), x1: Math.max(z.x, xe), z0: Math.min(z.z, ze), z1: Math.max(z.z, ze) };
    }
    return { x0: z.x0, x1: z.x1, z0: z.z0, z1: z.z1 };
  }

  function nameOf(kind, z, catalog) {
    if (kind === "rooms") return z.name;
    if (kind === "streets" && z.label) return z.label.charAt(0) + z.label.slice(1).toLowerCase();
    if (kind === "streets" && z.style === "entry") return "Entrance";
    if ((kind === "shafts" || kind === "lifts") && z.label) return z.label;
    if (kind === "marks") return z.short || z.label || "Area";
    if (kind === "pads") {
      const spec = catalog && catalog.multis[z.key];
      const name = spec ? spec.name : z.key;
      const count = (z.wx || 1) * (z.wz || 1);
      const titled = count > 1 ? `${count}× ${name}` : name;
      return z.label ? `${titled} (${z.label})` : titled;
    }
    if (kind === "walls") return z.title ? `${z.id} ${z.title}` : `Row ${z.id}`;
    return z.id;
  }

  function inner(layout) {
    const s = layout.site.square;
    const r = layout.site.rim;
    return { x0: s.x0 + r, x1: s.x1 - r, z0: s.z0 + r, z1: s.z1 - r };
  }

  function hasSpan(floor) {
    return Boolean(floor) && [floor.x0, floor.x1, floor.z0, floor.z1].every((n) => Number.isInteger(n));
  }

  /** The floor other plans fit inside: the one with id main, or the lowest slab. */
  function mainFloor(layout) {
    return layout.floors.find((f) => f.id === "main")
      || layout.floors.slice().sort((a, b) => a.slab - b.slab || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0]
      || null;
  }

  function floorBox(layout, floor) {
    if (hasSpan(floor)) return { x0: floor.x0, x1: floor.x1, z0: floor.z0, z1: floor.z1 };
    const main = mainFloor(layout);
    if (floor && main && floor.id !== main.id && hasSpan(main)) return floorBox(layout, main);
    return inner(layout);
  }

  function isMain(layout, floor) {
    if (floor && floor.id === "main") return true;
    const main = mainFloor(layout);
    return Boolean(main && floor && floor.id === main.id);
  }

  function floorLimit(layout, floor) {
    if (!floor || isMain(layout, floor)) return inner(layout);
    const main = mainFloor(layout);
    return main ? floorBox(layout, main) : inner(layout);
  }

  function containsBox(limit, box) {
    return box.x0 >= limit.x0 && box.x1 <= limit.x1 && box.z0 >= limit.z0 && box.z1 <= limit.z1;
  }

  /** Store a footprint only when it is smaller than the area the floor is allowed. */
  function writeSpan(layout, floor, box) {
    if (sameBox(box, floorLimit(layout, floor))) {
      delete floor.x0;
      delete floor.x1;
      delete floor.z0;
      delete floor.z1;
      return;
    }
    floor.x0 = box.x0;
    floor.x1 = box.x1;
    floor.z0 = box.z0;
    floor.z1 = box.z1;
  }

  function zoneLimit(layout, kind, z, footprint) {
    const box = footprint || inner(layout);
    const site = inner(layout);
    // The entrance mouth may sit north of the rim while this floor still reaches that rim.
    const reachesNorth = box.z0 <= site.z0;
    if (reachesNorth && kind === "streets" && z && z.style === "entry") {
      return { x0: box.x0, x1: box.x1, z0: layout.site.sheet.z0, z1: box.z1 };
    }
    if (reachesNorth && kind === "streets" && z && Number.isInteger(z.x0)) {
      const entry = layout.streets.find((s) => s.style === "entry");
      if (entry && z.floor === entry.floor && z.x0 >= entry.x0 && z.x1 <= entry.x1) {
        return { x0: box.x0, x1: box.x1, z0: layout.site.square.z0, z1: box.z1 };
      }
    }
    return box;
  }

  function zoneOnFloor(layout, floorId, kind, z) {
    if (kind === "trenches") return layout.site.crawl.under === floorId;
    if (kind === "stairs" || kind === "lifts") return Array.isArray(z.floors) && z.floors.includes(floorId);
    if (z.floor) return z.floor === floorId;
    if (z.room) {
      const room = roomById(layout, z.room);
      return Boolean(room && room.floor === floorId);
    }
    return false;
  }

  function floorContentsOutside(layout, floorId, footprint, label) {
    const kinds = ["rooms", "streets", "doors", "shafts", "pads", "walls", "marks", "stairs", "lifts", "trenches"];
    for (const kind of kinds) {
      for (const z of layout[kind] || []) {
        if (!zoneOnFloor(layout, floorId, kind, z)) continue;
        const bounds = kind === "stairs" || kind === "lifts" ? footprint : zoneLimit(layout, kind, z, footprint);
        const box = boxOf(kind, z);
        if (box.x0 < bounds.x0 || box.x1 > bounds.x1 || box.z0 < bounds.z0 || box.z1 > bounds.z1) {
          return `${nameOf(kind, z)} sits outside ${label}.`;
        }
      }
    }
    return "";
  }

  /** A problem with this footprint, or "". The box is both ends inside. */
  function spanProblem(layout, floor, box) {
    if (![box.x0, box.x1, box.z0, box.z1].every((n) => Number.isInteger(n))) return "X and Z are whole numbers.";
    if (box.x0 > box.x1 || box.z0 > box.z1) return "X0..X1 and Z0..Z1 run from low to high.";
    const limit = floorLimit(layout, floor);
    const main = mainFloor(layout);
    if (!containsBox(limit, box)) {
      if (!main || isMain(layout, floor)) return `${floor.name || "This floor"} stays inside the site.`;
      return `${floor.name || "This floor"} stays inside ${main.name}.`;
    }
    const own = floorContentsOutside(layout, floor.id, box, "this floor");
    if (own) return own;
    if (isMain(layout, floor)) {
      for (const other of layout.floors) {
        if (other.id === floor.id) continue;
        if (hasSpan(other)) {
          if (!containsBox(box, { x0: other.x0, x1: other.x1, z0: other.z0, z1: other.z1 })) {
            return `${other.name} stays inside this floor.`;
          }
        } else {
          const hit = floorContentsOutside(layout, other.id, box, other.name);
          if (hit) return hit;
        }
      }
    }
    return "";
  }

  /** Inside the floor's footprint. An entry street may use the sheet's north edge. */
  function boundsFor(layout, kind, z) {
    if (kind === "stairs" || kind === "lifts") {
      const ids = (z && z.floors) || [];
      const boxes = ids.map((id) => floorById(layout, id)).filter(Boolean).map((floor) => floorBox(layout, floor));
      if (!boxes.length) return inner(layout);
      return {
        x0: Math.max(...boxes.map((b) => b.x0)),
        x1: Math.min(...boxes.map((b) => b.x1)),
        z0: Math.max(...boxes.map((b) => b.z0)),
        z1: Math.min(...boxes.map((b) => b.z1)),
      };
    }
    if (kind === "trenches") {
      const under = floorById(layout, layout.site.crawl.under);
      return under ? floorBox(layout, under) : inner(layout);
    }
    let floor = null;
    if (z && z.floor) floor = floorById(layout, z.floor);
    else if (z && z.room) {
      const room = roomById(layout, z.room);
      if (room) floor = floorById(layout, room.floor);
    }
    return zoneLimit(layout, kind, z, floor ? floorBox(layout, floor) : inner(layout));
  }

  /** The largest part of (dx, dz) that keeps a box inside the bounds. */
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

  function shiftBox(item, dx, dz) {
    item.x0 += dx;
    item.x1 += dx;
    item.z0 += dz;
    item.z1 += dz;
  }

  /** Move a zone. A room takes its pads, machine walls, marks, and shafts along. */
  function moveZone(layout, kind, z, dx, dz) {
    if (!dx && !dz) return;
    if (kind === "lifts" || kind === "walls") {
      z.x += dx;
      z.z += dz;
      return;
    }
    shiftBox(z, dx, dz);
    if (Array.isArray(z.label_at)) z.label_at = [z.label_at[0] + dx, z.label_at[1] + dz];
    if (Array.isArray(z.door)) z.door = [z.door[0] + dx, z.door[1] + dz];
    if (kind !== "rooms") return;
    for (const pad of layout.pads) {
      if (pad.room !== z.id) continue;
      shiftBox(pad, dx, dz);
      if (Array.isArray(pad.door)) pad.door = [pad.door[0] + dx, pad.door[1] + dz];
    }
    for (const wall of layout.walls) {
      if (wall.room !== z.id) continue;
      wall.x += dx;
      wall.z += dz;
    }
    for (const mark of layout.marks) if (mark.room === z.id) shiftBox(mark, dx, dz);
    for (const shaft of layout.shafts) if (shaft.room === z.id) shiftBox(shaft, dx, dz);
  }

  /** Set a zone's box. Contents stay put; a label is pulled back inside. */
  function setBox(kind, z, box) {
    const x0 = Math.min(box.x0, box.x1);
    const x1 = Math.max(box.x0, box.x1);
    const z0 = Math.min(box.z0, box.z1);
    const z1 = Math.max(box.z0, box.z1);
    if (kind === "lifts") {
      z.x = x0;
      z.z = z0;
      return;
    }
    Object.assign(z, { x0, x1, z0, z1 });
    if (Array.isArray(z.label_at)) {
      z.label_at = [Math.min(Math.max(z.label_at[0], x0), x1), Math.min(Math.max(z.label_at[1], z0), z1)];
    }
    if (kind === "marks" && z.shape === "circle") z.radius = circleRadius(z);
    if (kind === "pads" && Array.isArray(z.door)) z.door = frontCell(z);
  }

  function contentsOf(layout, roomId) {
    return {
      pads: layout.pads.filter((p) => p.room === roomId),
      walls: layout.walls.filter((w) => w.room === roomId),
      marks: layout.marks.filter((m) => m.room === roomId),
      shafts: layout.shafts.filter((s) => s.room === roomId),
    };
  }

  /** Cells of a machine wall, one per slot that holds a machine. */
  function wallSlots(wall) {
    return rowSlots(wall).filter((s) => s.code !== "-").map((s) => ({ ...s, face: wall.face }));
  }

  // ---- contents: multiblocks, machine rows, floor marks ----

  function area(box) {
    return (box.x1 - box.x0 + 1) * (box.z1 - box.z0 + 1);
  }

  /** The room on a floor that holds a cell, as { room, index }, or null. */
  function roomAt(layout, floorId, x, z) {
    let best = null;
    layout.rooms.forEach((room, index) => {
      if (room.floor === floorId && inside(room, x, z) && (!best || area(room) < area(best.room))) {
        best = { room, index };
      }
    });
    return best;
  }

  function onFloor(layout, roomId, layer) {
    const room = roomById(layout, roomId);
    return Boolean(room && room.floor === layer);
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

  function codesOf(wall) {
    return String(wall.codes || "").split(/\s+/).filter(Boolean);
  }

  function normalizeTier(value) {
    const raw = String(value || "MV");
    const found = TIERS.find((tier) => tier.toLowerCase() === raw.toLowerCase());
    return found || "MV";
  }

  /** One tier per slot, parallel to `codes`. An empty slot is "-". Missing means MV. */
  function tiersOf(wall) {
    const codes = codesOf(wall);
    const raw = String(wall.tiers || "").split(/\s+/).filter(Boolean);
    return codes.map((code, i) => (code === "-" ? "-" : normalizeTier(raw[i])));
  }

  function tierAt(wall, slot) {
    return tiersOf(wall)[slot] || "MV";
  }

  function writeSlots(wall, codes, tiers) {
    delete wall.stacked;
    wall.codes = codes.join(" ");
    const stored = codes.map((code, i) => (code === "-" ? "-" : normalizeTier(tiers && tiers[i])));
    if (stored.every((t) => t === "MV" || t === "-")) delete wall.tiers;
    else wall.tiers = stored.join(" ");
  }

  function setCodes(wall, codes, tiers) {
    writeSlots(wall, codes, tiers || tiersOf(wall));
  }

  function setTier(wall, slot, tier) {
    const codes = codesOf(wall);
    const tiers = tiersOf(wall);
    if (codes[slot] === "-" || slot < 0 || slot >= codes.length) return;
    tiers[slot] = normalizeTier(tier);
    writeSlots(wall, codes, tiers);
  }

  /** Every slot of a machine row, empty ones ("-") included, with its cell and tier. */
  function rowSlots(wall) {
    const step = STEP[wall.along];
    const tiers = tiersOf(wall);
    return codesOf(wall).map((code, slot) => ({
      slot, code, tier: tiers[slot], x: wall.x + step[0] * slot, z: wall.z + step[1] * slot,
    }));
  }

  /** One entry per machine on a layer: its row (index), slot, code, cell, and facing. */
  function machinesOn(layout, layer) {
    const out = [];
    layout.walls.forEach((wall, index) => {
      if (!onFloor(layout, wall.room, layer)) return;
      for (const s of rowSlots(wall)) {
        if (s.code !== "-") out.push({ index, slot: s.slot, code: s.code, tier: s.tier, x: s.x, z: s.z, face: wall.face, wall });
      }
    });
    return out;
  }

  /** The row slot at a cell in a room, empty slots included. */
  function slotIn(layout, roomId, x, z) {
    for (let index = 0; index < layout.walls.length; index += 1) {
      const wall = layout.walls[index];
      if (wall.room !== roomId) continue;
      const hit = rowSlots(wall).find((s) => s.x === x && s.z === z);
      if (hit) return { index, slot: hit.slot, code: hit.code };
    }
    return null;
  }

  /** Drop empty slots off both ends of a row, and the row once it holds nothing. */
  function trimRow(layout, index) {
    const wall = layout.walls[index];
    const codes = codesOf(wall);
    const tiers = tiersOf(wall);
    const step = STEP[wall.along];
    while (codes.length && codes[0] === "-") {
      codes.shift();
      tiers.shift();
      wall.x += step[0];
      wall.z += step[1];
    }
    while (codes.length && codes[codes.length - 1] === "-") {
      codes.pop();
      tiers.pop();
    }
    if (!codes.length) {
      layout.walls.splice(index, 1);
      return;
    }
    setCodes(wall, codes, tiers);
  }

  /** Take a machine out of its row. A gap in the middle stays as a spare slot. */
  function removeMachine(layout, index, slot) {
    const wall = layout.walls[index];
    const codes = codesOf(wall);
    const tiers = tiersOf(wall);
    codes[slot] = "-";
    tiers[slot] = "-";
    setCodes(wall, codes, tiers);
    trimRow(layout, index);
  }

  function nextRowId(layout) {
    const taken = new Set(layout.walls.map((w) => w.id));
    for (let n = 1; ; n += 1) if (!taken.has(`M${n}`)) return `M${n}`;
  }

  /** Fill, extend, or start a machine row at this cell. */
  function placeMachine(layout, catalog, { code, x, z, face, room, tier }) {
    const given = tier === undefined ? null : normalizeTier(tier);
    const hit = slotIn(layout, room, x, z);
    if (hit) {
      const wall = layout.walls[hit.index];
      if (wall.face === face) {
        const codes = codesOf(wall);
        const tiers = tiersOf(wall);
        const keep = given === null && codes[hit.slot] !== "-" ? tiers[hit.slot] : (given || "MV");
        codes[hit.slot] = code;
        tiers[hit.slot] = keep;
        setCodes(wall, codes, tiers);
        return;
      }
      removeMachine(layout, hit.index, hit.slot);
    }
    for (const wall of layout.walls) {
      if (wall.room !== room || wall.face !== face) continue;
      const step = STEP[wall.along];
      const codes = codesOf(wall);
      const tiers = tiersOf(wall);
      const next = given || "MV";
      if (x === wall.x + step[0] * codes.length && z === wall.z + step[1] * codes.length) {
        codes.push(code);
        tiers.push(next);
        setCodes(wall, codes, tiers);
        return;
      }
      if (x === wall.x - step[0] && z === wall.z - step[1]) {
        wall.x = x;
        wall.z = z;
        codes.unshift(code);
        tiers.unshift(next);
        setCodes(wall, codes, tiers);
        return;
      }
    }
    const row = { id: nextRowId(layout), room, x, z, along: face === "n" || face === "s" ? "e" : "s", face, codes: code };
    if (given && given !== "MV") row.tiers = given;
    layout.walls.push(row);
  }

  function cellOf(wall, slot) {
    const step = STEP[wall.along];
    return [wall.x + step[0] * slot, wall.z + step[1] * slot];
  }

  /** Move one machine to a cell, keeping its tier, facing the given way. Returns a problem, or "". */
  function moveMachine(layout, catalog, index, slot, x, z, face) {
    const wall = layout.walls[index];
    const room = roomById(layout, wall.room);
    const target = room && roomAt(layout, room.floor, x, z);
    if (!target) return "Machines go inside a room.";
    const code = codesOf(wall)[slot];
    const keep = { face: face || wall.face, tier: tierAt(wall, slot) };
    removeMachine(layout, index, slot);
    placeMachine(layout, catalog, { code, x, z, face: keep.face, room: target.room.id, tier: keep.tier });
    return "";
  }

  /** Turn one machine to face another way. A row of one turns as a whole. */
  function turnMachine(layout, catalog, index, slot, face) {
    const wall = layout.walls[index];
    if (codesOf(wall).length === 1) {
      wall.face = face;
      wall.along = face === "n" || face === "s" ? "e" : "s";
      return;
    }
    const [x, z] = cellOf(wall, slot);
    moveMachine(layout, catalog, index, slot, x, z, face);
  }

  /** Swap two machines, so a row can be reordered by dropping one machine on another. */
  function swapMachines(layout, a, b) {
    const wa = layout.walls[a.index];
    const wb = layout.walls[b.index];
    const ca = codesOf(wa);
    const cb = wa === wb ? ca : codesOf(wb);
    const ta = tiersOf(wa);
    const tb = wa === wb ? ta : tiersOf(wb);
    const keep = ca[a.slot];
    ca[a.slot] = cb[b.slot];
    cb[b.slot] = keep;
    const keepTier = ta[a.slot];
    ta[a.slot] = tb[b.slot];
    tb[b.slot] = keepTier;
    setCodes(wa, ca, ta);
    if (wa !== wb) setCodes(wb, cb, tb);
  }

  /** The default facing for something new in a room: away from the room's nearest wall. */
  function facingAway(room, box) {
    const gaps = [["e", box.x0 - room.x0], ["w", room.x1 - box.x1], ["s", box.z0 - room.z0], ["n", room.z1 - box.z1]];
    gaps.sort((a, b) => a[1] - b[1]);
    return gaps[0][0];
  }

  function nextPadNum(layout) {
    return layout.pads.reduce((n, p) => Math.max(n, p.num), 0) + 1;
  }

  /** The block in the middle of a multiblock's controller face. A shell has its door there. */
  function frontCell(pad) {
    const cx = (pad.x0 + pad.x1) >> 1;
    const cz = (pad.z0 + pad.z1) >> 1;
    return { n: [cx, pad.z0], s: [cx, pad.z1], e: [pad.x1, cz], w: [pad.x0, cz] }[pad.front];
  }

  /** A multiblock's footprint before any turn: width along X, depth along Z. */
  function padSize(catalog, key) {
    const spec = catalog && catalog.multis[key];
    return spec ? [spec.size[0], spec.size[1]] : [3, 3];
  }

  /** One module's width and depth, recovered from the footprint and the module counts. */
  function moduleSize(pad) {
    const wx = pad.wx || 1;
    const wz = pad.wz || 1;
    const spanX = pad.x1 - pad.x0 + 1;
    const spanZ = pad.z1 - pad.z0 + 1;
    return [Math.floor((spanX - 1) / wx) + 1, Math.floor((spanZ - 1) / wz) + 1];
  }

  /** Across is side by side, facing the same way. Ranks sit behind and face the other way. */
  function moduleCounts(pad) {
    const wx = pad.wx || 1;
    const wz = pad.wz || 1;
    const ns = pad.front === "n" || pad.front === "s";
    return { across: ns ? wx : wz, ranks: ns ? wz : wx };
  }

  function moduleList(pad) {
    const wx = pad.wx || 1;
    const wz = pad.wz || 1;
    const [mw, md] = moduleSize(pad);
    const stepX = mw - 1;
    const stepZ = md - 1;
    const opp = { n: "s", s: "n", e: "w", w: "e" };
    const out = [];
    for (let i = 0; i < wx; i += 1) {
      for (let j = 0; j < wz; j += 1) {
        let front = pad.front;
        if (pad.flip === "x" && i > 0) front = opp[front];
        if (pad.flip === "z" && j > 0) front = opp[front];
        const x0 = pad.x0 + i * stepX;
        const z0 = pad.z0 + j * stepZ;
        out.push({ x0, x1: x0 + mw - 1, z0, z1: z0 + md - 1, front });
      }
    }
    return out;
  }

  /** Blocks a run of modules covers. Each one after the first shares a wall, so it adds its size less one. */
  function rowSpan(size, count) {
    return size + (count - 1) * Math.max(1, size - 1);
  }

  /** Store the module counts on a pad. A rank behind the first faces the other way. */
  function writeModules(pad, wx, wz) {
    if (wx > 1) pad.wx = wx;
    else delete pad.wx;
    if (wz > 1) pad.wz = wz;
    else delete pad.wz;
    const ns = pad.front === "n" || pad.front === "s";
    if ((ns ? wz : wx) > 1) pad.flip = ns ? "z" : "x";
    else delete pad.flip;
    delete pad.share;
  }

  function setModules(pad, across, ranks) {
    const [mw, md] = moduleSize(pad);
    const wide = Math.max(1, Math.min(MOST_MODULES, across || 1));
    const deep = Math.max(1, Math.min(MOST_MODULES, ranks || 1));
    const ns = pad.front === "n" || pad.front === "s";
    const wx = ns ? wide : deep;
    const wz = ns ? deep : wide;
    pad.x1 = pad.x0 + rowSpan(mw, wx) - 1;
    pad.z1 = pad.z0 + rowSpan(md, wz) - 1;
    writeModules(pad, wx, wz);
  }

  /**
   * Drag an edge of a wallshared row: the module count follows the pointer.
   * `size` is one module and `origin` the row's box when the drag began. The row stays inside `limit`.
   */
  function stretchModules(pad, size, origin, handle, cell, limit) {
    const count = (length, module, room) => {
      if (module < 2) return 1;
      const wanted = Math.round((length - module) / (module - 1)) + 1;
      const fitting = Math.floor((room - module) / (module - 1)) + 1;
      return Math.max(1, Math.min(wanted, fitting, MOST_MODULES));
    };
    const [mw, md] = size;
    const west = handle.includes("w");
    const north = handle.includes("n");
    const x0 = west ? Math.min(cell[0], origin.x1 - mw + 1) : origin.x0;
    const x1 = handle.includes("e") ? Math.max(cell[0], origin.x0 + mw - 1) : origin.x1;
    const z0 = north ? Math.min(cell[1], origin.z1 - md + 1) : origin.z0;
    const z1 = handle.includes("s") ? Math.max(cell[1], origin.z0 + md - 1) : origin.z1;
    const roomX = limit ? (west ? origin.x1 - limit.x0 : limit.x1 - origin.x0) + 1 : Infinity;
    const roomZ = limit ? (north ? origin.z1 - limit.z0 : limit.z1 - origin.z0) + 1 : Infinity;
    const wx = count(x1 - x0 + 1, mw, roomX);
    const wz = count(z1 - z0 + 1, md, roomZ);
    const spanX = rowSpan(mw, wx);
    const spanZ = rowSpan(md, wz);
    pad.x0 = west ? origin.x1 - spanX + 1 : origin.x0;
    pad.z0 = north ? origin.z1 - spanZ + 1 : origin.z0;
    pad.x1 = pad.x0 + spanX - 1;
    pad.z1 = pad.z0 + spanZ - 1;
    writeModules(pad, wx, wz);
  }

  function placePad(layout, catalog, { key, x0, z0, w, d, front, room }) {
    const pad = { num: nextPadNum(layout), key, room, x0, x1: x0 + w - 1, z0, z1: z0 + d - 1, front };
    if ((catalog.multis[key] || {}).shell) pad.door = frontCell(pad);
    layout.pads.push(pad);
    return layout.pads.length - 1;
  }

  /** Point a multiblock's controller another way. A shell's door moves to that side. */
  function setPadFront(pad, front) {
    pad.front = front;
    if (pad.door) pad.door = frontCell(pad);
  }

  /** Turn a multiblock a quarter clockwise about its middle: the footprint and the controller face. */
  function turnPad(pad) {
    const w = pad.x1 - pad.x0 + 1;
    const d = pad.z1 - pad.z0 + 1;
    const x0 = pad.x0 + Math.trunc((w - d) / 2);
    const z0 = pad.z0 + Math.trunc((d - w) / 2);
    Object.assign(pad, { x0, x1: x0 + d - 1, z0, z1: z0 + w - 1, front: TURN[pad.front] });
    if ((pad.wx || 1) > 1 || (pad.wz || 1) > 1 || pad.flip) {
      const wx = pad.wz || 1;
      const wz = pad.wx || 1;
      const flip = pad.flip === "x" ? "z" : pad.flip === "z" ? "x" : "";
      if (wx > 1) pad.wx = wx;
      else delete pad.wx;
      if (wz > 1) pad.wz = wz;
      else delete pad.wz;
      if (flip) pad.flip = flip;
      else delete pad.flip;
    }
    if (pad.door) pad.door = frontCell(pad);
  }

  /** Two sides as [width, depth], with the long one along X when `wide`. */
  function laid(wide, a, b) {
    return wide ? [Math.max(a, b), Math.min(a, b)] : [Math.min(a, b), Math.max(a, b)];
  }

  /** Make a multiblock another kind, at that kind's own size. Its corner stays, and its long side keeps its direction. */
  function retypePad(pad, catalog, key) {
    const [w, d] = laid(pad.x1 - pad.x0 >= pad.z1 - pad.z0, ...padSize(catalog, key));
    pad.key = key;
    pad.x1 = pad.x0 + w - 1;
    pad.z1 = pad.z0 + d - 1;
    if ((catalog.multis[key] || {}).shell) pad.door = frontCell(pad);
    else delete pad.door;
    delete pad.h;
    delete pad.wx;
    delete pad.wz;
    delete pad.flip;
    delete pad.share;
  }

  // ---- multiblock sizes ----

  /**
   * The sizes the wiki allows a multiblock, or null when it has the one `size`.
   * `fits` lists the only legal [width, depth, height] sizes. `span` holds ranges: four numbers are one
   * range for both sides and then one for the height, and six are width, depth, and height.
   * A turn swaps width and depth, so either way round is legal. catalog.py Multi.allows is the same rule.
   */
  function sizeRule(spec) {
    if (!spec) return null;
    if (Array.isArray(spec.fits) && spec.fits.length) return { fits: spec.fits };
    const s = spec.span;
    if (!Array.isArray(s) || (s.length !== 4 && s.length !== 6)) return null;
    const rule = s.length === 4
      ? { x: [s[0], s[1]], z: [s[0], s[1]], h: [s[2], s[3]] }
      : { x: [s[0], s[1]], z: [s[2], s[3]], h: [s[4], s[5]] };
    rule.square = Boolean(spec.square);
    rule.odd = Boolean(spec.odd);
    return rule;
  }

  function inSide(n, side, odd) {
    return n >= side[0] && n <= side[1] && (!odd || n % 2 === 1);
  }

  /** Whether one module can be built this size. */
  function sizeAllows(spec, w, d, h) {
    const rule = sizeRule(spec);
    if (!rule) {
      const [a, b, high] = spec.size;
      return h === high && ((w === a && d === b) || (w === b && d === a));
    }
    if (rule.fits) {
      return rule.fits.some((f) => f[2] === h && ((f[0] === w && f[1] === d) || (f[0] === d && f[1] === w)));
    }
    if ((rule.square && w !== d) || h < rule.h[0] || h > rule.h[1]) return false;
    return (inSide(w, rule.x, rule.odd) && inSide(d, rule.z, rule.odd))
      || (inSide(w, rule.z, rule.odd) && inSide(d, rule.x, rule.odd));
  }

  function sideText(side, odd) {
    if (side[0] === side[1]) return String(side[0]);
    if (!odd) return `${side[0]}–${side[1]}`;
    const nums = [];
    for (let n = side[0]; n <= side[1]; n += 1) if (n % 2 === 1) nums.push(n);
    return nums.join("/");
  }

  /** The legal sizes in a few characters, written the way catalog.py size_text writes them. */
  function sizeText(spec) {
    const rule = sizeRule(spec);
    if (!rule) return spec.size.join("×");
    if (rule.fits) return rule.fits.map((f) => f.join("×")).join(", ");
    const high = sideText(rule.h, false);
    if (rule.square) return `${sideText(rule.x, rule.odd)} square × ${high}`;
    return `${sideText(rule.x, rule.odd)}×${sideText(rule.z, rule.odd)}×${high}`;
  }

  /** What is wrong with a placed multiblock's size, or "". A wallshared row is judged one module at a time. */
  function padSizeProblem(pad, spec) {
    const [w, d] = moduleSize(pad);
    const h = pad.h || spec.size[2];
    if (sizeAllows(spec, w, d, h)) return "";
    return `${spec.name} is ${w}×${d}×${h}; the wiki size is ${sizeText(spec)}`;
  }

  /**
   * Which way round a module lies under a rule with ranges: "direct" as the catalog lists it, or "turned".
   * It is "" when both ways fit, as for a square, or when neither does.
   */
  function lies(rule, w, d) {
    if (rule.fits || rule.square) return "";
    const direct = inSide(w, rule.x, rule.odd) && inSide(d, rule.z, rule.odd);
    const turned = inSide(w, rule.z, rule.odd) && inSide(d, rule.x, rule.odd);
    if (direct === turned) return "";
    return direct ? "direct" : "turned";
  }

  function nearest(values, want) {
    return values.reduce((best, v) => (Math.abs(v - want) < Math.abs(best - want) ? v : best), values[0]);
  }

  /** A length pulled into a range, and onto an odd number when the rule needs one. */
  function snap(n, side, odd) {
    const v = Math.max(side[0], Math.min(n, side[1]));
    if (!odd || v % 2 === 1) return v;
    return v + 1 <= side[1] ? v + 1 : v - 1;
  }

  /**
   * The legal width and depth nearest to a wanted one.
   * `lead` is "x" or "z" when only that side was dragged or typed, so a square follows it.
   * `keep` is "direct" or "turned" to leave a structure with one free side lying the way it already does.
   */
  function legalFootprint(rule, w, d, lead, keep) {
    const led = lead === "x" ? w : lead === "z" ? d : Math.max(w, d);
    if (rule.fits) {
      if (rule.fits.every((f) => f[0] === f[1])) {
        const side = nearest(rule.fits.map((f) => f[0]), led);
        return [side, side];
      }
      let best = [rule.fits[0][0], rule.fits[0][1]];
      let least = Infinity;
      for (const f of rule.fits) {
        for (const [fw, fd] of [[f[0], f[1]], [f[1], f[0]]]) {
          const off = Math.abs(fw - w) + Math.abs(fd - d);
          if (off < least) {
            least = off;
            best = [fw, fd];
          }
        }
      }
      return best;
    }
    if (rule.square) {
      const side = snap(led, rule.x, rule.odd);
      return [side, side];
    }
    const direct = [snap(w, rule.x, rule.odd), snap(d, rule.z, rule.odd)];
    const turned = [snap(w, rule.z, rule.odd), snap(d, rule.x, rule.odd)];
    if (keep === "direct") return direct;
    if (keep === "turned") return turned;
    const off = (pair) => Math.abs(pair[0] - w) + Math.abs(pair[1] - d);
    return off(turned) < off(direct) ? turned : direct;
  }

  /** The heights a listed size allows for one footprint, lowest first. */
  function listedHeights(rule, w, d) {
    const highs = rule.fits.filter((f) => (f[0] === w && f[1] === d) || (f[0] === d && f[1] === w)).map((f) => f[2]);
    return [...new Set(highs)].sort((a, b) => a - b);
  }

  /** Pull a multiblock's height onto one its footprint allows. The catalog height is stored as no `h`. */
  function settleHeight(pad, spec) {
    const rule = sizeRule(spec);
    const now = pad.h || spec.size[2];
    let next = spec.size[2];
    if (rule && rule.fits) {
      const highs = listedHeights(rule, ...moduleSize(pad));
      next = highs.length ? nearest(highs, now) : now;
    } else if (rule) {
      next = Math.max(rule.h[0], Math.min(now, rule.h[1]));
    }
    if (next === spec.size[2]) delete pad.h;
    else pad.h = next;
  }

  /** Slide a footprint back inside its room. A room smaller than the footprint keeps the near corner. */
  function settleInRoom(box, room) {
    if (!room) return box;
    const w = box.x1 - box.x0 + 1;
    const d = box.z1 - box.z0 + 1;
    let { x0, z0 } = box;
    if (w <= room.x1 - room.x0 + 1) x0 = Math.max(room.x0, Math.min(x0, room.x1 - w + 1));
    if (d <= room.z1 - room.z0 + 1) z0 = Math.max(room.z0, Math.min(z0, room.z1 - d + 1));
    return { x0, x1: x0 + w - 1, z0, z1: z0 + d - 1 };
  }

  /** Give every module of a pad one width and depth, the nearest legal ones. A row keeps its count and its corner. */
  function resizeModules(pad, layout, spec, w, d, lead) {
    const rule = sizeRule(spec);
    const [mw, md] = rule ? legalFootprint(rule, w, d, lead, lies(rule, ...moduleSize(pad))) : [w, d];
    const box = {
      x0: pad.x0, x1: pad.x0 + rowSpan(mw, pad.wx || 1) - 1,
      z0: pad.z0, z1: pad.z0 + rowSpan(md, pad.wz || 1) - 1,
    };
    setBox("pads", pad, settleInRoom(box, roomById(layout, pad.room)));
    settleHeight(pad, spec);
  }

  /**
   * Resize one multiblock to a dragged or typed box. It lands on the nearest legal size, anchored on the
   * side that did not move, and stays inside its room. `from` is the box the drag began with.
   */
  function resizePadBox(pad, layout, spec, box, handle, from) {
    const rule = sizeRule(spec);
    if (!rule) return;
    const x0 = Math.min(box.x0, box.x1);
    const x1 = Math.max(box.x0, box.x1);
    const z0 = Math.min(box.z0, box.z1);
    const z1 = Math.max(box.z0, box.z1);
    const pull = String(handle || "");
    const alongX = pull.includes("e") || pull.includes("w");
    const alongZ = pull.includes("n") || pull.includes("s");
    const lead = alongX === alongZ ? "" : alongX ? "x" : "z";
    const start = from || pad;
    const keep = lies(rule, start.x1 - start.x0 + 1, start.z1 - start.z0 + 1);
    const [w, d] = legalFootprint(rule, x1 - x0 + 1, z1 - z0 + 1, lead, keep);
    const left = pull.includes("w") ? x1 - w + 1 : x0;
    const top = pull.includes("n") ? z1 - d + 1 : z0;
    setBox("pads", pad, settleInRoom({ x0: left, x1: left + w - 1, z0: top, z1: top + d - 1 }, roomById(layout, pad.room)));
    settleHeight(pad, spec);
  }

  /**
   * What the panel can change on a placed multiblock. Each entry is { key, value } with a `range`
   * ([low, high], and `odd`) or a list of `choices`. The keys are "side" for a square, "x" and "z" for
   * width and depth, and "h" for height. A wallshared row lists one module.
   */
  function sizeFields(pad, spec) {
    const rule = sizeRule(spec);
    if (!rule) return [];
    const [w, d] = moduleSize(pad);
    const high = pad.h || spec.size[2];
    const out = [];
    if (rule.fits) {
      const sides = [...new Set(rule.fits.flatMap((f) => [f[0], f[1]]))].sort((a, b) => a - b);
      if (sides.length > 1 && rule.fits.every((f) => f[0] === f[1])) out.push({ key: "side", value: w, choices: sides });
      else if (sides.length > 1) out.push({ key: "x", value: w, choices: sides }, { key: "z", value: d, choices: sides });
      const highs = listedHeights(rule, w, d);
      if (highs.length > 1) out.push({ key: "h", value: high, choices: highs });
      return out;
    }
    const free = (side) => side[0] !== side[1];
    if (rule.square) {
      if (free(rule.x)) out.push({ key: "side", value: w, range: rule.x, odd: rule.odd });
    } else if (free(rule.x) && free(rule.z)) {
      out.push({ key: "x", value: w, range: rule.x, odd: rule.odd }, { key: "z", value: d, range: rule.z, odd: rule.odd });
    } else if (free(rule.x) || free(rule.z)) {
      // One side grows. It runs along X or Z by the way the module is turned. A square module can grow either way.
      const long = free(rule.x) ? rule.x : rule.z;
      const way = lies(rule, w, d);
      const alongX = free(rule.x) ? way === "direct" : way === "turned";
      if (!way || alongX) out.push({ key: "x", value: w, range: long, odd: rule.odd });
      if (!way || !alongX) out.push({ key: "z", value: d, range: long, odd: rule.odd });
    }
    if (free(rule.h)) out.push({ key: "h", value: high, range: rule.h });
    return out;
  }

  /** Set one of the sizeFields. The multiblock lands on the nearest legal size and stays inside its room. */
  function setPadSize(pad, layout, spec, key, value) {
    const n = Math.round(Number(value));
    if (!Number.isFinite(n) || n < 1) return;
    if (key === "h") {
      pad.h = n;
      settleHeight(pad, spec);
      return;
    }
    const [w, d] = moduleSize(pad);
    if (key === "side") resizeModules(pad, layout, spec, n, n, "");
    else if (key === "x") resizeModules(pad, layout, spec, n, d, "x");
    else resizeModules(pad, layout, spec, w, n, "z");
  }

  /** Put a multiblock back on a legal size: the one nearest to what it has now. */
  function fitPad(pad, layout, spec) {
    const [w, d] = moduleSize(pad);
    const [fw, fd] = sizeRule(spec) ? [w, d] : laid(w >= d, spec.size[0], spec.size[1]);
    resizeModules(pad, layout, spec, fw, fd, "");
  }

  /** Cells a multiblock blocks. A shell (the cleanroom) blocks its ring, not its door or inside. */
  function padBlocks(pad, catalog) {
    const shell = Boolean((catalog.multis[pad.key] || {}).shell);
    const cells = [];
    for (let x = pad.x0; x <= pad.x1; x += 1) {
      for (let z = pad.z0; z <= pad.z1; z += 1) {
        const edge = x === pad.x0 || x === pad.x1 || z === pad.z0 || z === pad.z1;
        const door = Array.isArray(pad.door) && pad.door[0] === x && pad.door[1] === z;
        if (!shell || (edge && !door)) cells.push(`${x},${z}`);
      }
    }
    return cells;
  }

  function circleRadius(mark) {
    return Math.max(1, Math.floor(Math.min(mark.x1 - mark.x0, mark.z1 - mark.z0) / 2));
  }

  function addMark(layout, room, box, short) {
    layout.marks.push({ room, label: short, short, x0: box.x0, x1: box.x1, z0: box.z0, z1: box.z1 });
    return layout.marks.length - 1;
  }

  /** After a multiblock, row, or mark is dragged, it belongs to the room it now sits in. */
  function rehome(layout, kind, rec) {
    const room = roomById(layout, rec.room);
    if (!room) return;
    const [x, z] = kind === "walls" ? [rec.x, rec.z] : [(rec.x0 + rec.x1) >> 1, (rec.z0 + rec.z1) >> 1];
    const target = roomAt(layout, room.floor, x, z);
    if (target && target.room.id !== rec.room) rec.room = target.room.id;
  }

  // ---- ids ----

  function slug(text) {
    return String(text).toLowerCase().replace(/[^a-z0-9_]+/g, "-").replace(/^[-_]+|[-_]+$/g, "") || "zone";
  }

  function takenIds(layout, kind) {
    const list = kind === "floors" ? layout.floors : layout[kind];
    const ids = new Set(list.map((z) => z.id));
    if (kind === "floors" || kind === "rooms") RESERVED.forEach((id) => ids.add(id));
    return ids;
  }

  function uniqueId(layout, kind, base) {
    const taken = takenIds(layout, kind);
    const root = slug(base);
    let id = root;
    for (let n = 2; taken.has(id); n += 1) id = `${root}-${n}`;
    return id;
  }

  /** Rename a zone or floor, and every record that points at it. Returns a problem, or "". */
  function rename(layout, kind, z, id) {
    if (id === z.id) return "";
    if (!IDENT.test(id)) return "Use lowercase letters, digits, - or _.";
    if (takenIds(layout, kind).has(id)) return `${id} is already taken.`;
    const old = z.id;
    if (kind === "rooms") {
      for (const list of [layout.pads, layout.walls, layout.marks, layout.shafts]) {
        for (const item of list) if (item.room === old) item.room = id;
      }
    }
    if (kind === "floors") {
      for (const list of [layout.rooms, layout.streets, layout.doors, layout.sheets]) {
        for (const item of list) if (item.floor === old) item.floor = id;
      }
      for (const list of [layout.stairs, layout.lifts]) {
        for (const item of list) item.floors = item.floors.map((f) => (f === old ? id : f));
      }
      if (layout.site.crawl.under === old) layout.site.crawl.under = id;
    }
    z.id = id;
    return "";
  }

  /** Delete a zone. A room takes its pads, machine walls, marks, and shafts with it. */
  function deleteZone(layout, kind, index) {
    const z = layout[kind][index];
    if (kind === "rooms") {
      for (const list of ["pads", "walls", "marks", "shafts"]) {
        layout[list] = layout[list].filter((item) => item.room !== z.id);
      }
    }
    layout[kind].splice(index, 1);
  }

  // ---- copy and paste ----

  const IN_ROOM = new Set(["marks", "pads", "walls", "shafts", "machines"]);

  function shiftRec(kind, rec, dx, dz) {
    if (!dx && !dz) return;
    if (kind === "lifts" || kind === "walls") {
      rec.x += dx;
      rec.z += dz;
      return;
    }
    shiftBox(rec, dx, dz);
    if (Array.isArray(rec.label_at)) rec.label_at = [rec.label_at[0] + dx, rec.label_at[1] + dz];
    if (Array.isArray(rec.door)) rec.door = [rec.door[0] + dx, rec.door[1] + dz];
  }

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
      clip.contents = {
        pads: found.pads.map(clone),
        walls: found.walls.map(clone),
        marks: found.marks.map(clone),
        shafts: found.shafts.map(clone),
      };
    }
    return clip;
  }

  /** The footprint of a captured zone, in the same shape as boxOf. */
  function clipBox(clip) {
    if (clip.kind === "machines") {
      const m = clip.machine;
      return { x0: m.x, x1: m.x, z0: m.z, z1: m.z };
    }
    return boxOf(clip.kind, clip.rec);
  }

  /** Slide a captured zone, so the next paste steps from where the last one landed. */
  function shiftClip(clip, dx, dz) {
    if (clip.kind === "machines") {
      clip.machine.x += dx;
      clip.machine.z += dz;
      return;
    }
    shiftRec(clip.kind, clip.rec, dx, dz);
    if (clip.kind !== "rooms" || !clip.contents) return;
    for (const pad of clip.contents.pads) shiftRec("pads", pad, dx, dz);
    for (const wall of clip.contents.walls) shiftRec("walls", wall, dx, dz);
    for (const mark of clip.contents.marks) shiftRec("marks", mark, dx, dz);
    for (const shaft of clip.contents.shafts) shiftRec("shafts", shaft, dx, dz);
  }

  function roomsApart(a, b) {
    const gx = gap(a.x0, a.x1, b.x0, b.x1);
    const gz = gap(a.z0, a.z1, b.z0, b.z1);
    if (gx < 0 && gz < 0) return false;
    if ((gx < 0 && gz < 1) || (gz < 0 && gx < 1)) return false;
    return true;
  }

  function boxesOverlap(a, b) {
    return a.x0 <= b.x1 && b.x0 <= a.x1 && a.z0 <= b.z1 && b.z0 <= a.z1;
  }

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
    if (id) {
      const host = floorById(layout, id);
      if (host) return floorBox(layout, host);
    }
    if (clip.rec && clip.rec.room) {
      const room = roomById(layout, clip.rec.room);
      const host = room && floorById(layout, room.floor);
      if (host) return floorBox(layout, host);
    }
    return inner(layout);
  }

  function inBounds(layout, clip, floor, box) {
    const bounds = spotBounds(layout, clip, floor, box);
    return box.x0 >= bounds.x0 && box.x1 <= bounds.x1 && box.z0 >= bounds.z0 && box.z1 <= bounds.z1;
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

  /** Strict: the footprint sits in one room and does not cover another multiblock. */
  function contentSpot(layout, floor, clip, at, box, strict) {
    const dx = box.x0 - at.x0;
    const dz = box.z0 - at.z0;
    if (clip.kind === "walls") {
      const x = clip.rec.x + dx;
      const z = clip.rec.z + dz;
      const home = roomAt(layout, floor, x, z);
      if (!home) return false;
      const step = STEP[clip.rec.along];
      const n = Math.max(1, codesOf(clip.rec).length);
      let covered = true;
      for (let i = 0; i < n; i += 1) {
        if (!inside(home.room, x + step[0] * i, z + step[1] * i)) covered = false;
      }
      return covered || !strict;
    }
    const x = (box.x0 + box.x1) >> 1;
    const z = (box.z0 + box.z1) >> 1;
    const home = roomAt(layout, floor, x, z);
    if (!home) return false;
    const room = home.room;
    const covered = box.x0 >= room.x0 && box.x1 <= room.x1 && box.z0 >= room.z0 && box.z1 <= room.z1;
    if (!covered) return !strict;
    if (!strict || clip.kind !== "pads") return true;
    return !layout.pads.some((pad) => onFloor(layout, pad.room, floor) && boxesOverlap(box, pad));
  }

  /** Whether a copy fits. Strict rejects overlaps. */
  function spotFree(layout, catalog, clip, floor, at, box, strict) {
    if (!inBounds(layout, clip, floor, box)) return false;
    if (clip.kind === "rooms") return Boolean(floor) && (!strict || roomClear(layout, floor, box));
    if (clip.kind === "machines") {
      return Boolean(floor) && machineSpot(layout, catalog, floor, box.x0, box.z0, clip.machine.face);
    }
    if (IN_ROOM.has(clip.kind)) return Boolean(floor) && contentSpot(layout, floor, clip, at, box, strict);
    return true;
  }

  function sameBox(rec, box) {
    return rec.x0 === box.x0 && rec.x1 === box.x1 && rec.z0 === box.z0 && rec.z1 === box.z1;
  }

  /** The cut can land back on its old cells when nothing else is standing there. */
  function originFree(layout, catalog, clip, floor, at) {
    if (!spotFree(layout, catalog, clip, floor, at, at, true)) return false;
    if (clip.kind === "marks") {
      return !layout.marks.some((mark) => onFloor(layout, mark.room, floor) && sameBox(mark, at));
    }
    if (clip.kind === "shafts") {
      return !layout.shafts.some((shaft) => onFloor(layout, shaft.room, floor) && sameBox(shaft, at));
    }
    if (clip.kind === "walls") {
      return !layout.walls.some((wall) => onFloor(layout, wall.room, floor) && wall.x === clip.rec.x
        && wall.z === clip.rec.z && wall.along === clip.rec.along);
    }
    if (clip.kind === "stairs") return !layout.stairs.some((stair) => sameBox(stair, at));
    if (clip.kind === "lifts") return !layout.lifts.some((lift) => lift.x === at.x0 && lift.z === at.z0);
    if (clip.kind === "trenches") return !layout.trenches.some((trench) => sameBox(trench, at));
    if (clip.kind === "doors") {
      const on = floor || clip.rec.floor;
      return !layout.doors.some((door) => door.floor === on && sameBox(door, at));
    }
    if (clip.kind === "streets") {
      const on = floor || clip.rec.floor;
      return !layout.streets.some((street) => street.floor === on && boxesOverlap(street, at));
    }
    return true;
  }

  /** Offsets that step a footprint aside: east, south, west, north, then one block each way. */
  function pasteSteps(at, gap) {
    const w = at.x1 - at.x0 + 1;
    const d = at.z1 - at.z0 + 1;
    const sx = w + gap;
    const sz = d + gap;
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

  /** The smallest box around several. */
  function unionBoxes(boxes) {
    return {
      x0: Math.min(...boxes.map((box) => box.x0)),
      x1: Math.max(...boxes.map((box) => box.x1)),
      z0: Math.min(...boxes.map((box) => box.z0)),
      z1: Math.max(...boxes.map((box) => box.z1)),
    };
  }

  /** One offset that lands every copy, so a group stays in the same arrangement. */
  function pasteGroupSpot(layout, catalog, clips, floor, allowOrigin) {
    if (!clips.length) return null;
    const boxes = clips.map((clip) => clipBox(clip));
    const free = (dx, dz, strict) => clips.every((clip, i) => {
      const at = boxes[i];
      const box = { x0: at.x0 + dx, x1: at.x1 + dx, z0: at.z0 + dz, z1: at.z1 + dz };
      return spotFree(layout, catalog, clip, floor, at, box, strict);
    });
    if (allowOrigin && clips.every((clip, i) => originFree(layout, catalog, clip, floor, boxes[i]))) {
      return { dx: 0, dz: 0 };
    }
    const gap = clips.some((clip) => clip.kind === "rooms") ? 1 : 0;
    const spots = pasteSteps(unionBoxes(boxes), gap);
    return spots.find((spot) => free(spot.dx, spot.dz, true))
      || spots.find((spot) => free(spot.dx, spot.dz, false))
      || null;
  }

  /** Insert a copy shifted by (dx, dz). Returns { kind, index, slot }, or null. */
  function pasteClip(layout, catalog, clip, dx, dz, floor) {
    if (clip.kind === "machines") {
      const m = clip.machine;
      const x = m.x + dx;
      const z = m.z + dz;
      const home = roomAt(layout, floor, x, z);
      if (!home) return null;
      placeMachine(layout, catalog, { code: m.code, x, z, face: m.face, room: home.room.id, tier: m.tier });
      const hit = slotIn(layout, home.room.id, x, z);
      return hit ? { kind: "machines", index: hit.index, slot: hit.slot } : null;
    }

    if (clip.kind === "rooms") {
      const rec = clone(clip.rec);
      rec.id = uniqueId(layout, "rooms", rec.id);
      if (floor) rec.floor = floor;
      shiftRec("rooms", rec, dx, dz);
      layout.rooms.push(rec);
      const id = rec.id;
      for (const pad of clip.contents.pads) {
        const copy = clone(pad);
        copy.room = id;
        copy.num = nextPadNum(layout);
        shiftRec("pads", copy, dx, dz);
        layout.pads.push(copy);
      }
      for (const wall of clip.contents.walls) {
        const copy = clone(wall);
        copy.room = id;
        copy.id = nextRowId(layout);
        shiftRec("walls", copy, dx, dz);
        layout.walls.push(copy);
      }
      for (const mark of clip.contents.marks) {
        const copy = clone(mark);
        copy.room = id;
        shiftRec("marks", copy, dx, dz);
        layout.marks.push(copy);
      }
      for (const shaft of clip.contents.shafts) {
        const copy = clone(shaft);
        copy.room = id;
        copy.id = uniqueId(layout, "shafts", copy.id || "shaft");
        shiftRec("shafts", copy, dx, dz);
        layout.shafts.push(copy);
      }
      return { kind: "rooms", index: layout.rooms.length - 1 };
    }

    const rec = clone(clip.rec);
    shiftRec(clip.kind, rec, dx, dz);
    if ((clip.kind === "streets" || clip.kind === "doors") && floor) rec.floor = floor;
    if (clip.kind === "streets") rec.id = uniqueId(layout, "streets", rec.id);
    if (clip.kind === "doors") rec.id = uniqueId(layout, "doors", rec.id);
    if (clip.kind === "stairs") rec.id = uniqueId(layout, "stairs", rec.id);
    if (clip.kind === "lifts") rec.id = uniqueId(layout, "lifts", rec.id);
    if (clip.kind === "trenches") rec.id = uniqueId(layout, "trenches", rec.id);
    if (clip.kind === "shafts" || clip.kind === "marks" || clip.kind === "pads" || clip.kind === "walls") {
      const [x, z] = clip.kind === "walls" ? [rec.x, rec.z] : [(rec.x0 + rec.x1) >> 1, (rec.z0 + rec.z1) >> 1];
      const home = roomAt(layout, floor, x, z);
      if (!home) return null;
      rec.room = home.room.id;
    }
    if (clip.kind === "shafts") rec.id = uniqueId(layout, "shafts", rec.id || "shaft");
    if (clip.kind === "pads") rec.num = nextPadNum(layout);
    if (clip.kind === "walls") rec.id = nextRowId(layout);
    layout[clip.kind].push(rec);
    return { kind: clip.kind, index: layout[clip.kind].length - 1 };
  }

  // ---- chunks ----

  function chunkOrigin(layout) {
    return [layout.site.square.x0 >> 4, layout.site.square.z0 >> 4];
  }

  function chunkName(layout, x, z) {
    const [ox, oz] = chunkOrigin(layout);
    const letter = layout.site.columns[(x >> 4) - ox] || "?";
    return letter + ((z >> 4) - oz + 1);
  }

  function chunkBounds(layout, name) {
    const [ox, oz] = chunkOrigin(layout);
    const cx = layout.site.columns.indexOf(name[0]) + ox;
    const cz = Number(name.slice(1)) - 1 + oz;
    return { x0: cx * 16, x1: cx * 16 + 15, z0: cz * 16, z1: cz * 16 + 15 };
  }

  // ---- checks ----

  function gap(a0, a1, b0, b1) {
    if (a1 < b0) return b0 - a1 - 1;
    if (b1 < a0) return a0 - b1 - 1;
    return -1;
  }

  function inside(box, x, z) {
    return x >= box.x0 && x <= box.x1 && z >= box.z0 && z <= box.z1;
  }

  /** Cells a person can stand in on a floor: rooms, streets, doors, and stairs that reach it. */
  function walkCells(layout, floorId) {
    const cells = new Map();
    const add = (box, label) => {
      for (let x = box.x0; x <= box.x1; x += 1) {
        for (let z = box.z0; z <= box.z1; z += 1) if (!cells.has(`${x},${z}`)) cells.set(`${x},${z}`, label);
      }
    };
    for (const r of layout.rooms) if (r.floor === floorId) add(r, r.name);
    for (const s of layout.streets) if (s.floor === floorId) add(s, nameOf("streets", s));
    for (const s of layout.stairs) if (s.floors.includes(floorId)) add(s, s.id);
    for (const d of layout.doors) if (d.floor === floorId) add(d, d.id);
    return cells;
  }

  function pieces(cells) {
    const seen = new Set();
    const out = [];
    for (const key of cells.keys()) {
      if (seen.has(key)) continue;
      const piece = [];
      const queue = [key];
      seen.add(key);
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
      out.push(piece);
    }
    return out.sort((a, b) => b.length - a.length);
  }

  function stairEnds(stair) {
    const alongZ = stair.low === "n" || stair.low === "s";
    const lo = alongZ ? stair.z0 : stair.x0;
    const hi = alongZ ? stair.z1 : stair.x1;
    const rows = [];
    for (let v = lo; v <= hi; v += 1) rows.push(v);
    const ordered = stair.low === "n" || stair.low === "w" ? rows : rows.reverse();
    const pick = (set) => {
      const out = [];
      for (let x = stair.x0; x <= stair.x1; x += 1) {
        for (let z = stair.z0; z <= stair.z1; z += 1) if (set.has(alongZ ? z : x)) out.push([x, z]);
      }
      return out;
    };
    return [pick(new Set(ordered.slice(0, 3))), pick(new Set(ordered.slice(-3)))];
  }

  /** Problems a move can cause. Each item is { text, kind, index }. */
  function check(layout, catalog) {
    const out = [];
    const note = (text, kind, index, layer, slot) => out.push({ text, kind, index, layer, slot });
    const walked = new Map();
    const walkedCells = (floorId) => {
      let cells = walked.get(floorId);
      if (!cells) {
        cells = walkCells(layout, floorId);
        walked.set(floorId, cells);
      }
      return cells;
    };
    const floorIds = new Set(layout.floors.map((f) => f.id));

    const bands = bandProblem(layout, layout.floors);
    if (bands) note(bands, null, null, null);

    const site = inner(layout);
    [...KINDS, "marks", "pads", "walls"].forEach((kind) => layout[kind].forEach((z, index) => {
      const box = boxOf(kind, z);
      const b = boundsFor(layout, kind, z);
      const layer = kind === "trenches" ? CRAWL : z.floor || (z.floors ? z.floors[0] : null)
        || (roomById(layout, z.room) || {}).floor;
      if (box.x0 < b.x0 || box.x1 > b.x1 || box.z0 < b.z0 || box.z1 > b.z1) {
        const custom = b.x0 !== site.x0 || b.x1 !== site.x1 || b.z0 !== site.z0 || b.z1 !== site.z1;
        note(`${nameOf(kind, z, catalog)} ${custom ? "sits outside this floor" : "reaches the rim"}`, kind, index, layer);
      }
    }));

    for (const floor of layout.floors) {
      const rooms = layout.rooms.map((z, index) => ({ z, index })).filter((r) => r.z.floor === floor.id);
      const streets = layout.streets.map((z, index) => ({ z, index })).filter((s) => s.z.floor === floor.id);
      for (let i = 0; i < rooms.length; i += 1) {
        for (let j = i + 1; j < rooms.length; j += 1) {
          const a = rooms[i].z;
          const b = rooms[j].z;
          const gx = gap(a.x0, a.x1, b.x0, b.x1);
          const gz = gap(a.z0, a.z1, b.z0, b.z1);
          if (gx < 0 && gz < 0) {
            note(`${b.name} overlaps ${a.name}`, "rooms", rooms[j].index, floor.id);
          } else if ((gx < 0 && gz < 1) || (gz < 0 && gx < 1)) {
            note(`${b.name} touches ${a.name} with no wall`, "rooms", rooms[j].index, floor.id);
          }
        }
        for (const s of streets) {
          const a = rooms[i].z;
          const gx = gap(a.x0, a.x1, s.z.x0, s.z.x1);
          const gz = gap(a.z0, a.z1, s.z.z0, s.z.z1);
          if (gx < 0 && gz < 0) {
            note(`${a.name} overlaps ${nameOf("streets", s.z)}`, "rooms", rooms[i].index, floor.id);
          } else if ((gx < 0 && gz === 2) || (gz < 0 && gx === 2)) {
            note(`${a.name} is 2 blocks from ${nameOf("streets", s.z)}; walls are 1 block`, "rooms",
              rooms[i].index, floor.id);
          }
        }
      }

      const cells = walkedCells(floor.id);
      const parts = pieces(cells);
      for (const part of parts.slice(1)) {
        note(`${cells.get(part[0])} is cut off from the rest of the floor`, null, null, floor.id);
      }
    }

    layout.doors.forEach((d, index) => {
      const wide = d.x1 - d.x0 + 1;
      const deep = d.z1 - d.z0 + 1;
      if (Math.min(wide, deep) !== 1 || Math.max(wide, deep) < 3) {
        note(`${d.id} is ${wide}×${deep}; a door is 1 deep and 3 or more wide`, "doors", index, d.floor);
        return;
      }
      const open = new Set();
      for (const r of layout.rooms) if (r.floor === d.floor) open.add(r);
      for (const s of layout.streets) if (s.floor === d.floor) open.add(s);
      for (const s of layout.stairs) if (s.floors.includes(d.floor)) open.add(s);
      const zones = [...open];
      const isOpen = (x, z) => zones.some((zone) => inside(zone, x, z));
      const vertical = wide === 1;
      for (let x = d.x0; x <= d.x1; x += 1) {
        for (let z = d.z0; z <= d.z1; z += 1) {
          if (isOpen(x, z)) {
            note(`${d.id} sits inside a room or street; doors go in the wall`, "doors", index, d.floor);
            return;
          }
          const sides = vertical ? [[x - 1, z], [x + 1, z]] : [[x, z - 1], [x, z + 1]];
          if (!sides.every(([sx, sz]) => isOpen(sx, sz))) {
            note(`${d.id} opens onto rock`, "doors", index, d.floor);
            return;
          }
        }
      }
    });

    layout.stairs.forEach((s, index) => {
      if (!s.floors.every((f) => floorIds.has(f))) {
        note(`${s.id} names a floor that does not exist`, "stairs", index, null);
        return;
      }
      const [low, high] = stairEnds(s);
      const own = (x, z) => inside(s, x, z);
      const lands = (cellsAtEnd, floorId) => {
        const walk = walkedCells(floorId);
        return cellsAtEnd.some(([x, z]) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => {
          const nx = x + dx;
          const nz = z + dz;
          return !own(nx, nz) && walk.has(`${nx},${nz}`);
        }));
      };
      const [bottom, top] = s.floors;
      if (!lands(low, bottom)) note(`${s.id} has no landing at its low end on the ${layerName(layout, bottom)}`, "stairs", index, bottom);
      if (!lands(high, top)) note(`${s.id} has no landing at its high end on the ${layerName(layout, top)}`, "stairs", index, top);
    });

    const reach = (catalog && catalog.elevator) || 20;
    layout.lifts.forEach((lift, index) => {
      for (const f of lift.floors) {
        if (!walkedCells(f).has(`${lift.x},${lift.z}`)) {
          note(`${nameOf("lifts", lift)} has no landing on the ${layerName(layout, f)}`, "lifts", index, f);
        }
      }
      const slabs = lift.floors.map((f) => (floorById(layout, f) || { slab: 0 }).slab);
      for (let i = 1; i < slabs.length; i += 1) {
        if (slabs[i] - slabs[i - 1] > reach) {
          note(`${nameOf("lifts", lift)}: ${slabs[i] - slabs[i - 1]} blocks between stops; an elevator reaches ${reach}`, "lifts", index, lift.floors[i]);
        }
      }
    });

    const rooms = new Map(layout.rooms.map((r, index) => [r.id, { r, index }]));
    const within = (room, x, z) => room && inside(room.r, x, z);
    layout.pads.forEach((p, index) => {
      const room = rooms.get(p.room);
      if (room && !(within(room, p.x0, p.z0) && within(room, p.x1, p.z1))) {
        note(`Multiblock ${nameOf("pads", p, catalog)} sticks out of ${room.r.name}`, "pads", index, room.r.floor);
      }
    });
    layout.walls.forEach((w, index) => {
      const room = rooms.get(w.room);
      if (room && wallSlots(w).some((slot) => !within(room, slot.x, slot.z))) {
        note(`Machine row ${w.id} sticks out of ${room.r.name}`, "walls", index, room.r.floor);
      }
    });
    layout.marks.forEach((m, index) => {
      const room = rooms.get(m.room);
      if (room && !(within(room, m.x0, m.z0) && within(room, m.x1, m.z1))) {
        note(`Area ${nameOf("marks", m)} sticks out of ${room.r.name}`, "marks", index, room.r.floor);
      }
    });

    if (catalog) {
      layout.pads.forEach((p, index) => {
        const spec = catalog.multis[p.key];
        const problem = spec ? padSizeProblem(p, spec) : "";
        if (problem) note(problem, "pads", index, (rooms.get(p.room) || { r: {} }).r.floor);
      });
      for (const floor of layout.floors) {
        const pads = [];
        layout.pads.forEach((p, index) => {
          if ((rooms.get(p.room) || { r: {} }).r.floor === floor.id) pads.push({ p, index });
        });
        for (let i = 0; i < pads.length; i += 1) {
          for (let j = i + 1; j < pads.length; j += 1) {
            const a = pads[i].p;
            const b = pads[j].p;
            if (gap(a.x0, a.x1, b.x0, b.x1) < 0 && gap(a.z0, a.z1, b.z0, b.z1) < 0 && !(a.share && b.share)) {
              const an = (catalog.multis[a.key] || {}).short || a.key;
              const bn = (catalog.multis[b.key] || {}).short || b.key;
              note(`${an} overlaps ${bn}`, "pads",
                pads[i].index, floor.id);
            }
          }
        }
        const padCells = new Map();
        for (const { p } of pads) {
          const called = (catalog.multis[p.key] || {}).short || p.key;
          for (const cell of padBlocks(p, catalog)) padCells.set(cell, called);
        }
        const blocked = new Set(padCells.keys());
        const machines = machinesOn(layout, floor.id);
        for (const m of machines) blocked.add(`${m.x},${m.z}`);
        for (const mark of layout.marks) {
          if (mark.shape !== "service" || (rooms.get(mark.room) || { r: {} }).r.floor !== floor.id) continue;
          for (let x = mark.x0; x <= mark.x1; x += 1) for (let z = mark.z0; z <= mark.z1; z += 1) blocked.add(`${x},${z}`);
        }
        const walk = walkedCells(floor.id);
        for (const m of machines) {
          const name = (catalog.singles[m.code] || { name: m.code }).name;
          const here = `${m.x},${m.z}`;
          if (padCells.has(here)) {
            note(`${name} in ${m.wall.id} sits on multiblock ${padCells.get(here)}`, "machines", m.index, floor.id, m.slot);
            continue;
          }
          const step = STEP[m.face];
          const front = `${m.x + step[0]},${m.z + step[1]}`;
          if (!walk.has(front) || blocked.has(front)) {
            note(`${name} in ${m.wall.id} faces a wall or a machine`, "machines", m.index, floor.id, m.slot);
          }
        }
      }

      const cap = planTier(layout);
      for (const item of overTier(layout, catalog, cap)) {
        note(item.text, item.kind, item.index, item.layer, item.slot);
      }

      const dirty = new Set(layout.site.dirty);
      layout.pads.forEach((p) => {
        const spec = catalog.multis[p.key];
        if (!spec || !spec.pollution) return;
        const room = rooms.get(p.room);
        const corners = [[p.x0, p.z0], [p.x1, p.z0], [p.x0, p.z1], [p.x1, p.z1]];
        const outside = corners.find(([x, z]) => !dirty.has(chunkName(layout, x, z)));
        if (outside) {
          note(`${spec.name} pollutes outside the dirty chunks, at ${chunkName(layout, ...outside)}`,
            "rooms", room ? room.index : null, room ? room.r.floor : null);
        }
      });
      layout.walls.forEach((w) => {
        const room = rooms.get(w.room);
        for (const slot of wallSlots(w)) {
          const spec = catalog.singles[slot.code];
          if (spec && spec.pollution && !dirty.has(chunkName(layout, slot.x, slot.z))) {
            note(`${spec.name} in ${w.id} pollutes outside the dirty chunks`, "rooms", room ? room.index : null,
              room ? room.r.floor : null);
            break;
          }
        }
      });
      const [ox, oz] = chunkOrigin(layout);
      const dirtyXY = [...dirty].map((n) => [layout.site.columns.indexOf(n[0]) + ox, Number(n.slice(1)) - 1 + oz]);
      layout.rooms.forEach((r, index) => {
        if (!r.clean) return;
        for (let cx = r.x0 >> 4; cx <= r.x1 >> 4; cx += 1) {
          for (let cz = r.z0 >> 4; cz <= r.z1 >> 4; cz += 1) {
            if (dirtyXY.some(([dx, dz]) => Math.abs(cx - dx) + Math.abs(cz - dz) < 2)) {
              note(`${r.name} is a clean room within one chunk of the dirty block`, "rooms", index, r.floor);
              return;
            }
          }
        }
      });
    }

    const crawlCells = new Map();
    const addCrawl = (box, label) => {
      for (let x = box.x0; x <= box.x1; x += 1) {
        for (let z = box.z0; z <= box.z1; z += 1) crawlCells.set(`${x},${z}`, label);
      }
    };
    for (const t of layout.trenches) addCrawl(t, t.id);
    for (const s of layout.streets) {
      if (s.floor === layout.site.crawl.under && s.trench !== false) addCrawl(s, `under ${nameOf("streets", s)}`);
    }
    const crawlParts = pieces(crawlCells);
    for (const part of crawlParts.slice(1)) {
      note(`${crawlCells.get(part[0])} is cut off from the other trenches`, null, null, CRAWL);
    }
    return out;
  }

  root.Core = {
    CRAWL, STEP, TURN, KIND_NAMES, KIND_PLURALS, TIERS, VOLTAGE, SELECTABLE,
    dumps, clone,
    tierLabel, planTier, voltageRank, multiOpen, overTier,
    floorById, floorHeight, floorAir, crawlAir, layers, layerName, floorUse, seatFloor,
    roomById, zonesOn, boxOf, nameOf, inner, boundsFor, clampDelta, moveZone, setBox, contentsOf,
    mainFloor, floorBox, floorLimit, sameBox, unionBoxes, spanProblem, writeSpan,
    uniqueId, rename, deleteZone,
    capture, clipBox, shiftClip, pasteGroupSpot, pasteClip,
    roomAt, contentsOn, codesOf, setCodes, tierAt, setTier, machinesOn, slotIn, cellOf,
    placeMachine, removeMachine, moveMachine, turnMachine, swapMachines, facingAway,
    padSize, placePad, setPadFront, turnPad, retypePad, padBlocks, frontCell,
    moduleSize, moduleCounts, moduleList, setModules, stretchModules,
    sizeRule, sizeText, sizeFields, setPadSize, resizePadBox, padSizeProblem, fitPad,
    circleRadius, addMark, rehome,
    chunkOrigin, chunkName, chunkBounds,
    walkCells, check,
  };
})(typeof window !== "undefined" ? window : globalThis);
