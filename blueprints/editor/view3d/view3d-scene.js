/* The plan as a 3D scene. Scene3D.build() walks the plan once and returns the triangles and outlines
   to draw, plus what the view needs beside them: a box for everything the pointer can name, the room
   and street names to paint over the picture, the floor tops that can hide a name, and the scene's size. */
(function (root) {
  "use strict";

  const Core = root.Core;
  const { INK, hex, shade, Triangles, Outlines } = root.Mesh3D;

  // How thick a floor slab is drawn.
  const SLAB = 0.16;
  const DEFAULT_HEIGHT = 5;
  // A shaft's glass ends this far above the highest thing in the plan, so every shaft has the same level top.
  const SHAFT_RISE = 32;
  // The four neighbors of a cell, as [dx, dz, the side they are on].
  const DIRS = [[1, 0, "e"], [-1, 0, "w"], [0, 1, "s"], [0, -1, "n"]];
  const UNKNOWN_COLOR = "#888888";
  const LIFT_COLOR = "#8a8680";
  // How tall a single-block machine is drawn.
  const MACHINE_TOP = 0.72;

  // ---- small helpers ----

  /** The Y a person stands at on a floor. */
  function floorWalk(floor) {
    return floor.slab + 1;
  }

  /** The Y of a floor's ceiling. */
  function floorCeil(floor) {
    return floor.slab + 1 + (floor.height || DEFAULT_HEIGHT);
  }

  /** One number for a cell, for sets and maps. */
  function keyOf(x, z) {
    return x * 4096 + z;
  }

  /** Call fn(x, z) for every cell of a box. */
  function eachCell(x0, x1, z0, z1, fn) {
    for (let x = x0; x <= x1; x += 1) {
      for (let z = z0; z <= z1; z += 1) fn(x, z);
    }
  }

  /** An id as a name: underscores become spaces. */
  function pretty(id) {
    return String(id || "").replace(/_/g, " ");
  }

  /** Note that a rock cell stands beside a room from y0 to y1. A cell beside two rooms spans both. */
  function touch(map, x, z, y0, y1) {
    const k = keyOf(x, z);
    const hit = map.get(k);
    if (!hit) map.set(k, { x, z, y0, y1 });
    else {
      hit.y0 = Math.min(hit.y0, y0);
      hit.y1 = Math.max(hit.y1, y1);
    }
  }

  /** Runs of cells along an edge whose outside neighbor is not another street, as [a, b). */
  function exposedRuns(n, exposed) {
    const out = [];
    let start = null;
    for (let i = 0; i <= n; i += 1) {
      const on = i < n && exposed(i);
      if (on && start === null) start = i;
      if (!on && start !== null) {
        out.push([start, i]);
        start = null;
      }
    }
    return out;
  }

  /** Runs of a shell's wall from a to b, both ends inside, broken where the door is. */
  function wallRuns(a, b, fixed, alongX, door) {
    const out = [];
    let start = null;
    for (let i = a; i <= b; i += 1) {
      const x = alongX ? i : fixed;
      const z = alongX ? fixed : i;
      const skip = door && door[0] === x && door[1] === z;
      if (skip) {
        if (start !== null) out.push([start, i - 1]);
        start = null;
      } else if (start === null) start = i;
    }
    if (start !== null) out.push([start, b]);
    return out;
  }

  /** The point the scene is measured from: the middle of the site, halfway up the floors. */
  function sceneOrigin(layout) {
    const sq = layout.site.square;
    const lows = layout.floors.map((f) => floorWalk(f));
    const highs = layout.floors.map((f) => floorCeil(f));
    return [(sq.x0 + sq.x1 + 1) / 2, (Math.min(...lows) + Math.max(...highs)) / 2, (sq.z0 + sq.z1 + 1) / 2];
  }

  // ---- the builder ----

  /** Builds one scene. `visible(id)` says whether a floor or the crawl is shown; `padColor(spec)` fills a multiblock. */
  class SceneBuilder {
    constructor(layout, catalog, visible, padColor) {
      this.layout = layout;
      this.catalog = catalog;
      this.visible = visible;
      this.padColor = padColor;
      this.picks = [];
      this.labels = [];
      this.slabs = [];
      this.bounds = { min: [1e9, 1e9, 1e9], max: [-1e9, -1e9, -1e9] };
      this.pal = layout.palette;
      this.origin = sceneOrigin(layout);
      this.solid = new Triangles(this.origin);
      this.glass = new Triangles(this.origin);
      this.lines = new Outlines();
      this.rock = hex(this.pal.rock, 1);
    }

    // ---- lookups ----

    /** The floor with this id, or null. */
    floorOf(id) {
      return this.layout.floors.find((f) => f.id === id) || null;
    }

    /** The room with this id, or null. */
    roomOf(id) {
      return this.layout.rooms.find((r) => r.id === id) || null;
    }

    /** A room's air as [floor Y, ceiling Y], or null when its floor is gone. A room may be taller than its floor. */
    roomSpan(room) {
      const floor = this.floorOf(room.floor);
      if (!floor) return null;
      const y0 = floorWalk(floor);
      return [y0, y0 + (room.height || floor.height || DEFAULT_HEIGHT)];
    }

    /** Whether any of these floors is shown. */
    anyVisible(ids) {
      return ids.some((id) => this.visible(id));
    }

    /** The room a multiblock, row, mark, or shaft is in and that room's air, when its floor is shown. */
    shownRoom(roomId) {
      const room = this.roomOf(roomId);
      if (!room || !this.visible(room.floor)) return null;
      const span = this.roomSpan(room);
      return span ? { room, span } : null;
    }

    // ---- what the view keeps beside the triangles ----

    /** Stretch the scene's size to take in a box. */
    grow(x0, y0, z0, x1, y1, z1) {
      const { min, max } = this.bounds;
      min[0] = Math.min(min[0], x0);
      min[1] = Math.min(min[1], y0);
      min[2] = Math.min(min[2], z0);
      max[0] = Math.max(max[0], x1);
      max[1] = Math.max(max[1], y1);
      max[2] = Math.max(max[2], z1);
    }

    /** Give the pointer something to name. An open box is hit on its floor, not its missing lid. */
    watch(name, x0, y0, z0, x1, y1, z1, open, color) {
      const o = this.origin;
      this.picks.push({
        name,
        open: Boolean(open),
        color: color || INK,
        min: [x0 - o[0], y0 - o[1], z0 - o[2]],
        max: [x1 - o[0], y1 - o[1], z1 - o[2]],
        box: [x0, y0, z0, x1, y1, z1],
      });
    }

    // ---- rooms and the rock around them ----

    /** Cells of shafts on shown floors: a room open to the sky gets no roof there. */
    findShaftCells() {
      const cells = new Set();
      for (const shaft of this.layout.shafts) {
        const home = this.roomOf(shaft.room);
        if (!home || !this.visible(home.floor)) continue;
        eachCell(shaft.x0, shaft.x1, shaft.z0, shaft.z1, (x, z) => cells.add(keyOf(x, z)));
      }
      return cells;
    }

    /** Every cell a floor has dug: rooms, streets, doors, and the stairs that reach it. */
    dugCells(floor, rooms) {
      const dug = new Set();
      const dig = (box) => eachCell(box.x0, box.x1, box.z0, box.z1, (x, z) => dug.add(keyOf(x, z)));
      for (const room of rooms) dig(room);
      for (const street of this.layout.streets) if (street.floor === floor.id) dig(street);
      for (const door of this.layout.doors) if (door.floor === floor.id) dig(door);
      for (const stair of this.layout.stairs) if (stair.floors.includes(floor.id)) dig(stair);
      return dug;
    }

    /** Note the rock a room's walls are made of: every undug cell beside it or at one of its corners. */
    touchWalls(room, span, dug, walls) {
      const inside = (x, z) => x >= room.x0 && x <= room.x1 && z >= room.z0 && z <= room.z1;
      const rock = (x, z) => {
        if (!dug.has(keyOf(x, z))) touch(walls, x, z, span[0], span[1]);
      };
      eachCell(room.x0, room.x1, room.z0, room.z1, (x, z) => {
        for (const [dx, dz] of DIRS) {
          if (!inside(x + dx, z + dz)) rock(x + dx, z + dz);
        }
        const north = !inside(x, z - 1);
        const south = !inside(x, z + 1);
        const east = !inside(x + 1, z);
        const west = !inside(x - 1, z);
        if (north && west) rock(x - 1, z - 1);
        if (north && east) rock(x + 1, z - 1);
        if (south && west) rock(x - 1, z + 1);
        if (south && east) rock(x + 1, z + 1);
      });
    }

    /** Remember where a room's name goes. */
    labelRoom(room, span) {
      const at = Array.isArray(room.label_at) ? room.label_at : [(room.x0 + room.x1) >> 1, (room.z0 + room.z1) >> 1];
      this.labels.push({
        kind: "room", name: room.name, code: room.code,
        x: at[0] + 0.5, y: span[0] + SLAB + 0.45, z: at[1] + 0.5,
        x0: room.x0, z0: room.z0, x1: room.x1 + 1, z1: room.z1 + 1,
      });
    }

    /** Roof a room that stands at grade: glass, or a thin lid of rock. Shafts stay open. */
    roofRoom(room, span, shaftCells) {
      eachCell(room.x0, room.x1, room.z0, room.z1, (x, z) => {
        if (shaftCells.has(keyOf(x, z))) return;
        if (room.roof === "glass") {
          this.glass.topFace(hex(this.pal.well, 0.4), x, z, x + 1, z + 1, span[1] + 0.04);
        } else {
          this.solid.box(x, span[1], z, x + 1, span[1] + 0.18, z + 1, shade(this.rock, 0.9));
        }
      });
    }

    /** One room: its floor slab, its name, its roof, and notes of the rock around it and the color it shows that rock. */
    buildRoom(room, dug, walls, tints, shaftCells) {
      const span = this.roomSpan(room);
      if (!span) return;
      const color = hex(room.color, 1);
      eachCell(room.x0, room.x1, room.z0, room.z1, (x, z) => tints.set(keyOf(x, z), color));
      this.touchWalls(room, span, dug, walls);
      this.solid.box(room.x0, span[0], room.z0, room.x1 + 1, span[0] + SLAB, room.z1 + 1, color);
      this.slabs.push({ y: span[0] + SLAB, x0: room.x0, z0: room.z0, x1: room.x1 + 1, z1: room.z1 + 1 });
      this.grow(room.x0, span[0], room.z0, room.x1 + 1, span[1], room.z1 + 1);
      this.watch(room.name, room.x0, span[0], room.z0, room.x1 + 1, span[1], room.z1 + 1, true, color);
      this.labelRoom(room, span);
      if (room.grade) this.roofRoom(room, span, shaftCells);
    }

    /** The rock walls of a floor: a top on each block, and a side wherever no other wall block stands. */
    buildWalls(walls, tints) {
      for (const wall of walls.values()) {
        const y0 = wall.y0 + SLAB;
        const y1 = wall.y1;
        if (y1 - y0 < 0.2) continue;
        this.solid.topFace(this.rock, wall.x, wall.z, wall.x + 1, wall.z + 1, y1);
        this.lines.noteTop(wall.x, wall.z, wall.x + 1, wall.z + 1, y1);
        for (const [dx, dz, dir] of DIRS) {
          const nk = keyOf(wall.x + dx, wall.z + dz);
          if (walls.has(nk)) continue;
          // A side that looks into a room takes the room's color.
          this.solid.wallSide(tints.get(nk) || this.rock, wall.x, wall.z, dir, y0, y1);
          this.lines.noteSide(wall.x, wall.z, dir, y0, y1);
        }
      }
    }

    /** How high a doorway reaches: the ceiling of the tallest room it touches. */
    doorTop(door, floor, rooms) {
      let top = floorCeil(floor);
      for (const room of rooms) {
        const span = this.roomSpan(room);
        if (!span) continue;
        const near = door.x1 >= room.x0 - 1 && door.x0 <= room.x1 + 1
          && door.z1 >= room.z0 - 1 && door.z0 <= room.z1 + 1;
        if (near) top = Math.max(top, span[1]);
      }
      return top;
    }

    /** The doors of a floor: a threshold slab and a lintel overhead. */
    buildDoors(floor, rooms) {
      for (const door of this.layout.doors) {
        if (door.floor !== floor.id) continue;
        const top = this.doorTop(door, floor, rooms);
        const y0 = floorWalk(floor);
        const head = Math.min(0.45, Math.max(0.2, (top - y0) * 0.15));
        const head0 = Math.max(y0 + SLAB, top - head);
        const color = hex(this.pal.door, 1);
        this.solid.box(door.x0, y0, door.z0, door.x1 + 1, y0 + SLAB, door.z1 + 1, color);
        this.solid.box(door.x0, head0, door.z0, door.x1 + 1, top, door.z1 + 1, shade(color, 0.75));
        this.lines.wireBox(door.x0, y0, door.z0, door.x1 + 1, y0 + SLAB, door.z1 + 1, INK);
        this.lines.wireBox(door.x0, head0, door.z0, door.x1 + 1, top, door.z1 + 1, INK);
        this.watch(pretty(door.id), door.x0, y0, door.z0, door.x1 + 1, top, door.z1 + 1, false, color);
      }
    }

    /** One shown floor: its rooms, the rock between them, and its doors. */
    buildFloor(floor, shaftCells) {
      const rooms = this.layout.rooms.filter((r) => r.floor === floor.id);
      const dug = this.dugCells(floor, rooms);
      const walls = new Map();
      const tints = new Map();
      for (const room of rooms) this.buildRoom(room, dug, walls, tints, shaftCells);
      this.buildWalls(walls, tints);
      this.buildDoors(floor, rooms);
    }

    // ---- streets ----

    /** Whether another street on the same floor covers a cell, so this street's edge is open there. */
    streetContinues(street, x, z) {
      return this.layout.streets.some((other) => other !== street && other.floor === street.floor
        && x >= other.x0 && x <= other.x1 && z >= other.z0 && z <= other.z1);
    }

    /** One run of a street's edge from p to q, as [x, z]: the slab's lip and its outline. `flip` faces the lip the other way. */
    streetLip(p, q, y0, y1, color, flip) {
      const [a, b] = flip ? [q, p] : [p, q];
      this.solid.quad(color, [a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], y1, b[1]], [a[0], y1, a[1]]);
      this.lines.seg(p[0], y1, p[1], q[0], y1, q[1], INK);
      this.lines.seg(p[0], y0, p[1], q[0], y0, q[1], INK);
      this.lines.seg(p[0], y0, p[1], p[0], y1, p[1], INK);
      this.lines.seg(q[0], y0, q[1], q[0], y1, q[1], INK);
    }

    /** A street's lip and outline on all four sides. A crossing omits the shared edge, the same rule as the plan. */
    streetEdges(street, y0, y1, color) {
      const depth = street.z1 - street.z0 + 1;
      const width = street.x1 - street.x0 + 1;
      const west = street.x0;
      const east = street.x1 + 1;
      const north = street.z0;
      const south = street.z1 + 1;
      const open = (x, z) => !this.streetContinues(street, x, z);
      for (const [a, b] of exposedRuns(depth, (i) => open(street.x0 - 1, street.z0 + i))) {
        this.streetLip([west, north + a], [west, north + b], y0, y1, color, false);
      }
      for (const [a, b] of exposedRuns(depth, (i) => open(street.x1 + 1, street.z0 + i))) {
        this.streetLip([east, north + a], [east, north + b], y0, y1, color, true);
      }
      for (const [a, b] of exposedRuns(width, (i) => open(street.x0 + i, street.z0 - 1))) {
        this.streetLip([west + a, north], [west + b, north], y0, y1, color, true);
      }
      for (const [a, b] of exposedRuns(width, (i) => open(street.x0 + i, street.z1 + 1))) {
        this.streetLip([west + a, south], [west + b, south], y0, y1, color, false);
      }
    }

    /** Remember where a street's name goes. */
    labelStreet(street, y) {
      const at = Array.isArray(street.label_at) ? street.label_at : [street.x0 + 1, (street.z0 + street.z1) >> 1];
      this.labels.push({
        kind: "street", name: street.label, vertical: Boolean(street.label_vertical),
        x: at[0] + 0.5, y: y + SLAB + 0.35, z: at[1] + 0.5,
        x0: street.x0, z0: street.z0, x1: street.x1 + 1, z1: street.z1 + 1,
      });
    }

    /** The streets of every shown floor. Where two cross, the paving is laid once. */
    buildStreets() {
      const paved = new Set();
      for (const street of this.layout.streets) {
        if (!this.visible(street.floor)) continue;
        const floor = this.floorOf(street.floor);
        if (!floor) continue;
        const y = floorWalk(floor);
        const top = y + SLAB;
        const color = hex(street.style === "entry" ? this.pal.entry : this.pal.corridor, 1);
        eachCell(street.x0, street.x1, street.z0, street.z1, (x, z) => {
          const id = `${street.floor}:${keyOf(x, z)}`;
          if (paved.has(id)) return;
          paved.add(id);
          this.solid.topFace(color, x, z, x + 1, z + 1, top);
        });
        this.streetEdges(street, y, top, color);
        this.slabs.push({ y: top, x0: street.x0, z0: street.z0, x1: street.x1 + 1, z1: street.z1 + 1 });
        this.grow(street.x0, y, street.z0, street.x1 + 1, top, street.z1 + 1);
        const name = street.label || (street.style === "entry" ? "Entrance" : pretty(street.id));
        this.watch(name, street.x0, y, street.z0, street.x1 + 1, y + 0.4, street.z1 + 1, false, color);
        if (street.label) this.labelStreet(street, y);
      }
    }

    // ---- stairs, the crawl, and lifts ----

    /** A flight of steps in a box, rising from its `low` side. Spare length becomes a landing at each end. */
    steps(x0, z0, x1, z1, y0, y1, low, color) {
      const alongZ = low === "n" || low === "s";
      const len = alongZ ? z1 - z0 + 1 : x1 - x0 + 1;
      const rise = Math.max(1, Math.round(y1 - y0));
      const spare = Math.max(0, len - rise);
      const land = Math.ceil(spare / 2);
      const start = spare - land;
      const climb = Math.max(1, len - start - land);
      const stepRise = (y1 - y0) / climb;
      const row = (i) => {
        if (low === "n") return { x0, x1: x1 + 1, z0: z0 + i, z1: z0 + i + 1 };
        if (low === "s") return { x0, x1: x1 + 1, z0: z1 - i, z1: z1 - i + 1 };
        if (low === "w") return { x0: x0 + i, x1: x0 + i + 1, z0, z1: z1 + 1 };
        return { x0: x1 - i, x1: x1 - i + 1, z0, z1: z1 + 1 };
      };
      const slab = (i, y) => {
        const r = row(i);
        this.solid.box(r.x0, y, r.z0, r.x1, y + 0.16, r.z1, color);
      };
      for (let i = 0; i < start; i += 1) slab(i, y0);
      for (let i = 0; i < climb; i += 1) {
        const r = row(start + i);
        this.solid.box(r.x0, y0, r.z0, r.x1, y0 + (i + 1) * stepRise, r.z1, color);
      }
      for (let i = 0; i < land; i += 1) slab(start + climb + i, y1);
    }

    /** Every stair that reaches a shown floor. */
    buildStairs() {
      for (const stair of this.layout.stairs) {
        if (!this.anyVisible(stair.floors)) continue;
        const low = this.floorOf(stair.floors[0]);
        const high = this.floorOf(stair.floors[1]);
        if (!low || !high) continue;
        const y0 = floorWalk(low);
        const y1 = floorWalk(high);
        const color = hex(this.pal.stair, 1);
        this.steps(stair.x0, stair.z0, stair.x1, stair.z1, y0, y1, stair.low, color);
        this.grow(stair.x0, y0, stair.z0, stair.x1 + 1, y1, stair.z1 + 1);
        this.watch(pretty(stair.id), stair.x0, y0, stair.z0, stair.x1 + 1, y1, stair.z1 + 1, false, color);
      }
    }

    /** The pipe crawl: each trench as a box, and a low run under every street that keeps one. */
    buildCrawl() {
      const trench = hex(this.pal.trench, 1);
      for (const crawl of Core.crawlRecords(this.layout)) {
        const layer = Core.crawlLayerId(crawl);
        const band = Core.crawlAir(this.layout, crawl);
        if (!band || !this.visible(layer)) continue;
        for (const item of this.layout.trenches) {
          if (Core.trenchCrawl(this.layout, item) !== crawl) continue;
          this.solid.box(item.x0, band[0], item.z0, item.x1 + 1, band[1] + 1, item.z1 + 1, trench);
          this.grow(item.x0, band[0], item.z0, item.x1 + 1, band[1] + 1, item.z1 + 1);
          this.watch(pretty(item.id), item.x0, band[0], item.z0, item.x1 + 1, band[1] + 1, item.z1 + 1, false, trench);
        }
        const y = band[0] + 0.25;
        const laid = new Set();
        for (const street of this.layout.streets) {
          if (street.floor !== crawl.under || street.trench === false) continue;
          eachCell(street.x0, street.x1, street.z0, street.z1, (x, z) => {
            const id = keyOf(x, z);
            if (laid.has(id)) return;
            laid.add(id);
            this.solid.box(x + 0.12, y, z + 0.12, x + 0.88, y + 0.22, z + 0.88, shade(trench, 0.85));
          });
        }
      }
    }

    /** Every lift that stops on a shown floor: a post through its stops, with a plate at each. */
    buildLifts() {
      for (const lift of this.layout.lifts) {
        if (!this.anyVisible(lift.floors)) continue;
        const floors = lift.floors.map((id) => this.floorOf(id)).filter(Boolean);
        if (!floors.length) continue;
        const color = hex(LIFT_COLOR, 1);
        const y0 = Math.min(...floors.map((f) => floorWalk(f)));
        const y1 = Math.max(...floors.map((f) => f.slab + 2));
        this.solid.box(lift.x + 0.32, y0, lift.z + 0.32, lift.x + 0.68, y1, lift.z + 0.68, color);
        for (const floor of floors) {
          const y = floorWalk(floor);
          this.solid.box(lift.x + 0.12, y, lift.z + 0.12, lift.x + 0.88, y + 0.12, lift.z + 0.88, color);
        }
        this.watch(lift.label || "Lift", lift.x, y0, lift.z, lift.x + 1, y1, lift.z + 1, false, color);
      }
    }

    // ---- multiblocks and machines ----

    /** A shell's ring of walls, one block thick, with a gap where its door is. */
    shell(pad, y0, y1, color) {
      const door = pad.door || null;
      const { solid } = this;
      for (const [a, b] of wallRuns(pad.x0, pad.x1, pad.z0, true, door)) solid.box(a, y0, pad.z0, b + 1, y1, pad.z0 + 1, color);
      for (const [a, b] of wallRuns(pad.x0, pad.x1, pad.z1, true, door)) solid.box(a, y0, pad.z1, b + 1, y1, pad.z1 + 1, color);
      // A shell two blocks wide is all north and south wall.
      if (!(pad.x0 + 1 <= pad.x1 - 1)) return;
      for (const [a, b] of wallRuns(pad.z0 + 1, pad.z1 - 1, pad.x0, false, door)) solid.box(pad.x0, y0, a, pad.x0 + 1, y1, b + 1, color);
      for (const [a, b] of wallRuns(pad.z0 + 1, pad.z1 - 1, pad.x1, false, door)) solid.box(pad.x1, y0, a, pad.x1 + 1, y1, b + 1, color);
    }

    /** The dark block on a module's front that marks its controller. */
    controllerMark(mod, y0, color) {
      const cx = Math.floor((mod.x0 + mod.x1) / 2);
      const cz = Math.floor((mod.z0 + mod.z1) / 2);
      const { solid } = this;
      if (mod.front === "n") solid.box(cx + 0.2, y0, mod.z0 - 0.02, cx + 0.8, y0 + 1, mod.z0 + 0.16, color);
      else if (mod.front === "s") solid.box(cx + 0.2, y0, mod.z1 + 0.84, cx + 0.8, y0 + 1, mod.z1 + 1.02, color);
      else if (mod.front === "w") solid.box(mod.x0 - 0.02, y0, cz + 0.2, mod.x0 + 0.16, y0 + 1, cz + 0.8, color);
      else solid.box(mod.x1 + 0.84, y0, cz + 0.2, mod.x1 + 1.02, y0 + 1, cz + 0.8, color);
    }

    /** One multiblock: its body or shell, an outline for each module, and the controller marks. */
    buildPad(pad, span, spec) {
      const y0 = span[0] + SLAB;
      const y1 = y0 + (pad.h || spec.size[2]);
      const color = hex(this.padColor(spec), 1);
      const inset = spec.shell ? 0 : 0.06;
      const px0 = pad.x0 + inset;
      const pz0 = pad.z0 + inset;
      const px1 = pad.x1 + 1 - inset;
      const pz1 = pad.z1 + 1 - inset;
      if (spec.shell) this.shell(pad, y0, y1, color);
      else this.solid.box(px0, y0, pz0, px1, y1, pz1, color);
      this.lines.wireBox(px0, y0, pz0, px1, y1, pz1, INK);
      const mods = Core.moduleList(pad);
      if (mods.length > 1) {
        for (const mod of mods) {
          this.lines.wireBox(Math.max(px0, mod.x0), y0, Math.max(pz0, mod.z0), Math.min(px1, mod.x1 + 1), y1, Math.min(pz1, mod.z1 + 1), INK);
        }
      }
      const dark = shade(color, 0.35);
      for (const mod of mods) this.controllerMark(mod, y0, dark);
      let name = mods.length > 1 ? `${mods.length}× ${spec.name}` : spec.name;
      if (spec.pollution) name += " pollutes";
      this.watch(name, pad.x0, y0, pad.z0, pad.x1 + 1, y1, pad.z1 + 1, false, color);
    }

    /** Every multiblock in a room on a shown floor. One the catalog does not know is left out. */
    buildPads() {
      const multis = (this.catalog && this.catalog.multis) || {};
      for (const pad of this.layout.pads) {
        const home = this.shownRoom(pad.room);
        const spec = multis[pad.key];
        if (home && spec) this.buildPad(pad, home.span, spec);
      }
    }

    /** The small plate on the side a machine faces. */
    frontPlate(x, y, z, face, color) {
      const y0 = y + 0.1;
      const y1 = y + 0.58;
      const { solid } = this;
      if (face === "n") solid.box(x + 0.28, y0, z + 0.12, x + 0.72, y1, z + 0.24, color);
      else if (face === "s") solid.box(x + 0.28, y0, z + 0.76, x + 0.72, y1, z + 0.88, color);
      else if (face === "w") solid.box(x + 0.12, y0, z + 0.28, x + 0.24, y1, z + 0.72, color);
      else solid.box(x + 0.76, y0, z + 0.28, x + 0.88, y1, z + 0.72, color);
    }

    /** One machine: a block in its group's color with a plate on its front. */
    buildMachine(code, x, z, y0, face, plateColor) {
      const singles = (this.catalog && this.catalog.singles) || {};
      const single = singles[code] || {};
      const color = hex((this.pal.groups || {})[single.group] || UNKNOWN_COLOR, 1);
      this.solid.box(x + 0.2, y0, z + 0.2, x + 0.8, y0 + MACHINE_TOP, z + 0.8, color);
      this.lines.wireBox(x + 0.2, y0, z + 0.2, x + 0.8, y0 + MACHINE_TOP, z + 0.8, INK);
      this.frontPlate(x, y0, z, face, plateColor);
      this.watch(single.name || code, x, y0, z, x + 1, y0 + MACHINE_TOP, z + 1, false, color);
    }

    /** Every machine of every row in a room on a shown floor. */
    buildMachines() {
      const plateColor = hex(this.pal.door, 1);
      for (const wall of this.layout.walls) {
        const home = this.shownRoom(wall.room);
        const step = Core.STEP[wall.along];
        if (!home || !step) continue;
        const codes = String(wall.codes || "").split(/\s+/).filter(Boolean);
        codes.forEach((code, i) => {
          if (code === "-") return;
          this.buildMachine(code, wall.x + step[0] * i, wall.z + step[1] * i, home.span[0] + SLAB, wall.face, plateColor);
        });
      }
    }

    // ---- floor marks and shafts ----

    /** One floor mark: a dark pad for a service core, else a circle or a rectangle of lines. Names and wells draw nothing. */
    buildMark(mark, room, span) {
      const shape = mark.shape || "box";
      if (shape === "text" || shape === "well") return;
      const y = span[0] + SLAB + 0.05;
      const name = mark.label || mark.short || (shape === "service" ? "Service core" : "Area");
      let color = INK;
      if (shape === "service") {
        color = shade(hex(room.color, 1), 0.5);
        this.solid.box(mark.x0 + 0.04, y, mark.z0 + 0.04, mark.x1 + 0.96, y + 0.06, mark.z1 + 0.96, color);
      } else if (shape === "circle") {
        const radius = (mark.radius || Core.circleRadius(mark)) + 0.5;
        this.lines.circle((mark.x0 + mark.x1 + 1) / 2, y, (mark.z0 + mark.z1 + 1) / 2, radius, INK);
      } else {
        const inset = 0.22;
        this.lines.loop(mark.x0 + inset, y, mark.z0 + inset, mark.x1 + 1 - inset, mark.z1 + 1 - inset, INK);
      }
      this.watch(name, mark.x0, y, mark.z0, mark.x1 + 1, y + 0.2, mark.z1 + 1, false, color);
    }

    /** Every floor mark in a room on a shown floor. */
    buildMarks() {
      for (const mark of this.layout.marks || []) {
        const home = this.shownRoom(mark.room);
        if (home) this.buildMark(mark, home.room, home.span);
      }
    }

    /** The highest Y the plan reaches: floor ceilings, tall rooms, and the tops of multiblocks. Shafts are not counted. */
    planTop() {
      let top = 0;
      for (const floor of this.layout.floors) top = Math.max(top, floorCeil(floor));
      for (const room of this.layout.rooms) {
        const span = this.roomSpan(room);
        if (span) top = Math.max(top, span[1]);
      }
      const multis = (this.catalog && this.catalog.multis) || {};
      for (const pad of this.layout.pads || []) {
        const room = this.roomOf(pad.room);
        const span = room && this.roomSpan(room);
        const spec = multis[pad.key];
        if (!span || !spec) continue;
        top = Math.max(top, span[0] + SLAB + (pad.h || spec.size[2] || 0));
      }
      return top;
    }

    /** One shaft: panes of glass around it from its room's ceiling up, and a glass cap when it has one. */
    buildShaft(shaft, span, shaftTop, pane) {
      const cap = shaft.cap === "glass" ? hex(this.pal.well, 0.35) : null;
      const { glass } = this;
      eachCell(shaft.x0, shaft.x1, shaft.z0, shaft.z1, (x, z) => {
        if (z === shaft.z0) glass.sideQuad(pane, x, z, "n", span[1], shaftTop);
        if (z === shaft.z1) glass.sideQuad(pane, x, z, "s", span[1], shaftTop);
        if (x === shaft.x0) glass.sideQuad(pane, x, z, "w", span[1], shaftTop);
        if (x === shaft.x1) glass.sideQuad(pane, x, z, "e", span[1], shaftTop);
        if (cap) glass.topFace(cap, x + 0.08, z + 0.08, x + 0.92, z + 0.92, shaftTop);
      });
      this.watch(shaft.label || "Shaft", shaft.x0, span[1], shaft.z0, shaft.x1 + 1, shaftTop, shaft.z1 + 1, false, hex(this.pal.well, 1));
    }

    /** Every shaft from a room on a shown floor. All of them end at one height. */
    buildShafts() {
      const shaftTop = this.planTop() + SHAFT_RISE;
      const pane = hex(this.pal.well, 0.22);
      for (const shaft of this.layout.shafts) {
        const home = this.shownRoom(shaft.room);
        if (home) this.buildShaft(shaft, home.span, shaftTop, pane);
      }
    }

    // ---- the whole scene ----

    /** Build everything, in the order it is drawn, and hand back the scene. */
    build() {
      const shaftCells = this.findShaftCells();
      for (const floor of this.layout.floors) {
        if (this.visible(floor.id)) this.buildFloor(floor, shaftCells);
      }
      this.buildStreets();
      this.buildStairs();
      this.buildCrawl();
      this.buildLifts();
      this.buildPads();
      this.buildMachines();
      this.buildMarks();
      this.buildShafts();
      this.lines.flushSeams();
      return {
        origin: this.origin,
        opaque: this.solid.toArray(),
        clear: this.glass.toArray(),
        segs: this.lines.segs,
        picks: this.picks,
        labels: this.labels,
        slabs: this.slabs,
        bounds: this.bounds,
      };
    }
  }

  /**
   * The plan as a scene: { origin, opaque, clear, segs, picks, labels, slabs, bounds }.
   * `visible(id)` says whether a floor or the crawl is shown, and `padColor(spec)` gives a multiblock's fill.
   */
  function build(layout, catalog, visible, padColor) {
    return new SceneBuilder(layout, catalog, visible, padColor).build();
  }

  root.Scene3D = { build };
}(window));
