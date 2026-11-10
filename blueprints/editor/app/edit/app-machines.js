/* Moving machines about. A machine is a slot of a row, so moving one takes it out of its row and
   places it again, and the rows are renumbered as that happens. What is being moved is therefore
   remembered by cell, not by row and slot: a machine note is { index, slot, x, z, code, face, tier }. */
(function (App) {
  "use strict";

  const { Core, CATALOG, state, L, status, Sel, History, Panels } = App;

  // ---- notes of machines ----

  /** A note of a selected machine as it stands now. */
  function note(item) {
    return {
      index: item.index, slot: item.slot, x: item.x, z: item.z,
      code: item.code, face: item.rec.face, tier: Core.tierAt(item.rec, item.slot),
    };
  }

  /** A note back as a selection item. */
  function itemOf(m) {
    return {
      kind: "machines", index: m.index, slot: m.slot, rec: L().walls[m.index],
      code: m.code, x: m.x, z: m.z,
    };
  }

  /** How far a drag has carried its machines, as [dx, dz], or null when it carries none. */
  function delta(drag) {
    if (!drag || !drag.machines || !drag.machines.length) return null;
    if (drag.mode === "machine") return drag.delta || [0, 0];
    return drag.applied || [0, 0];
  }

  /** The machine on a cell of this floor, or undefined. */
  function machineAt(x, z) {
    return Core.machinesOn(L(), state.layer).find((item) => item.x === x && item.z === z);
  }

  // ---- keeping the selection through a move ----

  /** The selection as pins that survive renumbering: a machine by its cell, anything else by its record. */
  function pinsNow() {
    const pins = [];
    for (const ref of Sel.refs()) {
      const item = Sel.resolve(ref);
      if (!item) continue;
      if (item.kind === "machines") pins.push({ kind: "machines", x: item.x, z: item.z });
      else pins.push({ kind: item.kind, rec: item.rec });
    }
    return pins;
  }

  /** The ref a pin names now, or null when what it named is gone. */
  function refOfPin(pin) {
    if (pin.kind === "machines") {
      const found = machineAt(pin.x, pin.z);
      return found ? { kind: "machines", index: found.index, slot: found.slot } : null;
    }
    const list = L()[pin.kind];
    const index = list ? list.indexOf(pin.rec) : -1;
    return index < 0 ? null : { kind: pin.kind, index };
  }

  /** Select what the pins name, each thing once. */
  function restorePins(pins) {
    const refs = [];
    const seen = new Set();
    for (const pin of pins) {
      const ref = refOfPin(pin);
      if (!ref) continue;
      const key = ref.kind === "machines" ? `machines:${ref.index}:${ref.slot}` : `${ref.kind}:${ref.index}`;
      if (seen.has(key)) continue;
      seen.add(key);
      refs.push(ref);
    }
    Sel.set(refs);
  }

  // ---- moving a group ----

  /** Notes of machines with where each would land after a move: tx and tz. */
  function landings(machines, dx, dz) {
    return machines.map((m) => ({ ...m, tx: m.x + dx, tz: m.z + dz }));
  }

  /** What stops a group of machines landing where it is headed, or "". */
  function groupProblem(plans) {
    const leaving = new Set(plans.map((p) => `${p.x},${p.z}`));
    const landing = new Set();
    for (const p of plans) {
      const key = `${p.tx},${p.tz}`;
      if (landing.has(key)) return "Those machines would land on the same block.";
      landing.add(key);
      if (!Core.roomAt(L(), state.layer, p.tx, p.tz)) return "Machines go inside a room.";
    }
    for (const m of Core.machinesOn(L(), state.layer)) {
      const key = `${m.x},${m.z}`;
      if (landing.has(key) && !leaving.has(key)) return "A machine is already there.";
    }
    return "";
  }

  /** Point the pins of the machines that are moving at the cells they will land on. */
  function repin(pins, plans) {
    for (const pin of pins) {
      if (pin.kind !== "machines") continue;
      const plan = plans.find((p) => p.x === pin.x && p.z === pin.z);
      if (plan) {
        pin.x = plan.tx;
        pin.z = plan.tz;
      }
    }
  }

  /** Take every machine of a move out of its row, last slots first so the slots before them keep their numbers. */
  function liftAll(plans) {
    const sorted = [...plans].sort((a, b) => b.index - a.index || b.slot - a.slot);
    for (const p of sorted) Core.removeMachine(L(), p.index, p.slot);
  }

  /** Place every machine of a move on the cell it lands on, in the room there. */
  function landAll(plans) {
    for (const p of plans) {
      const home = Core.roomAt(L(), state.layer, p.tx, p.tz);
      if (!home) continue;
      Core.placeMachine(L(), CATALOG, {
        code: p.code, x: p.tx, z: p.tz, face: p.face, room: home.room.id,
        tier: p.tier === Core.DEFAULT_TIER ? undefined : p.tier,
      });
    }
  }

  /** Move machines by a shared offset. Returns a problem, or "". Selection follows them. */
  function applyDelta(machines, dx, dz) {
    const plans = landings(machines, dx, dz);
    const problem = groupProblem(plans);
    if (problem) return problem;
    const pins = pinsNow();
    repin(pins, plans);
    liftAll(plans);
    landAll(plans);
    restorePins(pins);
    return "";
  }

  // ---- moving one ----

  /** Move a machine to a cell. Dropped on another machine, the two swap places. */
  function drop(item, x, z) {
    const other = machineAt(x, z);
    if (other) {
      History.change(() => Core.swapMachines(L(), item, other));
      Sel.selectMachineAt(x, z);
      Panels.refresh();
      status("Swapped the two machines.");
      return;
    }
    const problem = History.change(() => Core.moveMachine(L(), CATALOG, item.index, item.slot, x, z));
    if (problem) {
      status(problem, true);
      return;
    }
    Sel.selectMachineAt(x, z);
    Panels.refresh();
  }

  Object.assign(App.Machines, {
    note, itemOf, delta, machineAt, pinsNow, restorePins, landings, groupProblem, applyDelta, drop,
  });
})(window.App);
