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
  const BLOCK_GRID = "rgba(27, 36, 48, 0.22)";
  const MODULE_EDGE = "rgba(27, 36, 48, 0.72)";
  const SERVICE_FILL = "rgba(120, 114, 104, 0.3)";
  const MACHINE_FACE = "rgba(255, 255, 255, 0.85)";
  const MACHINE_TEXT = "#FFFFFF";
  // A machine being dragged shows faint where it was.
  const LIFTED_ALPHA = 0.35;
  // A multiblock's block grid shows from this many pixels a block, and its name from this many.
  const GRID_FROM = 6;
  const NAME_FROM = 4;

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

  /** A solid multiblock: its fill, and a faint grid of its blocks when there is room to see one. */
  function paintBody(g, v, p, r, fill) {
    g.fillStyle = fill;
    g.fillRect(r.x, r.y, r.w, r.h);
    const oneBlock = !(p.x1 > p.x0 || p.z1 > p.z0);
    if (v.scale < GRID_FROM || oneBlock) return;
    g.strokeStyle = BLOCK_GRID;
    g.lineWidth = 1;
    g.beginPath();
    PaintZones.traceGrid(g, v, p, { left: r.x, right: r.x + r.w, top: r.y, bottom: r.y + r.h });
    g.stroke();
  }

  /** An outline around each module of a wallshared row. The block between two outlines is the shared wall. */
  function paintModuleEdges(g, v, mods) {
    if (mods.length <= 1) return;
    g.strokeStyle = MODULE_EDGE;
    g.lineWidth = 2;
    for (const mod of mods) {
      const a = View.cellRect(mod.x0, mod.z0, v);
      const b = View.cellRect(mod.x1, mod.z1, v);
      g.strokeRect(a.x + 0.5, a.y + 0.5, Math.max(0, b.x + b.w - a.x - 1), Math.max(0, b.y + b.h - a.y - 1));
    }
  }

  /** A dark bar on the edge of the block that holds a module's controller. */
  function paintController(g, v, mod) {
    const [fx, fz] = Core.frontCell(mod);
    const fc = View.cellRect(fx, fz, v);
    const thick = Math.max(2, Math.min(fc.w, fc.h) * 0.45);
    g.fillStyle = COLORS.INK;
    if (mod.front === "n") g.fillRect(fc.x, fc.y, fc.w, thick);
    else if (mod.front === "s") g.fillRect(fc.x, fc.y + fc.h - thick, fc.w, thick);
    else if (mod.front === "w") g.fillRect(fc.x, fc.y, thick, fc.h);
    else g.fillRect(fc.x + fc.w - thick, fc.y, thick, fc.h);
  }

  /** A multiblock's outline: rust when it pollutes, dashed rust when it is above the plan's tier. */
  function paintPadEdge(g, r, spec) {
    const over = Boolean(spec.tier) && !Core.multiOpen(spec, Core.planTier(L()));
    g.lineWidth = spec.pollution || over ? 2 : 1;
    g.strokeStyle = spec.pollution || over ? COLORS.RUST : COLORS.WALL;
    g.setLineDash(over && !spec.pollution ? [4, 3] : []);
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
    g.save();
    g.beginPath();
    g.rect(r.x + 1, r.y + 1, Math.max(0, r.w - 2), Math.max(0, r.h - 2));
    g.clip();
    g.textAlign = "center";
    g.textBaseline = "middle";
    const maxW = Math.max(4, r.w - 4);
    let size = Math.min(13, Math.max(8, sc));
    Paint.setFont(g, size, true);
    while (size > 7 && g.measureText(name).width > maxW) {
      size -= 1;
      Paint.setFont(g, size, true);
    }
    if (g.measureText(name).width <= maxW && r.h >= size) Paint.halo(g, name, r.x + r.w / 2, r.y + r.h / 2);
    g.restore();
  }

  /** One multiblock: its body, its modules and controllers, its outline, and its name. */
  function pad(g, v, p) {
    const spec = CATALOG.multis[p.key] || {};
    const r = View.rectOf(p, v);
    const fill = padFill(spec);
    if (spec.shell) paintShell(g, v, p, fill);
    else paintBody(g, v, p, r, fill);
    const mods = Core.moduleList(p);
    paintModuleEdges(g, v, mods);
    for (const mod of mods) paintController(g, v, mod);
    paintPadEdge(g, r, spec);
    if (v.scale < NAME_FROM) return;
    const name = padLabel(p, spec, mods.length);
    if (name) paintFittedName(g, r, name, v.scale);
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

  /** The pale bar along the side a machine faces. */
  function paintMachineFace(g, r, face, inset, bar) {
    g.fillStyle = MACHINE_FACE;
    if (face === "n") g.fillRect(r.x + inset, r.y + inset, r.w - inset * 2, bar);
    if (face === "s") g.fillRect(r.x + inset, r.y + r.h - inset - bar, r.w - inset * 2, bar);
    if (face === "w") g.fillRect(r.x + inset, r.y + inset, bar, r.h - inset * 2);
    if (face === "e") g.fillRect(r.x + r.w - inset - bar, r.y + inset, bar, r.h - inset * 2);
  }

  /** A machine's tier in a corner away from its face. MV, the usual tier, is not written. */
  function paintMachineTier(g, r, face, tier, sc, inset) {
    Paint.setFont(g, Math.max(8, Math.min(11, sc * 0.32)), true);
    g.fillStyle = MACHINE_TEXT;
    const edge = inset + 1;
    if (face === "e") {
      g.textAlign = "left";
      g.textBaseline = "bottom";
      g.fillText(tier, r.x + edge, r.y + r.h - edge);
    } else if (face === "s") {
      g.textAlign = "right";
      g.textBaseline = "top";
      g.fillText(tier, r.x + r.w - edge, r.y + edge);
    } else {
      g.textAlign = "right";
      g.textBaseline = "bottom";
      g.fillText(tier, r.x + r.w - edge, r.y + r.h - edge);
    }
  }

  /** One machine on a cell: a block in its group's color, a bar on its face, and its code and tier when zoomed in. */
  function machine(g, v, code, face, x, z, alpha = 1, tier = Core.DEFAULT_TIER) {
    const sc = v.scale;
    const r = View.rectOf(cellBox(x, z), v);
    const spec = CATALOG.singles[code] || {};
    const inset = sc >= 8 ? 1.5 : 0.5;
    g.globalAlpha = alpha;
    g.fillStyle = L().palette.groups[spec.group] || COLORS.MUTED;
    g.fillRect(r.x + inset, r.y + inset, r.w - inset * 2, r.h - inset * 2);
    paintMachineFace(g, r, face, inset, Math.max(1, sc / 7));
    if (sc >= 16) {
      Paint.setFont(g, Math.min(12, sc * 0.42), true);
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillStyle = MACHINE_TEXT;
      g.fillText(code, r.x + r.w / 2, r.y + r.h / 2 + 1);
    }
    if (tier && tier !== Core.DEFAULT_TIER && sc >= 10) paintMachineTier(g, r, face, tier, sc, inset);
    g.globalAlpha = 1;
  }

  // ---- everything in the rooms of this floor ----

  /** The machines a drag has lifted off their cells, or null. */
  function liftedMachines() {
    const moving = Machines.delta(state.drag);
    return moving && (moving[0] || moving[1]) ? state.drag.machines : null;
  }

  /** Paint the marks, then the multiblocks, then the machines, so small things sit on top. */
  function paint(g, v) {
    const contents = Core.contentsOn(L(), state.layer);
    for (const item of contents) if (item.kind === "marks") mark(g, v, item.z);
    for (const item of contents) if (item.kind === "pads") pad(g, v, item.z);
    const lifted = liftedMachines();
    for (const m of Core.machinesOn(L(), state.layer)) {
      const ghosted = lifted && lifted.some((item) => item.index === m.index && item.slot === m.slot);
      machine(g, v, m.code, m.face, m.x, m.z, ghosted ? LIFTED_ALPHA : 1, m.tier);
    }
  }

  Object.assign(App.PaintContents, { padFill, pad, machine, paint });
})(window.App);
