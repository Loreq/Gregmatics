/* Painting the zones of a floor: rooms, streets, doors, stairs, shafts, lifts, and trenches, their
   names, and the outlines of the floors above and below. */
(function (App) {
  "use strict";

  const { Core, COLORS, state, L, cellBox, View, Paint } = App;

  const SOFT_EDGE = "rgba(40, 44, 50, 0.45)";
  // A street's own edge is the wall ink, lighter than a room wall, still visible on the street fill.
  const STREET_ALPHA = 0.7;
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

  /** Whether a door on this floor covers a cell. A door is an opening, so the wall stops there. */
  function doorAt(floor, x, z) {
    return L().doors.some((door) => door.floor === floor && Core.inside(door, x, z));
  }

  /** Whether this room draws the wall beside one of its cells. The west and north rooms own a shared line. */
  function roomWall(room, side, along) {
    const across = side === "w" || side === "e";
    const x = across ? (side === "w" ? room.x0 : room.x1) : along;
    const z = across ? along : (side === "n" ? room.z0 : room.z1);
    const nx = side === "w" ? x - 1 : side === "e" ? x + 1 : x;
    const nz = side === "n" ? z - 1 : side === "s" ? z + 1 : z;
    if (doorAt(room.floor, nx, nz)) return false;
    if ((side === "w" || side === "n") && Core.roomAt(L(), room.floor, nx, nz)) return false;
    return true;
  }

  /** Whether a street draws its edge beside a cell. It stops for another street, a room, or a door. */
  function streetExposed(street, x, z) {
    if (!streetEnds(street, x, z)) return false;
    if (Core.roomAt(L(), street.floor, x, z)) return false;
    return !doorAt(street.floor, x, z);
  }

  /** Add runs of one boundary. East and south use the owner's last pixel. West and north use the first. */
  function traceBoundary(g, v, vertical, at, origin, runs, lastPixel) {
    const nudge = lastPixel ? -0.5 : 0.5;
    for (const [a, b] of runs) {
      if (vertical) {
        const x = View.blockX(at, v) + nudge;
        g.moveTo(x, View.blockY(origin + a, v));
        g.lineTo(x, View.blockY(origin + b + 1, v));
      } else {
        const y = View.blockY(at, v) + nudge;
        g.moveTo(View.blockX(origin + a, v), y);
        g.lineTo(View.blockX(origin + b + 1, v), y);
      }
    }
  }

  /** Add one room's walls. A shared edge is drawn once, and a door is left open. */
  function traceRoomWalls(g, v, room) {
    const depth = room.z1 - room.z0 + 1;
    const width = room.x1 - room.x0 + 1;
    traceBoundary(g, v, true, room.x0, room.z0, edgeRuns(depth, (i) => roomWall(room, "w", room.z0 + i)), false);
    traceBoundary(g, v, true, room.x1 + 1, room.z0, edgeRuns(depth, (i) => roomWall(room, "e", room.z0 + i)), true);
    traceBoundary(g, v, false, room.z0, room.x0, edgeRuns(width, (i) => roomWall(room, "n", room.x0 + i)), false);
    traceBoundary(g, v, false, room.z1 + 1, room.x0, edgeRuns(width, (i) => roomWall(room, "s", room.x0 + i)), true);
  }

  /** A street's own edge, in the wall ink and lighter than a room wall. A room draws the line it shares. */
  function paintStreetWall(g, v, street) {
    const depth = street.z1 - street.z0 + 1;
    const width = street.x1 - street.x0 + 1;
    g.save();
    g.beginPath();
    g.lineCap = "butt";
    g.setLineDash([]);
    g.strokeStyle = Paint.hexAlpha(COLORS.WALL, STREET_ALPHA);
    g.lineWidth = 1;
    const west = edgeRuns(depth, (i) => streetExposed(street, street.x0 - 1, street.z0 + i));
    const east = edgeRuns(depth, (i) => streetExposed(street, street.x1 + 1, street.z0 + i));
    const north = edgeRuns(width, (i) => streetExposed(street, street.x0 + i, street.z0 - 1));
    const south = edgeRuns(width, (i) => streetExposed(street, street.x0 + i, street.z1 + 1));
    traceBoundary(g, v, true, street.x0, street.z0, west, false);
    traceBoundary(g, v, true, street.x1 + 1, street.z0, east, true);
    traceBoundary(g, v, false, street.z0, street.x0, north, false);
    traceBoundary(g, v, false, street.z1 + 1, street.x0, south, true);
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

  /** The two jambs of a door. The long sides stay open, so the wall reads as a break. */
  function paintDoorJambs(g, door, r) {
    const alongX = door.x1 - door.x0 >= door.z1 - door.z0;
    g.strokeStyle = SOFT_EDGE;
    g.lineWidth = 1;
    g.lineCap = "butt";
    g.setLineDash([]);
    g.beginPath();
    if (alongX) {
      g.moveTo(r.x + 0.5, r.y);
      g.lineTo(r.x + 0.5, r.y + r.h);
      g.moveTo(r.x + r.w - 0.5, r.y);
      g.lineTo(r.x + r.w - 0.5, r.y + r.h);
    } else {
      g.moveTo(r.x, r.y + 0.5);
      g.lineTo(r.x + r.w, r.y + 0.5);
      g.moveTo(r.x, r.y + r.h - 0.5);
      g.lineTo(r.x + r.w, r.y + r.h - 0.5);
    }
    g.stroke();
  }

  /** One zone that is not a room or a street: its fill, and the edge its kind has. */
  function zone(g, v, item) {
    const { kind, z } = item;
    const r = View.rectOf(Core.boxOf(kind, z), v);
    if (kind === "lifts") {
      paintLift(g, r, v.scale);
      return;
    }
    if (kind === "rooms" || kind === "streets") return;
    g.fillStyle = zoneFill(kind, z);
    g.fillRect(r.x, r.y, r.w, r.h);
    if (kind === "doors") {
      paintDoorJambs(g, z, r);
      return;
    }
    if (kind === "shafts") {
      paintShaft(g, r);
      return;
    }
    if (kind === "stairs") paintStair(g, z, r, v.scale);
    g.lineWidth = 1;
    g.strokeStyle = SOFT_EDGE;
    g.setLineDash([]);
    g.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
  }

  /** The room and street floors, edge to edge, before the grids and the walls. */
  function fills(g, v, items) {
    for (const item of items) {
      if (item.kind !== "rooms" && item.kind !== "streets") continue;
      const r = View.rectOf(Core.boxOf(item.kind, item.z), v);
      g.fillStyle = zoneFill(item.kind, item.z);
      g.fillRect(r.x, r.y, r.w, r.h);
    }
  }

  /** Room walls, then the lighter street edges. Both sit on top of the grids. */
  function walls(g, v, items) {
    g.save();
    g.lineCap = "butt";
    g.setLineDash([]);
    g.lineWidth = Paint.wallWidth(v.scale);
    g.strokeStyle = COLORS.WALL;
    g.beginPath();
    for (const item of items) if (item.kind === "rooms") traceRoomWalls(g, v, item.z);
    g.stroke();
    g.restore();
    for (const item of items) if (item.kind === "streets") paintStreetWall(g, v, item.z);
  }

  /** Doors, stairs, shafts, lifts, and trenches, drawn over the grid so they stay clean. */
  function details(g, v, items) {
    for (const item of items) {
      if (item.kind === "rooms" || item.kind === "streets") continue;
      zone(g, v, item);
    }
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

  /** A faint grid of blocks over room floors and street floors. */
  function cellGrid(g, v, items) {
    g.strokeStyle = Paint.cellInk();
    g.lineWidth = 1;
    g.lineCap = "butt";
    g.setLineDash([]);
    g.beginPath();
    for (const item of items) {
      if (item.kind !== "rooms" && item.kind !== "streets") continue;
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
    const size = Paint.labelSize(sc);
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

  /** A center pulled back so a label of this half-width stays inside a span. */
  function clampSpan(center, start, span, half) {
    const lo = start + half + 2;
    const hi = start + span - half - 2;
    if (lo > hi) return start + span / 2;
    return Math.min(Math.max(center, lo), hi);
  }

  /** A street's name, centered on its short side and on its label cell along its long side. */
  function streetLabel(g, v, z) {
    const street = View.rectOf(z, v);
    const at = Array.isArray(z.label_at) ? z.label_at : [z.x0 + 1, (z.z0 + z.z1) >> 1];
    const cell = View.rectOf(cellBox(at[0], at[1]), v);
    const vertical = Boolean(z.label_vertical);
    const along = vertical ? street.h : street.w;
    const across = vertical ? street.w : street.h;
    const size = Paint.fitLabel(g, z.label, Math.max(0, along - 4), v.scale, Math.max(0, across - 2));
    if (!size) return;
    const half = g.measureText(z.label).width / 2;
    g.save();
    g.textAlign = "center";
    g.textBaseline = "middle";
    if (vertical) {
      g.translate(street.x + street.w / 2, clampSpan(cell.y + cell.h / 2, street.y, street.h, half));
      g.rotate(-Math.PI / 2);
      Paint.halo(g, z.label, 0, 0);
    } else {
      Paint.halo(g, z.label, clampSpan(cell.x + cell.w / 2, street.x, street.w, half), street.y + street.h / 2);
    }
    g.restore();
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
    if (Core.isCrawlLayer(layout, state.layer)) {
      const crawl = Core.crawlByLayer(layout, state.layer);
      return crawl ? [crawl.under] : [];
    }
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
      if (Core.isCrawlLayer(layout, state.layer) && z.trench !== false) {
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

  Object.assign(App.PaintZones, {
    zoneFill, traceGrid, cellGrid, label, ghosts, fills, walls, details,
  });
})(window.App);
