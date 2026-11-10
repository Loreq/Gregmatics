/* The place tools: Multiblock and Machine. Both put down the item picked in the catalog picker.
   A placement says what a click on a cell would put there and whether it fits; the preview and the
   click both ask for it. A machine can be dragged out as a row. */
(function (App) {
  "use strict";

  const {
    Core, CATALOG, CRAWL, SIDE_NAMES, state, L, snapshot, status, cellBox, insideBox, around,
    Sel, History, Paint, Panels,
  } = App;

  const DEFAULT_FRONT = "s";

  // ---- what would be placed ----

  /** Every cell a multiblock blocks on this floor. */
  function padCellsOnLayer() {
    const cells = new Set();
    for (const item of Core.contentsOn(L(), state.layer)) {
      if (item.kind === "pads") for (const cell of Core.padBlocks(item.z, CATALOG)) cells.add(cell);
    }
    return cells;
  }

  /** The face of a machine row this cell would join: a slot already there, or one step past an end. */
  function rowFaceAt(roomId, x, z) {
    const hit = Core.slotIn(L(), roomId, x, z);
    if (hit) return L().walls[hit.index].face;
    for (const wall of L().walls) {
      if (wall.room !== roomId) continue;
      const step = Core.STEP[wall.along];
      const n = Core.codesOf(wall).length;
      if ((x === wall.x + step[0] * n && z === wall.z + step[1] * n) || (x === wall.x - step[0] && z === wall.z - step[1])) {
        return wall.face;
      }
    }
    return null;
  }

  /** The picked multiblock centered on a cell. It fits when all of it is in one room. */
  function padPlacement(cell, home) {
    const key = state.pick.pads;
    const [a, b] = Core.padSize(CATALOG, key);
    const [w, d] = state.swap ? [b, a] : [a, b];
    const box = around(cell, w, d);
    const fits = Boolean(home) && insideBox(home.room, box);
    const front = state.front || (home ? Core.facingAway(home.room, box) : DEFAULT_FRONT);
    return { kind: "pads", key, box, w, d, front, home, fits };
  }

  /** The picked machine on a cell. It faces the way the row it would join does, else away from the nearest wall. */
  function machinePlacement(cell, home) {
    const [x, z] = cell;
    const code = state.pick.machines;
    const face = state.front || (home && rowFaceAt(home.room.id, x, z))
      || (home ? Core.facingAway(home.room, cellBox(x, z)) : DEFAULT_FRONT);
    const open = Core.voltageRank(Core.planTier(L())) >= Core.voltageRank("LV");
    const fits = open && Boolean(home) && !padCellsOnLayer().has(`${x},${z}`);
    return { kind: "machines", code, box: cellBox(x, z), face, home, fits };
  }

  /** What the placing tool would put on a cell, and whether it fits. The cell defaults to the one under the pointer. */
  function placement(cell = state.hover) {
    if (!cell || !state.layout || state.layer === CRAWL) return null;
    const home = Core.roomAt(L(), state.layer, cell[0], cell[1]);
    if (state.tool === "pads") return padPlacement(cell, home);
    if (state.tool === "machines") return machinePlacement(cell, home);
    return null;
  }

  // ---- placing ----

  /** Put the picked multiblock down and select it. */
  function placePad(p) {
    const index = History.change(() => Core.placePad(L(), CATALOG, {
      key: p.key, x0: p.box.x0, z0: p.box.z0, w: p.w, d: p.d, front: p.front, room: p.home.room.id,
    }));
    Sel.replace({ kind: "pads", index });
    Panels.refresh();
    status(`Placed ${(CATALOG.multis[p.key] || {}).name || p.key}.`);
  }

  /** The tier a new machine gets: the plan's, which is stored as nothing when it is MV. */
  function newMachineTier() {
    const plan = Core.planTier(L());
    const tier = Core.TIERS.includes(plan) ? plan : "LV";
    return tier === Core.DEFAULT_TIER ? undefined : tier;
  }

  /** Put the picked machine on a cell and select it, when it fits there. This is not yet an undo step. */
  function paintMachineAt(cell) {
    const p = placement(cell);
    if (!p || !p.fits || p.kind !== "machines") return;
    Core.placeMachine(L(), CATALOG, {
      code: p.code, x: cell[0], z: cell[1], face: p.face, room: p.home.room.id, tier: newMachineTier(),
    });
    Sel.selectMachineAt(cell[0], cell[1]);
    status(`Placed ${(CATALOG.singles[p.code] || {}).name || p.code}.`);
  }

  /** Put down the first machine of what may become a dragged row. Returns the drag that carries it on. */
  function startRow(cell) {
    const before = snapshot();
    const rows = L().walls.length;
    paintMachineAt(cell);
    const freshId = L().walls.length > rows ? L().walls[L().walls.length - 1].id : null;
    return { mode: "paint", before, last: cell, freshId, oriented: false };
  }

  /** A press with a place tool. Returns a drag for a machine row, or null. */
  function start(cell) {
    const p = placement(cell);
    if (!p) return null;
    if (!p.fits) {
      status(p.home ? "It does not fit there. Turn it with R, or pick a roomier spot." : "Place it inside a room on this floor.", true);
      return null;
    }
    if (p.kind === "pads") {
      placePad(p);
      return null;
    }
    return startRow(cell);
  }

  // ---- dragging out a row of machines ----

  /** Cells on a straight run from one cell to another, not counting the first. */
  function cellsBetween(a, b) {
    const n = Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
    const out = [];
    for (let i = 1; i <= n; i += 1) {
      out.push([Math.round(a[0] + ((b[0] - a[0]) * i) / n), Math.round(a[1] + ((b[1] - a[1]) * i) / n)]);
    }
    return out;
  }

  /** The side one cell is on from the cell beside it, or null when they are not side by side. */
  function sideBetween(a, b) {
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    if (Math.abs(dx) + Math.abs(dz) !== 1) return null;
    return dx ? (dx > 0 ? "e" : "w") : dz > 0 ? "s" : "n";
  }

  /** Point a one-machine row along the drag, facing away from the nearer wall. */
  function orientRow(rowId, dir) {
    const wall = L().walls.find((w) => w.id === rowId);
    if (!wall || Core.codesOf(wall).length !== 1) return;
    const room = Core.roomById(L(), wall.room);
    const across = dir === "n" || dir === "s" ? ["e", "w"] : ["s", "n"];
    let face = across.includes(state.front) ? state.front : null;
    if (!face && across[0] === "e") face = wall.x - room.x0 <= room.x1 - wall.x ? "e" : "w";
    if (!face) face = wall.z - room.z0 <= room.z1 - wall.z ? "s" : "n";
    wall.face = face;
    wall.along = dir;
  }

  /** Carry a row drag on to a cell, placing a machine on every cell passed. The first step turns a new row along the drag. */
  function paintTo(drag, cell) {
    Paint.notePlan();
    for (const next of cellsBetween(drag.last, cell)) {
      const dir = sideBetween(drag.last, next);
      if (dir && drag.freshId && !drag.oriented) orientRow(drag.freshId, dir);
      drag.oriented = true;
      paintMachineAt(next);
      drag.last = next;
    }
  }

  // ---- turning what is about to be placed ----

  /** Turn the item in hand a quarter clockwise. A multiblock's footprint turns with it. */
  function turn() {
    const p = placement();
    const current = (p && p.front) || state.front || DEFAULT_FRONT;
    state.front = Core.TURN[current];
    if (state.tool === "pads") state.swap = !state.swap;
    Paint.draw();
    status(`Facing ${SIDE_NAMES[state.front].toLowerCase()}.`);
  }

  Object.assign(App.Place, { placement, start, paintTo, turn });
})(window.App);
