/* Painting the plan. The floor is painted once onto an offscreen canvas, the plate, and kept until
   the plan, the floor, or the view changes. Each frame copies the plate and paints what follows the
   pointer over it: the hover, the selection, and the preview. Every painter takes the 2D context `g`
   and the view `v` it paints through. */
(function (App) {
  "use strict";

  const {
    Core, CRAWL, COLORS, canvas, ctx, state, L, layerFloor, status,
    View, PaintZones, PaintContents, Overlay, Draw, Files,
  } = App;

  const FONT = "Segoe UI, sans-serif";
  const BACKDROP = "#2c2622";
  const CHUNK_LINE = "rgba(150, 132, 108, 0.45)";
  const DIRTY_FILL = "rgba(172, 78, 50, 0.07)";
  const DIRTY_EDGE = "rgba(172, 78, 50, 0.8)";
  const OUTSIDE_SHADE = "rgba(12, 10, 8, 0.42)";
  const SPAN_EDGE = "rgba(243, 230, 212, 0.92)";
  const SPAN_PEN = "#e0c4a4";
  const RULER_TICK = "#c4a882";
  const RULER_TEXT = "#f3e6d4";
  const TEXT_HALO = "rgba(255, 253, 248, 0.9)";
  const CHUNK = 16;
  // The cell grid shows from this many pixels a block.
  const GRID_FROM = 6;
  // An exported picture: pixels per block, and the margins that hold its rulers and title.
  const EXPORT = { scale: 8, left: 70, top: 90, right: 30, bottom: 30 };

  // ---- shapes and text ----

  /** Stroke one line. */
  function line(g, x0, y0, x1, y1) {
    g.beginPath();
    g.moveTo(x0, y0);
    g.lineTo(x1, y1);
    g.stroke();
  }

  /** Fill a triangle. */
  function triangle(g, x0, y0, x1, y1, x2, y2) {
    g.beginPath();
    g.moveTo(x0, y0);
    g.lineTo(x1, y1);
    g.lineTo(x2, y2);
    g.closePath();
    g.fill();
  }

  /** Paint text with a pale edge, so it reads over any fill. */
  function halo(g, text, x, y, color = COLORS.INK) {
    g.lineWidth = 3;
    g.strokeStyle = TEXT_HALO;
    g.lineJoin = "round";
    g.strokeText(text, x, y);
    g.fillStyle = color;
    g.fillText(text, x, y);
  }

  /** Paint a name that is part of the floor, such as a street's, upright or turned on its side. */
  function painted(g, text, x, y, vertical, sc, align = "center") {
    g.save();
    g.font = `bold ${Math.max(9, Math.min(13, sc * 1.3))}px ${FONT}`;
    g.textAlign = align;
    g.textBaseline = "middle";
    g.translate(x, y);
    if (vertical) g.rotate(-Math.PI / 2);
    halo(g, text, 0, 0, COLORS.MUTED);
    g.restore();
  }

  /** A "#RRGGBB" color with an alpha, as CSS. */
  function hexAlpha(hex, alpha) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
  }

  /** Set the font for a line of text. */
  function setFont(g, size, bold) {
    g.font = `${bold ? "bold " : ""}${size}px ${FONT}`;
  }

  // ---- the ground under the floor ----

  /** The box around the dirty chunks, or null when the plan has none. */
  function dirtyBox() {
    const names = L().site.dirty;
    if (!names.length) return null;
    return Core.unionBoxes(names.map((n) => Core.chunkBounds(L(), n)));
  }

  /** Whether multiblocks, machines, and areas are painted. A tool that places them always shows them. */
  function showContents() {
    return state.show.contents || state.tool === "pads" || state.tool === "machines" || state.tool === "marks";
  }

  /** The backdrop and the sheet of rock. Returns the sheet's rectangle. */
  function paintGround(g, v) {
    g.fillStyle = BACKDROP;
    g.fillRect(0, 0, v.width, v.height);
    const all = View.rectOf(L().site.sheet, v);
    g.fillStyle = L().palette.rock;
    g.fillRect(all.x, all.y, all.w, all.h);
    return all;
  }

  /** A line along every chunk border. */
  function paintChunkLines(g, v, all) {
    const s = L().site.sheet;
    g.strokeStyle = CHUNK_LINE;
    g.lineWidth = 1;
    for (let x = s.x0; x <= s.x1 + 1; x += 1) {
      if (x % CHUNK !== 0) continue;
      const px = View.blockX(x, v) + 0.5;
      line(g, px, all.y, px, all.y + all.h);
    }
    for (let z = s.z0; z <= s.z1 + 1; z += 1) {
      if (z % CHUNK !== 0) continue;
      const py = View.blockY(z, v) + 0.5;
      line(g, all.x, py, all.x + all.w, py);
    }
  }

  /** A tint and a dashed edge around the chunks where pollution is allowed. */
  function paintDirty(g, v) {
    const dirty = dirtyBox();
    if (!dirty) return;
    const r = View.rectOf(dirty, v);
    g.fillStyle = DIRTY_FILL;
    g.fillRect(r.x, r.y, r.w, r.h);
    g.setLineDash([9, 6]);
    g.strokeStyle = DIRTY_EDGE;
    g.lineWidth = 2;
    g.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
    g.setLineDash([]);
  }

  /** Shade the four strips of a rectangle that lie outside a hole in it. */
  function shadeAround(g, outer, hole) {
    const x0 = outer.x;
    const y0 = outer.y;
    const x1 = outer.x + outer.w;
    const y1 = outer.y + outer.h;
    const hx0 = Math.max(x0, hole.x);
    const hy0 = Math.max(y0, hole.y);
    const hx1 = Math.min(x1, hole.x + hole.w);
    const hy1 = Math.min(y1, hole.y + hole.h);
    g.fillStyle = OUTSIDE_SHADE;
    if (hy0 > y0) g.fillRect(x0, y0, outer.w, hy0 - y0);
    if (y1 > hy1) g.fillRect(x0, hy1, outer.w, y1 - hy1);
    if (hx0 > x0) g.fillRect(x0, hy0, hx0 - x0, Math.max(0, hy1 - hy0));
    if (x1 > hx1) g.fillRect(hx1, hy0, x1 - hx1, Math.max(0, hy1 - hy0));
  }

  /** Dim the sheet outside this floor's footprint, and stroke the footprint, when it is smaller than the site. */
  function paintSpan(g, v) {
    const layout = L();
    const box = Draw.activeBox();
    if (Core.sameBox(box, Core.inner(layout))) return;
    const hole = View.rectOf(box, v);
    shadeAround(g, View.rectOf(layout.site.sheet, v), hole);
    const floor = layerFloor() || Core.floorById(layout, layout.site.crawl.under);
    g.setLineDash([]);
    g.lineWidth = 3;
    g.strokeStyle = SPAN_EDGE;
    g.strokeRect(hole.x + 1.5, hole.y + 1.5, hole.w - 3, hole.h - 3);
    g.lineWidth = 1.5;
    g.strokeStyle = (floor && floor.pen) || SPAN_PEN;
    g.strokeRect(hole.x + 1.5, hole.y + 1.5, hole.w - 3, hole.h - 3);
  }

  // ---- the rulers around the sheet ----

  /** A tick above the sheet with its coordinate over it. */
  function tickAbove(g, all, mark, px, width, text, textX) {
    g.fillStyle = RULER_TICK;
    g.fillRect(px, all.y - mark, width, mark);
    g.fillStyle = RULER_TEXT;
    g.textAlign = "center";
    g.fillText(text, textX, all.y - 16);
  }

  /** A tick left of the sheet with its coordinate beside it. */
  function tickLeft(g, all, mark, py, height, text, textY) {
    g.fillStyle = RULER_TICK;
    g.fillRect(all.x - mark, py, mark, height);
    g.fillStyle = RULER_TEXT;
    g.textAlign = "right";
    g.fillText(text, all.x - 12, textY);
  }

  /** The coordinate of each chunk's first column and row, and of the sheet's last when it ends mid-chunk. */
  function paintCoordinates(g, v, all) {
    const s = L().site.sheet;
    const sc = v.scale;
    const mark = Math.max(3, Math.min(sc, 8));
    for (let x = s.x0; x <= s.x1; x += 1) {
      if (x % CHUNK !== 0) continue;
      const px = v.ox + (x - s.x0) * sc;
      tickAbove(g, all, mark, px, Math.max(2, sc), String(x), px + sc / 2);
    }
    for (let z = s.z0; z <= s.z1; z += 1) {
      if (z % CHUNK !== 0) continue;
      const py = v.oy + (z - s.z0) * sc;
      tickLeft(g, all, mark, py, Math.max(2, sc), String(z), py + sc / 2);
    }
    const tick = Math.max(2, Math.min(sc, 8));
    if (s.x1 % CHUNK !== 0) {
      const east = all.x + all.w;
      tickAbove(g, all, mark, east - tick, tick, String(s.x1), east - sc / 2);
    }
    if (s.z1 % CHUNK !== 0) {
      const south = all.y + all.h;
      tickLeft(g, all, mark, south - tick, tick, String(s.z1), south - sc / 2);
    }
  }

  /** The chunk letters along the top and numbers down the side. A sliver of a chunk gets none. */
  function paintChunkNames(g, v, all) {
    const layout = L();
    const s = layout.site.sheet;
    const sc = v.scale;
    const [ox, oz] = Core.chunkOrigin(layout);
    const cols = layout.site.columns;
    for (let c = 0; c < cols.length; c += 1) {
      const x0 = Math.max((ox + c) * CHUNK, s.x0);
      const x1 = Math.min((ox + c) * CHUNK + 15, s.x1);
      if (x1 - x0 < 3) continue;
      g.fillText(cols[c], v.ox + ((x0 + x1 + 1) / 2 - s.x0) * sc, all.y - 32);
    }
    for (let r = 0; r < layout.site.terrain.length; r += 1) {
      const z0 = Math.max((oz + r) * CHUNK, s.z0);
      const z1 = Math.min((oz + r) * CHUNK + 15, s.z1);
      if (z1 - z0 < 3) continue;
      g.fillText(String(r + 1), all.x - 48, v.oy + ((z0 + z1 + 1) / 2 - s.z0) * sc);
    }
  }

  /** Chunk letters and numbers, and the coordinate of each chunk's first column and row, as on the sheets. */
  function paintRulers(g, v, all) {
    setFont(g, 11, false);
    g.textBaseline = "middle";
    paintCoordinates(g, v, all);
    g.fillStyle = RULER_TEXT;
    setFont(g, 13, true);
    g.textAlign = "center";
    paintChunkNames(g, v, all);
  }

  // ---- the floor ----

  /** Paint the floor being shown: the ground, the floors beside it, its zones, what stands in them, and the rulers. */
  function paint(g, v) {
    const items = Core.zonesOn(L(), state.layer);
    g.save();
    const all = paintGround(g, v);
    paintChunkLines(g, v, all);
    paintDirty(g, v);
    paintSpan(g, v);
    if (state.show.others) PaintZones.ghosts(g, v);
    for (const item of items) PaintZones.zone(g, v, item);
    if (v.scale >= GRID_FROM) PaintZones.cellGrid(g, v, items);
    if (showContents() && state.layer !== CRAWL) PaintContents.paint(g, v);
    for (const item of items) PaintZones.label(g, v, item);
    paintRulers(g, v, all);
    g.restore();
  }

  // ---- frames ----

  const plate = document.createElement("canvas");
  const plateCtx = plate.getContext("2d");
  // What the plate was last painted for, and a count that moves on whenever the plan changes.
  let plateKey = "";
  let plateRev = 0;
  let paintQueued = 0;

  /** The floor drawing changed, so the next frame repaints the plate. */
  function notePlan() {
    plateRev += 1;
  }

  /** Everything the plate's picture depends on, as one string. */
  function plateStamp(v, dpr) {
    return [
      state.layer, state.show.others, showContents(),
      v.scale, v.ox, v.oy, v.width, v.height, dpr, plateRev,
    ].join("|");
  }

  /** Repaint the plate when what it shows has changed. */
  function refreshPlate(v, dpr) {
    const key = plateStamp(v, dpr);
    const pw = Math.round(v.width * dpr);
    const ph = Math.round(v.height * dpr);
    if (plate.width !== pw || plate.height !== ph) {
      plate.width = pw;
      plate.height = ph;
      plateKey = "";
    }
    if (plateKey === key) return;
    plateCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    paint(plateCtx, v);
    plateKey = key;
  }

  /** Paint the canvas now: the plate, then the hover, the selection, and the preview. */
  function paintFrame() {
    if (paintQueued) {
      cancelAnimationFrame(paintQueued);
      paintQueued = 0;
    }
    if (!state.layout || state.space) return;
    const v = state.view;
    if (v.width < 1 || v.height < 1) return;
    const dpr = window.devicePixelRatio || 1;
    refreshPlate(v, dpr);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(plate, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    Overlay.paint(ctx, v);
  }

  /** Paint at the next frame. Pointer moves share one paint; edits and resizes paint at once with paintFrame. */
  function draw() {
    if (!state.layout || state.space || paintQueued) return;
    paintQueued = requestAnimationFrame(paintFrame);
  }

  // ---- a picture file ----

  /** The floor's name, and its Y, in the top corner of an exported picture. */
  function paintExportTitle(g) {
    const floor = layerFloor();
    g.fillStyle = RULER_TEXT;
    setFont(g, 22, true);
    g.textAlign = "left";
    g.textBaseline = "top";
    g.fillText(Core.layerName(L(), state.layer), 16, 12);
    if (!floor) return;
    setFont(g, 13, false);
    g.fillStyle = "#c2b09a";
    g.fillText(`Y ${floor.slab + 2}`, 16, 40);
  }

  /** Download the floor being shown as a PNG, the whole sheet at a fixed scale. */
  function exportPng() {
    const s = L().site.sheet;
    const { scale, left, top } = EXPORT;
    const width = (s.x1 - s.x0 + 1) * scale + left + EXPORT.right;
    const height = (s.z1 - s.z0 + 1) * scale + top + EXPORT.bottom;
    const out = document.createElement("canvas");
    out.width = width;
    out.height = height;
    const g = out.getContext("2d");
    paint(g, { scale, ox: left, oy: top, width, height });
    paintExportTitle(g);
    out.toBlob((blob) => {
      Files.download(`${state.layer}.png`, blob);
      status("Downloaded.");
    });
  }

  Object.assign(App.Paint, {
    FONT, line, triangle, halo, painted, hexAlpha, setFont, showContents, paint, notePlan, paintFrame, draw, exportPng,
  });
})(window.App);
