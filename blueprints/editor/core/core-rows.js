/* Machine rows. A row is a line of single-block machines in a room: `codes` holds one code per slot,
   "-" for a spare slot, and `tiers` one tier per slot. A row with no `tiers` is all MV.
   The row starts at (x, z), runs `along` one side, and every machine faces `face`. */
(function (root) {
  "use strict";

  const Core = root.Core;
  const { STEP, DEFAULT_TIER, normalizeTier, roomById, roomAt, onFloor } = Core;

  const EMPTY = "-";

  // ---- reading a row ----

  /** A row's codes, one per slot. */
  function codesOf(wall) {
    return String(wall.codes || "").split(/\s+/).filter(Boolean);
  }

  /** One tier per slot, parallel to the codes. An empty slot is "-". A missing tier is MV. */
  function tiersOf(wall) {
    const raw = String(wall.tiers || "").split(/\s+/).filter(Boolean);
    return codesOf(wall).map((code, i) => (code === EMPTY ? EMPTY : normalizeTier(raw[i])));
  }

  /** The tier of the machine in a slot. */
  function tierAt(wall, slot) {
    return tiersOf(wall)[slot] || DEFAULT_TIER;
  }

  /** The cell a slot stands on. */
  function cellOf(wall, slot) {
    const step = STEP[wall.along];
    return [wall.x + step[0] * slot, wall.z + step[1] * slot];
  }

  /** Every slot of a row, empty ones included, with its code, tier, and cell. */
  function rowSlots(wall) {
    const tiers = tiersOf(wall);
    return codesOf(wall).map((code, slot) => {
      const [x, z] = cellOf(wall, slot);
      return { slot, code, tier: tiers[slot], x, z };
    });
  }

  /** The slots of a row that hold a machine, each with the way it faces. */
  function wallSlots(wall) {
    return rowSlots(wall).filter((s) => s.code !== EMPTY).map((s) => ({ ...s, face: wall.face }));
  }

  /** One entry per machine on a floor: its row (index), slot, code, tier, cell, and facing. */
  function machinesOn(layout, layer) {
    const out = [];
    layout.walls.forEach((wall, index) => {
      if (!onFloor(layout, wall.room, layer)) return;
      for (const s of rowSlots(wall)) {
        if (s.code !== EMPTY) out.push({ index, slot: s.slot, code: s.code, tier: s.tier, x: s.x, z: s.z, face: wall.face, wall });
      }
    });
    return out;
  }

  /** The row slot at a cell in a room, empty slots included, as { index, slot, code }, or null. */
  function slotIn(layout, roomId, x, z) {
    for (let index = 0; index < layout.walls.length; index += 1) {
      const wall = layout.walls[index];
      if (wall.room !== roomId) continue;
      const hit = rowSlots(wall).find((s) => s.x === x && s.z === z);
      if (hit) return { index, slot: hit.slot, code: hit.code };
    }
    return null;
  }

  // ---- writing a row ----

  /** Store a row's codes and tiers. An all-MV row stores no tiers. */
  function writeSlots(wall, codes, tiers) {
    delete wall.stacked;
    wall.codes = codes.join(" ");
    const stored = codes.map((code, i) => (code === EMPTY ? EMPTY : normalizeTier(tiers && tiers[i])));
    if (stored.every((t) => t === DEFAULT_TIER || t === EMPTY)) delete wall.tiers;
    else wall.tiers = stored.join(" ");
  }

  /** Give a row new codes. With no tiers given, each slot keeps the tier it had. */
  function setCodes(wall, codes, tiers) {
    writeSlots(wall, codes, tiers || tiersOf(wall));
  }

  /** Set the tier of the machine in a slot. An empty slot has none to set. */
  function setTier(wall, slot, tier) {
    const codes = codesOf(wall);
    const tiers = tiersOf(wall);
    if (codes[slot] === EMPTY || slot < 0 || slot >= codes.length) return;
    tiers[slot] = normalizeTier(tier);
    writeSlots(wall, codes, tiers);
  }

  /** The first row id of the form M1, M2, ... that no row has. */
  function nextRowId(layout) {
    const taken = new Set(layout.walls.map((w) => w.id));
    for (let n = 1; ; n += 1) if (!taken.has(`M${n}`)) return `M${n}`;
  }

  /** The side a row runs along when its machines face this way. */
  function alongFor(face) {
    return face === "n" || face === "s" ? "e" : "s";
  }

  // ---- taking machines out ----

  /** Drop empty slots off both ends of a row, and the row once it holds nothing. */
  function trimRow(layout, index) {
    const wall = layout.walls[index];
    const codes = codesOf(wall);
    const tiers = tiersOf(wall);
    const step = STEP[wall.along];
    while (codes.length && codes[0] === EMPTY) {
      codes.shift();
      tiers.shift();
      wall.x += step[0];
      wall.z += step[1];
    }
    while (codes.length && codes[codes.length - 1] === EMPTY) {
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
    codes[slot] = EMPTY;
    tiers[slot] = EMPTY;
    setCodes(wall, codes, tiers);
    trimRow(layout, index);
  }

  // ---- putting machines in ----

  /**
   * Use the slot a row already has at the machine's cell. Returns whether the machine went in.
   * A row that faces another way gives the cell up instead, and the machine still needs a home.
   */
  function takeSlot(layout, spot) {
    const hit = slotIn(layout, spot.room, spot.x, spot.z);
    if (!hit) return false;
    const wall = layout.walls[hit.index];
    if (wall.face !== spot.face) {
      removeMachine(layout, hit.index, hit.slot);
      return false;
    }
    const codes = codesOf(wall);
    const tiers = tiersOf(wall);
    const keep = spot.given === null && codes[hit.slot] !== EMPTY ? tiers[hit.slot] : (spot.given || DEFAULT_TIER);
    codes[hit.slot] = spot.code;
    tiers[hit.slot] = keep;
    setCodes(wall, codes, tiers);
    return true;
  }

  /** Add the machine to the end or the start of a row it lines up with. Returns whether one took it. */
  function joinRow(layout, spot) {
    const { x, z } = spot;
    for (const wall of layout.walls) {
      if (wall.room !== spot.room || wall.face !== spot.face) continue;
      const step = STEP[wall.along];
      const codes = codesOf(wall);
      const tiers = tiersOf(wall);
      const next = spot.given || DEFAULT_TIER;
      if (x === wall.x + step[0] * codes.length && z === wall.z + step[1] * codes.length) {
        codes.push(spot.code);
        tiers.push(next);
        setCodes(wall, codes, tiers);
        return true;
      }
      if (x === wall.x - step[0] && z === wall.z - step[1]) {
        wall.x = x;
        wall.z = z;
        codes.unshift(spot.code);
        tiers.unshift(next);
        setCodes(wall, codes, tiers);
        return true;
      }
    }
    return false;
  }

  /** Start a row of one machine. */
  function startRow(layout, spot) {
    const row = {
      id: nextRowId(layout), room: spot.room, x: spot.x, z: spot.z, along: alongFor(spot.face), face: spot.face,
      codes: spot.code,
    };
    if (spot.given && spot.given !== DEFAULT_TIER) row.tiers = spot.given;
    layout.walls.push(row);
  }

  /** Fill, extend, or start a machine row at this cell. With no tier given, a machine it replaces keeps its tier. */
  function placeMachine(layout, catalog, { code, x, z, face, room, tier }) {
    const spot = { code, x, z, face, room, given: tier === undefined ? null : normalizeTier(tier) };
    if (takeSlot(layout, spot) || joinRow(layout, spot)) return;
    startRow(layout, spot);
  }

  // ---- moving machines ----

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
      wall.along = alongFor(face);
      return;
    }
    const [x, z] = cellOf(wall, slot);
    moveMachine(layout, catalog, index, slot, x, z, face);
  }

  /** Exchange one entry of a list with one entry of another, or of the same list. */
  function exchange(listA, i, listB, j) {
    const keep = listA[i];
    listA[i] = listB[j];
    listB[j] = keep;
  }

  /** Swap two machines, so a row can be reordered by dropping one machine on another. */
  function swapMachines(layout, a, b) {
    const wa = layout.walls[a.index];
    const wb = layout.walls[b.index];
    const ca = codesOf(wa);
    const cb = wa === wb ? ca : codesOf(wb);
    const ta = tiersOf(wa);
    const tb = wa === wb ? ta : tiersOf(wb);
    exchange(ca, a.slot, cb, b.slot);
    exchange(ta, a.slot, tb, b.slot);
    setCodes(wa, ca, ta);
    if (wa !== wb) setCodes(wb, cb, tb);
  }

  Object.assign(Core, {
    codesOf, tiersOf, tierAt, cellOf, rowSlots, wallSlots, machinesOn, slotIn,
    setCodes, setTier, nextRowId,
    removeMachine, placeMachine, moveMachine, turnMachine, swapMachines,
  });
})(typeof window !== "undefined" ? window : globalThis);
