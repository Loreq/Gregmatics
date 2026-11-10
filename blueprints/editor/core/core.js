/* The ground every editor script stands on: names, tiers, the plan's text, boxes, and lookups.
   Each core-*.js file adds one subject to Core: floors, machine rows, multiblocks and their sizes, zones,
   the clipboard, and the checks. They load in the order index.html lists them, so a file may use what
   the files before it put on Core. Nothing here draws or reads the page. */
(function (root) {
  "use strict";

  // A list this short is written on one line.
  const INLINE = 100;
  const CRAWL = "crawl";
  const KIND_NAMES = {
    rooms: "Room", streets: "Street", doors: "Door", stairs: "Stair", shafts: "Shaft", lifts: "Lift",
    trenches: "Trench", marks: "Area", pads: "Multiblock", walls: "Machine row", machines: "Machine",
  };
  const KIND_PLURALS = {
    rooms: "Rooms", streets: "Streets", doors: "Doors", stairs: "Stairs", shafts: "Shafts", lifts: "Lifts",
    trenches: "Trenches", marks: "Areas", pads: "Multiblocks", walls: "Machine rows", machines: "Machines",
  };
  // One step toward each side, as [dx, dz], and the side a quarter turn clockwise.
  const STEP = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] };
  const TURN = { n: "e", e: "s", s: "w", w: "n" };
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
  // Tiers a plan can be built for, and tiers a machine can be.
  const SELECTABLE = VOLTAGE.slice();
  const TIERS = VOLTAGE.slice(VOLTAGE.indexOf("LV"));
  const DEFAULT_TIER = "MV";

  // ---- tiers ----

  /** A tier's place in the voltage order, or -1 for a name that is not a tier. */
  function voltageRank(tier) {
    return VOLTAGE.indexOf(tier);
  }

  /** A tier as the quest book names it. */
  function tierLabel(tier) {
    return QUEST[tier] || tier;
  }

  /** The tier a plan is built for. A plan that names none is MV. */
  function planTier(layout) {
    const tier = layout && layout.site && layout.site.tier;
    return SELECTABLE.includes(tier) ? tier : DEFAULT_TIER;
  }

  /** Whether a multiblock is within a tier. One with no tier of its own, such as an altar, always is. */
  function multiOpen(spec, cap) {
    const need = voltageRank(spec && spec.tier);
    if (need < 0) return true;
    return need <= voltageRank(planTier({ site: { tier: cap } }));
  }

  /** A machine's tier as the plan stores it. Anything that is not a machine tier is MV. */
  function normalizeTier(value) {
    const raw = String(value || DEFAULT_TIER);
    const found = TIERS.find((tier) => tier.toLowerCase() === raw.toLowerCase());
    return found || DEFAULT_TIER;
  }

  // ---- the plan's text ----

  /** A list of plain values on one line, or null when it holds a list or object or runs too long. */
  function inlineList(list) {
    if (!list.every((v) => v === null || typeof v !== "object")) return null;
    const flat = "[" + list.map((v) => JSON.stringify(v)).join(", ") + "]";
    return flat.length <= INLINE ? flat : null;
  }

  /** A list as plan text: on one line when it fits, else one item to a line. */
  function dumpsList(list, indent) {
    if (!list.length) return "[]";
    const flat = inlineList(list);
    if (flat !== null) return flat;
    const inner = "  ".repeat(indent + 1);
    return "[\n" + list.map((v) => inner + dumps(v, indent + 1)).join(",\n") + "\n" + "  ".repeat(indent) + "]";
  }

  /** An object as plan text, one key to a line. Keys set to undefined are left out. */
  function dumpsObject(value, indent) {
    const keys = Object.keys(value).filter((k) => value[k] !== undefined);
    if (!keys.length) return "{}";
    const inner = "  ".repeat(indent + 1);
    return "{\n" + keys.map((k) => inner + JSON.stringify(k) + ": " + dumps(value[k], indent + 1)).join(",\n")
      + "\n" + "  ".repeat(indent) + "}";
  }

  /** The plan as text, the same text layout.dumps() writes, so a file reads the same from either side. */
  function dumps(value, indent = 0) {
    if (Array.isArray(value)) return dumpsList(value, indent);
    if (value !== null && typeof value === "object") return dumpsObject(value, indent);
    return JSON.stringify(value);
  }

  /** A copy that shares nothing with the original. */
  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  // ---- boxes: { x0, x1, z0, z1 }, both ends inside ----

  /** Blocks between two spans on one axis: 0 when they touch, -1 when they overlap. */
  function gap(a0, a1, b0, b1) {
    if (a1 < b0) return b0 - a1 - 1;
    if (b1 < a0) return a0 - b1 - 1;
    return -1;
  }

  /** Whether a cell is in a box. */
  function inside(box, x, z) {
    return x >= box.x0 && x <= box.x1 && z >= box.z0 && z <= box.z1;
  }

  /** How many cells a box covers. */
  function area(box) {
    return (box.x1 - box.x0 + 1) * (box.z1 - box.z0 + 1);
  }

  /** Whether a record has exactly this box. */
  function sameBox(rec, box) {
    return rec.x0 === box.x0 && rec.x1 === box.x1 && rec.z0 === box.z0 && rec.z1 === box.z1;
  }

  /** Whether a box lies wholly inside a limit. */
  function containsBox(limit, box) {
    return box.x0 >= limit.x0 && box.x1 <= limit.x1 && box.z0 >= limit.z0 && box.z1 <= limit.z1;
  }

  /** Whether any side of a box passes a limit. */
  function pokesOut(box, limit) {
    return box.x0 < limit.x0 || box.x1 > limit.x1 || box.z0 < limit.z0 || box.z1 > limit.z1;
  }

  /** Whether two boxes share a cell. */
  function boxesOverlap(a, b) {
    return a.x0 <= b.x1 && b.x0 <= a.x1 && a.z0 <= b.z1 && b.z0 <= a.z1;
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

  /** A box with its ends in order, whichever way round they were given. */
  function orderedBox(box) {
    return {
      x0: Math.min(box.x0, box.x1), x1: Math.max(box.x0, box.x1),
      z0: Math.min(box.z0, box.z1), z1: Math.max(box.z0, box.z1),
    };
  }

  /** Slide a record's box. */
  function shiftBox(item, dx, dz) {
    item.x0 += dx;
    item.x1 += dx;
    item.z0 += dz;
    item.z1 += dz;
  }

  /** A cell moved by an offset. */
  function shiftedCell(cell, dx, dz) {
    return [cell[0] + dx, cell[1] + dz];
  }

  /** Slide a record: its box, and its label and door cells when it has them. */
  function shiftRecord(rec, dx, dz) {
    shiftBox(rec, dx, dz);
    if (Array.isArray(rec.label_at)) rec.label_at = shiftedCell(rec.label_at, dx, dz);
    if (Array.isArray(rec.door)) rec.door = shiftedCell(rec.door, dx, dz);
  }

  /** Give a record a box. Its label, when it has a place, is pulled back inside. */
  function assignBox(rec, box) {
    const { x0, x1, z0, z1 } = orderedBox(box);
    Object.assign(rec, { x0, x1, z0, z1 });
    if (Array.isArray(rec.label_at)) {
      rec.label_at = [Math.min(Math.max(rec.label_at[0], x0), x1), Math.min(Math.max(rec.label_at[1], z0), z1)];
    }
  }

  /** The cell in the middle of a box, toward the low corner when a side is even. */
  function middleCell(box) {
    return [(box.x0 + box.x1) >> 1, (box.z0 + box.z1) >> 1];
  }

  // ---- lookups ----

  /** The floor with this id, or null. */
  function floorById(layout, id) {
    return layout.floors.find((f) => f.id === id) || null;
  }

  /** The room with this id, or null. */
  function roomById(layout, id) {
    return layout.rooms.find((r) => r.id === id) || null;
  }

  /** Whether a room is on a floor. */
  function onFloor(layout, roomId, layer) {
    const room = roomById(layout, roomId);
    return Boolean(room && room.floor === layer);
  }

  /** The room on a floor that holds a cell, as { room, index }, or null. Where rooms overlap, the smallest. */
  function roomAt(layout, floorId, x, z) {
    let best = null;
    layout.rooms.forEach((room, index) => {
      if (room.floor === floorId && inside(room, x, z) && (!best || area(room) < area(best.room))) {
        best = { room, index };
      }
    });
    return best;
  }

  /** The way something new in a room should face: away from the room's nearest wall. */
  function facingAway(room, box) {
    const gaps = [["e", box.x0 - room.x0], ["w", room.x1 - box.x1], ["s", box.z0 - room.z0], ["n", room.z1 - box.z1]];
    gaps.sort((a, b) => a[1] - b[1]);
    return gaps[0][0];
  }

  // ---- chunks ----

  /** The chunk column and row of the site's first chunk. */
  function chunkOrigin(layout) {
    return [layout.site.square.x0 >> 4, layout.site.square.z0 >> 4];
  }

  /** The name of the chunk a cell is in, such as E6. A column past the site's letters is "?". */
  function chunkName(layout, x, z) {
    const [ox, oz] = chunkOrigin(layout);
    const letter = layout.site.columns[(x >> 4) - ox] || "?";
    return letter + ((z >> 4) - oz + 1);
  }

  /** The chunk column and row a name such as E6 stands for. */
  function chunkCell(layout, name) {
    const [ox, oz] = chunkOrigin(layout);
    return [layout.site.columns.indexOf(name[0]) + ox, Number(name.slice(1)) - 1 + oz];
  }

  /** The box of blocks a named chunk covers. */
  function chunkBounds(layout, name) {
    const [cx, cz] = chunkCell(layout, name);
    return { x0: cx * 16, x1: cx * 16 + 15, z0: cz * 16, z1: cz * 16 + 15 };
  }

  root.Core = {
    CRAWL, STEP, TURN, KIND_NAMES, KIND_PLURALS, TIERS, VOLTAGE, SELECTABLE, DEFAULT_TIER,
    tierLabel, planTier, voltageRank, multiOpen, normalizeTier,
    dumps, clone,
    gap, inside, area, sameBox, containsBox, pokesOut, boxesOverlap, unionBoxes, orderedBox,
    shiftBox, shiftRecord, assignBox, middleCell,
    floorById, roomById, onFloor, roomAt, facingAway,
    chunkOrigin, chunkName, chunkCell, chunkBounds,
  };
})(typeof window !== "undefined" ? window : globalThis);
