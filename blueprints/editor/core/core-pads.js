/* Multiblocks. A pad is a multiblock's footprint in a room, with the side its controller is on.
   A wallshared row is one pad of several modules: `wx` and `wz` count them along X and Z, and each module
   after the first shares a wall with the one before, so it adds its size less one. `flip` names the axis
   along which the ranks behind the first face the other way. A shell, the cleanroom, has a door block. */
(function (root) {
  "use strict";

  const Core = root.Core;
  const { TURN, assignBox, middleCell } = Core;

  // A wallshared row runs at most this many modules each way.
  const MOST_MODULES = 8;
  const OPPOSITE = { n: "s", s: "n", e: "w", w: "e" };
  // The footprint of a multiblock the catalog does not know.
  const UNKNOWN_SIZE = [3, 3];

  // ---- one pad ----

  /** The catalog's entry for a multiblock, or an empty one for a key it does not know. */
  function specOf(catalog, key) {
    return catalog.multis[key] || {};
  }

  /** The number the next new multiblock gets. */
  function nextPadNum(layout) {
    return layout.pads.reduce((n, p) => Math.max(n, p.num), 0) + 1;
  }

  /** The block in the middle of a multiblock's controller face. A shell has its door there. */
  function frontCell(pad) {
    const [cx, cz] = middleCell(pad);
    return { n: [cx, pad.z0], s: [cx, pad.z1], e: [pad.x1, cz], w: [pad.x0, cz] }[pad.front];
  }

  /** A multiblock's footprint before any turn: width along X, depth along Z. */
  function padSize(catalog, key) {
    const spec = catalog && catalog.multis[key];
    return spec ? [spec.size[0], spec.size[1]] : UNKNOWN_SIZE.slice();
  }

  /** Whether the controller faces north or south, so the row runs along X. */
  function facesAlongZ(pad) {
    return pad.front === "n" || pad.front === "s";
  }

  /** Keep a shell's door in the middle of its controller face. */
  function rehangDoor(pad) {
    if (pad.door) pad.door = frontCell(pad);
  }

  /** Give a pad a box. A door it already has follows the controller face. */
  function setPadBox(pad, box) {
    assignBox(pad, box);
    if (Array.isArray(pad.door)) pad.door = frontCell(pad);
  }

  /** Add a multiblock to a room. Returns its index. */
  function placePad(layout, catalog, { key, x0, z0, w, d, front, room }) {
    const pad = { num: nextPadNum(layout), key, room, x0, x1: x0 + w - 1, z0, z1: z0 + d - 1, front };
    if (specOf(catalog, key).shell) pad.door = frontCell(pad);
    layout.pads.push(pad);
    return layout.pads.length - 1;
  }

  /** Point a multiblock's controller another way. A shell's door moves to that side. */
  function setPadFront(pad, front) {
    pad.front = front;
    rehangDoor(pad);
  }

  /** Cells a multiblock blocks. A shell blocks its ring, not its door or its inside. */
  function padBlocks(pad, catalog) {
    const shell = Boolean(specOf(catalog, pad.key).shell);
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

  // ---- modules of a wallshared row ----

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
    return facesAlongZ(pad) ? { across: wx, ranks: wz } : { across: wz, ranks: wx };
  }

  /** The way module (i, j) of a row faces: ranks behind the first face the other way. */
  function moduleFront(pad, i, j) {
    let front = pad.front;
    if (pad.flip === "x" && i > 0) front = OPPOSITE[front];
    if (pad.flip === "z" && j > 0) front = OPPOSITE[front];
    return front;
  }

  /** Every module of a pad as { x0, x1, z0, z1, front }. A plain multiblock is one module. */
  function moduleList(pad) {
    const [mw, md] = moduleSize(pad);
    const out = [];
    for (let i = 0; i < (pad.wx || 1); i += 1) {
      for (let j = 0; j < (pad.wz || 1); j += 1) {
        const x0 = pad.x0 + i * (mw - 1);
        const z0 = pad.z0 + j * (md - 1);
        out.push({ x0, x1: x0 + mw - 1, z0, z1: z0 + md - 1, front: moduleFront(pad, i, j) });
      }
    }
    return out;
  }

  /** Blocks a run of modules covers. Each one after the first shares a wall, so it adds its size less one. */
  function rowSpan(size, count) {
    return size + (count - 1) * Math.max(1, size - 1);
  }

  /** Store a count on a pad. A count of one is stored as nothing. */
  function writeCount(pad, key, count) {
    if (count > 1) pad[key] = count;
    else delete pad[key];
  }

  /** Store the module counts on a pad. A rank behind the first faces the other way. */
  function writeModules(pad, wx, wz) {
    writeCount(pad, "wx", wx);
    writeCount(pad, "wz", wz);
    const alongZ = facesAlongZ(pad);
    if ((alongZ ? wz : wx) > 1) pad.flip = alongZ ? "z" : "x";
    else delete pad.flip;
    delete pad.share;
  }

  /** A module count held to what a row allows. */
  function cappedCount(count) {
    return Math.max(1, Math.min(MOST_MODULES, count || 1));
  }

  /** Set how many modules a row has across and in ranks. The row grows from its low corner. */
  function setModules(pad, across, ranks) {
    const [mw, md] = moduleSize(pad);
    const wide = cappedCount(across);
    const deep = cappedCount(ranks);
    const wx = facesAlongZ(pad) ? wide : deep;
    const wz = facesAlongZ(pad) ? deep : wide;
    pad.x1 = pad.x0 + rowSpan(mw, wx) - 1;
    pad.z1 = pad.z0 + rowSpan(md, wz) - 1;
    writeModules(pad, wx, wz);
  }

  /** How many modules fit a dragged length, held to the room there is and the most a row allows. */
  function modulesFor(length, module, room) {
    if (module < 2) return 1;
    const wanted = Math.round((length - module) / (module - 1)) + 1;
    const fitting = Math.floor((room - module) / (module - 1)) + 1;
    return Math.max(1, Math.min(wanted, fitting, MOST_MODULES));
  }

  /**
   * One axis of a dragged row. `low` and `high` say which end the handle holds, `at` is the pointer,
   * `from` and `to` the row's ends when the drag began, and `limit` the ends of the room, or null.
   * Returns the count of modules and the end the row grows from: { count, low, anchor }.
   */
  function stretchAxis(low, high, at, from, to, module, limit) {
    const start = low ? Math.min(at, to - module + 1) : from;
    const end = high ? Math.max(at, from + module - 1) : to;
    const room = limit ? (low ? to - limit[0] : limit[1] - from) + 1 : Infinity;
    return { count: modulesFor(end - start + 1, module, room), low, anchor: low ? to : from };
  }

  /** The low end of a stretched axis: it grows away from the end the handle does not hold. */
  function stretchedStart(axis, span) {
    return axis.low ? axis.anchor - span + 1 : axis.anchor;
  }

  /**
   * Drag an edge of a wallshared row: the module count follows the pointer.
   * `size` is one module and `origin` the row's box when the drag began. The row stays inside `limit`.
   */
  function stretchModules(pad, size, origin, handle, cell, limit) {
    const [mw, md] = size;
    const alongX = stretchAxis(handle.includes("w"), handle.includes("e"), cell[0], origin.x0, origin.x1, mw,
      limit && [limit.x0, limit.x1]);
    const alongZ = stretchAxis(handle.includes("n"), handle.includes("s"), cell[1], origin.z0, origin.z1, md,
      limit && [limit.z0, limit.z1]);
    const spanX = rowSpan(mw, alongX.count);
    const spanZ = rowSpan(md, alongZ.count);
    pad.x0 = stretchedStart(alongX, spanX);
    pad.z0 = stretchedStart(alongZ, spanZ);
    pad.x1 = pad.x0 + spanX - 1;
    pad.z1 = pad.z0 + spanZ - 1;
    writeModules(pad, alongX.count, alongZ.count);
  }

  // ---- turning and retyping ----

  /** Swap a row's module counts and the axis its ranks flip along, for a quarter turn. */
  function turnModules(pad) {
    if (!((pad.wx || 1) > 1 || (pad.wz || 1) > 1 || pad.flip)) return;
    const wx = pad.wz || 1;
    const wz = pad.wx || 1;
    const flip = pad.flip === "x" ? "z" : pad.flip === "z" ? "x" : "";
    writeCount(pad, "wx", wx);
    writeCount(pad, "wz", wz);
    if (flip) pad.flip = flip;
    else delete pad.flip;
  }

  /** Turn a multiblock a quarter clockwise about its middle: the footprint and the controller face. */
  function turnPad(pad) {
    const w = pad.x1 - pad.x0 + 1;
    const d = pad.z1 - pad.z0 + 1;
    const x0 = pad.x0 + Math.trunc((w - d) / 2);
    const z0 = pad.z0 + Math.trunc((d - w) / 2);
    Object.assign(pad, { x0, x1: x0 + d - 1, z0, z1: z0 + w - 1, front: TURN[pad.front] });
    turnModules(pad);
    rehangDoor(pad);
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
    if (specOf(catalog, key).shell) pad.door = frontCell(pad);
    else delete pad.door;
    delete pad.h;
    delete pad.wx;
    delete pad.wz;
    delete pad.flip;
    delete pad.share;
  }

  Object.assign(Core, {
    nextPadNum, frontCell, padSize, setPadBox, placePad, setPadFront, padBlocks,
    moduleSize, moduleCounts, moduleList, rowSpan, setModules, stretchModules,
    turnPad, laid, retypePad,
  });
})(typeof window !== "undefined" ? window : globalThis);
