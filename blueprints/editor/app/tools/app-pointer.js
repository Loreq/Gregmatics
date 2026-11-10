/* The pointer on the plan. A press starts a drag, kept in state.drag with a `mode` that says what
   moving and releasing do:
     pan      slide the view
     locked   a press on something that will not move; a release still counts as a click
     paint    drag out a row of machines
     resize   pull a handle of the selected thing
     machine  carry machines on their own
     move     carry zones, and any machines selected with them
   The draw tools keep their sketch in state.draw instead; see app-draw.js. */
(function (App) {
  "use strict";

  const {
    Core, CATALOG, CONTENTS, canvas, state, L, roomLocked, snapshot, status, clampCell, pulledBox,
    Sel, History, View, Paint, Tools, Hit, Draw, Place, Edit, Machines, Panels,
  } = App;

  const CURSORS = { nw: "nwse-resize", se: "nwse-resize", ne: "nesw-resize", sw: "nesw-resize", n: "ns-resize",
    s: "ns-resize", e: "ew-resize", w: "ew-resize" };

  // ---- small pieces ----

  /** Keep getting this pointer's moves when it leaves the canvas. */
  function capture(event) {
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch (err) {
      // Pointers the browser does not track as active cannot be captured; the drag still works inside the canvas.
    }
  }

  /** Paint at the next frame and show what is under the pointer. */
  function redraw() {
    Paint.draw();
    Panels.showCursor();
  }

  /** Whether a cell is not the one a drag began on. */
  function leftStart(drag, cell) {
    return cell[0] !== drag.start[0] || cell[1] !== drag.start[1];
  }

  /** A drag that slides the view from where it is now. */
  function panFrom(px, py) {
    return { mode: "pan", px, py, ox: state.view.ox, oy: state.view.oy };
  }

  // ---- pressing ----

  /** A drag that pulls a handle of the selected thing. A wallshared row remembers the size of one module. */
  function resizeDrag(handle) {
    const item = Sel.selected();
    const drag = { mode: "resize", handle, before: snapshot(), box: Sel.boxOf(item) };
    if (item.kind === "pads" && Hit.padDrag(item.rec) === "modules") drag.module = Core.moduleSize(item.rec);
    return drag;
  }

  /**
   * A drag that carries the selection. What cannot move is "locked"; machines alone are a "machine"
   * drag, which moves nothing until the release; zones are a "move" drag, which moves them as it goes.
   */
  function beginMove(cell, items, click) {
    const plan = Edit.movePlan(items);
    const machines = plan.machines.map(Machines.note);
    if (!plan.zones.length && !machines.length) return { mode: "locked", start: cell, moved: false, ...click };
    if (!plan.zones.length) {
      return { mode: "machine", before: snapshot(), start: cell, delta: null, moved: false, machines, ...click };
    }
    return {
      mode: "move", before: snapshot(), start: cell, applied: [0, 0], moved: false,
      zones: plan.zones.map((item) => ({
        kind: item.kind, rec: item.rec, box: Sel.boxOf(item), bounds: Edit.boundsForItem(item),
      })),
      machines, ...click,
    };
  }

  /** A press with the Select tool on the things under a cell: select what was pressed and get ready to carry it. */
  function pressThings(cell, hits, px, py) {
    const current = hits.find((hit) => Sel.holds(hit));
    const target = current || hits[0];
    if (!target) {
      Sel.clear();
      return panFrom(px, py);
    }
    const wasSelected = Boolean(current);
    if (!wasSelected) Sel.replace(target);
    const click = { wasSelected, hits, anchor: Sel.refOf(target) };
    const items = Sel.selection();
    const onlyLocked = items.length === 1 && items[0].kind === "rooms" && roomLocked(items[0].rec);
    if (onlyLocked) return { mode: "locked", start: cell, moved: false, ...click };
    return beginMove(cell, items, click);
  }

  /** A press with the Select tool: on a handle, with Ctrl to add or take away, or on a thing or on rock. */
  function pressSelect(event, cell, px, py) {
    const handle = Hit.handleAt(px, py);
    if (handle) {
      state.drag = resizeDrag(handle);
      return;
    }
    const hits = Hit.at(cell[0], cell[1]);
    if (event.ctrlKey || event.metaKey) {
      if (hits[0]) Sel.toggle(hits[0]);
    } else {
      state.drag = pressThings(cell, hits, px, py);
    }
    Panels.refresh();
  }

  /** The pointer went down on the plan. */
  function onDown(event) {
    if (!state.layout) return;
    canvas.focus();
    const [px, py] = View.local(event);
    const cell = View.toWorld(px, py);
    state.hover = cell;
    capture(event);
    if (event.button !== 0) {
      state.drag = panFrom(px, py);
      return;
    }
    const tool = Tools.current();
    if (tool.draw) {
      Draw.start(cell);
    } else if (tool.place) {
      const drag = Place.start(cell);
      if (drag) state.drag = drag;
    } else {
      pressSelect(event, cell, px, py);
    }
  }

  // ---- moving with nothing held ----

  /** The cursor for the Select tool over a pixel: a resize arrow, a move cross, or a grabbing hand for the view. */
  function selectCursor(px, py, cell) {
    const handle = Hit.handleAt(px, py);
    if (handle) return CURSORS[handle];
    const top = Hit.at(cell[0], cell[1])[0];
    if (!top) return "grab";
    const fixed = top.kind === "rooms" && roomLocked(L().rooms[top.index]);
    return fixed ? "default" : "move";
  }

  /** The pointer moved with no button down: set the cursor and show what is under it. */
  function hoverMove(px, py, cell, moved) {
    const tool = Tools.current();
    canvas.style.cursor = tool.draw || tool.place ? "crosshair" : selectCursor(px, py, cell);
    if (moved) Paint.draw();
    Panels.showCursor();
  }

  // ---- moving with a drag ----

  /** Slide the view with the pointer. */
  function panMove(drag, cell, px, py) {
    View.panTo(drag.ox + (px - drag.px), drag.oy + (py - drag.py));
    canvas.style.cursor = "grabbing";
    Paint.draw();
  }

  /** Note that the pointer left the cell it pressed, so the release is not a click. */
  function lockedMove(drag, cell) {
    if (leftStart(drag, cell)) drag.moved = true;
    canvas.style.cursor = "not-allowed";
  }

  /** Carry a row of machines on to the cell under the pointer. */
  function paintMove(drag, cell, px, py, moved) {
    if (moved) Place.paintTo(drag, cell);
    redraw();
  }

  /** Pull an edge or corner of a multiblock to a cell. It lands on the nearest size the wiki allows, inside its room. */
  function resizePad(drag, pad, cell, room) {
    const at = room ? clampCell(cell, room) : cell;
    const spec = CATALOG.multis[pad.key] || {};
    Core.resizePadBox(pad, L(), spec, pulledBox(drag.box, drag.handle, at), drag.handle, drag.box);
  }

  /** Pull an edge or corner of a zone or an area to a cell, inside its room or its floor. */
  function resizeZone(drag, item, cell, room) {
    const bounds = room || (item.kind === "marks" ? Core.inner(L()) : Core.boundsFor(L(), item.kind, item.rec));
    Core.setBox(item.kind, item.rec, pulledBox(drag.box, drag.handle, clampCell(cell, bounds)));
  }

  /** Pull a handle of the selected thing to the cell under the pointer. A wallshared row gains or loses modules. */
  function resizeMove(drag, cell, px, py, moved) {
    const item = Sel.selected();
    if (!item) return;
    if (moved) Paint.notePlan();
    const room = CONTENTS.has(item.kind) ? Core.roomById(L(), item.rec.room) : null;
    if (drag.module) Core.stretchModules(item.rec, drag.module, drag.box, drag.handle, cell, room);
    else if (item.kind === "pads") resizePad(drag, item.rec, cell, room);
    else resizeZone(drag, item, cell, room);
    redraw();
  }

  /** Note how far machines have been carried. They are moved on release. */
  function machineMove(drag, cell) {
    const dx = cell[0] - drag.start[0];
    const dz = cell[1] - drag.start[1];
    drag.delta = dx || dz ? [dx, dz] : null;
  }

  /** Move the zones being carried to where the pointer has taken them, as far as their floors allow. */
  function zonesMove(drag, cell) {
    const [dx, dz] = Edit.clampGroup(drag.zones, cell[0] - drag.start[0], cell[1] - drag.start[1]);
    const sx = dx - drag.applied[0];
    const sz = dz - drag.applied[1];
    if (sx || sz) {
      for (const item of drag.zones) Core.moveZone(L(), item.kind, item.rec, sx, sz);
    }
    drag.applied = [dx, dz];
  }

  /** Carry the selection to the cell under the pointer. */
  function carryMove(drag, cell, px, py, moved) {
    if (leftStart(drag, cell)) drag.moved = true;
    if (moved) Paint.notePlan();
    if (drag.mode === "machine") machineMove(drag, cell);
    else zonesMove(drag, cell);
    redraw();
  }

  const MOVES = { pan: panMove, locked: lockedMove, paint: paintMove, resize: resizeMove, machine: carryMove, move: carryMove };

  /** The pointer moved over the plan. */
  function onMove(event) {
    if (!state.layout) return;
    const [px, py] = View.local(event);
    const cell = View.toWorld(px, py);
    const moved = !state.hover || state.hover[0] !== cell[0] || state.hover[1] !== cell[1];
    state.hover = cell;
    const drag = state.drag;
    if (state.draw) Draw.extend(cell);
    else if (!drag) hoverMove(px, py, cell, moved);
    else MOVES[drag.mode](drag, cell, px, py, moved);
  }

  // ---- releasing ----

  /** A press and release that did not move: narrow a group to the item under the pointer, or cycle a stack. */
  function finishClick(drag) {
    if (drag.wasSelected && Sel.refs().length > 1 && drag.anchor) {
      Sel.replace(drag.anchor);
      Panels.refresh();
      return;
    }
    if (drag.wasSelected && Sel.refs().length === 1 && drag.hits && drag.hits.length > 1) {
      const i = drag.hits.findIndex((hit) => Sel.same(hit, Sel.primary()));
      Sel.replace(drag.hits[(i + 1) % drag.hits.length]);
      Panels.refresh();
    }
  }

  /** Release over something that will not move. */
  function lockedEnd(drag) {
    if (drag.moved) status("This room is locked.", true);
    else finishClick(drag);
  }

  /** Release a drag that edited the plan as it went: make it one undo step. */
  function commitEnd(drag) {
    History.commit(drag.before);
  }

  /** Put down machines that were carried on their own. One machine may swap with another; a group may not. */
  function machineEnd(drag) {
    const [dx, dz] = drag.delta || [0, 0];
    if (!drag.moved) {
      finishClick(drag);
      return;
    }
    if (!dx && !dz) return;
    if (drag.machines.length === 1) {
      const m = drag.machines[0];
      Machines.drop(Machines.itemOf(m), m.x + dx, m.z + dz);
      return;
    }
    const problem = History.change(() => Machines.applyDelta(drag.machines, dx, dz));
    if (problem) status(problem, true);
  }

  /** Put down zones that were carried, and the machines selected with them. */
  function moveEnd(drag) {
    if (!drag.moved) {
      finishClick(drag);
      return;
    }
    if (!(drag.applied[0] || drag.applied[1])) return;
    Edit.rehomeAll(drag.zones);
    let problem = "";
    if (drag.machines.length) problem = Machines.applyDelta(drag.machines, drag.applied[0], drag.applied[1]);
    History.commit(drag.before);
    if (problem) status(problem, true);
  }

  const ENDS = { locked: lockedEnd, paint: commitEnd, resize: commitEnd, machine: machineEnd, move: moveEnd };

  /** The pointer came up, or the browser took it away. */
  function onUp() {
    if (state.draw) {
      Draw.finish();
      return;
    }
    const drag = state.drag;
    state.drag = null;
    const tool = Tools.current();
    canvas.style.cursor = tool.draw || tool.place ? "crosshair" : "";
    const end = drag && ENDS[drag.mode];
    if (end) end(drag);
  }

  // ---- the rest ----

  /** The pointer left the plan with nothing held. */
  function onLeave() {
    if (state.drag || state.draw) return;
    state.hover = null;
    redraw();
  }

  /** The wheel zooms on the cell under the pointer. */
  function onWheel(event) {
    if (!state.layout) return;
    event.preventDefault();
    const [px, py] = View.local(event);
    View.zoomAt(px, py, event.deltaY < 0);
    Paint.draw();
  }

  Object.assign(App.Pointer, { onDown, onMove, onUp, onLeave, onWheel });
})(window.App);
