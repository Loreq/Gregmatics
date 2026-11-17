/* Painting what stands in the rooms: floor marks, multiblocks, and machines. */
(function (App) {
  "use strict";

  const { Core, CATALOG, COLORS, state, L, cellBox, View, Paint, PaintZones, Machines } = App;

  // A multiblock's fill by tier, on the plan and in 3D. Tier "-" is the magic mods. A tier with no color here is `other`.
  const PAD_COLOR = {
    Stone: "#C4A882",
    Steam: "#D7A15A",
    LV: "#9BB0B8",
    MV: "#8FB48A",
    HV: "#7E97D0",
    EV: "#E0B15A",
    magic: "#B592C4",
    other: "#A3988C",
  };
  const SERVICE_FILL = "rgba(120, 114, 104, 0.3)";
  const MACHINE_FACE = "rgba(255, 255, 255, 0.85)";
  // A machine being dragged shows faint where it was.
  const LIFTED_ALPHA = 0.35;
  // A machine sits this far inside its cell, on every side, at every zoom that can hold it.
  const MACHINE_INSET = 1;
  // The face bar is a hairline, then this thick once that is still at most a sixth of the inner cell.
  const FACE_THIN = 1;
  const FACE_THICK = 2;
  const FACE_PART = 6;
  // Pollution, and a multiblock above the plan's tier, keep this rust outline.
  const RUST_EDGE = 2;
  const RUST_DASH = [4, 3];
  // Vertical dashes on a block two modules share. The first number is the dash, the second is the gap.
  const SHARE_DASH = [1, 2];
  // A multiblock's name shows from this many pixels a block. Its code and tier use the gates below.
  const NAME_FROM = 4;
  const CODE_FROM = 16;
  const TIER_FROM = 10;

  // ---- multiblocks ----

  /** The fill for a multiblock, by its tier. */
  function padFill(spec) {
    if (spec.tier && PAD_COLOR[spec.tier]) return PAD_COLOR[spec.tier];
    if (spec.tier === "-") return PAD_COLOR.magic;
    return PAD_COLOR.other;
  }

  /** A shell: its ring of blocks in the fill, with its door left pale. */
  function paintShell(g, v, p, fill) {
    for (let x = p.x0; x <= p.x1; x += 1) {
      for (let z = p.z0; z <= p.z1; z += 1) {
        const edge = x === p.x0 || x === p.x1 || z === p.z0 || z === p.z1;
        if (!edge) continue;
        const isDoor = Array.isArray(p.door) && p.door[0] === x && p.door[1] === z;
        const c = View.cellRect(x, z, v);
        g.fillStyle = isDoor ? COLORS.PAPER : fill;
        g.fillRect(c.x, c.y, c.w, c.h);
      }
    }
  }

  /** The face bar's thickness: 1px, or 2px once that is still at most a sixth of the cell. */
  function faceBar(inner) {
    return inner >= FACE_THICK * FACE_PART ? FACE_THICK : FACE_THIN;
  }

  /** A solid multiblock: its fill, and the cell grid inside it when there is more than one block. */
  function paintBody(g, v, p, r, fill, part) {
    if (part !== "grid") {
      g.fillStyle = fill;
      g.fillRect(r.x, r.y, r.w, r.h);
    }
    if (part === "fill") return;
    const oneBlock = p.x0 === p.x1 && p.z0 === p.z1;
    if (v.scale < Paint.GRID_FROM || oneBlock) return;
    g.strokeStyle = Paint.cellInk();
    g.lineWidth = 1;
    g.setLineDash([]);
    g.beginPath();
    PaintZones.traceGrid(g, v, p, { left: r.x, right: r.x + r.w, top: r.y, bottom: r.y + r.h });
    g.stroke();
  }

  /** One line on each shared wall of a wallshared row, in the room wall's weight. */
  function paintModuleEdges(g, v, pad, mods) {
    const wx = pad.wx || 1;
    const wz = pad.wz || 1;
    if (wx <= 1 && wz <= 1) return;
    const top = View.blockY(pad.z0, v);
    const bottom = View.blockY(pad.z1 + 1, v);
    const left = View.blockX(pad.x0, v);
    const right = View.blockX(pad.x1 + 1, v);
    g.strokeStyle = COLORS.WALL;
    g.lineWidth = Paint.wallWidth(v.scale);
    g.lineCap = "butt";
    g.setLineDash([]);
    g.beginPath();
    for (let i = 0; i < wx - 1; i += 1) {
      const x = mods[i * wz].x1;
      const x0 = View.blockX(x, v);
      const px = Math.floor((x0 + View.blockX(x + 1, v)) / 2) + 0.5;
      g.moveTo(px, top);
      g.lineTo(px, bottom);
    }
    for (let j = 0; j < wz - 1; j += 1) {
      const z = mods[j].z1;
      const y0 = View.blockY(z, v);
      const py = Math.floor((y0 + View.blockY(z + 1, v)) / 2) + 0.5;
      g.moveTo(left, py);
      g.lineTo(right, py);
    }
    g.stroke();
  }

  /** A thin face bar on the front edge of the block that holds a module's controller. */
  function paintController(g, v, mod) {
    const [fx, fz] = Core.frontCell(mod);
    const fc = View.cellRect(fx, fz, v);
    const thick = faceBar(Math.min(fc.w, fc.h));
    g.fillStyle = MACHINE_FACE;
    if (mod.front === "n") g.fillRect(fc.x, fc.y, fc.w, thick);
    else if (mod.front === "s") g.fillRect(fc.x, fc.y + fc.h - thick, fc.w, thick);
    else if (mod.front === "w") g.fillRect(fc.x, fc.y, thick, fc.h);
    else g.fillRect(fc.x + fc.w - thick, fc.y, thick, fc.h);
  }

  /** A multiblock's outline: rust when it pollutes, dashed rust when it is above the plan's tier. */
  function paintPadEdge(g, r, spec, scale) {
    const over = Boolean(spec.tier) && !Core.multiOpen(spec, Core.planTier(L()));
    const marked = spec.pollution || over;
    g.lineWidth = marked ? RUST_EDGE : Paint.wallWidth(scale);
    g.strokeStyle = marked ? COLORS.RUST : COLORS.WALL;
    g.lineCap = "butt";
    g.setLineDash(over && !spec.pollution ? RUST_DASH : []);
    g.strokeRect(r.x + 0.5, r.y + 0.5, Math.max(0, r.w - 1), Math.max(0, r.h - 1));
    g.setLineDash([]);
  }

  /** The name painted on a multiblock: its label, else its short name with the module count. */
  function padLabel(p, spec, count) {
    const short = spec.short || spec.name || "";
    return (p.label && String(p.label).trim()) || (count > 1 ? `${count}× ${short}` : short);
  }

  /** Paint a name in the middle of a rectangle, in the largest size that fits, or not at all. */
  function paintFittedName(g, r, name, sc) {
    if (r.w < 4 || r.h < 4) return;
    g.save();
    g.beginPath();
    g.rect(r.x, r.y, r.w, r.h);
    g.clip();
    g.textAlign = "center";
    g.textBaseline = "middle";
    const size = Paint.fitLabel(g, name, Math.max(4, r.w - 4), sc, r.h);
    if (size) Paint.halo(g, name, r.x + r.w / 2, r.y + r.h / 2);
    g.restore();
  }

  /** The footprint with each controller bar taken off its front, so the name has the middle. */
  function nameRect(v, p, mods) {
    const r = View.rectOf(p, v);
    let top = 0;
    let right = 0;
    let bottom = 0;
    let left = 0;
    for (const mod of mods) {
      const [fx, fz] = Core.frontCell(mod);
      const fc = View.cellRect(fx, fz, v);
      const thick = faceBar(Math.min(fc.w, fc.h));
      if (mod.front === "n") top = Math.max(top, thick);
      else if (mod.front === "s") bottom = Math.max(bottom, thick);
      else if (mod.front === "w") left = Math.max(left, thick);
      else right = Math.max(right, thick);
    }
    return {
      x: r.x + left, y: r.y + top,
      w: Math.max(0, r.w - left - right), h: Math.max(0, r.h - top - bottom),
    };
  }

  /** The blocks two neighboring modules both cover, each block once. */
  function sharedBlocks(pad) {
    const mods = Core.moduleList(pad);
    const wx = pad.wx || 1;
    const wz = pad.wz || 1;
    const seen = new Set();
    const blocks = [];
    for (let i = 0; i < wx; i += 1) {
      for (let j = 0; j < wz; j += 1) {
        const a = mods[i * wz + j];
        const neighbors = [];
        if (i + 1 < wx) neighbors.push(mods[(i + 1) * wz + j]);
        if (j + 1 < wz) neighbors.push(mods[i * wz + j + 1]);
        for (const b of neighbors) {
          for (let x = Math.max(a.x0, b.x0); x <= Math.min(a.x1, b.x1); x += 1) {
            for (let z = Math.max(a.z0, b.z0); z <= Math.min(a.z1, b.z1); z += 1) {
              const key = `${x},${z}`;
              if (seen.has(key)) continue;
              seen.add(key);
              blocks.push({ x, z });
            }
          }
        }
      }
    }
    return blocks;
  }

  /** One vertical dash stroke on each shared block, from its top to its bottom. */
  function paintSharedDashes(g, v, blocks) {
    g.strokeStyle = COLORS.WALL;
    g.lineWidth = Paint.wallWidth(v.scale);
    g.lineCap = "butt";
    g.setLineDash(SHARE_DASH);
    for (const block of blocks) {
      const x0 = View.blockX(block.x, v);
      const px = Math.floor((x0 + View.blockX(block.x + 1, v)) / 2) + 0.5;
      const top = View.blockY(block.z, v);
      const bottom = View.blockY(block.z + 1, v);
      g.beginPath();
      g.moveTo(px, top);
      g.lineTo(px, bottom);
      g.stroke();
    }
    g.setLineDash([]);
  }

  /** One wallshared row: each module's fill, then its grid, then its outline, then the dashes. */
  function paintWallshared(g, v, pad, spec, fill) {
    const mods = Core.moduleList(pad);
    for (const mod of mods) paintBody(g, v, mod, View.rectOf(mod, v), fill, "fill");
    for (const mod of mods) paintBody(g, v, mod, View.rectOf(mod, v), fill, "grid");
    for (const mod of mods) paintPadEdge(g, View.rectOf(mod, v), spec, v.scale);
    paintSharedDashes(g, v, sharedBlocks(pad));
  }

  /** One multiblock: a shell or one module as a single shape, or each module of a wallshared row, then the controllers. */
  function pad(g, v, p) {
    const spec = CATALOG.multis[p.key] || {};
    const fill = padFill(spec);
    const wx = p.wx || 1;
    const wz = p.wz || 1;
    const mods = Core.moduleList(p);
    if (spec.shell || (wx === 1 && wz === 1)) {
      const r = View.rectOf(p, v);
      if (spec.shell) paintShell(g, v, p, fill);
      else paintBody(g, v, p, r, fill);
      paintModuleEdges(g, v, p, mods);
      paintPadEdge(g, r, spec, v.scale);
    } else {
      paintWallshared(g, v, p, spec, fill);
    }
    for (const mod of mods) paintController(g, v, mod);
  }

  /** A multiblock's name, in the middle left after the controller bar, or nothing when that middle is too small. */
  function padName(g, v, p) {
    if (v.scale < NAME_FROM) return;
    const spec = CATALOG.multis[p.key] || {};
    const mods = Core.moduleList(p);
    const name = padLabel(p, spec, mods.length);
    if (name) paintFittedName(g, nameRect(v, p, mods), name, v.scale);
  }

  // ---- floor marks ----

  /** The radius, in blocks, a circle mark is drawn with. */
  function markRadius(m) {
    return (m.radius || Core.circleRadius(m)) + 0.5;
  }

  /** A mark's dashed outline: a circle, or a rectangle just inside its box. */
  function paintMarkEdge(g, m, r, sc) {
    g.setLineDash([4, 3]);
    g.strokeStyle = Paint.hexAlpha(COLORS.MARK, 0.75);
    g.lineWidth = 1;
    if (m.shape === "circle") {
      g.beginPath();
      g.arc(r.x + r.w / 2, r.y + r.h / 2, markRadius(m) * sc, 0, Math.PI * 2);
      g.stroke();
    } else {
      g.strokeRect(r.x + 1.5, r.y + 1.5, r.w - 3, r.h - 3);
    }
    g.setLineDash([]);
  }

  /** A mark's short name: under the top of a circle, or in the corner of a box, when it fits. */
  function paintMarkName(g, m, r, sc) {
    if (!m.short || sc < 5) return;
    Paint.setFont(g, Math.max(9, Math.min(12, sc * 1.1)), false);
    g.textBaseline = "top";
    if (m.shape === "circle") {
      const radius = markRadius(m) * sc;
      g.textAlign = "center";
      if (g.measureText(m.short).width < radius * 1.6) Paint.halo(g, m.short, r.x + r.w / 2, r.y + r.h / 2 - radius + 4);
      g.textAlign = "left";
      return;
    }
    g.textAlign = "left";
    if (g.measureText(m.short).width < r.w - 6) Paint.halo(g, m.short, r.x + 4, r.y + 3);
  }

  /** One floor mark. A service core is a grey pad, a name is only its text, and a well draws nothing here. */
  function mark(g, v, m) {
    const sc = v.scale;
    const r = View.rectOf(m, v);
    if (m.shape === "service") {
      g.fillStyle = SERVICE_FILL;
      g.fillRect(r.x, r.y, r.w, r.h);
      return;
    }
    if (m.shape === "text") {
      if (sc >= 8) Paint.painted(g, m.short, r.x + r.w / 2, r.y + r.h / 2, m.vertical, sc);
      return;
    }
    if (m.shape === "well") return;
    paintMarkEdge(g, m, r, sc);
    paintMarkName(g, m, r, sc);
  }

  // ---- machines ----

  /** A machine's fill and a hairline of wall ink on that fill, both inside the cell. */
  function paintMachineBlock(g, r, fill, inset) {
    const w = r.w - inset * 2;
    const h = r.h - inset * 2;
    if (w <= 0 || h <= 0) return;
    g.fillStyle = fill;
    g.fillRect(r.x + inset, r.y + inset, w, h);
    if (w < 2 || h < 2) return;
    g.strokeStyle = COLORS.WALL;
    g.lineWidth = 1;
    g.setLineDash([]);
    g.strokeRect(r.x + inset + 0.5, r.y + inset + 0.5, w - 1, h - 1);
  }

  /** The pale bar along the side a machine faces, inside the inset and clear of the center. */
  function paintMachineFace(g, r, face, inset) {
    const innerW = r.w - inset * 2;
    const innerH = r.h - inset * 2;
    if (innerW <= 0 || innerH <= 0) return;
    const bar = faceBar(Math.min(innerW, innerH));
    g.fillStyle = MACHINE_FACE;
    if (face === "n") g.fillRect(r.x + inset, r.y + inset, innerW, bar);
    if (face === "s") g.fillRect(r.x + inset, r.y + r.h - inset - bar, innerW, bar);
    if (face === "w") g.fillRect(r.x + inset, r.y + inset, bar, innerH);
    if (face === "e") g.fillRect(r.x + r.w - inset - bar, r.y + inset, bar, innerH);
  }

  /** The tier's box in the corner away from the face. */
  function tierRect(r, face, size, width, edge) {
    const x = face === "e" ? r.x + edge : r.x + r.w - edge - width;
    const y = face === "s" ? r.y + edge : r.y + r.h - edge - size;
    return { x, y, w: width, h: size };
  }

  /** Whether two text boxes meet, counting a two-pixel gap as meeting so the halos stay apart. */
  function boxesMeet(a, b) {
    return a.x < b.x + b.w + 2 && b.x < a.x + a.w + 2 && a.y < b.y + b.h + 2 && b.y < a.y + a.h + 2;
  }

  /** The tier's size and inset. The usual size until the code is drawn, then whatever still misses that code. */
  function tierLayout(g, r, face, tier, sc, inset, code) {
    const preferred = Math.min(11, Math.max(8, sc * 0.32));
    if (sc < CODE_FROM) return { size: preferred, edge: inset + 1 };
    const codeSize = Math.min(12, sc * 0.42);
    Paint.setFont(g, codeSize, true);
    const codeW = g.measureText(code).width;
    const codeBox = {
      x: r.x + (r.w - codeW) / 2, y: r.y + (r.h - codeSize) / 2, w: codeW, h: codeSize,
    };
    for (let size = preferred; size >= 1; size -= 1) {
      Paint.setFont(g, size, true);
      const width = g.measureText(tier).width;
      for (let edge = inset + 1; edge >= 0; edge -= 1) {
        const box = tierRect(r, face, size, width, edge);
        const inside = box.x >= r.x && box.y >= r.y && box.x + box.w <= r.x + r.w && box.y + box.h <= r.y + r.h;
        if (inside && !boxesMeet(box, codeBox)) return { size, edge };
      }
    }
    return { size: 0, edge: inset + 1 };
  }

  /** A machine's tier in a corner away from its face. MV, the usual tier, is not written. */
  function paintMachineTier(g, r, face, tier, sc, inset, code) {
    const { size, edge } = tierLayout(g, r, face, tier, sc, inset, code);
    if (!size) return;
    Paint.setFont(g, size, true);
    if (face === "e") {
      g.textAlign = "left";
      g.textBaseline = "bottom";
      Paint.halo(g, tier, r.x + edge, r.y + r.h - edge);
    } else if (face === "s") {
      g.textAlign = "right";
      g.textBaseline = "top";
      Paint.halo(g, tier, r.x + r.w - edge, r.y + edge);
    } else {
      g.textAlign = "right";
      g.textBaseline = "bottom";
      Paint.halo(g, tier, r.x + r.w - edge, r.y + r.h - edge);
    }
  }

  /** One machine on a cell: a block in its group's color, a bar on its face, and its code and tier when zoomed in. */
  function machine(g, v, code, face, x, z, alpha = 1, tier = Core.DEFAULT_TIER) {
    const sc = v.scale;
    const r = View.rectOf(cellBox(x, z), v);
    const spec = CATALOG.singles[code] || {};
    const inset = r.w > MACHINE_INSET * 2 && r.h > MACHINE_INSET * 2 ? MACHINE_INSET : 0;
    const fill = L().palette.groups[spec.group] || COLORS.MUTED;
    g.globalAlpha = alpha;
    paintMachineBlock(g, r, fill, inset);
    paintMachineFace(g, r, face, inset);
    if (sc >= CODE_FROM) {
      Paint.setFont(g, Math.min(12, sc * 0.42), true);
      g.textAlign = "center";
      g.textBaseline = "middle";
      Paint.halo(g, code, r.x + r.w / 2, r.y + r.h / 2);
    }
    if (tier && tier !== Core.DEFAULT_TIER && sc >= TIER_FROM) paintMachineTier(g, r, face, tier, sc, inset, code);
    g.globalAlpha = 1;
  }

  // ---- everything in the rooms of this floor ----

  /** The machines a drag has lifted off their cells, or null. */
  function liftedMachines() {
    const moving = Machines.delta(state.drag);
    return moving && (moving[0] || moving[1]) ? state.drag.machines : null;
  }

  /** Paint marks, multiblock bodies, machines, then multiblock names, so a name stays above a machine. */
  function paint(g, v) {
    const contents = Core.contentsOn(L(), state.layer);
    for (const item of contents) if (item.kind === "marks") mark(g, v, item.z);
    for (const item of contents) if (item.kind === "pads") pad(g, v, item.z);
    const lifted = liftedMachines();
    for (const m of Core.machinesOn(L(), state.layer)) {
      const ghosted = lifted && lifted.some((item) => item.index === m.index && item.slot === m.slot);
      machine(g, v, m.code, m.face, m.x, m.z, ghosted ? LIFTED_ALPHA : 1, m.tier);
    }
    for (const item of contents) if (item.kind === "pads") padName(g, v, item.z);
  }

  Object.assign(App.PaintContents, { padFill, pad, padName, machine, paint });
})(window.App);
