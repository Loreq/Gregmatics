/* Painting the zones of a floor: rooms, streets, doors, stairs, shafts, lifts, and trenches, their
   names, and the outlines of the floors above and below. */
(function (App) {
  "use strict";

  const { Core, CRAWL, COLORS, state, L, cellBox, View, Paint } = App;

  const SOFT_EDGE = "rgba(40, 44, 50, 0.45)";
  const CELL_GRID = "rgba(0, 0, 0, 0.16)";
  const MARK_FILL = "#FFFDF8";
  const SHAFT_HATCH = "rgba(90, 150, 190, 0.45)";
  const SHAFT_EDGE = "#5A96BE";
  const STAIR_TREAD = "rgba(150, 132, 104, 0.6)";
  const STAIR_EDGE = "rgba(40, 44, 50, 0.6)";
  // How see-through the floors above and below are drawn, and their dashes.
  const GHOST_ALPHA = 0.55;
  const GHOST_DASH = [5, 4];

  // ---- fills and edges ----

  /** The color a zone is filled with: a room's own, else the plan's color for its kind. */
  function zoneFill(kind, z) {
    const pal = L().palette;
    if (kind === "rooms") return z.color;
    if (kind === "streets") return pal[z.style === "entry" ? "entry" : "corridor"];
    return { doors: pal.door, stairs: pal.stair, shafts: pal.well, trenches: pal.trench, marks: MARK_FILL }[kind] || pal.corridor;
  }

  /** Runs of cells along an edge where `exposed` holds, as [first, last]. */
  function edgeRuns(n, exposed) {
    const out = [];
    let start = null;
    for (let i = 0; i <= n; i += 1) {
      const on = i < n && exposed(i);
      if (on && start === null) start = i;
      if (!on && start !== null) {
        out.push([start, i - 1]);
        start = null;
      }
    }
    return out;
  }

  /** Whether no other street on the same floor covers a cell, so this street's edge shows there. */
  function streetEnds(street, x, z) {
    return !L().streets.some((other) => other !== street && other.floor === street.floor
      && x >= other.x0 && x <= other.x1 && z >= other.z0 && z <= other.z1);
  }

  /** Add a street's four edges to the current path, leaving out where another street carries on. */
  function traceStreetEdges(g, street, v) {
    const depth = street.z1 - street.z0 + 1;
    const width = street.x1 - street.x0 + 1;
    const { blockX, blockY } = View;
    for (const [a, b] of edgeRuns(depth, (i) => streetEnds(street, street.x0 - 1, street.z0 + i))) {
      const x = blockX(street.x0, v) + 0.5;
      g.moveTo(x, blockY(street.z0 + a, v));
      g.lineTo(x, blockY(street.z0 + b + 1, v));
    }
    for (const [a, b] of edgeRuns(depth, (i) => streetEnds(street, street.x1 + 1, street.z0 + i))) {
      const x = blockX(street.x1 + 1, v) - 0.5;
      g.moveTo(x, blockY(street.z0 + a, v));
      g.lineTo(x, blockY(street.z0 + b + 1, v));
    }
    for (const [a, b] of edgeRuns(width, (i) => streetEnds(street, street.x0 + i, street.z0 - 1))) {
      const y = blockY(street.z0, v) + 0.5;
      g.moveTo(blockX(street.x0 + a, v), y);
      g.lineTo(blockX(street.x0 + b + 1, v), y);
    }
    for (const [a, b] of edgeRuns(width, (i) => streetEnds(street, street.x0 + i, street.z1 + 1))) {
      const y = blockY(street.z1 + 1, v) - 0.5;
      g.moveTo(blockX(street.x0 + a, v), y);
      g.lineTo(blockX(street.x0 + b + 1, v), y);
    }
  }

  /** A street's outline stops where another street on the same floor continues, so a crossing stays open. */
  function streetEdges(g, street, v, style) {
    g.save();
    g.beginPath();
    g.lineCap = "butt";
    g.setLineDash(style && style.dash ? style.dash : []);
    g.strokeStyle = style ? style.strokeStyle : SOFT_EDGE;
    g.lineWidth = style ? style.lineWidth : 1;
    traceStreetEdges(g, street, v);
    g.stroke();
    g.restore();
  }

  // ---- one zone ----

  /** A lift: a dark cell with an arrow up and an arrow down. */
  function paintLift(g, r, sc) {
    const pad = Math.max(1, sc * 0.15);
    g.fillStyle = COLORS.INK;
    g.fillRect(r.x - pad, r.y - pad, r.w + pad * 2, r.h + pad * 2);
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    const k = Math.max(2, sc * 0.3);
    g.fillStyle = COLORS.PAPER;
    Paint.triangle(g, cx, cy - k - 1, cx - k, cy - 1, cx + k, cy - 1);
    Paint.triangle(g, cx, cy + k + 1, cx - k, cy + 1, cx + k, cy + 1);
  }

  /** A shaft's hatching and its blue edge. */
  function paintShaft(g, r) {
    g.save();
    g.beginPath();
    g.rect(r.x, r.y, r.w, r.h);
    g.clip();
    g.strokeStyle = SHAFT_HATCH;
    g.lineWidth = 1;
    for (let k = -r.h; k < r.w; k += 8) Paint.line(g, r.x + k, r.y + r.h, r.x + k + r.h, r.y);
    g.restore();
    g.strokeStyle = SHAFT_EDGE;
    g.lineWidth = 2;
    g.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
  }

  /** A stair's treads, across the way it climbs. */
  function paintTreads(g, r, sc, alongZ) {
    const step = Math.max(3, sc / 2);
    g.strokeStyle = STAIR_TREAD;
    g.lineWidth = 1;
    if (alongZ) for (let y = r.y + step; y < r.y + r.h; y += step) Paint.line(g, r.x, y, r.x + r.w, y);
    else for (let x = r.x + step; x < r.x + r.w; x += step) Paint.line(g, x, r.y, x, r.y + r.h);
    g.strokeStyle = STAIR_EDGE;
    g.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
  }

  /** A stair's arrow, from where you step on to where you step off on this floor, and UP or DOWN beside it. */
  function paintStairArrow(g, stair, r, sc, alongZ) {
    const going = state.layer === stair.floors[0] ? "UP" : "DOWN";
    const dir = Core.STEP[stair.low];
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    const span = (alongZ ? r.h : r.w) * 0.36;
    const low = [cx + dir[0] * span, cy + dir[1] * span];
    const high = [cx - dir[0] * span, cy - dir[1] * span];
    const [from, to] = going === "UP" ? [low, high] : [high, low];
    g.strokeStyle = COLORS.INK;
    g.fillStyle = COLORS.INK;
    g.lineWidth = 2;
    Paint.line(g, from[0], from[1], to[0], to[1]);
    const ax = Math.sign(to[0] - from[0]);
    const ay = Math.sign(to[1] - from[1]);
    const k = Math.max(4, sc * 0.6);
    Paint.triangle(g, to[0] + ax * 2, to[1] + ay * 2, to[0] - ax * k - ay * k * 0.7, to[1] - ay * k - ax * k * 0.7,
      to[0] - ax * k + ay * k * 0.7, to[1] - ay * k + ax * k * 0.7);
    if (sc < 4) return;
    Paint.setFont(g, Math.max(9, Math.min(13, sc * 1.4)), true);
    g.textAlign = "center";
    g.textBaseline = "middle";
    Paint.halo(g, going, from[0], from[1]);
  }

  /** A stair: its treads and its arrow. */
  function paintStair(g, stair, r, sc) {
    const alongZ = stair.low === "n" || stair.low === "s";
    paintTreads(g, r, sc, alongZ);
    paintStairArrow(g, stair, r, sc, alongZ);
  }

  /** One zone: its fill, and the edge its kind has. */
  function zone(g, v, item) {
    const { kind, z } = item;
    const sc = v.scale;
    const r = View.rectOf(Core.boxOf(kind, z), v);
    if (kind === "lifts") {
      paintLift(g, r, sc);
      return;
    }
    g.fillStyle = zoneFill(kind, z);
    g.fillRect(r.x, r.y, r.w, r.h);
    if (kind === "streets") {
      streetEdges(g, z, v);
      return;
    }
    if (kind === "shafts") {
      paintShaft(g, r);
      return;
    }
    if (kind === "stairs") paintStair(g, z, r, sc);
    g.lineWidth = kind === "rooms" ? 1.5 : 1;
    g.strokeStyle = kind === "rooms" ? COLORS.WALL : SOFT_EDGE;
    g.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
  }

  // ---- the block grid ----

  /**
   * Add the lines between the blocks of a box to the current path. `edge` is where the lines end,
   * in pixels: { left, right, top, bottom }.
   */
  function traceGrid(g, v, box, edge) {
    for (let x = box.x0 + 1; x <= box.x1; x += 1) {
      const px = View.blockX(x, v) + 0.5;
      g.moveTo(px, edge.top);
      g.lineTo(px, edge.bottom);
    }
    for (let z = box.z0 + 1; z <= box.z1; z += 1) {
      const py = View.blockY(z, v) + 0.5;
      g.moveTo(edge.left, py);
      g.lineTo(edge.right, py);
    }
  }

  /** The pixel edges of a box of blocks, with no least size. */
  function blockEdges(box, v) {
    return {
      left: View.blockX(box.x0, v), right: View.blockX(box.x1 + 1, v),
      top: View.blockY(box.z0, v), bottom: View.blockY(box.z1 + 1, v),
    };
  }

  /** A faint grid of blocks over every zone but the lifts. */
  function cellGrid(g, v, items) {
    g.strokeStyle = CELL_GRID;
    g.lineWidth = 1;
    g.beginPath();
    for (const item of items) {
      if (item.kind === "lifts") continue;
      const box = Core.boxOf(item.kind, item.z);
      traceGrid(g, v, box, blockEdges(box, v));
    }
    g.stroke();
  }

  // ---- names ----

  /** A room's name at its label cell, or its code when the name is too wide, and its height when that is its own. */
  function roomLabel(g, v, z) {
    const sc = v.scale;
    const at = Array.isArray(z.label_at) ? z.label_at : [(z.x0 + z.x1) >> 1, (z.z0 + z.z1) >> 1];
    const room = View.rectOf(z, v);
    const cell = View.rectOf(cellBox(at[0], at[1]), v);
    const size = Math.max(10, Math.min(15, sc * 1.6));
    Paint.setFont(g, size, true);
    g.textAlign = "center";
    g.textBaseline = "middle";
    let text = z.name;
    if (g.measureText(text).width > room.w - 8) text = z.code;
    if (g.measureText(text).width > room.w - 4 || room.h < size) return;
    const half = g.measureText(text).width / 2;
    const cx = Math.min(Math.max(cell.x + cell.w / 2, room.x + half + 4), room.x + room.w - half - 4);
    Paint.halo(g, text, cx, cell.y + cell.h / 2);
    const floor = Core.floorById(L(), z.floor);
    if (!(z.height && floor && z.height !== Core.floorHeight(floor) && sc >= 4)) return;
    Paint.setFont(g, Math.max(9, size - 3), false);
    const tag = `${z.height} high`;
    if (g.measureText(tag).width < room.w - 6) Paint.halo(g, tag, cx, cell.y + cell.h / 2 + size, COLORS.MUTED);
  }

  /** A street's name at its label cell, along the street or turned on its side. */
  function streetLabel(g, v, z) {
    const at = Array.isArray(z.label_at) ? z.label_at : [z.x0 + 1, (z.z0 + z.z1) >> 1];
    const r = View.rectOf(cellBox(at[0], at[1]), v);
    if (z.label_vertical) Paint.painted(g, z.label, r.x + r.w / 2, r.y + r.h / 2, true, v.scale);
    else Paint.painted(g, z.label, r.x, r.y + r.h / 2, false, v.scale, "left");
  }

  /** The name of a zone, for the kinds that show one on the plan. */
  function label(g, v, item) {
    if (item.kind === "rooms") roomLabel(g, v, item.z);
    else if (item.kind === "streets" && item.z.label) streetLabel(g, v, item.z);
  }

  // ---- the floors above and below ----

  /** The floors whose outlines show through: the ones right above and below, or the floor over the crawl. */
  function nearFloors() {
    const layout = L();
    if (state.layer === CRAWL) return [layout.site.crawl.under];
    const floors = layout.floors.slice().sort((a, b) => a.slab - b.slab).map((f) => f.id);
    const i = floors.indexOf(state.layer);
    return [floors[i - 1], floors[i + 1]].filter(Boolean);
  }

  /** One floor as a ghost: dashed outlines of its rooms and streets. From the crawl, its trenches show filled. */
  function ghostFloor(g, v, id) {
    const layout = L();
    const ink = Paint.hexAlpha(Core.floorById(layout, id).pen || COLORS.WALL, GHOST_ALPHA);
    g.strokeStyle = ink;
    g.setLineDash(GHOST_DASH);
    for (const z of layout.rooms) {
      if (z.floor !== id) continue;
      const r = View.rectOf(z, v);
      g.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
    }
    for (const z of layout.streets) {
      if (z.floor !== id) continue;
      if (state.layer === CRAWL && z.trench !== false) {
        const r = View.rectOf(z, v);
        g.fillStyle = Paint.hexAlpha(layout.palette.trench, GHOST_ALPHA);
        g.fillRect(r.x, r.y, r.w, r.h);
      }
      streetEdges(g, z, v, { strokeStyle: ink, lineWidth: 1.5, dash: GHOST_DASH });
    }
    g.setLineDash([]);
  }

  /** Outlines of the floors right above and below, so stairs, lifts, and shafts can line up. */
  function ghosts(g, v) {
    g.lineWidth = 1.5;
    for (const id of nearFloors()) ghostFloor(g, v, id);
  }

  Object.assign(App.PaintZones, { zoneFill, traceGrid, zone, cellGrid, label, ghosts });
})(window.App);
