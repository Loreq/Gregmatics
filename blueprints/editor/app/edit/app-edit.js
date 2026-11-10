/* Acting on the selection: moving it with the arrow keys, turning it, and deleting it. The same
   sorting of a selection into what moves on its own is used by a drag (app-pointer.js) and by copy
   (app-clipboard.js). */
(function (App) {
  "use strict";

  const {
    Core, CATALOG, CONTENTS, SIDE_NAMES, L, roomLocked, status,
    Sel, History, Machines, Dialogs, Panels,
  } = App;

  // ---- sorting a selection ----

  /** Items without the entrance, which stays where it is, and whether it was among them. */
  function withoutEntrance(items) {
    const kept = items.filter((item) => !(item.kind === "streets" && item.rec.style === "entry"));
    return { kept, skipped: kept.length !== items.length };
  }

  /**
   * Split items into the zones and the machines that act on their own. A room already carries what is
   * inside it, and a row carries its machines, so those are left out.
   */
  function independentItems(items) {
    const roomIds = new Set(items.filter((item) => item.kind === "rooms").map((item) => item.rec.id));
    const walls = items.filter((item) => item.kind === "walls" && !roomIds.has(item.rec.room));
    const wallSet = new Set(walls.map((item) => item.rec));
    const zones = [];
    const machines = [];
    for (const item of items) {
      if (item.kind === "rooms") {
        zones.push(item);
        continue;
      }
      if (item.rec && item.rec.room && roomIds.has(item.rec.room)) continue;
      if (item.kind === "machines") {
        if (wallSet.has(item.rec)) continue;
        machines.push(item);
        continue;
      }
      zones.push(item);
    }
    return { zones, machines };
  }

  /** The items a copy, cut, or delete acts on, and whether the entrance was left out. */
  function actionItems(items) {
    const split = withoutEntrance(items);
    const plan = independentItems(split.kept);
    return { items: [...plan.zones, ...plan.machines], skipped: split.skipped };
  }

  /** What a move carries. Locked rooms stay where they are. Anything else in the selection still moves. */
  function movePlan(items) {
    const locked = items.some((item) => item.kind === "rooms" && roomLocked(item.rec));
    const open = items.filter((item) => !(item.kind === "rooms" && roomLocked(item.rec)));
    return { ...independentItems(open), locked };
  }

  // ---- keeping a move inside the floor ----

  /** The box an item may move in. Something in a room may go anywhere on its floor, to be re-roomed where it lands. */
  function boundsForItem(item) {
    if (CONTENTS.has(item.kind)) {
      const room = Core.roomById(L(), item.rec.room);
      const floor = room && Core.floorById(L(), room.floor);
      return floor ? Core.floorBox(L(), floor) : Core.inner(L());
    }
    return Core.boundsFor(L(), item.kind, item.rec);
  }

  /** How far a box can move each way inside some bounds. A box too big for them is not held. */
  function deltaRange(box, bounds) {
    const range = { loX: -Infinity, hiX: Infinity, loZ: -Infinity, hiZ: Infinity };
    if (box.x1 - box.x0 <= bounds.x1 - bounds.x0) {
      range.loX = bounds.x0 - box.x0;
      range.hiX = bounds.x1 - box.x1;
    }
    if (box.z1 - box.z0 <= bounds.z1 - bounds.z0) {
      range.loZ = bounds.z0 - box.z0;
      range.hiZ = bounds.z1 - box.z1;
    }
    return range;
  }

  /** The largest move that keeps every footprint inside its own bounds. Entries are { box, bounds }. */
  function clampGroup(entries, dx, dz) {
    let loX = -Infinity;
    let hiX = Infinity;
    let loZ = -Infinity;
    let hiZ = Infinity;
    for (const entry of entries) {
      const range = deltaRange(entry.box, entry.bounds);
      loX = Math.max(loX, range.loX);
      hiX = Math.min(hiX, range.hiX);
      loZ = Math.max(loZ, range.loZ);
      hiZ = Math.min(hiZ, range.hiZ);
    }
    // Two things that cannot both stay inside hold the group still along that axis.
    if (loX > hiX) { loX = 0; hiX = 0; }
    if (loZ > hiZ) { loZ = 0; hiZ = 0; }
    return [Math.max(loX, Math.min(hiX, dx)), Math.max(loZ, Math.min(hiZ, dz))];
  }

  /** After a move, whatever stands in a room belongs to the room it now sits in. */
  function rehomeAll(zones) {
    for (const item of zones) {
      if (CONTENTS.has(item.kind)) Core.rehome(L(), item.kind, item.rec);
    }
  }

  // ---- the arrow keys ----

  /** Move zones and machines together by one offset, or not at all. Returns a problem, or "". */
  function moveTogether(zones, machines, dx, dz) {
    let problem = "";
    History.change(() => {
      for (const item of zones) Core.moveZone(L(), item.kind, item.rec, dx, dz);
      if (machines.length) problem = Machines.applyDelta(machines, dx, dz);
      if (problem) {
        for (const item of zones) Core.moveZone(L(), item.kind, item.rec, -dx, -dz);
        return;
      }
      rehomeAll(zones);
    });
    return problem;
  }

  /** Move the selection by (dx, dz) blocks, as far as the floor allows. */
  function nudge(dx, dz) {
    const items = Sel.selection();
    if (!items.length) return;
    const plan = movePlan(items);
    if (!plan.zones.length && !plan.machines.length) {
      if (plan.locked) status("This room is locked.", true);
      return;
    }
    if (!plan.zones.length && plan.machines.length === 1 && items.length === 1) {
      const m = plan.machines[0];
      Machines.drop(m, m.x + dx, m.z + dz);
      return;
    }
    const entries = plan.zones.map((item) => ({ box: Sel.boxOf(item), bounds: boundsForItem(item) }));
    const [cx, cz] = entries.length ? clampGroup(entries, dx, dz) : [dx, dz];
    if (!cx && !cz) return;
    const machines = plan.machines.map(Machines.note);
    const blocked = machines.length ? Machines.groupProblem(Machines.landings(machines, cx, cz)) : "";
    const problem = blocked || moveTogether(plan.zones, machines, cx, cz);
    if (problem) status(problem, true);
  }

  // ---- turning ----

  /** Turn the one selected thing a quarter clockwise: a machine, a multiblock, or a row. */
  function turnOne(item) {
    if (item.kind === "machines") {
      const face = Core.TURN[item.rec.face];
      History.change(() => Core.turnMachine(L(), CATALOG, item.index, item.slot, face));
      Sel.selectMachineAt(item.x, item.z);
      Panels.refresh();
      status(`Turned it to face ${SIDE_NAMES[face].toLowerCase()}.`);
    } else if (item.kind === "pads") {
      History.change(() => Core.turnPad(item.rec));
      status(`Turned it; the controller faces ${SIDE_NAMES[item.rec.front].toLowerCase()}.`);
    } else if (item.kind === "walls") {
      const face = Core.TURN[item.rec.face];
      History.change(() => {
        item.rec.face = face;
      });
      status(`The row faces ${SIDE_NAMES[face].toLowerCase()}.`);
    }
  }

  /** Turn every multiblock, row, and machine of a group. A machine whose row is in the group turns with the row. */
  function turnGroup(items) {
    const wallRecs = new Set(items.filter((item) => item.kind === "walls").map((item) => item.rec));
    const pads = items.filter((item) => item.kind === "pads");
    const walls = items.filter((item) => item.kind === "walls");
    const machines = items.filter((item) => item.kind === "machines" && !wallRecs.has(item.rec))
      .map((item) => ({ x: item.x, z: item.z, face: Core.TURN[item.rec.face] }));
    const count = pads.length + walls.length + machines.length;
    if (!count) return;
    History.change(() => {
      const pins = Machines.pinsNow();
      for (const item of pads) Core.turnPad(item.rec);
      for (const item of walls) item.rec.face = Core.TURN[item.rec.face];
      for (const m of machines) {
        const found = Machines.machineAt(m.x, m.z);
        if (found) Core.turnMachine(L(), CATALOG, found.index, found.slot, m.face);
      }
      Machines.restorePins(pins);
    });
    status(`Turned ${count}.`);
  }

  /** Turn the selection a quarter clockwise. */
  function turnSelected() {
    const items = Sel.selection();
    if (!items.length) return;
    if (items.length === 1) turnOne(items[0]);
    else turnGroup(items);
  }

  // ---- deleting ----

  /** Take machines out of their rows, the last slot of each row first so the others keep their numbers. */
  function deleteMachines(machines) {
    const layout = L();
    const byWall = new Map();
    for (const m of machines) {
      if (!byWall.has(m.rec)) byWall.set(m.rec, []);
      byWall.get(m.rec).push(m.slot);
    }
    for (const [wall, slots] of byWall) {
      const ordered = [...new Set(slots)].sort((a, b) => b - a);
      for (const slot of ordered) {
        const index = layout.walls.indexOf(wall);
        if (index < 0 || slot >= Core.codesOf(wall).length) continue;
        Core.removeMachine(layout, index, slot);
      }
    }
  }

  /** Delete zones. Rooms go last, last in the plan first, each taking what is inside it. */
  function deleteZones(zones) {
    const layout = L();
    const roomIds = new Set(zones.filter((item) => item.kind === "rooms").map((item) => item.rec.id));
    const rooms = [];
    for (const item of zones) {
      if (item.kind === "rooms") {
        rooms.push(item.rec);
        continue;
      }
      if (item.rec.room && roomIds.has(item.rec.room)) continue;
      const index = layout[item.kind].indexOf(item.rec);
      if (index >= 0) Core.deleteZone(layout, item.kind, index);
    }
    rooms.sort((a, b) => layout.rooms.indexOf(b) - layout.rooms.indexOf(a));
    for (const rec of rooms) {
      const index = layout.rooms.indexOf(rec);
      if (index >= 0) Core.deleteZone(layout, "rooms", index);
    }
  }

  /** Delete some items from the plan. This is not yet an undo step. */
  function deleteItems(items) {
    const plan = independentItems(items);
    deleteMachines(plan.machines);
    deleteZones(plan.zones);
  }

  /**
   * Delete the selection, after asking. `opts.verb` is the word used, "Delete" or "Cut", and
   * `opts.confirm` false skips the question for a caller that has asked already.
   */
  async function removeSelected(opts) {
    if (!Sel.selection().length) return;
    const { items, skipped } = actionItems(Sel.selection());
    if (!items.length) {
      status("The entrance stays. Move it instead.", true);
      return;
    }
    const verb = (opts && opts.verb) || "Delete";
    if ((!opts || opts.confirm !== false) && !(await Dialogs.confirmRemove(items, verb))) return;
    const names = Sel.namesOf(items);
    History.change(() => deleteItems(items));
    Sel.clear();
    Panels.refresh();
    status(`${verb === "Cut" ? "Cut" : "Deleted"} ${names}.${skipped ? " The entrance stays." : ""}`);
  }

  Object.assign(App.Edit, {
    actionItems, movePlan, boundsForItem, clampGroup, rehomeAll, nudge, turnSelected, deleteItems, removeSelected,
  });
})(window.App);
