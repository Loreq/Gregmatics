/* The ground every editor script stands on: names, tiers, the plan's text, boxes, lookups,
   and the pollution settlement.
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
  // One minute of a vent, the part kept after dissipation, and the spread above 400,000 gibbl.
  const GIBBL_STEP = 60;
  const GIBBL_KEEP_NUM = 9945;
  const GIBBL_KEEP_DEN = 10000;
  const GIBBL_SPREAD = 400000;
  const GIBBL_SHARE = 20;
  const GIBBL_NEIGHBOR = 6;
  const GIBBL_SENDER = 5;
  const GIBBL_CAP = 2147483647;
  // Counts minute steps after the occupied set last grew. Not a gibbl rate and not a radius.
  const SETTLED_STEPS = 4096;

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

  /** The name of chunk column `index`: A, B, then Z, then AA, AB. */
  function columnName(index) {
    let n = index;
    let name = "";
    do {
      name = String.fromCharCode(65 + (n % 26)) + name;
      n = Math.floor(n / 26) - 1;
    } while (n >= 0);
    return name;
  }

  /** The column names a site stores, whether that is a string of letters or a list. */
  function columnList(columns) {
    if (Array.isArray(columns)) return columns.slice();
    return String(columns || "").split("");
  }

  /** The letters and row of a chunk name such as E6 or AA12, or null. */
  function chunkParts(name) {
    const match = /^([A-Z]+)(\d+)$/.exec(String(name || ""));
    if (!match) return null;
    return { letters: match[1], row: Number(match[2]) };
  }

  /** The chunk column and row of the site's first chunk. */
  function chunkOrigin(layout) {
    return [layout.site.square.x0 >> 4, layout.site.square.z0 >> 4];
  }

  /** The name of the chunk a cell is in, such as E6 or AA3. A column past the site's names is "?". */
  function chunkName(layout, x, z) {
    const [ox, oz] = chunkOrigin(layout);
    const cols = columnList(layout.site.columns);
    const letter = cols[(x >> 4) - ox] || "?";
    return letter + ((z >> 4) - oz + 1);
  }

  /** The chunk column and row a name such as E6 or AA12 stands for. */
  function chunkCell(layout, name) {
    const [ox, oz] = chunkOrigin(layout);
    const parts = chunkParts(name);
    const cols = columnList(layout.site.columns);
    const index = parts ? cols.indexOf(parts.letters) : -1;
    const row = parts ? parts.row : NaN;
    return [index + ox, row - 1 + oz];
  }

  /** The box of blocks a named chunk covers. */
  function chunkBounds(layout, name) {
    const [cx, cz] = chunkCell(layout, name);
    return { x0: cx * 16, x1: cx * 16 + 15, z0: cz * 16, z1: cz * 16 + 15 };
  }

  /** The home chunks of a footprint, each as that chunk's box. */
  function homeChunks(box) {
    if (!box || box.x0 > box.x1 || box.z0 > box.z1) return [];
    if (![box.x0, box.x1, box.z0, box.z1].every(Number.isInteger)) return [];
    const chunks = [];
    for (let cx = box.x0 >> 4; cx <= box.x1 >> 4; cx += 1) {
      for (let cz = box.z0 >> 4; cz <= box.z1 >> 4; cz += 1) {
        chunks.push({ x0: cx * 16, x1: cx * 16 + 15, z0: cz * 16, z1: cz * 16 + 15 });
      }
    }
    return chunks;
  }

  // ---- pollution ----

  // Keys sort by chunk X, then chunk Z, for any chunk within a million of the origin.
  const CHUNK_SPAN = 2097152;
  const CHUNK_BIAS = 1048576;

  /** The map key of the chunk at cx, cz. */
  function cellKey(cx, cz) {
    return (cx + CHUNK_BIAS) * CHUNK_SPAN + (cz + CHUNK_BIAS);
  }

  /** The chunk a map key names. */
  function chunkAt(key) {
    return { cx: Math.floor(key / CHUNK_SPAN) - CHUNK_BIAS, cz: (key % CHUNK_SPAN) - CHUNK_BIAS };
  }

  /** Chunk keys in walk order: increasing X, then increasing Z. */
  function walkKeys(amounts) {
    return [...amounts.keys()].sort((a, b) => a - b);
  }

  /** An empty gibbl map that remembers its walk order until a chunk is added or removed. */
  function gibblState() {
    return { amt: new Map(), order: null };
  }

  /** The live chunks in walk order, reused while the set of chunks stays the same. */
  function orderOf(state) {
    if (state.order) return state.order;
    state.order = [...state.amt.keys()].sort((a, b) => a - b);
    return state.order;
  }

  /** The chunks and amounts, in walk order, so two maps can be compared. */
  function amountStamp(amounts) {
    return walkKeys(amounts).map((key) => `${key}=${amounts.get(key)}`).join(";");
  }

  /** Whether a catalog value is a positive gibbl/s rate. */
  function isRate(pollution) {
    return typeof pollution === "number" && pollution > 0;
  }

  /** Stop a gibbl amount at the cap. */
  function capGibbl(amount) {
    return amount > GIBBL_CAP ? GIBBL_CAP : amount;
  }

  /** The gibbl a chunk keeps after one dissipation. */
  function keepGibbl(amount) {
    return Math.floor(amount * GIBBL_KEEP_NUM / GIBBL_KEEP_DEN);
  }

  /** Add this step's vent gibbl to the vent chunks. */
  function gainStep(state, vents) {
    for (const [key, rate] of vents) {
      const had = state.amt.has(key);
      state.amt.set(key, capGibbl((state.amt.get(key) || 0) + rate * GIBBL_STEP));
      if (!had) state.order = null;
    }
  }

  /** Dissipate every chunk that holds gibbl, in walk order. */
  function dissipateStep(state) {
    const keys = orderOf(state);
    let dropped = false;
    for (let i = 0; i < keys.length; i += 1) {
      const kept = keepGibbl(state.amt.get(keys[i]));
      if (kept > 0) state.amt.set(keys[i], kept);
      else {
        state.amt.delete(keys[i]);
        dropped = true;
      }
    }
    if (dropped) state.order = null;
  }

  /** Give one neighbor its share and drop that share from the sender. */
  function shareTo(state, senderKey, cx, cz) {
    const sender = state.amt.get(senderKey) || 0;
    const neighborKey = cellKey(cx, cz);
    const neighbor = state.amt.get(neighborKey) || 0;
    if (neighbor * GIBBL_NEIGHBOR >= sender * GIBBL_SENDER) return;
    const share = Math.floor((sender - neighbor) / GIBBL_SHARE);
    if (share <= 0) return;
    if (!state.amt.has(neighborKey)) state.order = null;
    state.amt.set(neighborKey, capGibbl(neighbor + share));
    const left = sender - share;
    if (left > 0) state.amt.set(senderKey, left);
    else {
      state.amt.delete(senderKey);
      state.order = null;
    }
  }

  /** Spread one chunk that is still above 400,000 to its four neighbors. */
  function spreadChunk(state, key) {
    if ((state.amt.get(key) || 0) <= GIBBL_SPREAD) return;
    const { cx, cz } = chunkAt(key);
    shareTo(state, key, cx + STEP.e[0], cz + STEP.e[1]);
    shareTo(state, key, cx + STEP.w[0], cz + STEP.w[1]);
    shareTo(state, key, cx + STEP.s[0], cz + STEP.s[1]);
    shareTo(state, key, cx + STEP.n[0], cz + STEP.n[1]);
  }

  /** Spread from the chunks that held gibbl after dissipation. */
  function spreadStep(state) {
    const keys = orderOf(state);
    const count = keys.length;
    for (let i = 0; i < count; i += 1) spreadChunk(state, keys[i]);
  }

  /** Run one 60-second step: gain, dissipate, then spread. */
  function pollutionStep(state, vents) {
    gainStep(state, vents);
    dissipateStep(state);
    spreadStep(state);
  }

  /** Whether two gibbl maps hold the same chunks and amounts. */
  function sameAmounts(a, b) {
    if (a.size !== b.size) return false;
    for (const [key, amount] of a) {
      if (b.get(key) !== amount) return false;
    }
    return true;
  }

  /** A fingerprint of a gibbl map, in walk order. A match is checked against the real amounts. */
  function hashAmounts(state) {
    const keys = orderOf(state);
    let h1 = 0x811c9dc5;
    let h2 = 0x811c9dc5;
    for (let i = 0; i < keys.length; i += 1) {
      const amount = state.amt.get(keys[i]);
      h1 = Math.imul(h1 ^ keys[i], 0x01000193) ^ amount;
      h2 = Math.imul(h2 ^ amount, 0x01000193) ^ keys[i];
    }
    return `${keys.length}:${h1 >>> 0}:${h2 >>> 0}`;
  }

  /** Whether stepping from empty this many times lands on these amounts. */
  function replayMatches(vents, prev, amt) {
    const trial = gibblState();
    for (let i = 0; i <= prev; i += 1) pollutionStep(trial, vents);
    return sameAmounts(trial.amt, amt);
  }

  /** The gibbl map when a step's amounts repeat, or when the occupied set has added no chunk for SETTLED_STEPS steps. */
  function repeatedStep(vents) {
    const seen = new Map();
    const state = gibblState();
    const held = new Set();
    let quiet = 0;
    let step = 0;
    for (;;) {
      pollutionStep(state, vents);
      const hash = hashAmounts(state);
      const prev = seen.get(hash);
      if (prev !== undefined && replayMatches(vents, prev, state.amt)) return state.amt;
      let gained = false;
      for (const key of state.amt.keys()) {
        if (!held.has(key)) {
          held.add(key);
          gained = true;
        }
      }
      if (gained) quiet = 0;
      else {
        quiet += 1;
        if (quiet >= SETTLED_STEPS) return state.amt;
      }
      if (prev === undefined) seen.set(hash, step);
      step += 1;
    }
  }

  /** The chunks that hold gibbl in the map repeatedStep returns, after a repeat or a quiet occupied set. */
  function settleVents(vents) {
    return walkKeys(repeatedStep(vents)).map(chunkAt);
  }

  /** Every way to give each rated source one home chunk, with rates in a chunk added. */
  function ventMaps(sources) {
    const rated = [];
    for (const source of sources) {
      if (source && isRate(source.pollution) && source.cells && source.cells.length) rated.push(source);
    }
    if (!rated.length) return [];
    let maps = new Map();
    maps.set("", new Map());
    for (const source of rated) {
      const next = new Map();
      for (const map of maps.values()) {
        for (const cell of source.cells) {
          const copy = new Map(map);
          const key = cellKey(cell[0], cell[1]);
          copy.set(key, (copy.get(key) || 0) + source.pollution);
          const stamp = amountStamp(copy);
          if (!next.has(stamp)) next.set(stamp, copy);
        }
      }
      maps = next;
    }
    return [...maps.values()];
  }

  /** The chunks to draw for these sources. */
  function pollutionChunks(sources) {
    const drawn = new Map();
    for (const vents of ventMaps(sources || [])) {
      for (const chunk of settleVents(vents)) drawn.set(cellKey(chunk.cx, chunk.cz), chunk);
    }
    for (const source of sources || []) {
      if (!source || source.pollution !== true || !source.cells) continue;
      for (const cell of source.cells) drawn.set(cellKey(cell[0], cell[1]), { cx: cell[0], cz: cell[1] });
    }
    return [...drawn.values()].sort((a, b) => a.cx - b.cx || a.cz - b.cz);
  }

  // The one remembered signature, and the chunk list pollutionChunks returned for it.
  let settledStamp = null;
  let settledChunks = null;

  /** Each source's pollution value and home chunks, in list order, as one string. */
  function sourceStamp(sources) {
    return (sources || []).map((source) => {
      const cells = source.cells.map((cell) => `${cell[0]},${cell[1]}`).join(";");
      return `${source.pollution}:${cells}`;
    }).join("|");
  }

  /** The chunks for these sources, settled once and kept until the sources change. */
  function cachedPollutionChunks(sources) {
    const stamp = sourceStamp(sources);
    if (stamp === settledStamp) return settledChunks;
    settledChunks = pollutionChunks(sources);
    settledStamp = stamp;
    return settledChunks;
  }

  root.Core = {
    CRAWL, STEP, TURN, KIND_NAMES, KIND_PLURALS, TIERS, VOLTAGE, SELECTABLE, DEFAULT_TIER,
    tierLabel, planTier, voltageRank, multiOpen, normalizeTier,
    dumps, clone,
    gap, inside, area, sameBox, containsBox, pokesOut, boxesOverlap, unionBoxes, orderedBox,
    shiftBox, shiftRecord, assignBox, middleCell,
    floorById, roomById, onFloor, roomAt, facingAway,
    chunkOrigin, chunkName, chunkCell, chunkBounds, homeChunks, columnName, columnList, chunkParts,
    pollutionChunks, cachedPollutionChunks,
  };
})(typeof window !== "undefined" ? window : globalThis);
