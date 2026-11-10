/* The view of the plan: how blocks map to pixels on the canvas. A view is { scale, ox, oy, width,
   height }: pixels per block, the pixel where the sheet's first block starts, and the canvas size.
   state.view is the one on screen. An export paints through a view of its own. */
(function (App) {
  "use strict";

  const { $, canvas, ctx, state, L } = App;

  // Pixels per block: the closest and the farthest the wheel goes, and one notch of it.
  const MIN_SCALE = 2;
  const MAX_SCALE = 48;
  const ZOOM_STEP = 1.15;

  // ---- size ----

  /** Make the canvas as large as the space it fills. */
  function resize() {
    const box = $("view").getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    state.view.width = Math.max(1, box.width);
    state.view.height = Math.max(1, box.height);
    canvas.width = Math.round(state.view.width * dpr);
    canvas.height = Math.round(state.view.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (state.space) window.View3D.resize();
  }

  /** Show the whole sheet, with room around it for the rulers. */
  function fit() {
    if (!state.layout) return;
    const s = L().site.sheet;
    const w = s.x1 - s.x0 + 1;
    const h = s.z1 - s.z0 + 1;
    const v = state.view;
    v.scale = Math.max(MIN_SCALE, Math.min((v.width - 110) / w, (v.height - 100) / h));
    v.ox = Math.round((v.width - w * v.scale) / 2 + 20);
    v.oy = Math.round((v.height - h * v.scale) / 2 + 16);
    state.fitted = true;
  }

  // ---- blocks to pixels and back ----

  /** Where on the canvas a pointer event is, as [px, py]. */
  function local(event) {
    const box = canvas.getBoundingClientRect();
    return [event.clientX - box.left, event.clientY - box.top];
  }

  /** The cell under a pixel. */
  function toWorld(px, py, v = state.view) {
    const s = L().site.sheet;
    return [Math.floor((px - v.ox) / v.scale) + s.x0, Math.floor((py - v.oy) / v.scale) + s.z0];
  }

  /** Pixel of a block edge along X, shared by the room grid, footprints, and module outlines. */
  function blockX(world, v) {
    const s = L().site.sheet;
    return Math.round(v.ox + (world - s.x0) * v.scale);
  }

  /** Pixel of a block edge along Z. */
  function blockY(world, v) {
    const s = L().site.sheet;
    return Math.round(v.oy + (world - s.z0) * v.scale);
  }

  /** The pixels a box of blocks covers, as { x, y, w, h }. Never thinner than a pixel. */
  function rectOf(box, v = state.view) {
    const x = blockX(box.x0, v);
    const y = blockY(box.z0, v);
    return {
      x, y,
      w: Math.max(1, blockX(box.x1 + 1, v) - x),
      h: Math.max(1, blockY(box.z1 + 1, v) - y),
    };
  }

  /** The pixels one cell covers, with no least size: { x, y, w, h }. */
  function cellRect(x, z, v) {
    const x0 = blockX(x, v);
    const y0 = blockY(z, v);
    return { x: x0, y: y0, w: blockX(x + 1, v) - x0, h: blockY(z + 1, v) - y0 };
  }

  // ---- moving the view ----

  /** Put a box in the middle of the view. */
  function centerOn(box) {
    const r = rectOf(box);
    state.view.ox += state.view.width / 2 - (r.x + r.w / 2);
    state.view.oy += state.view.height / 2 - (r.y + r.h / 2);
    state.fitted = false;
  }

  /** Slide the view so its first block starts at a pixel. */
  function panTo(ox, oy) {
    state.view.ox = ox;
    state.view.oy = oy;
    state.fitted = false;
  }

  /** Zoom one notch in or out, keeping the block under a pixel where it is. */
  function zoomAt(px, py, inward) {
    const v = state.view;
    const factor = inward ? ZOOM_STEP : 1 / ZOOM_STEP;
    const next = Math.max(MIN_SCALE, Math.min(MAX_SCALE, v.scale * factor));
    v.ox = px - ((px - v.ox) * next) / v.scale;
    v.oy = py - ((py - v.oy) * next) / v.scale;
    v.scale = next;
    state.fitted = false;
  }

  Object.assign(App.View, { resize, fit, local, toWorld, blockX, blockY, rectOf, cellRect, centerOn, panTo, zoomAt });
})(window.App);
