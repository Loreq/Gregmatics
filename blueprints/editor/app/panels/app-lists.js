/* The two lists in the side panel: the checks, and everything on the floor being shown. A list is
   split into groups that fold. state.openLists remembers which are open, by a key such as "zone:doors". */
(function (App) {
  "use strict";

  const { Core, CATALOG, $, state, L, Sel, View, Picker, Stack, Panels } = App;

  // ---- groups that fold ----

  /** Whether a group is open. One the user has not touched is open when `fallback` says so. */
  function listOpen(key, fallback) {
    return key in state.openLists ? state.openLists[key] : fallback;
  }

  /** Fold or unfold a group. `open` is how it stands now. */
  function toggleList(key, open) {
    state.openLists[key] = !open;
    // refresh() rebuilds the picker only when the tool, floor, search, or tier changes, so a fold asks for it here.
    Picker.render();
    Panels.refresh();
  }

  /** Add the heading of a group to a list: its name, how many it holds, and an arrow that folds it. */
  function groupHead(list, label, count, open, onToggle) {
    const li = document.createElement("li");
    li.className = "head fold";
    const name = document.createElement("span");
    name.textContent = `${open ? "▾" : "▸"} ${label}`;
    const n = document.createElement("span");
    n.className = "size";
    n.textContent = String(count);
    li.append(name, n);
    li.addEventListener("click", (event) => {
      event.stopPropagation();
      onToggle();
    });
    list.append(li);
  }

  /**
   * Add a group's heading to a list. Returns whether the group is open, so its rows should follow.
   * `forced` holds every group open, as a search does.
   */
  function group(list, key, label, count, fallback, forced) {
    const open = Boolean(forced) || listOpen(key, fallback);
    groupHead(list, label, count, open, () => toggleList(key, open));
    return open;
  }

  // ---- selecting from a list ----

  /** Select a thing and bring it to the middle of the view. `additive` adds it to the selection, or takes it out. */
  function selectAndShow(ref, additive) {
    if (additive) Sel.toggle(ref);
    else Sel.replace(ref);
    const focus = Sel.selection().find((item) => Sel.same(item, ref)) || Sel.selection()[Sel.selection().length - 1];
    if (focus) View.centerOn(Sel.boxOf(focus));
    Panels.refresh();
  }

  // ---- the checks ----

  /** Run the checks on the plan. */
  function runChecks() {
    state.checks = Core.check(L(), CATALOG);
  }

  /** One problem as a row. A click selects what it is about and shows its floor. */
  function checkItem(c, prefix) {
    const li = document.createElement("li");
    li.textContent = prefix + c.text;
    if (prefix) li.className = "other";
    li.addEventListener("click", () => {
      if (c.layer && c.layer !== state.layer) Stack.openLayer(c.layer);
      if (c.kind) {
        Sel.replace({ kind: c.kind, index: c.index, slot: c.slot });
        const item = Sel.selected();
        if (item) View.centerOn(Sel.boxOf(item));
      }
      Sel.fix();
      Panels.refresh();
    });
    return li;
  }

  /** The list of problems: this floor's first, then the other floors', each under its floor's name. */
  function renderChecks() {
    const list = $("checks");
    list.innerHTML = "";
    const checks = state.checks;
    $("check-count").textContent = checks.length ? String(checks.length) : "";
    if (!checks.length) {
      const li = document.createElement("li");
      li.className = "ok";
      li.textContent = "None";
      list.append(li);
      return;
    }
    for (const c of checks.filter((x) => !x.layer || x.layer === state.layer)) list.append(checkItem(c, ""));
    for (const c of checks.filter((x) => x.layer && x.layer !== state.layer)) {
      list.append(checkItem(c, `${Core.layerName(L(), c.layer)}: `));
    }
  }

  // ---- what is on this floor ----

  /** The zones of the floor being shown, grouped by kind in the order they are drawn. */
  function zonesByKind() {
    const byKind = new Map();
    for (const item of Core.zonesOn(L(), state.layer)) {
      if (!byKind.has(item.kind)) byKind.set(item.kind, []);
      byKind.get(item.kind).push(item);
    }
    return byKind;
  }

  /** One zone as a row: its name and its size, or its cell for a lift. */
  function zoneRow(item) {
    const b = Core.boxOf(item.kind, item.z);
    const li = document.createElement("li");
    const name = document.createElement("span");
    name.textContent = Core.nameOf(item.kind, item.z, CATALOG);
    const size = document.createElement("span");
    size.className = "size";
    size.textContent = item.kind === "lifts" ? `${b.x0}, ${b.z0}` : `${b.x1 - b.x0 + 1}×${b.z1 - b.z0 + 1}`;
    li.append(name, size);
    return li;
  }

  /** The list of everything on this floor. The group of the thing just selected opens, and its row is brought into sight. */
  function renderZones() {
    const list = $("zones");
    list.innerHTML = "";
    $("zones-title").textContent = Core.layerName(L(), state.layer);
    const byKind = zonesByKind();
    const primary = Sel.primary();
    const selKey = primary ? `${primary.kind}:${primary.index}:${primary.slot ?? ""}` : "";
    if (primary && primary.kind !== "rooms" && selKey !== state.shownSel) {
      state.openLists[`zone:${primary.kind}`] = true;
    }
    let selectedRow = null;
    for (const [kind, rows] of byKind) {
      if (!group(list, `zone:${kind}`, Core.KIND_PLURALS[kind], rows.length, false)) continue;
      for (const item of rows) {
        const li = zoneRow(item);
        const ref = { kind: item.kind, index: item.index };
        if (Sel.holds(ref)) {
          li.className = "selected";
          if (primary && Sel.same(primary, ref)) selectedRow = li;
        }
        li.addEventListener("click", (event) => selectAndShow(ref, event.ctrlKey || event.metaKey));
        list.append(li);
      }
    }
    if (selectedRow && selKey !== state.shownSel) {
      state.shownSel = selKey;
      selectedRow.scrollIntoView({ block: "nearest" });
    }
  }

  Object.assign(App.Lists, { group, selectAndShow, runChecks, renderChecks, renderZones });
})(window.App);
