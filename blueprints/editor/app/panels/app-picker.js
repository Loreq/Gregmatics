/* The catalog picker, shown while a place tool is in hand: machines by group, or multiblocks by
   tier. The item picked is kept in state.pick, one for each tool. */
(function (App) {
  "use strict";

  const { Core, CATALOG, $, canvas, state, L, Paint, Tools, Lists } = App;

  // The group for multiblocks with no tier of their own, such as altars.
  const NO_TIER = "Other";

  // ---- rows ----

  /** A row saying why the list is empty. */
  function hintRow(text) {
    const li = document.createElement("li");
    li.className = "hint";
    li.textContent = text;
    return li;
  }

  /** Take an item in hand for the tool being used. */
  function pick(value) {
    state.pick[state.tool] = value;
    state.front = null;
    state.swap = false;
    render();
    Paint.draw();
    canvas.focus();
  }

  /** One catalog item as a row: a color chip, its short tag, its name, and something on the right. */
  function pickItem(value, name, tag, color, extra) {
    const li = document.createElement("li");
    const left = document.createElement("span");
    if (color) {
      const chip = document.createElement("i");
      chip.className = "chip";
      chip.style.background = color;
      left.append(chip);
    }
    const strong = document.createElement("b");
    strong.textContent = tag;
    left.append(strong, ` ${name}`);
    const right = document.createElement("span");
    right.className = "size";
    right.textContent = extra || "";
    li.append(left, right);
    if (state.pick[state.tool] === value) li.className = "selected";
    li.addEventListener("click", () => pick(value));
    return li;
  }

  /** A multiblock's legal sizes, short enough for a list row. A long list of sizes shows its ends. */
  function sizeLabel(spec) {
    const rule = Core.sizeRule(spec);
    if (rule && rule.fits && rule.fits.length > 2) {
      return `${rule.fits[0].join("×")} to ${rule.fits[rule.fits.length - 1].join("×")}`;
    }
    return Core.sizeText(spec);
  }

  // ---- machines ----

  /** The machines that match a search, by group, as [code, spec] pairs. */
  function machinesByGroup(q) {
    const byGroup = {};
    for (const [code, spec] of Object.entries(CATALOG.singles)) {
      if (q && !`${code} ${spec.name}`.toLowerCase().includes(q)) continue;
      (byGroup[spec.group] = byGroup[spec.group] || []).push([code, spec]);
    }
    return byGroup;
  }

  /** List the machines, a group at a time. The group of the picked machine starts open. */
  function listMachines(list, q) {
    if (Core.voltageRank(Core.planTier(L())) < Core.voltageRank("LV")) {
      list.append(hintRow("Electric machines start at Tier 1."));
      return;
    }
    const colors = L().palette.groups;
    const byGroup = machinesByGroup(q);
    const picked = CATALOG.singles[state.pick.machines];
    for (const [group, label] of Object.entries(CATALOG.groups)) {
      const rows = byGroup[group];
      if (!rows) continue;
      const mine = Boolean(picked && picked.group === group);
      if (!Lists.group(list, `machine:${group}`, label, rows.length, mine, q)) continue;
      for (const [code, spec] of rows) list.append(pickItem(code, spec.name, code, colors[group], ""));
    }
  }

  // ---- multiblocks ----

  /** The tier a multiblock is listed under. */
  function tierOf(spec) {
    return spec && spec.tier && spec.tier !== "-" ? spec.tier : NO_TIER;
  }

  /** The multiblocks within the plan's tier, by name, as [key, spec] pairs. */
  function openMultis(cap) {
    return Object.entries(CATALOG.multis)
      .filter(([, spec]) => Core.multiOpen(spec, cap))
      .sort((a, b) => a[1].name.localeCompare(b[1].name));
  }

  /** The multiblocks that match a search, by tier. */
  function multisByTier(entries, q) {
    const byTier = new Map();
    for (const entry of entries) {
      if (q && !`${entry[0]} ${entry[1].short} ${entry[1].name}`.toLowerCase().includes(q)) continue;
      const tier = tierOf(entry[1]);
      if (!byTier.has(tier)) byTier.set(tier, []);
      byTier.get(tier).push(entry);
    }
    return byTier;
  }

  /** List the multiblocks, a tier at a time. The picked one's tier and the plan's tier start open. */
  function listMultis(list, q) {
    const cap = Core.planTier(L());
    const entries = openMultis(cap);
    // A lowered tier may have closed the multiblock in hand; take the first one that is still open.
    if (state.pick.pads && !entries.some(([key]) => key === state.pick.pads)) state.pick.pads = entries[0] ? entries[0][0] : "";
    const byTier = multisByTier(entries, q);
    const pickedTier = tierOf(CATALOG.multis[state.pick.pads]);
    for (const tier of [...Core.SELECTABLE, NO_TIER]) {
      const rows = byTier.get(tier);
      if (!rows) continue;
      const mine = tier === pickedTier || tier === cap;
      if (!Lists.group(list, `multi:${tier}`, Core.tierLabel(tier), rows.length, mine, q)) continue;
      for (const [key, spec] of rows) list.append(pickItem(key, spec.name, spec.short, null, sizeLabel(spec)));
    }
  }

  // ---- the panel ----

  /** Show the picker for the tool in hand, or hide it when the tool places nothing. */
  function render() {
    const placing = Tools.current().place;
    $("picker").hidden = !placing;
    if (!placing) return;
    const machines = state.tool === "machines";
    $("picker-title").textContent = machines ? "Machine" : "Multiblock";
    const search = $("picker-search");
    if (search.value !== state.search) search.value = state.search;
    const list = $("picker-list");
    list.innerHTML = "";
    const q = state.search.trim().toLowerCase();
    if (machines) listMachines(list, q);
    else listMultis(list, q);
    if (!list.children.length) list.append(hintRow("Nothing matches."));
  }

  /** Something was typed in the search box. */
  function onSearch(event) {
    state.search = event.target.value;
    render();
  }

  Object.assign(App.Picker, { sizeLabel, render, onSearch });
})(window.App);
