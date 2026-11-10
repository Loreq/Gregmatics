/* What is painted over the floor each frame because it follows the pointer: an outline around the
   thing under it, the selection with its handles and size, and a preview of what a tool would make. */
(function (App) {
  "use strict";

  const {
    Core, CATALOG, COLORS, ROOM_COLORS, SIDE_NAMES, state, cellBox,
    Sel, View, Paint, PaintZones, PaintContents, Tools, Hit, Draw, Place, Machines,
  } = App;

  const HOVER_EDGE = "rgba(47, 93, 138, 0.8)";
  // How see-through a preview is: a box being drawn, and a thing being placed or carried.
  const SKETCH_ALPHA = 0.7;
  const PAD_PREVIEW_ALPHA = 0.82;
  const MACHINE_PREVIEW_ALPHA = 0.85;
  const HANDLE_SIZE = 8;

  // ---- small pieces ----

  /** Stroke a rectangle one pixel outside a box, so the outline rings the thing and does not cover it. */
  function ring(g, r) {
    g.strokeRect(r.x - 1, r.y - 1, r.w + 2, r.h + 2);
  }

  /** A line of text just above a box's top left corner. */
  function tagAbove(g, r, text) {
    Paint.setFont(g, 12, true);
    g.textAlign = "left";
    g.textBaseline = "bottom";
    Paint.halo(g, text, r.x, r.y - 6);
  }

  /** A box's size as text. */
  function sizeText(box) {
    return `${box.x1 - box.x0 + 1} × ${box.z1 - box.z0 + 1}`;
  }

  // ---- the thing under the pointer ----

  /** A dashed outline around what a click would select, unless it is selected already. */
  function paintHover(g, v) {
    if (state.tool !== "select" || state.drag || !state.hover) return;
    const hit = Hit.at(state.hover[0], state.hover[1])[0];
    if (!hit || Sel.holds(hit)) return;
    g.strokeStyle = HOVER_EDGE;
    g.lineWidth = 1.5;
    g.setLineDash([3, 3]);
    ring(g, View.rectOf(Hit.boxOf(hit), v));
    g.setLineDash([]);
  }

  // ---- the selection ----

  /** Where a selected item is drawn: its box, or where a drag is carrying it when it is a machine. */
  function selectionBox(item) {
    const box = Sel.boxOf(item);
    if (item.kind !== "machines") return box;
    const delta = Machines.delta(state.drag);
    if (!delta || (!delta[0] && !delta[1]) || !state.drag.machines) return box;
    const moved = state.drag.machines.some((m) => m.index === item.index && m.slot === item.slot);
    if (!moved) return box;
    return {
      x0: box.x0 + delta[0], x1: box.x1 + delta[0],
      z0: box.z0 + delta[1], z1: box.z1 + delta[1],
    };
  }

  /** The eight squares a box is resized by. */
  function paintHandles(g, r) {
    const half = HANDLE_SIZE / 2;
    g.fillStyle = COLORS.PAPER;
    for (const [hx, hy] of Hit.handlePoints(r)) {
      g.fillRect(hx - half, hy - half, HANDLE_SIZE, HANDLE_SIZE);
      g.strokeRect(hx - half, hy - half, HANDLE_SIZE, HANDLE_SIZE);
    }
  }

  /** What is written above the one selected thing: a machine's code, tier, and facing, a lift's cell, else its size. */
  function selectionText(item, box) {
    if (item.kind === "machines") {
      return `${item.code} · ${Core.tierAt(item.rec, item.slot)} · faces ${SIDE_NAMES[item.rec.face].toLowerCase()}`;
    }
    if (item.kind === "lifts") return `X ${box.x0}, Z ${box.z0}`;
    return sizeText(box);
  }

  /** An outline around everything selected. One thing also gets its handles and size; several get a count. */
  function paintSelection(g, v) {
    const items = Sel.selection();
    if (!items.length) return;
    g.lineWidth = 2;
    g.setLineDash([]);
    g.strokeStyle = COLORS.INK;
    const boxes = items.map(selectionBox);
    for (const box of boxes) ring(g, View.rectOf(box, v));
    if (items.length > 1) {
      tagAbove(g, View.rectOf(Core.unionBoxes(boxes), v), `${items.length} selected`);
      return;
    }
    const r = View.rectOf(boxes[0], v);
    if (Hit.canResize(items[0])) paintHandles(g, r);
    tagAbove(g, r, selectionText(items[0], boxes[0]));
  }

  // ---- previews ----

  /** The box a draw tool is dragging out, with its size. */
  function paintSketch(g, v) {
    const box = Draw.box();
    const r = View.rectOf(box, v);
    g.globalAlpha = SKETCH_ALPHA;
    g.fillStyle = state.tool === "rooms" ? ROOM_COLORS[0] : PaintZones.zoneFill(state.tool, {});
    g.fillRect(r.x, r.y, r.w, r.h);
    g.globalAlpha = 1;
    g.strokeStyle = COLORS.INK;
    g.lineWidth = 1.5;
    g.setLineDash([5, 3]);
    g.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
    g.setLineDash([]);
    tagAbove(g, r, sizeText(box));
  }

  /** The machines a drag is carrying, where they would land. */
  function paintCarried(g, v, delta) {
    for (const m of state.drag.machines) {
      const x = m.x + delta[0];
      const z = m.z + delta[1];
      PaintContents.machine(g, v, m.code, m.face, x, z, MACHINE_PREVIEW_ALPHA, m.tier);
      g.strokeStyle = COLORS.INK;
      g.lineWidth = 2;
      ring(g, View.rectOf(cellBox(x, z), v));
    }
  }

  /** A multiblock as a place tool would put it down. */
  function paintPadPreview(g, v, p) {
    const spec = CATALOG.multis[p.key] || {};
    const pad = {
      key: p.key, num: "", front: p.front,
      x0: p.box.x0, x1: p.box.x1, z0: p.box.z0, z1: p.box.z1,
    };
    if (spec.shell) pad.door = Core.frontCell(pad);
    g.save();
    g.globalAlpha = PAD_PREVIEW_ALPHA;
    PaintContents.pad(g, v, pad);
    g.restore();
  }

  /** What a place tool would put under the pointer, ringed green where it fits and dashed rust where it does not. */
  function paintPlacement(g, v) {
    const p = Tools.byId(state.tool).place && Place.placement();
    if (!p) return;
    if (p.kind === "pads") paintPadPreview(g, v, p);
    else PaintContents.machine(g, v, p.code, p.face, p.box.x0, p.box.z0, MACHINE_PREVIEW_ALPHA);
    g.strokeStyle = p.fits ? COLORS.GOOD : COLORS.RUST;
    g.lineWidth = 2;
    g.setLineDash(p.fits ? [] : [4, 3]);
    ring(g, View.rectOf(p.box, v));
    g.setLineDash([]);
  }

  /** The preview for whatever is going on: a box being drawn, machines being carried, or a thing being placed. */
  function paintPreview(g, v) {
    if (state.draw) {
      paintSketch(g, v);
      return;
    }
    if (state.drag && state.drag.machines && state.drag.machines.length) {
      const delta = Machines.delta(state.drag);
      if (delta[0] || delta[1]) {
        paintCarried(g, v, delta);
        return;
      }
    }
    paintPlacement(g, v);
  }

  /** Paint the hover, the selection, and the preview, in that order. */
  function paint(g, v) {
    paintHover(g, v);
    paintSelection(g, v);
    paintPreview(g, v);
  }

  Object.assign(App.Overlay, { paint });
})(window.App);
