/* View-only 3D of the plan. Drag turns, right-drag slides, the wheel zooms toward the pointer.
   Double-click frames the thing under the pointer. Double-click empty ground fits the base. */
(function (root) {
  "use strict";

  const ALONG = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] };
  const HOME_YAW = 0;
  const HOME_PITCH = 1.0;
  const INK = [0.29, 0.24, 0.2, 1];
  const SLAB = 0.16;
  // A shaft's glass ends this far above the highest thing in the plan, so every shaft has the same level top.
  const SHAFT_RISE = 32;
  const DIRS = [[1, 0, "e"], [-1, 0, "w"], [0, 1, "s"], [0, -1, "n"]];

  const canvas = { el: null, gl: null };
  const tags = { el: null, ctx: null };
  let layout = null;
  let catalog = null;
  let shown = null;
  let tell = function () {};
  // The plan's fill for a multiblock, handed in by app.js so both views use one table.
  let padColor = function () { return "#A3988C"; };
  let opaque = null;
  let clear = null;
  let picks = [];
  let labels = [];
  // The top of every drawn floor, as { y, x0, z0, x1, z1 }: what can hide a name on a floor below.
  let slabs = [];
  let edgeSegs = [];
  let bounds = null;
  let hovered = null;
  let program = null;
  let attrib = null;
  let viewFrame = 0;
  let edgeKey = "";
  let hoverKey = "";
  const mesh = { solid: null, lines: null, glass: null, hover: null, solidN: 0, lineN: 0, glassN: 0, hoverN: 0 };
  const matProj = new Float32Array(16);
  const matView = new Float32Array(16);
  const matMvp = new Float32Array(16);
  let uMvp = null;
  const origin = [0, 0, 0];
  const target = [0, 0, 0];
  let yaw = HOME_YAW;
  let pitch = HOME_PITCH;
  let dist = 180;
  let drag = null;

  function hex(color, alpha) {
    const n = parseInt(String(color || "#888888").slice(1), 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, alpha == null ? 1 : alpha];
  }

  function shade(color, k) {
    return [color[0] * k, color[1] * k, color[2] * k, color[3]];
  }

  function lighten(color, t) {
    return [
      color[0] + (1 - color[0]) * t,
      color[1] + (1 - color[1]) * t,
      color[2] + (1 - color[2]) * t,
      1,
    ];
  }

  function floorOf(id) {
    return layout.floors.find((f) => f.id === id) || null;
  }

  function roomOf(id) {
    return layout.rooms.find((r) => r.id === id) || null;
  }

  function floorWalk(floor) {
    return floor.slab + 1;
  }

  function floorCeil(floor) {
    return floor.slab + 1 + (floor.height || 5);
  }

  function roomSpan(room) {
    const floor = floorOf(room.floor);
    if (!floor) return null;
    const y0 = floorWalk(floor);
    return [y0, y0 + (room.height || floor.height || 5)];
  }

  function visible(id) {
    return !shown || shown.has(id);
  }

  function anyVisible(ids) {
    return ids.some((id) => visible(id));
  }

  function keyOf(x, z) {
    return x * 4096 + z;
  }

  function eachCell(x0, x1, z0, z1, fn) {
    for (let x = x0; x <= x1; x += 1) {
      for (let z = z0; z <= z1; z += 1) fn(x, z);
    }
  }

  function push(dst, p, n, c) {
    dst.push(
      p[0] - origin[0], p[1] - origin[1], p[2] - origin[2],
      n[0], n[1], n[2], c[0], c[1], c[2], c[3],
    );
  }

  function normal(a, b, c) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const x = uy * vz - uz * vy;
    const y = uz * vx - ux * vz;
    const z = ux * vy - uy * vx;
    const len = Math.hypot(x, y, z) || 1;
    return [x / len, y / len, z / len];
  }

  function tri(dst, color, a, b, c) {
    const n = normal(a, b, c);
    push(dst, a, n, color);
    push(dst, b, n, color);
    push(dst, c, n, color);
  }

  function quad(dst, color, a, b, c, d) {
    tri(dst, color, a, b, c);
    tri(dst, color, a, c, d);
  }

  /** Upward face. Winding matches the top of box(). */
  function topFace(dst, color, x0, z0, x1, z1, y) {
    quad(dst, color, [x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0]);
  }

  function box(dst, x0, y0, z0, x1, y1, z1, color, openTop) {
    const faces = [
      [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]],
      [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]],
      [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]],
      [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]],
      [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]],
    ];
    if (!openTop) faces.push([[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]]);
    for (const f of faces) quad(dst, color, f[0], f[1], f[2], f[3]);
  }

  function sideQuad(dst, color, x, z, dir, ya, yb) {
    if (yb - ya < 0.01) return;
    if (dir === "w") quad(dst, color, [x, ya, z], [x, ya, z + 1], [x, yb, z + 1], [x, yb, z]);
    else if (dir === "e") quad(dst, color, [x + 1, ya, z + 1], [x + 1, ya, z], [x + 1, yb, z], [x + 1, yb, z + 1]);
    else if (dir === "n") quad(dst, color, [x + 1, ya, z], [x, ya, z], [x, yb, z], [x + 1, yb, z]);
    else quad(dst, color, [x, ya, z + 1], [x + 1, ya, z + 1], [x + 1, yb, z + 1], [x, yb, z + 1]);
  }

  function wallFace(dst, x, z, dir, y0, y1, color) {
    const cut = Math.min(y1, y0 + 1);
    sideQuad(dst, shade(color, 0.82), x, z, dir, y0, cut);
    if (y1 - cut > 0.02) sideQuad(dst, color, x, z, dir, cut, y1);
    noteSide(x, z, dir, y0, y1);
  }

  function ribbon(dst, ax, ay, az, bx, by, bz, color, width) {
    let dx = bx - ax;
    let dy = by - ay;
    let dz = bz - az;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-4) return;
    dx /= len; dy /= len; dz /= len;
    let ux = 0;
    let uy = 1;
    let uz = 0;
    if (Math.abs(dy) > 0.85) { ux = 1; uy = 0; uz = 0; }
    let vx = dy * uz - dz * uy;
    let vy = dz * ux - dx * uz;
    let vz = dx * uy - dy * ux;
    const vl = Math.hypot(vx, vy, vz) || 1;
    vx /= vl; vy /= vl; vz /= vl;
    const wx = vy * dz - vz * dy;
    const wy = vz * dx - vx * dz;
    const wz = vx * dy - vy * dx;
    const h = width * 0.5;
    const at = (x, y, z, su, sv) => [x + vx * su + wx * sv, y + vy * su + wy * sv, z + vz * su + wz * sv];
    const ring = [[-h, -h], [h, -h], [h, h], [-h, h]];
    for (let i = 0; i < 4; i += 1) {
      const c0 = ring[i];
      const c1 = ring[(i + 1) % 4];
      quad(dst, color,
        at(ax, ay, az, c0[0], c0[1]),
        at(bx, by, bz, c0[0], c0[1]),
        at(bx, by, bz, c1[0], c1[1]),
        at(ax, ay, az, c1[0], c1[1]));
    }
  }

  let edgeSeen = new Set();
  const seams = new Map();

  function addSeg(x0, y0, z0, x1, y1, z1, color) {
    const r = (v) => Math.round(v * 100);
    const sa = `${r(x0)},${r(y0)},${r(z0)}`;
    const sb = `${r(x1)},${r(y1)},${r(z1)}`;
    const key = sa < sb ? `${sa}|${sb}` : `${sb}|${sa}`;
    if (edgeSeen.has(key)) return;
    edgeSeen.add(key);
    edgeSegs.push([x0, y0, z0, x1, y1, z1, color]);
  }

  function noteEdge(ax, ay, az, bx, by, bz, dir) {
    const r = (v) => Math.round(v * 100);
    const sa = `${r(ax)},${r(ay)},${r(az)}`;
    const sb = `${r(bx)},${r(by)},${r(bz)}`;
    const key = sa < sb ? `${sa}|${sb}` : `${sb}|${sa}`;
    let item = seams.get(key);
    if (!item) {
      item = { a: [ax, ay, az], b: [bx, by, bz], dirs: [] };
      seams.set(key, item);
    }
    item.dirs.push(dir);
  }

  function noteSide(x, z, dir, y0, y1) {
    if (dir === "w") {
      noteEdge(x, y0, z, x, y0, z + 1, dir);
      noteEdge(x, y1, z, x, y1, z + 1, dir);
      noteEdge(x, y0, z, x, y1, z, dir);
      noteEdge(x, y0, z + 1, x, y1, z + 1, dir);
    } else if (dir === "e") {
      noteEdge(x + 1, y0, z, x + 1, y0, z + 1, dir);
      noteEdge(x + 1, y1, z, x + 1, y1, z + 1, dir);
      noteEdge(x + 1, y0, z, x + 1, y1, z, dir);
      noteEdge(x + 1, y0, z + 1, x + 1, y1, z + 1, dir);
    } else if (dir === "n") {
      noteEdge(x, y0, z, x + 1, y0, z, dir);
      noteEdge(x, y1, z, x + 1, y1, z, dir);
      noteEdge(x, y0, z, x, y1, z, dir);
      noteEdge(x + 1, y0, z, x + 1, y1, z, dir);
    } else {
      noteEdge(x, y0, z + 1, x + 1, y0, z + 1, dir);
      noteEdge(x, y1, z + 1, x + 1, y1, z + 1, dir);
      noteEdge(x, y0, z + 1, x, y1, z + 1, dir);
      noteEdge(x + 1, y0, z + 1, x + 1, y1, z + 1, dir);
    }
  }

  function noteTop(x0, z0, x1, z1, y) {
    noteEdge(x0, y, z0, x1, y, z0, "u");
    noteEdge(x1, y, z0, x1, y, z1, "u");
    noteEdge(x1, y, z1, x0, y, z1, "u");
    noteEdge(x0, y, z1, x0, y, z0, "u");
  }

  function flushSeams() {
    for (const item of seams.values()) {
      const dir = item.dirs[0];
      const crease = item.dirs.length === 1 || item.dirs.some((d) => d !== dir);
      if (crease) addSeg(item.a[0], item.a[1], item.a[2], item.b[0], item.b[1], item.b[2], INK);
    }
    seams.clear();
  }

  function loopSeg(x0, y, z0, x1, z1, color) {
    addSeg(x0, y, z0, x1, y, z0, color);
    addSeg(x1, y, z0, x1, y, z1, color);
    addSeg(x1, y, z1, x0, y, z1, color);
    addSeg(x0, y, z1, x0, y, z0, color);
  }

  function wireBox(x0, y0, z0, x1, y1, z1, color) {
    loopSeg(x0, y0, z0, x1, z1, color);
    loopSeg(x0, y1, z0, x1, z1, color);
    addSeg(x0, y0, z0, x0, y1, z0, color);
    addSeg(x1, y0, z0, x1, y1, z0, color);
    addSeg(x0, y0, z1, x0, y1, z1, color);
    addSeg(x1, y0, z1, x1, y1, z1, color);
  }

  /** Runs of cells whose outside neighbor is not another street. `b` is exclusive. */
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

  function streetContinues(street, x, z) {
    return layout.streets.some((other) => other !== street && other.floor === street.floor
      && x >= other.x0 && x <= other.x1 && z >= other.z0 && z <= other.z1);
  }

  /** Slab lip and outline. A crossing omits the shared edge, the same rule as the plan. */
  function streetEdges(dst, street, y0, y1, fill) {
    const lip = fill;
    const depth = street.z1 - street.z0 + 1;
    const width = street.x1 - street.x0 + 1;
    for (const [a, b] of exposedRuns(depth, (i) => !streetContinues(street, street.x0 - 1, street.z0 + i))) {
      const z0 = street.z0 + a;
      const z1 = street.z0 + b;
      quad(dst, lip, [street.x0, y0, z0], [street.x0, y0, z1], [street.x0, y1, z1], [street.x0, y1, z0]);
      addSeg(street.x0, y1, z0, street.x0, y1, z1, INK);
      addSeg(street.x0, y0, z0, street.x0, y0, z1, INK);
      addSeg(street.x0, y0, z0, street.x0, y1, z0, INK);
      addSeg(street.x0, y0, z1, street.x0, y1, z1, INK);
    }
    for (const [a, b] of exposedRuns(depth, (i) => !streetContinues(street, street.x1 + 1, street.z0 + i))) {
      const z0 = street.z0 + a;
      const z1 = street.z0 + b;
      const x = street.x1 + 1;
      quad(dst, lip, [x, y0, z1], [x, y0, z0], [x, y1, z0], [x, y1, z1]);
      addSeg(x, y1, z0, x, y1, z1, INK);
      addSeg(x, y0, z0, x, y0, z1, INK);
      addSeg(x, y0, z0, x, y1, z0, INK);
      addSeg(x, y0, z1, x, y1, z1, INK);
    }
    for (const [a, b] of exposedRuns(width, (i) => !streetContinues(street, street.x0 + i, street.z0 - 1))) {
      const x0 = street.x0 + a;
      const x1 = street.x0 + b;
      quad(dst, lip, [x1, y0, street.z0], [x0, y0, street.z0], [x0, y1, street.z0], [x1, y1, street.z0]);
      addSeg(x0, y1, street.z0, x1, y1, street.z0, INK);
      addSeg(x0, y0, street.z0, x1, y0, street.z0, INK);
      addSeg(x0, y0, street.z0, x0, y1, street.z0, INK);
      addSeg(x1, y0, street.z0, x1, y1, street.z0, INK);
    }
    for (const [a, b] of exposedRuns(width, (i) => !streetContinues(street, street.x0 + i, street.z1 + 1))) {
      const x0 = street.x0 + a;
      const x1 = street.x0 + b;
      const z = street.z1 + 1;
      quad(dst, lip, [x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]);
      addSeg(x0, y1, z, x1, y1, z, INK);
      addSeg(x0, y0, z, x1, y0, z, INK);
      addSeg(x0, y0, z, x0, y1, z, INK);
      addSeg(x1, y0, z, x1, y1, z, INK);
    }
  }

  function circleSeg(cx, y, cz, radius, color) {
    const n = 32;
    for (let i = 0; i < n; i += 1) {
      const a0 = (i / n) * Math.PI * 2;
      const a1 = ((i + 1) / n) * Math.PI * 2;
      addSeg(cx + Math.cos(a0) * radius, y, cz + Math.sin(a0) * radius,
        cx + Math.cos(a1) * radius, y, cz + Math.sin(a1) * radius, color);
    }
  }

  function runs(a, b, fixed, alongX, door) {
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

  function shell(dst, pad, y0, y1, color) {
    const door = pad.door || null;
    for (const [a, b] of runs(pad.x0, pad.x1, pad.z0, true, door)) box(dst, a, y0, pad.z0, b + 1, y1, pad.z0 + 1, color);
    for (const [a, b] of runs(pad.x0, pad.x1, pad.z1, true, door)) box(dst, a, y0, pad.z1, b + 1, y1, pad.z1 + 1, color);
    if (pad.x0 + 1 <= pad.x1 - 1) {
      for (const [a, b] of runs(pad.z0 + 1, pad.z1 - 1, pad.x0, false, door)) box(dst, pad.x0, y0, a, pad.x0 + 1, y1, b + 1, color);
      for (const [a, b] of runs(pad.z0 + 1, pad.z1 - 1, pad.x1, false, door)) box(dst, pad.x1, y0, a, pad.x1 + 1, y1, b + 1, color);
    }
  }

  function steps(dst, x0, z0, x1, z1, y0, y1, low, color) {
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
      box(dst, r.x0, y, r.z0, r.x1, y + 0.16, r.z1, color);
    };
    for (let i = 0; i < start; i += 1) slab(i, y0);
    for (let i = 0; i < climb; i += 1) {
      const r = row(start + i);
      box(dst, r.x0, y0, r.z0, r.x1, y0 + (i + 1) * stepRise, r.z1, color);
    }
    for (let i = 0; i < land; i += 1) slab(start + climb + i, y1);
  }

  function grow(x0, y0, z0, x1, y1, z1) {
    bounds.min[0] = Math.min(bounds.min[0], x0);
    bounds.min[1] = Math.min(bounds.min[1], y0);
    bounds.min[2] = Math.min(bounds.min[2], z0);
    bounds.max[0] = Math.max(bounds.max[0], x1);
    bounds.max[1] = Math.max(bounds.max[1], y1);
    bounds.max[2] = Math.max(bounds.max[2], z1);
  }

  function watch(name, x0, y0, z0, x1, y1, z1, open, color) {
    picks.push({
      name,
      open: Boolean(open),
      color: color || INK,
      min: [x0 - origin[0], y0 - origin[1], z0 - origin[2]],
      max: [x1 - origin[0], y1 - origin[1], z1 - origin[2]],
      box: [x0, y0, z0, x1, y1, z1],
    });
  }

  function pretty(id) {
    return String(id || "").replace(/_/g, " ");
  }

  function touch(map, x, z, y0, y1) {
    const k = keyOf(x, z);
    const hit = map.get(k);
    if (!hit) map.set(k, { x, z, y0, y1 });
    else {
      hit.y0 = Math.min(hit.y0, y0);
      hit.y1 = Math.max(hit.y1, y1);
    }
  }

  function frontPlate(dst, x, y, z, face, color) {
    const y0 = y + 0.1;
    const y1 = y + 0.58;
    if (face === "n") box(dst, x + 0.28, y0, z + 0.12, x + 0.72, y1, z + 0.24, color);
    else if (face === "s") box(dst, x + 0.28, y0, z + 0.76, x + 0.72, y1, z + 0.88, color);
    else if (face === "w") box(dst, x + 0.12, y0, z + 0.28, x + 0.24, y1, z + 0.72, color);
    else box(dst, x + 0.76, y0, z + 0.28, x + 0.88, y1, z + 0.72, color);
  }

  /** The highest Y the plan reaches: floor ceilings, tall rooms, and the tops of multiblocks. Shafts are not counted. */
  function planTop() {
    let top = 0;
    for (const floor of layout.floors) top = Math.max(top, floorCeil(floor));
    for (const room of layout.rooms) {
      const span = roomSpan(room);
      if (span) top = Math.max(top, span[1]);
    }
    const multis = (catalog && catalog.multis) || {};
    for (const pad of layout.pads || []) {
      const room = roomOf(pad.room);
      const span = room && roomSpan(room);
      const spec = multis[pad.key];
      if (!span || !spec) continue;
      top = Math.max(top, span[0] + SLAB + (pad.h || spec.size[2] || 0));
    }
    return top;
  }

  function build() {
    const solid = [];
    const glass = [];
    picks = [];
    labels = [];
    slabs = [];
    edgeSegs = [];
    edgeSeen = new Set();
    seams.clear();
    edgeKey = "";
    hoverKey = "";
    hovered = null;
    tell("");
    bounds = { min: [1e9, 1e9, 1e9], max: [-1e9, -1e9, -1e9] };
    const pal = layout.palette;
    const sq = layout.site.square;
    origin[0] = (sq.x0 + sq.x1 + 1) / 2;
    origin[2] = (sq.z0 + sq.z1 + 1) / 2;
    const lows = layout.floors.map((f) => floorWalk(f));
    const highs = layout.floors.map((f) => floorCeil(f));
    origin[1] = (Math.min(...lows) + Math.max(...highs)) / 2;
    const rock = hex(pal.rock, 1);
    const shaftCells = new Set();
    for (const shaft of layout.shafts) {
      const home = roomOf(shaft.room);
      if (!home || !visible(home.floor)) continue;
      eachCell(shaft.x0, shaft.x1, shaft.z0, shaft.z1, (x, z) => shaftCells.add(keyOf(x, z)));
    }

    for (const floor of layout.floors) {
      if (!visible(floor.id)) continue;
      const dug = new Set();
      const roomAt = new Map();
      const rooms = layout.rooms.filter((r) => r.floor === floor.id);
      for (const room of rooms) eachCell(room.x0, room.x1, room.z0, room.z1, (x, z) => dug.add(keyOf(x, z)));
      for (const street of layout.streets) {
        if (street.floor === floor.id) eachCell(street.x0, street.x1, street.z0, street.z1, (x, z) => dug.add(keyOf(x, z)));
      }
      for (const door of layout.doors) {
        if (door.floor === floor.id) eachCell(door.x0, door.x1, door.z0, door.z1, (x, z) => dug.add(keyOf(x, z)));
      }
      for (const stair of layout.stairs) {
        if (stair.floors.includes(floor.id)) eachCell(stair.x0, stair.x1, stair.z0, stair.z1, (x, z) => dug.add(keyOf(x, z)));
      }
      const walls = new Map();
      for (const room of rooms) {
        const span = roomSpan(room);
        if (!span) continue;
        const color = hex(room.color, 1);
        eachCell(room.x0, room.x1, room.z0, room.z1, (x, z) => roomAt.set(keyOf(x, z), color));
        const inside = (x, z) => x >= room.x0 && x <= room.x1 && z >= room.z0 && z <= room.z1;
        for (let x = room.x0; x <= room.x1; x += 1) {
          for (let z = room.z0; z <= room.z1; z += 1) {
            for (const [dx, dz] of DIRS) {
              const nx = x + dx;
              const nz = z + dz;
              if (!inside(nx, nz) && !dug.has(keyOf(nx, nz))) touch(walls, nx, nz, span[0], span[1]);
            }
            const north = !inside(x, z - 1);
            const south = !inside(x, z + 1);
            const east = !inside(x + 1, z);
            const west = !inside(x - 1, z);
            const corners = [];
            if (north && west) corners.push([x - 1, z - 1]);
            if (north && east) corners.push([x + 1, z - 1]);
            if (south && west) corners.push([x - 1, z + 1]);
            if (south && east) corners.push([x + 1, z + 1]);
            for (const [cx, cz] of corners) {
              if (!dug.has(keyOf(cx, cz))) touch(walls, cx, cz, span[0], span[1]);
            }
          }
        }
        box(solid, room.x0, span[0], room.z0, room.x1 + 1, span[0] + SLAB, room.z1 + 1, color);
        slabs.push({ y: span[0] + SLAB, x0: room.x0, z0: room.z0, x1: room.x1 + 1, z1: room.z1 + 1 });
        grow(room.x0, span[0], room.z0, room.x1 + 1, span[1], room.z1 + 1);
        watch(room.name, room.x0, span[0], room.z0, room.x1 + 1, span[1], room.z1 + 1, true, color);
        const at = Array.isArray(room.label_at) ? room.label_at : [(room.x0 + room.x1) >> 1, (room.z0 + room.z1) >> 1];
        labels.push({
          kind: "room", name: room.name, code: room.code,
          x: at[0] + 0.5, y: span[0] + SLAB + 0.45, z: at[1] + 0.5,
          x0: room.x0, z0: room.z0, x1: room.x1 + 1, z1: room.z1 + 1,
        });
        if (room.grade) {
          eachCell(room.x0, room.x1, room.z0, room.z1, (x, z) => {
            if (shaftCells.has(keyOf(x, z))) return;
            if (room.roof === "glass") {
              topFace(glass, hex(pal.well, 0.4), x, z, x + 1, z + 1, span[1] + 0.04);
            } else {
              box(solid, x, span[1], z, x + 1, span[1] + 0.18, z + 1, shade(rock, 0.9));
            }
          });
        }
      }
      for (const wall of walls.values()) {
        const y0 = wall.y0 + SLAB;
        const y1 = wall.y1;
        if (y1 - y0 < 0.2) continue;
        topFace(solid, rock, wall.x, wall.z, wall.x + 1, wall.z + 1, y1);
        noteTop(wall.x, wall.z, wall.x + 1, wall.z + 1, y1);
        for (const [dx, dz, dir] of DIRS) {
          const nk = keyOf(wall.x + dx, wall.z + dz);
          if (walls.has(nk)) continue;
          const tint = roomAt.get(nk);
          wallFace(solid, wall.x, wall.z, dir, y0, y1, tint || rock);
        }
      }
      for (const door of layout.doors) {
        if (door.floor !== floor.id) continue;
        let top = floorCeil(floor);
        for (const room of rooms) {
          const span = roomSpan(room);
          if (!span) continue;
          const near = door.x1 >= room.x0 - 1 && door.x0 <= room.x1 + 1
            && door.z1 >= room.z0 - 1 && door.z0 <= room.z1 + 1;
          if (near) top = Math.max(top, span[1]);
        }
        const y0 = floorWalk(floor);
        const head = Math.min(0.45, Math.max(0.2, (top - y0) * 0.15));
        const head0 = Math.max(y0 + SLAB, top - head);
        const color = hex(pal.door, 1);
        box(solid, door.x0, y0, door.z0, door.x1 + 1, y0 + SLAB, door.z1 + 1, color);
        box(solid, door.x0, head0, door.z0, door.x1 + 1, top, door.z1 + 1, shade(color, 0.75));
        wireBox(door.x0, y0, door.z0, door.x1 + 1, y0 + SLAB, door.z1 + 1, INK);
        wireBox(door.x0, head0, door.z0, door.x1 + 1, top, door.z1 + 1, INK);
        watch(pretty(door.id), door.x0, y0, door.z0, door.x1 + 1, top, door.z1 + 1, false, color);
      }
    }

    const paved = new Set();
    for (const street of layout.streets) {
      if (!visible(street.floor)) continue;
      const floor = floorOf(street.floor);
      if (!floor) continue;
      const y = floorWalk(floor);
      const top = y + SLAB;
      const color = hex(street.style === "entry" ? pal.entry : pal.corridor, 1);
      eachCell(street.x0, street.x1, street.z0, street.z1, (x, z) => {
        const id = `${street.floor}:${keyOf(x, z)}`;
        if (paved.has(id)) return;
        paved.add(id);
        topFace(solid, color, x, z, x + 1, z + 1, top);
      });
      streetEdges(solid, street, y, top, color);
      slabs.push({ y: top, x0: street.x0, z0: street.z0, x1: street.x1 + 1, z1: street.z1 + 1 });
      grow(street.x0, y, street.z0, street.x1 + 1, top, street.z1 + 1);
      const name = street.label || (street.style === "entry" ? "Entrance" : pretty(street.id));
      watch(name, street.x0, y, street.z0, street.x1 + 1, y + 0.4, street.z1 + 1, false, color);
      if (street.label) {
        const at = Array.isArray(street.label_at) ? street.label_at : [street.x0 + 1, (street.z0 + street.z1) >> 1];
        labels.push({
          kind: "street", name: street.label, vertical: Boolean(street.label_vertical),
          x: at[0] + 0.5, y: y + SLAB + 0.35, z: at[1] + 0.5,
          x0: street.x0, z0: street.z0, x1: street.x1 + 1, z1: street.z1 + 1,
        });
      }
    }

    for (const stair of layout.stairs) {
      if (!anyVisible(stair.floors)) continue;
      const low = floorOf(stair.floors[0]);
      const high = floorOf(stair.floors[1]);
      if (!low || !high) continue;
      const y0 = floorWalk(low);
      const y1 = floorWalk(high);
      const color = hex(pal.stair, 1);
      steps(solid, stair.x0, stair.z0, stair.x1, stair.z1, y0, y1, stair.low, color);
      grow(stair.x0, y0, stair.z0, stair.x1 + 1, y1, stair.z1 + 1);
      watch(pretty(stair.id), stair.x0, y0, stair.z0, stair.x1 + 1, y1, stair.z1 + 1, false, color);
    }

    const band = root.Core.crawlAir(layout);
    const crawl = layout.site.crawl;
    if (band && visible(root.Core.CRAWL)) {
      const trench = hex(pal.trench, 1);
      for (const item of layout.trenches) {
        box(solid, item.x0, band[0], item.z0, item.x1 + 1, band[1] + 1, item.z1 + 1, trench);
        grow(item.x0, band[0], item.z0, item.x1 + 1, band[1] + 1, item.z1 + 1);
        watch(pretty(item.id), item.x0, band[0], item.z0, item.x1 + 1, band[1] + 1, item.z1 + 1, false, trench);
      }
      const y = band[0] + 0.25;
      const laid = new Set();
      for (const street of layout.streets) {
        if (street.floor !== crawl.under || street.trench === false) continue;
        eachCell(street.x0, street.x1, street.z0, street.z1, (x, z) => {
          const id = keyOf(x, z);
          if (laid.has(id)) return;
          laid.add(id);
          box(solid, x + 0.12, y, z + 0.12, x + 0.88, y + 0.22, z + 0.88, shade(trench, 0.85));
        });
      }
    }

    for (const lift of layout.lifts) {
      if (!anyVisible(lift.floors)) continue;
      const floors = lift.floors.map(floorOf).filter(Boolean);
      if (!floors.length) continue;
      const color = hex("#8a8680", 1);
      const y0 = Math.min(...floors.map((f) => floorWalk(f)));
      const y1 = Math.max(...floors.map((f) => f.slab + 2));
      box(solid, lift.x + 0.32, y0, lift.z + 0.32, lift.x + 0.68, y1, lift.z + 0.68, color);
      for (const floor of floors) {
        const y = floorWalk(floor);
        box(solid, lift.x + 0.12, y, lift.z + 0.12, lift.x + 0.88, y + 0.12, lift.z + 0.88, color);
      }
      watch(lift.label || "Lift", lift.x, y0, lift.z, lift.x + 1, y1, lift.z + 1, false, color);
    }

    const multis = (catalog && catalog.multis) || {};
    for (const pad of layout.pads) {
      const room = roomOf(pad.room);
      if (!room || !visible(room.floor)) continue;
      const span = roomSpan(room);
      const spec = multis[pad.key];
      if (!span || !spec) continue;
      const y0 = span[0] + SLAB;
      const y1 = y0 + (pad.h || spec.size[2]);
      const color = hex(padColor(spec), 1);
      const inset = spec.shell ? 0 : 0.06;
      const px0 = pad.x0 + inset;
      const pz0 = pad.z0 + inset;
      const px1 = pad.x1 + 1 - inset;
      const pz1 = pad.z1 + 1 - inset;
      if (spec.shell) shell(solid, pad, y0, y1, color);
      else box(solid, px0, y0, pz0, px1, y1, pz1, color);
      wireBox(px0, y0, pz0, px1, y1, pz1, INK);
      const mods = root.Core.moduleList(pad);
      if (mods.length > 1) {
        for (const mod of mods) {
          wireBox(Math.max(px0, mod.x0), y0, Math.max(pz0, mod.z0), Math.min(px1, mod.x1 + 1), y1, Math.min(pz1, mod.z1 + 1), INK);
        }
      }
      const dark = shade(color, 0.35);
      for (const mod of mods) {
        const cx = Math.floor((mod.x0 + mod.x1) / 2);
        const cz = Math.floor((mod.z0 + mod.z1) / 2);
        if (mod.front === "n") box(solid, cx + 0.2, y0, mod.z0 - 0.02, cx + 0.8, y0 + 1, mod.z0 + 0.16, dark);
        else if (mod.front === "s") box(solid, cx + 0.2, y0, mod.z1 + 0.84, cx + 0.8, y0 + 1, mod.z1 + 1.02, dark);
        else if (mod.front === "w") box(solid, mod.x0 - 0.02, y0, cz + 0.2, mod.x0 + 0.16, y0 + 1, cz + 0.8, dark);
        else box(solid, mod.x1 + 0.84, y0, cz + 0.2, mod.x1 + 1.02, y0 + 1, cz + 0.8, dark);
      }
      const count = mods.length;
      let name = count > 1 ? `${count}× ${spec.name}` : spec.name;
      if (spec.pollution) name += " pollutes";
      watch(name, pad.x0, y0, pad.z0, pad.x1 + 1, y1, pad.z1 + 1, false, color);
    }

    const singles = (catalog && catalog.singles) || {};
    const doorColor = hex(pal.door, 1);
    for (const wall of layout.walls) {
      const room = roomOf(wall.room);
      if (!room || !visible(room.floor)) continue;
      const span = roomSpan(room);
      const step = ALONG[wall.along];
      if (!span || !step) continue;
      const codes = String(wall.codes || "").split(/\s+/).filter(Boolean);
      codes.forEach((code, i) => {
        if (code === "-") return;
        const single = singles[code] || {};
        const x = wall.x + step[0] * i;
        const z = wall.z + step[1] * i;
        const y0 = span[0] + SLAB;
        const color = hex((pal.groups || {})[single.group] || "#888888", 1);
        box(solid, x + 0.2, y0, z + 0.2, x + 0.8, y0 + 0.72, z + 0.8, color);
        wireBox(x + 0.2, y0, z + 0.2, x + 0.8, y0 + 0.72, z + 0.8, INK);
        frontPlate(solid, x, y0, z, wall.face, doorColor);
        watch(single.name || code, x, y0, z, x + 1, y0 + 0.72, z + 1, false, color);
      });
    }

    for (const mark of layout.marks || []) {
      const room = roomOf(mark.room);
      if (!room || !visible(room.floor)) continue;
      const span = roomSpan(room);
      if (!span) continue;
      const shape = mark.shape || "box";
      if (shape === "text" || shape === "well") continue;
      const y = span[0] + SLAB + 0.05;
      const name = mark.label || mark.short || (shape === "service" ? "Service core" : "Area");
      if (shape === "service") {
        const dark = shade(hex(room.color, 1), 0.5);
        box(solid, mark.x0 + 0.04, y, mark.z0 + 0.04, mark.x1 + 0.96, y + 0.06, mark.z1 + 0.96, dark);
        watch(name, mark.x0, y, mark.z0, mark.x1 + 1, y + 0.2, mark.z1 + 1, false, dark);
      } else if (shape === "circle") {
        const radius = (mark.radius || root.Core.circleRadius(mark)) + 0.5;
        const cx = (mark.x0 + mark.x1 + 1) / 2;
        const cz = (mark.z0 + mark.z1 + 1) / 2;
        circleSeg(cx, y, cz, radius, INK);
        watch(name, mark.x0, y, mark.z0, mark.x1 + 1, y + 0.2, mark.z1 + 1, false, INK);
      } else {
        const i = 0.22;
        loopSeg(mark.x0 + i, y, mark.z0 + i, mark.x1 + 1 - i, mark.z1 + 1 - i, INK);
        watch(name, mark.x0, y, mark.z0, mark.x1 + 1, y + 0.2, mark.z1 + 1, false, INK);
      }
    }

    const shaftTop = planTop() + SHAFT_RISE;
    const pane = hex(pal.well, 0.22);
    for (const shaft of layout.shafts) {
      const room = roomOf(shaft.room);
      if (!room || !visible(room.floor)) continue;
      const span = roomSpan(room);
      if (!span) continue;
      const cap = shaft.cap === "glass" ? hex(pal.well, 0.35) : null;
      for (let x = shaft.x0; x <= shaft.x1; x += 1) {
        for (let z = shaft.z0; z <= shaft.z1; z += 1) {
          if (z === shaft.z0) sideQuad(glass, pane, x, z, "n", span[1], shaftTop);
          if (z === shaft.z1) sideQuad(glass, pane, x, z, "s", span[1], shaftTop);
          if (x === shaft.x0) sideQuad(glass, pane, x, z, "w", span[1], shaftTop);
          if (x === shaft.x1) sideQuad(glass, pane, x, z, "e", span[1], shaftTop);
          if (cap) topFace(glass, cap, x + 0.08, z + 0.08, x + 0.92, z + 0.92, shaftTop);
        }
      }
      watch(shaft.label || "Shaft", shaft.x0, span[1], shaft.z0, shaft.x1 + 1, shaftTop, shaft.z1 + 1, false, hex(pal.well, 1));
    }

    flushSeams();

    opaque = new Float32Array(solid);
    clear = new Float32Array(glass);
    uploadMesh();
  }

  function shader(gl, type, source) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, source);
    gl.compileShader(sh);
    return sh;
  }

  function setup(gl) {
    program = gl.createProgram();
    const vert = shader(gl, gl.VERTEX_SHADER, `
      attribute vec3 aPos;
      attribute vec3 aNrm;
      attribute vec4 aCol;
      uniform mat4 uMvp;
      varying vec3 vNrm;
      varying vec4 vCol;
      void main() {
        gl_Position = uMvp * vec4(aPos, 1.0);
        vNrm = aNrm;
        vCol = aCol;
      }
    `);
    const frag = shader(gl, gl.FRAGMENT_SHADER, `
      precision mediump float;
      varying vec3 vNrm;
      varying vec4 vCol;
      void main() {
        vec3 n = normalize(vNrm);
        vec3 L = normalize(vec3(0.35, 0.86, 0.28));
        float nd = max(dot(n, L), 0.0);
        float up = clamp(n.y, 0.0, 1.0);
        float light = min(1.0, 0.84 + 0.10 * up + 0.06 * nd);
        gl_FragColor = vec4(vCol.rgb * light, vCol.a);
      }
    `);
    gl.attachShader(program, vert);
    gl.attachShader(program, frag);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return false;
    gl.useProgram(program);
    uMvp = gl.getUniformLocation(program, "uMvp");
    attrib = {
      pos: gl.getAttribLocation(program, "aPos"),
      nrm: gl.getAttribLocation(program, "aNrm"),
      col: gl.getAttribLocation(program, "aCol"),
    };
    mesh.solid = gl.createBuffer();
    mesh.lines = gl.createBuffer();
    mesh.glass = gl.createBuffer();
    mesh.hover = gl.createBuffer();
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0.173, 0.149, 0.133, 1);
    return true;
  }

  function lookAt(out, eye, center) {
    let zx = eye[0] - center[0], zy = eye[1] - center[1], zz = eye[2] - center[2];
    let len = Math.hypot(zx, zy, zz) || 1;
    zx /= len; zy /= len; zz /= len;
    let xx = zz, xy = 0, xz = -zx;
    len = Math.hypot(xx, xy, xz) || 1;
    xx /= len; xy /= len; xz /= len;
    const yx = zy * xz - zz * xy;
    const yy = zz * xx - zx * xz;
    const yz = zx * xy - zy * xx;
    out[0] = xx; out[1] = yx; out[2] = zx; out[3] = 0;
    out[4] = xy; out[5] = yy; out[6] = zy; out[7] = 0;
    out[8] = xz; out[9] = yz; out[10] = zz; out[11] = 0;
    out[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2]);
    out[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]);
    out[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2]);
    out[15] = 1;
  }

  function perspective(out, aspect) {
    const f = 1 / Math.tan(0.45);
    const near = Math.max(0.04, dist * 0.0015);
    const far = dist * 14 + 280;
    const nf = 1 / (near - far);
    out.fill(0);
    out[0] = f / aspect;
    out[5] = f;
    out[10] = (far + near) * nf;
    out[11] = -1;
    out[14] = 2 * far * near * nf;
  }

  function multiply(out, a, b) {
    for (let c = 0; c < 4; c += 1) {
      for (let r = 0; r < 4; r += 1) {
        out[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
      }
    }
  }

  function eyePos() {
    const cp = Math.cos(pitch);
    const sp = Math.sin(pitch);
    return [
      target[0] + dist * cp * Math.sin(yaw),
      target[1] + dist * sp,
      target[2] + dist * cp * Math.cos(yaw),
    ];
  }

  function basis() {
    const eye = eyePos();
    let fx = target[0] - eye[0], fy = target[1] - eye[1], fz = target[2] - eye[2];
    const fl = Math.hypot(fx, fy, fz) || 1;
    fx /= fl; fy /= fl; fz /= fl;
    let rx = -fz, ry = 0, rz = fx;
    const rl = Math.hypot(rx, ry, rz) || 1;
    rx /= rl; ry /= rl; rz /= rl;
    return {
      forward: [fx, fy, fz],
      right: [rx, ry, rz],
      up: [ry * fz - rz * fy, rz * fx - rx * fz, rx * fy - ry * fx],
    };
  }

  function frame() {
    if (!bounds || bounds.min[0] > bounds.max[0]) return;
    target[0] = (bounds.min[0] + bounds.max[0]) / 2 - origin[0];
    target[1] = (bounds.min[1] + bounds.max[1]) / 2 - origin[1];
    target[2] = (bounds.min[2] + bounds.max[2]) / 2 - origin[2];
    const dx = bounds.max[0] - bounds.min[0];
    const dy = bounds.max[1] - bounds.min[1];
    const dz = bounds.max[2] - bounds.min[2];
    const aspect = (canvas.el.clientWidth || 1) / (canvas.el.clientHeight || 1);
    const span = Math.max(dx, dz * 1.2, dy * 3);
    dist = (span * 0.58) / Math.tan(0.45);
    if (aspect < 1) dist /= aspect;
    dist = Math.min(1200, Math.max(12, dist));
  }

  function frameBox(item) {
    const min = item.min;
    const max = item.max;
    target[0] = (min[0] + max[0]) / 2;
    target[1] = (min[1] + max[1]) / 2;
    target[2] = (min[2] + max[2]) / 2;
    const dx = Math.max(1, max[0] - min[0]);
    const dy = Math.max(1, max[1] - min[1]);
    const dz = Math.max(1, max[2] - min[2]);
    const aspect = (canvas.el.clientWidth || 1) / (canvas.el.clientHeight || 1);
    const span = Math.max(dx, dz * 1.2, dy * 2.2, 4);
    dist = (span * 0.7) / Math.tan(0.45);
    if (aspect < 1) dist /= aspect;
    dist = Math.min(1200, Math.max(8, dist));
  }

  function bindMesh(gl, buffer) {
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.enableVertexAttribArray(attrib.pos);
    gl.vertexAttribPointer(attrib.pos, 3, gl.FLOAT, false, 40, 0);
    gl.enableVertexAttribArray(attrib.nrm);
    gl.vertexAttribPointer(attrib.nrm, 3, gl.FLOAT, false, 40, 12);
    gl.enableVertexAttribArray(attrib.col);
    gl.vertexAttribPointer(attrib.col, 4, gl.FLOAT, false, 40, 24);
  }

  function uploadMesh() {
    const gl = canvas.gl;
    if (!gl || !mesh.solid) return;
    const put = (buffer, data) => {
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      const src = data && data.length ? data : new Float32Array(0);
      gl.bufferData(gl.ARRAY_BUFFER, src, gl.STATIC_DRAW);
      return src.length / 10;
    };
    mesh.solidN = put(mesh.solid, opaque);
    mesh.glassN = put(mesh.glass, clear);
    edgeKey = "";
    hoverKey = "";
  }

  function edgePixelWidth() {
    const h = canvas.el.clientHeight || 1;
    const worldPerPx = (2 * dist * Math.tan(0.45)) / h;
    return Math.min(0.05, Math.max(0.02, worldPerPx * 0.85));
  }

  function refreshEdges() {
    const width = edgePixelWidth();
    const stamp = `${width.toFixed(3)}:${edgeSegs.length}`;
    if (stamp === edgeKey) return;
    edgeKey = stamp;
    const dst = [];
    for (const s of edgeSegs) ribbon(dst, s[0], s[1], s[2], s[3], s[4], s[5], s[6], width);
    const data = new Float32Array(dst);
    const gl = canvas.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.lines);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    mesh.lineN = data.length / 10;
  }

  function refreshHover() {
    const width = edgePixelWidth();
    const stamp = hovered ? `${hovered.box.join(",")}:${width.toFixed(3)}` : "";
    if (stamp === hoverKey) return;
    hoverKey = stamp;
    const dst = [];
    if (hovered) {
      const [x0, y0, z0, x1, y1, z1] = hovered.box;
      const color = lighten(hovered.color, 0.58);
      const w = width * 1.8;
      const edge = (ax, ay, az, bx, by, bz) => ribbon(dst, ax, ay, az, bx, by, bz, color, w);
      edge(x0, y0, z0, x1, y0, z0);
      edge(x1, y0, z0, x1, y0, z1);
      edge(x1, y0, z1, x0, y0, z1);
      edge(x0, y0, z1, x0, y0, z0);
      edge(x0, y1, z0, x1, y1, z0);
      edge(x1, y1, z0, x1, y1, z1);
      edge(x1, y1, z1, x0, y1, z1);
      edge(x0, y1, z1, x0, y1, z0);
      edge(x0, y0, z0, x0, y1, z0);
      edge(x1, y0, z0, x1, y1, z0);
      edge(x0, y0, z1, x0, y1, z1);
      edge(x1, y0, z1, x1, y1, z1);
    }
    const data = new Float32Array(dst);
    const gl = canvas.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.hover);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    mesh.hoverN = data.length / 10;
  }

  function drawMesh(gl, buffer, count, mode, mask) {
    if (!count) return;
    bindMesh(gl, buffer);
    gl.depthMask(mask);
    gl.drawArrays(mode, 0, count);
  }

  function project(x, y, z, w, h) {
    const px = x - origin[0];
    const py = y - origin[1];
    const pz = z - origin[2];
    const m = matMvp;
    const cx = m[0] * px + m[4] * py + m[8] * pz + m[12];
    const cy = m[1] * px + m[5] * py + m[9] * pz + m[13];
    const cw = m[3] * px + m[7] * py + m[11] * pz + m[15];
    if (cw <= 0.08) return null;
    const nx = cx / cw;
    const ny = cy / cw;
    if (nx < -1.08 || nx > 1.08 || ny < -1.08 || ny > 1.08) return null;
    return { x: (nx * 0.5 + 0.5) * w, y: (0.5 - ny * 0.5) * h };
  }

  /**
   * Whether a floor above cuts the line from the eye to a point, both in block coordinates.
   * Names are painted over the scene, so this is what hides one on a floor below.
   */
  function covered(eye, x, y, z) {
    for (const slab of slabs) {
      if (slab.y <= y + 0.5 || slab.y >= eye[1]) continue;
      const t = (eye[1] - slab.y) / (eye[1] - y);
      const px = eye[0] + (x - eye[0]) * t;
      const pz = eye[2] + (z - eye[2]) * t;
      if (px >= slab.x0 && px <= slab.x1 && pz >= slab.z0 && pz <= slab.z1) return true;
    }
    return false;
  }

  function paintLabels() {
    const el = tags.el || (typeof document !== "undefined" ? document.getElementById("space-tags") : null);
    if (!el || !canvas.el) return;
    tags.el = el;
    if (!tags.ctx) tags.ctx = el.getContext("2d");
    const cssW = canvas.el.clientWidth || 1;
    const cssH = canvas.el.clientHeight || 1;
    const dpr = window.devicePixelRatio || 1;
    const pw = Math.round(cssW * dpr);
    const ph = Math.round(cssH * dpr);
    if (el.width !== pw || el.height !== ph) {
      el.width = pw;
      el.height = ph;
    }
    const ctx = tags.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    const halo = (text, x, y) => {
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(244, 241, 234, 0.92)";
      ctx.strokeText(text, x, y);
      ctx.fillStyle = "#241e18";
      ctx.fillText(text, x, y);
    };
    const eye = eyePos().map((v, i) => v + origin[i]);
    for (const item of labels) {
      if (covered(eye, item.x, item.y, item.z)) continue;
      if (item.kind === "room") {
        const y = item.y;
        const corners = [
          project(item.x0, y, item.z0, cssW, cssH),
          project(item.x1, y, item.z0, cssW, cssH),
          project(item.x1, y, item.z1, cssW, cssH),
          project(item.x0, y, item.z1, cssW, cssH),
        ].filter(Boolean);
        if (corners.length < 2) continue;
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (const p of corners) {
          minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
          minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
        }
        const pw = maxX - minX;
        const ph = maxY - minY;
        if (Math.min(pw, ph) < 48) continue;
        const at = project(item.x, item.y, item.z, cssW, cssH);
        if (!at) continue;
        const size = Math.max(11, Math.min(18, Math.max(pw, ph) / 9));
        ctx.font = `bold ${size}px Segoe UI, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        let text = item.name;
        if (ctx.measureText(text).width > pw * 0.82) text = item.code || text;
        if (ctx.measureText(text).width > pw * 0.9) continue;
        halo(text, at.x, at.y);
      } else if (item.kind === "street") {
        const alongX = (item.x1 - item.x0) >= (item.z1 - item.z0);
        const a = project(item.x, item.y, item.z, cssW, cssH);
        const b = project(item.x + (alongX ? 4 : 0), item.y, item.z + (alongX ? 0 : 4), cssW, cssH);
        if (!a || !b || Math.hypot(a.x - b.x, a.y - b.y) < 22) continue;
        ctx.font = "bold 12px Segoe UI, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.save();
        ctx.translate(a.x, a.y);
        if (item.vertical) ctx.rotate(-Math.PI / 2);
        halo(item.name, 0, 0);
        ctx.restore();
      }
    }
  }

  function draw() {
    const gl = canvas.gl;
    if (!gl || !opaque) return;
    const w = canvas.el.clientWidth || 1;
    const h = canvas.el.clientHeight || 1;
    const dpr = window.devicePixelRatio || 1;
    const pw = Math.round(w * dpr);
    const ph = Math.round(h * dpr);
    if (canvas.el.width !== pw || canvas.el.height !== ph) {
      canvas.el.width = pw;
      canvas.el.height = ph;
    }
    gl.viewport(0, 0, canvas.el.width, canvas.el.height);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    perspective(matProj, canvas.el.width / Math.max(1, canvas.el.height));
    lookAt(matView, eyePos(), target);
    multiply(matMvp, matProj, matView);
    gl.useProgram(program);
    gl.uniformMatrix4fv(uMvp, false, matMvp);
    drawMesh(gl, mesh.solid, mesh.solidN, gl.TRIANGLES, true);
    refreshEdges();
    drawMesh(gl, mesh.lines, mesh.lineN, gl.TRIANGLES, true);
    drawMesh(gl, mesh.glass, mesh.glassN, gl.TRIANGLES, true);
    refreshHover();
    drawMesh(gl, mesh.hover, mesh.hoverN, gl.TRIANGLES, true);
    gl.depthMask(true);
    paintLabels();
  }

  function drawSoon() {
    if (viewFrame) return;
    viewFrame = requestAnimationFrame(() => {
      viewFrame = 0;
      draw();
    });
  }

  function pointerRay(event) {
    const rect = canvas.el.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const ndcX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = 1 - ((event.clientY - rect.top) / rect.height) * 2;
    const { forward, right, up } = basis();
    const scale = Math.tan(0.45);
    const aspect = rect.width / rect.height;
    const dx = forward[0] + right[0] * ndcX * scale * aspect + up[0] * ndcY * scale;
    const dy = forward[1] + right[1] * ndcX * scale * aspect + up[1] * ndcY * scale;
    const dz = forward[2] + right[2] * ndcX * scale * aspect + up[2] * ndcY * scale;
    const len = Math.hypot(dx, dy, dz) || 1;
    return { eye: eyePos(), dir: [dx / len, dy / len, dz / len] };
  }

  function rayAabb(eye, dir, min, max) {
    let tmin = 0;
    let tmax = 1e9;
    for (let i = 0; i < 3; i += 1) {
      if (Math.abs(dir[i]) < 1e-8) {
        if (eye[i] < min[i] || eye[i] > max[i]) return null;
        continue;
      }
      let t1 = (min[i] - eye[i]) / dir[i];
      let t2 = (max[i] - eye[i]) / dir[i];
      if (t1 > t2) { const swap = t1; t1 = t2; t2 = swap; }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return null;
    }
    if (tmax < 0) return null;
    return tmin >= 0 ? tmin : tmax;
  }

  function pick(ray) {
    let best = null;
    let bestT = 1e9;
    for (const item of picks) {
      let t = rayAabb(ray.eye, ray.dir, item.min, item.max);
      if (t === null) continue;
      if (item.open && ray.dir[1] < 0) {
        const y = ray.eye[1] + ray.dir[1] * t;
        if (Math.abs(y - item.max[1]) < 0.08) {
          const tf = (item.min[1] - ray.eye[1]) / ray.dir[1];
          if (tf < t) continue;
          const x = ray.eye[0] + ray.dir[0] * tf;
          const z = ray.eye[2] + ray.dir[2] * tf;
          if (x < item.min[0] || x > item.max[0] || z < item.min[2] || z > item.max[2]) continue;
          t = tf;
        }
      }
      if (t < bestT) { bestT = t; best = item; }
    }
    return best;
  }

  function look(event) {
    const ray = pointerRay(event);
    const hit = ray ? pick(ray) : null;
    if (hit === hovered) return;
    hovered = hit;
    tell(hit ? hit.name : "");
    drawSoon();
  }

  function onDown(event) {
    if (event.button !== 0 && event.button !== 2) return;
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, button: event.button };
    canvas.el.classList.add("dragging");
    try { canvas.el.setPointerCapture(event.pointerId); } catch (err) { /* Move events still arrive. */ }
  }

  function onMove(event) {
    if (!drag || drag.id !== event.pointerId) {
      if (!drag) look(event);
      return;
    }
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    drag.x = event.clientX;
    drag.y = event.clientY;
    if (drag.button === 2 || event.shiftKey) {
      const { right, up } = basis();
      const scale = dist * 0.0015;
      target[0] += (-dx * right[0] + dy * up[0]) * scale;
      target[1] += (-dx * right[1] + dy * up[1]) * scale;
      target[2] += (-dx * right[2] + dy * up[2]) * scale;
    } else {
      yaw -= dx * 0.007;
      pitch = Math.min(1.5, Math.max(0.15, pitch - dy * 0.007));
    }
    drawSoon();
  }

  function onUp(event) {
    if (!drag || drag.id !== event.pointerId) return;
    drag = null;
    canvas.el.classList.remove("dragging");
    look(event);
  }

  function onWheel(event) {
    event.preventDefault();
    const ray = pointerRay(event);
    const hit = ray ? pick(ray) : null;
    const factor = Math.exp(event.deltaY * 0.001);
    dist = Math.min(1200, Math.max(8, dist * factor));
    if (hit && factor < 1) {
      const t = rayAabb(ray.eye, ray.dir, hit.min, hit.max);
      if (t) {
        const k = Math.min(0.4, 1 - factor);
        target[0] += (ray.eye[0] + ray.dir[0] * t - target[0]) * k;
        target[1] += (ray.eye[1] + ray.dir[1] * t - target[1]) * k * 0.35;
        target[2] += (ray.eye[2] + ray.dir[2] * t - target[2]) * k;
      }
    }
    drawSoon();
    look(event);
  }

  function onDouble(event) {
    const ray = pointerRay(event);
    const hit = ray ? pick(ray) : null;
    if (hit) frameBox(hit);
    else reset();
    draw();
  }

  function reset() {
    yaw = HOME_YAW;
    pitch = HOME_PITCH;
    frame();
    draw();
  }

  function open(el, nextLayout, nextCatalog, onHover, fill) {
    canvas.el = el;
    layout = nextLayout;
    catalog = nextCatalog;
    tell = onHover || function () {};
    if (fill) padColor = fill;
    shown = null;
    hovered = null;
    if (!canvas.gl) {
      canvas.gl = el.getContext("webgl", { antialias: true, alpha: false });
      if (!canvas.gl || !setup(canvas.gl)) return false;
      el.addEventListener("pointerdown", onDown);
      el.addEventListener("pointermove", onMove);
      el.addEventListener("pointerup", onUp);
      el.addEventListener("pointercancel", onUp);
      el.addEventListener("contextmenu", (event) => event.preventDefault());
      el.addEventListener("wheel", onWheel, { passive: false });
      el.addEventListener("dblclick", onDouble);
    }
    build();
    reset();
    return true;
  }

  function setVisible(id, on) {
    if (!layout) return;
    if (!shown) shown = new Set(root.Core.layers(layout).map((layer) => layer.id));
    if (on) shown.add(id);
    else shown.delete(id);
    build();
    draw();
  }

  function resize() {
    draw();
  }

  function close() {
    if (viewFrame) cancelAnimationFrame(viewFrame);
    viewFrame = 0;
    drag = null;
    hovered = null;
    if (canvas.el) canvas.el.classList.remove("dragging");
    if (tags.ctx && tags.el) {
      tags.ctx.setTransform(1, 0, 0, 1, 0, 0);
      tags.ctx.clearRect(0, 0, tags.el.width, tags.el.height);
    }
  }

  root.View3D = { open, close, resize, setVisible, reset };
}(window));
