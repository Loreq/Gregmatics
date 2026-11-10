/* What is under the pointer. A hit is { kind, index, slot, area }, a ref with the size of the thing
   it names. Small things are hit before the big things they stand on. */
(function (App) {
  "use strict";

  const { Core, CATALOG, CRAWL, RESIZABLE, state, L, roomLocked, cellBox, Sel, View, Paint } = App;

  // The eight handles of a box, clockwise from the north-west corner.
  const HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
  // Which kind wins where several cover one cell.
  const HIT_ORDER = ["lifts", "machines", "doors", "pads", "marks", "stairs", "shafts", "streets", "rooms", "trenches"];
  // How near a handle, in pixels, a press must be to take it.
  const HANDLE_REACH = 6;

  // ---- things ----

  /** Everything under a cell on this layer, small things first. */
  function at(x, z) {
    const layout = L();
    const hits = [];
    const add = (kind, index, box, slot) => {
      if (Core.inside(box, x, z)) hits.push({ kind, index, slot, area: Core.area(box) });
    };
    for (const item of Core.zonesOn(layout, state.layer)) add(item.kind, item.index, Core.boxOf(item.kind, item.z));
    if (Paint.showContents() && state.layer !== CRAWL) {
      for (const item of Core.contentsOn(layout, state.layer)) {
        if (item.kind !== "walls") add(item.kind, item.index, Core.boxOf(item.kind, item.z));
      }
      for (const m of Core.machinesOn(layout, state.layer)) add("machines", m.index, cellBox(m.x, m.z), m.slot);
    }
    hits.sort((a, b) => HIT_ORDER.indexOf(a.kind) - HIT_ORDER.indexOf(b.kind) || a.area - b.area);
    return hits;
  }

  /** The record a hit names. A machine's is its row. */
  function recOf(hit) {
    return L()[hit.kind === "machines" ? "walls" : hit.kind][hit.index];
  }

  /** The box a hit covers. */
  function boxOf(hit) {
    const rec = recOf(hit);
    return hit.kind === "machines" ? cellBox(...Core.cellOf(rec, hit.slot)) : Core.boxOf(hit.kind, rec);
  }

  /** The name a hit shows beside the pointer's coordinates. */
  function nameOf(hit) {
    const rec = recOf(hit);
    if (hit.kind !== "machines") return Core.nameOf(hit.kind, rec, CATALOG);
    return (CATALOG.singles[Core.codesOf(rec)[hit.slot]] || { name: "" }).name;
  }

  // ---- handles ----

  /**
   * What dragging a multiblock's handle does. "modules" adds to a wallshared row or takes from it,
   * "size" moves it to another legal size, and "" means its size is fixed.
   */
  function padDrag(pad) {
    const spec = CATALOG.multis[pad.key] || {};
    if (spec.share) return "modules";
    return Core.sizeFields(pad, spec).some((field) => field.key !== "h") ? "size" : "";
  }

  /** Whether the one selected thing shows handles. */
  function canResize(item) {
    if (!item) return false;
    if (item.kind === "rooms") return !roomLocked(item.rec);
    if (item.kind === "pads") return padDrag(item.rec) !== "";
    return RESIZABLE.has(item.kind);
  }

  /** The pixels of a rectangle's eight handles, in the order of HANDLES. */
  function handlePoints(r) {
    const xs = [r.x, r.x + r.w / 2, r.x + r.w];
    const ys = [r.y, r.y + r.h / 2, r.y + r.h];
    return [[xs[0], ys[0]], [xs[1], ys[0]], [xs[2], ys[0]], [xs[2], ys[1]], [xs[2], ys[2]], [xs[1], ys[2]],
      [xs[0], ys[2]], [xs[0], ys[1]]];
  }

  /** The handle of the selected thing under a pixel, such as "ne", or "". */
  function handleAt(px, py) {
    const item = Sel.selected();
    if (!canResize(item)) return "";
    const points = handlePoints(View.rectOf(Sel.boxOf(item)));
    const found = points.findIndex(([hx, hy]) => Math.abs(px - hx) <= HANDLE_REACH && Math.abs(py - hy) <= HANDLE_REACH);
    return found < 0 ? "" : HANDLES[found];
  }

  Object.assign(App.Hit, { at, recOf, boxOf, nameOf, padDrag, canResize, handlePoints, handleAt });
})(window.App);
