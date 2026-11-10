/* The camera of the 3D view. It circles a target point: yaw turns it around, pitch tilts it,
   and dist is how far back it stands. Positions here are measured from the scene's origin. */
(function (root) {
  "use strict";

  const HOME_YAW = 0;
  const HOME_PITCH = 1.0;
  // Half the height of the view, as an angle.
  const HALF_FOV = 0.45;
  const NEAREST = 8;
  const FARTHEST = 1200;

  /** A camera at the home angles. */
  function create() {
    return { yaw: HOME_YAW, pitch: HOME_PITCH, dist: 180, target: [0, 0, 0] };
  }

  /** Turn a camera back to the home angles. Its target and distance stay. */
  function home(cam) {
    cam.yaw = HOME_YAW;
    cam.pitch = HOME_PITCH;
  }

  /** Where the camera stands. */
  function eye(cam) {
    const cp = Math.cos(cam.pitch);
    const sp = Math.sin(cam.pitch);
    return [
      cam.target[0] + cam.dist * cp * Math.sin(cam.yaw),
      cam.target[1] + cam.dist * sp,
      cam.target[2] + cam.dist * cp * Math.cos(cam.yaw),
    ];
  }

  /** The camera's own axes: the way it looks, its right, and its up. */
  function basis(cam) {
    const from = eye(cam);
    let fx = cam.target[0] - from[0], fy = cam.target[1] - from[1], fz = cam.target[2] - from[2];
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

  // ---- matrices, column by column as WebGL takes them ----

  /** Fill `out` with the matrix that moves the world in front of an eye looking at a point. */
  function lookAt(out, from, center) {
    let zx = from[0] - center[0], zy = from[1] - center[1], zz = from[2] - center[2];
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
    out[12] = -(xx * from[0] + xy * from[1] + xz * from[2]);
    out[13] = -(yx * from[0] + yy * from[1] + yz * from[2]);
    out[14] = -(zx * from[0] + zy * from[1] + zz * from[2]);
    out[15] = 1;
  }

  /** Fill `out` with the matrix that gives depth. The near and far planes follow the camera's distance. */
  function perspective(out, aspect, dist) {
    const f = 1 / Math.tan(HALF_FOV);
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

  /** Fill `out` with a times b. */
  function multiply(out, a, b) {
    for (let c = 0; c < 4; c += 1) {
      for (let r = 0; r < 4; r += 1) {
        out[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
      }
    }
  }

  /** Where a point in block coordinates lands on a w by h screen, or null when it is behind or far off it. */
  function project(mvp, origin, x, y, z, w, h) {
    const px = x - origin[0];
    const py = y - origin[1];
    const pz = z - origin[2];
    const cx = mvp[0] * px + mvp[4] * py + mvp[8] * pz + mvp[12];
    const cy = mvp[1] * px + mvp[5] * py + mvp[9] * pz + mvp[13];
    const cw = mvp[3] * px + mvp[7] * py + mvp[11] * pz + mvp[15];
    if (cw <= 0.08) return null;
    const nx = cx / cw;
    const ny = cy / cw;
    if (nx < -1.08 || nx > 1.08 || ny < -1.08 || ny > 1.08) return null;
    return { x: (nx * 0.5 + 0.5) * w, y: (0.5 - ny * 0.5) * h };
  }

  // ---- framing ----

  /** Stand far enough back to see a span of blocks filling `fill` of the view, no nearer than `nearest`. */
  function standBack(cam, span, fill, aspect, nearest) {
    cam.dist = (span * fill) / Math.tan(HALF_FOV);
    if (aspect < 1) cam.dist /= aspect;
    cam.dist = Math.min(FARTHEST, Math.max(nearest, cam.dist));
  }

  /** Aim at the middle of the whole scene and stand back to see it. `bounds` is in block coordinates. */
  function frameScene(cam, bounds, origin, aspect) {
    if (!bounds || bounds.min[0] > bounds.max[0]) return;
    cam.target[0] = (bounds.min[0] + bounds.max[0]) / 2 - origin[0];
    cam.target[1] = (bounds.min[1] + bounds.max[1]) / 2 - origin[1];
    cam.target[2] = (bounds.min[2] + bounds.max[2]) / 2 - origin[2];
    const dx = bounds.max[0] - bounds.min[0];
    const dy = bounds.max[1] - bounds.min[1];
    const dz = bounds.max[2] - bounds.min[2];
    standBack(cam, Math.max(dx, dz * 1.2, dy * 3), 0.58, aspect, 12);
  }

  /** Aim at the middle of one thing and stand back to see it. */
  function frameBox(cam, item, aspect) {
    const { min, max } = item;
    cam.target[0] = (min[0] + max[0]) / 2;
    cam.target[1] = (min[1] + max[1]) / 2;
    cam.target[2] = (min[2] + max[2]) / 2;
    const dx = Math.max(1, max[0] - min[0]);
    const dy = Math.max(1, max[1] - min[1]);
    const dz = Math.max(1, max[2] - min[2]);
    standBack(cam, Math.max(dx, dz * 1.2, dy * 2.2, 4), 0.7, aspect, NEAREST);
  }

  // ---- moving ----

  /** Turn and tilt by a drag of (dx, dy) pixels. The tilt stops short of level and of straight down. */
  function turn(cam, dx, dy) {
    cam.yaw -= dx * 0.007;
    cam.pitch = Math.min(1.5, Math.max(0.15, cam.pitch - dy * 0.007));
  }

  /** Slide the target by a drag of (dx, dy) pixels, so the scene follows the pointer. */
  function slide(cam, dx, dy) {
    const { right, up } = basis(cam);
    const scale = cam.dist * 0.0015;
    cam.target[0] += (-dx * right[0] + dy * up[0]) * scale;
    cam.target[1] += (-dx * right[1] + dy * up[1]) * scale;
    cam.target[2] += (-dx * right[2] + dy * up[2]) * scale;
  }

  /**
   * Move in or out by a factor. Moving in also pulls the target toward the thing under the pointer:
   * `aim` is the pointer's ray before the move and `hit` what it struck, or null.
   */
  function zoom(cam, factor, aim, hit) {
    cam.dist = Math.min(FARTHEST, Math.max(NEAREST, cam.dist * factor));
    if (!hit || !(factor < 1)) return;
    const t = rayAabb(aim.eye, aim.dir, hit.min, hit.max);
    if (!t) return;
    const k = Math.min(0.4, 1 - factor);
    cam.target[0] += (aim.eye[0] + aim.dir[0] * t - cam.target[0]) * k;
    cam.target[1] += (aim.eye[1] + aim.dir[1] * t - cam.target[1]) * k * 0.35;
    cam.target[2] += (aim.eye[2] + aim.dir[2] * t - cam.target[2]) * k;
  }

  // ---- what is under the pointer ----

  /**
   * The ray from the eye through a point of the view. ndcX and ndcY run from -1 to 1, right and up.
   * Returns { eye, dir }.
   */
  function ray(cam, ndcX, ndcY, aspect) {
    const { forward, right, up } = basis(cam);
    const scale = Math.tan(HALF_FOV);
    const dx = forward[0] + right[0] * ndcX * scale * aspect + up[0] * ndcY * scale;
    const dy = forward[1] + right[1] * ndcX * scale * aspect + up[1] * ndcY * scale;
    const dz = forward[2] + right[2] * ndcX * scale * aspect + up[2] * ndcY * scale;
    const len = Math.hypot(dx, dy, dz) || 1;
    return { eye: eye(cam), dir: [dx / len, dy / len, dz / len] };
  }

  /** How far along a ray it enters a box, or leaves it when it starts inside. Null when it misses. */
  function rayAabb(from, dir, min, max) {
    let tmin = 0;
    let tmax = 1e9;
    for (let i = 0; i < 3; i += 1) {
      if (Math.abs(dir[i]) < 1e-8) {
        if (from[i] < min[i] || from[i] > max[i]) return null;
        continue;
      }
      let t1 = (min[i] - from[i]) / dir[i];
      let t2 = (max[i] - from[i]) / dir[i];
      if (t1 > t2) { const swap = t1; t1 = t2; t2 = swap; }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return null;
    }
    if (tmax < 0) return null;
    return tmin >= 0 ? tmin : tmax;
  }

  /**
   * How far along a ray it strikes one thing, or null. A room is an open box: a ray coming down through
   * its missing lid strikes the floor instead, and misses when it lands outside the room.
   */
  function strike(item, from, dir) {
    const t = rayAabb(from, dir, item.min, item.max);
    if (t === null || !item.open || !(dir[1] < 0)) return t;
    const y = from[1] + dir[1] * t;
    if (!(Math.abs(y - item.max[1]) < 0.08)) return t;
    const tf = (item.min[1] - from[1]) / dir[1];
    if (tf < t) return null;
    const x = from[0] + dir[0] * tf;
    const z = from[2] + dir[2] * tf;
    if (x < item.min[0] || x > item.max[0] || z < item.min[2] || z > item.max[2]) return null;
    return tf;
  }

  /** The nearest thing a ray strikes, or null. */
  function pick(picks, aim) {
    let best = null;
    let bestT = 1e9;
    for (const item of picks) {
      const t = strike(item, aim.eye, aim.dir);
      if (t === null) continue;
      if (t < bestT) { bestT = t; best = item; }
    }
    return best;
  }

  root.Camera3D = {
    HALF_FOV, create, home, eye, basis, lookAt, perspective, multiply, project,
    frameScene, frameBox, turn, slide, zoom, ray, rayAabb, pick,
  };
}(window));
