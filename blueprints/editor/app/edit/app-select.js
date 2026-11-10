/* The selection. state.sel is null or a list of refs, { kind, index, slot }, that name records of
   the plan by where they are in its lists. An item is a ref looked up: { kind, index, rec }, plus
   slot, code, and cell for a machine, which is one slot of a machine row. */
(function (App) {
  "use strict";

  const { Core, CATALOG, CONTENTS, state, L, entranceFloor, cellBox, Tools } = App;

  // ---- refs ----

  /** The refs that are selected, oldest first. */
  function refs() {
    return state.sel || [];
  }

  /** A ref for a hit or an item, with nothing else carried over. */
  function refOf(hit) {
    const ref = { kind: hit.kind, index: hit.index };
    if (hit.slot != null) ref.slot = hit.slot;
    return ref;
  }

  /** Whether two refs name the same thing. */
  function same(a, b) {
    return Boolean(a && b) && a.kind === b.kind && a.index === b.index && (a.slot ?? null) === (b.slot ?? null);
  }

  /** Select exactly these. */
  function set(list) {
    const next = (list || []).map(refOf);
    state.sel = next.length ? next : null;
  }

  /** Select one thing, or nothing. */
  function replace(ref) {
    set(ref ? [ref] : []);
  }

  /** Select nothing. */
  function clear() {
    state.sel = null;
  }

  /** Add a thing to the selection, or take it out when it is already in. */
  function toggle(ref) {
    const next = refs().filter((item) => !same(item, ref));
    if (next.length === refs().length) next.push(ref);
    set(next);
  }

  /** The ref selected last: the one a group narrows to. */
  function primary() {
    const list = refs();
    return list.length ? list[list.length - 1] : null;
  }

  /** Whether a hit is part of the selection. */
  function holds(hit) {
    return refs().some((item) => same(item, hit));
  }

  // ---- items ----

  /** One ref as { kind, index, rec }, plus slot, code, and cell for a machine. Null when it is gone. */
  function resolve(ref) {
    if (!ref || !state.layout) return null;
    const list = L()[ref.kind === "machines" ? "walls" : ref.kind];
    const rec = list && list[ref.index];
    if (!rec) return null;
    if (ref.kind !== "machines") return { kind: ref.kind, index: ref.index, rec };
    const codes = Core.codesOf(rec);
    if (!(ref.slot < codes.length) || codes[ref.slot] === "-") return null;
    const [x, z] = Core.cellOf(rec, ref.slot);
    return { kind: "machines", index: ref.index, slot: ref.slot, rec, code: codes[ref.slot], x, z };
  }

  /** Every selected item that still exists. */
  function selection() {
    const out = [];
    for (const ref of refs()) {
      const item = resolve(ref);
      if (item) out.push(item);
    }
    return out;
  }

  /** The selection when exactly one thing is selected. */
  function selected() {
    const all = selection();
    return all.length === 1 ? all[0] : null;
  }

  /** The box an item covers. */
  function boxOf(item) {
    if (!item) return null;
    if (item.kind === "machines") return cellBox(item.x, item.z);
    return Core.boxOf(item.kind, item.rec);
  }

  /** The name an item goes by. */
  function nameOf(item) {
    if (item.kind === "machines") return (CATALOG.singles[item.code] || { name: item.code }).name;
    return Core.nameOf(item.kind, item.rec, CATALOG);
  }

  /** The names of some items for a message: the first three, then how many more. */
  function namesOf(items) {
    const names = items.map(nameOf);
    if (names.length <= 3) return names.join(", ");
    return `${names.slice(0, 3).join(", ")}, and ${names.length - 3} more`;
  }

  /** Select the machine on a cell of this floor, or nothing when there is none. */
  function selectMachineAt(x, z) {
    const m = Core.machinesOn(L(), state.layer).find((item) => item.x === x && item.z === z);
    replace(m ? { kind: "machines", index: m.index, slot: m.slot } : null);
  }

  // ---- keeping it true to the plan ----

  /** Whether an item is on the floor being shown. */
  function onLayer(item) {
    if (!item) return false;
    if (CONTENTS.has(item.kind)) return Core.onFloor(L(), item.rec.room, state.layer);
    return Core.zonesOn(L(), state.layer).some((i) => i.kind === item.kind && i.index === item.index);
  }

  /** After the plan changes: show a floor that exists, drop what is gone, and leave a tool the floor lacks. */
  function fix() {
    if (!Core.layers(L()).some((l) => l.id === state.layer)) state.layer = entranceFloor();
    if (state.sel) {
      const kept = refs().filter((ref) => onLayer(resolve(ref)));
      state.sel = kept.length ? kept : null;
    }
    if (!Tools.available(state.tool)) Tools.set("select", true);
  }

  Object.assign(App.Sel, {
    refs, refOf, same, set, replace, clear, toggle, primary, holds,
    resolve, selection, selected, boxOf, nameOf, namesOf, selectMachineAt, onLayer, fix,
  });
})(window.App);
