/* Shapes for the 3D view: lists of triangles, and the outlines drawn over them.
   Everything is in block coordinates. A corner is stored as ten numbers: where it is, measured from
   an origin so the numbers stay small, then the way its face points, then its color. */
(function (root) {
  "use strict";

  // The color of outlines and of anything with no color of its own.
  const INK = [0.29, 0.24, 0.2, 1];
  const UNKNOWN_COLOR = "#888888";
  // Numbers per corner: position, normal, color.
  const CORNER_SIZE = 10;
  // A wall's lowest block is drawn a shade darker.
  const WALL_FOOT_SHADE = 0.82;

  // ---- colors ----

  /** A "#RRGGBB" color as [red, green, blue, alpha], each from 0 to 1. Alpha is 1 unless given. */
  function hex(color, alpha) {
    const n = parseInt(String(color || UNKNOWN_COLOR).slice(1), 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, alpha == null ? 1 : alpha];
  }

  /** A color made darker by a factor, keeping its alpha. */
  function shade(color, k) {
    return [color[0] * k, color[1] * k, color[2] * k, color[3]];
  }

  /** A color moved a fraction of the way to white, fully opaque. */
  function lighten(color, t) {
    return [
      color[0] + (1 - color[0]) * t,
      color[1] + (1 - color[1]) * t,
      color[2] + (1 - color[2]) * t,
      1,
    ];
  }

  // ---- triangles ----

  /** The way a triangle faces, as a vector of length 1. */
  function normal(a, b, c) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const x = uy * vz - uz * vy;
    const y = uz * vx - ux * vz;
    const z = ux * vy - uy * vx;
    const len = Math.hypot(x, y, z) || 1;
    return [x / len, y / len, z / len];
  }

  /**
   * Two directions across a line that runs along (dx, dy, dz), a vector of length 1. Both have
   * length 1 and are square to the line and to each other. Returns [vx, vy, vz, wx, wy, wz].
   */
  function crossAxes(dx, dy, dz) {
    // A guide axis that is not along the line: up, or east for a line that is nearly upright.
    const upright = Math.abs(dy) > 0.85;
    const ux = upright ? 1 : 0;
    const uy = upright ? 0 : 1;
    const uz = 0;
    let vx = dy * uz - dz * uy;
    let vy = dz * ux - dx * uz;
    let vz = dx * uy - dy * ux;
    const vl = Math.hypot(vx, vy, vz) || 1;
    vx /= vl; vy /= vl; vz /= vl;
    return [vx, vy, vz, vy * dz - vz * dy, vz * dx - vx * dz, vx * dy - vy * dx];
  }

  /** A list of triangles, three corners each. */
  class Triangles {
    constructor(origin) {
      this.origin = origin;
      this.data = [];
    }

    /** The corners as the array WebGL takes. */
    toArray() {
      return new Float32Array(this.data);
    }

    /** Add one corner: a point, the way its face points, and its color. */
    corner(p, n, c) {
      const o = this.origin;
      this.data.push(
        p[0] - o[0], p[1] - o[1], p[2] - o[2],
        n[0], n[1], n[2], c[0], c[1], c[2], c[3],
      );
    }

    /** Add a triangle. Seen from the side it faces, its corners run counter-clockwise. */
    tri(color, a, b, c) {
      const n = normal(a, b, c);
      this.corner(a, n, color);
      this.corner(b, n, color);
      this.corner(c, n, color);
    }

    /** Add a flat four-sided face as two triangles. */
    quad(color, a, b, c, d) {
      this.tri(color, a, b, c);
      this.tri(color, a, c, d);
    }

    /** Add a face that looks up. Winding matches the top of box(). */
    topFace(color, x0, z0, x1, z1, y) {
      this.quad(color, [x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0]);
    }

    /** Add a box: its four sides, its underside, and its top unless it is open. */
    box(x0, y0, z0, x1, y1, z1, color, openTop) {
      const faces = [
        [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]],
        [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]],
        [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]],
        [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]],
        [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]],
      ];
      if (!openTop) faces.push([[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]]);
      for (const f of faces) this.quad(color, f[0], f[1], f[2], f[3]);
    }

    /** Add one side of the block at (x, z), from ya up to yb, looking out toward a compass side. */
    sideQuad(color, x, z, dir, ya, yb) {
      if (yb - ya < 0.01) return;
      if (dir === "w") this.quad(color, [x, ya, z], [x, ya, z + 1], [x, yb, z + 1], [x, yb, z]);
      else if (dir === "e") this.quad(color, [x + 1, ya, z + 1], [x + 1, ya, z], [x + 1, yb, z], [x + 1, yb, z + 1]);
      else if (dir === "n") this.quad(color, [x + 1, ya, z], [x, ya, z], [x, yb, z], [x + 1, yb, z]);
      else this.quad(color, [x, ya, z + 1], [x + 1, ya, z + 1], [x + 1, yb, z + 1], [x, yb, z + 1]);
    }

    /** Add one side of a wall block. Its lowest block is a shade darker, so walls read as standing on the floor. */
    wallSide(color, x, z, dir, y0, y1) {
      const cut = Math.min(y1, y0 + 1);
      this.sideQuad(shade(color, WALL_FOOT_SHADE), x, z, dir, y0, cut);
      if (y1 - cut > 0.02) this.sideQuad(color, x, z, dir, cut, y1);
    }

    /** Add a line from a to b as a thin square bar, so it has a width on screen. */
    ribbon(ax, ay, az, bx, by, bz, color, width) {
      const len = Math.hypot(bx - ax, by - ay, bz - az);
      if (len < 1e-4) return;
      const [vx, vy, vz, wx, wy, wz] = crossAxes((bx - ax) / len, (by - ay) / len, (bz - az) / len);
      const h = width * 0.5;
      const at = (x, y, z, su, sv) => [x + vx * su + wx * sv, y + vy * su + wy * sv, z + vz * su + wz * sv];
      const ring = [[-h, -h], [h, -h], [h, h], [-h, h]];
      for (let i = 0; i < 4; i += 1) {
        const c0 = ring[i];
        const c1 = ring[(i + 1) % 4];
        this.quad(color,
          at(ax, ay, az, c0[0], c0[1]),
          at(bx, by, bz, c0[0], c0[1]),
          at(bx, by, bz, c1[0], c1[1]),
          at(ax, ay, az, c1[0], c1[1]));
      }
    }
  }

  // ---- outlines ----

  /** A name for the line between two points that is the same from either end. */
  function edgeKey(ax, ay, az, bx, by, bz) {
    const r = (v) => Math.round(v * 100);
    const sa = `${r(ax)},${r(ay)},${r(az)}`;
    const sb = `${r(bx)},${r(by)},${r(bz)}`;
    return sa < sb ? `${sa}|${sb}` : `${sb}|${sa}`;
  }

  /** The two ends, as [x, z], of the side of block (x, z) that looks toward a compass side. */
  function sideEnds(x, z, dir) {
    if (dir === "w") return [[x, z], [x, z + 1]];
    if (dir === "e") return [[x + 1, z], [x + 1, z + 1]];
    if (dir === "n") return [[x, z], [x + 1, z]];
    return [[x, z + 1], [x + 1, z + 1]];
  }

  /**
   * The lines drawn over a scene, each once. Rock walls are many flat faces side by side, so their
   * edges are noted as seams first: only an edge with one face, or with faces that point different
   * ways, is a crease worth a line.
   */
  class Outlines {
    constructor() {
      this.segs = [];
      this.seen = new Set();
      this.seams = new Map();
    }

    /** Add a line from one point to another, unless it is already there. */
    seg(x0, y0, z0, x1, y1, z1, color) {
      const key = edgeKey(x0, y0, z0, x1, y1, z1);
      if (this.seen.has(key)) return;
      this.seen.add(key);
      this.segs.push([x0, y0, z0, x1, y1, z1, color]);
    }

    /** Add a flat rectangle of lines at one height. */
    loop(x0, y, z0, x1, z1, color) {
      this.seg(x0, y, z0, x1, y, z0, color);
      this.seg(x1, y, z0, x1, y, z1, color);
      this.seg(x1, y, z1, x0, y, z1, color);
      this.seg(x0, y, z1, x0, y, z0, color);
    }

    /** Add the twelve edges of a box. */
    wireBox(x0, y0, z0, x1, y1, z1, color) {
      this.loop(x0, y0, z0, x1, z1, color);
      this.loop(x0, y1, z0, x1, z1, color);
      this.seg(x0, y0, z0, x0, y1, z0, color);
      this.seg(x1, y0, z0, x1, y1, z0, color);
      this.seg(x0, y0, z1, x0, y1, z1, color);
      this.seg(x1, y0, z1, x1, y1, z1, color);
    }

    /** Add a flat circle of 32 lines. */
    circle(cx, y, cz, radius, color) {
      const n = 32;
      for (let i = 0; i < n; i += 1) {
        const a0 = (i / n) * Math.PI * 2;
        const a1 = ((i + 1) / n) * Math.PI * 2;
        this.seg(cx + Math.cos(a0) * radius, y, cz + Math.sin(a0) * radius,
          cx + Math.cos(a1) * radius, y, cz + Math.sin(a1) * radius, color);
      }
    }

    /** Note that a face pointing `dir` has this edge. */
    noteEdge(ax, ay, az, bx, by, bz, dir) {
      const key = edgeKey(ax, ay, az, bx, by, bz);
      let item = this.seams.get(key);
      if (!item) {
        item = { a: [ax, ay, az], b: [bx, by, bz], dirs: [] };
        this.seams.set(key, item);
      }
      item.dirs.push(dir);
    }

    /** Note the four edges of one side of the block at (x, z), from y0 up to y1. */
    noteSide(x, z, dir, y0, y1) {
      const [p, q] = sideEnds(x, z, dir);
      this.noteEdge(p[0], y0, p[1], q[0], y0, q[1], dir);
      this.noteEdge(p[0], y1, p[1], q[0], y1, q[1], dir);
      this.noteEdge(p[0], y0, p[1], p[0], y1, p[1], dir);
      this.noteEdge(q[0], y0, q[1], q[0], y1, q[1], dir);
    }

    /** Note the four edges of a face that looks up. */
    noteTop(x0, z0, x1, z1, y) {
      this.noteEdge(x0, y, z0, x1, y, z0, "u");
      this.noteEdge(x1, y, z0, x1, y, z1, "u");
      this.noteEdge(x1, y, z1, x0, y, z1, "u");
      this.noteEdge(x0, y, z1, x0, y, z0, "u");
    }

    /** Turn the noted seams that are creases into lines, and forget the rest. */
    flushSeams() {
      for (const item of this.seams.values()) {
        const dir = item.dirs[0];
        const crease = item.dirs.length === 1 || item.dirs.some((d) => d !== dir);
        if (crease) this.seg(item.a[0], item.a[1], item.a[2], item.b[0], item.b[1], item.b[2], INK);
      }
      this.seams.clear();
    }
  }

  root.Mesh3D = { INK, CORNER_SIZE, hex, shade, lighten, Triangles, Outlines };
}(window));
