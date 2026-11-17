/* The catalog picker, shown while a place tool is in hand: machines by group, or multiblocks by
   tier. The item picked is kept in state.pick, one for each tool. The jump choice stays in this file. */
(function (App) {
  "use strict";

  const { Core, CATALOG, $, canvas, state, L, Paint, Tools, Lists } = App;

  // The group for multiblocks with no tier of their own, such as altars.
  const NO_TIER = "Other";
  // What the search box asks for. A multiblock search also matches the catalog key.
  const MACHINE_QUERY = "Name or code";
  const MULTI_QUERY = "Name or tag";

  // Jump choice for machines and for pads. Null is the first visit and follows the item in hand.
  const jumpMemory = { machines: null, pads: null };

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

  /** A color chip for a catalog group. */
  function colorChip(color) {
    const chip = document.createElement("i");
    chip.className = "chip";
    chip.style.background = color;
    return chip;
  }

  /** One catalog item as a row: a color chip, its short tag, its name, and something on the right. */
  function pickItem(value, name, tag, color, extra) {
    const li = document.createElement("li");
    const left = document.createElement("span");
    if (color) left.append(colorChip(color));
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

  /** One catalog row, with the query marked in its tag and its name. */
  function markedItem(value, name, tag, color, extra, q) {
    const row = pickItem(value, name, tag, color, extra);
    markRow(row, q);
    return row;
  }

  /** A multiblock's legal sizes, short enough for a list row. A long list of sizes shows its ends. */
  function sizeLabel(spec) {
    const rule = Core.sizeRule(spec);
    if (rule && rule.fits && rule.fits.length > 2) {
      return `${rule.fits[0].join("×")} to ${rule.fits[rule.fits.length - 1].join("×")}`;
    }
    return Core.sizeText(spec);
  }

  // ---- marks ----

  /** Mark the tag and the name where the query appears. */
  function markRow(row, q) {
    if (q && row.firstElementChild) markElement(row.firstElementChild, q);
  }

  /** Wrap each match inside an element by splitting its text nodes. */
  function markElement(el, q) {
    const nodes = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) markText(node, q);
  }

  /** Split one text node so each match sits in its own mark. */
  function markText(node, q) {
    if (!q) return;
    let rest = node;
    while (rest && rest.nodeValue) {
      const index = rest.nodeValue.toLowerCase().indexOf(q);
      if (index < 0) return;
      const start = index === 0 ? rest : rest.splitText(index);
      rest = q.length < start.nodeValue.length ? start.splitText(q.length) : null;
      const mark = document.createElement("mark");
      start.parentNode.insertBefore(mark, start);
      mark.append(start);
    }
  }

  // ---- machines ----

  /** Whether the plan is still below LV, where electric machines are closed. */
  function belowTierOne() {
    return Core.voltageRank(Core.planTier(L())) < Core.voltageRank("LV");
  }

  /** The machines that match a search, by group, as [code, spec] pairs. */
  function machinesByGroup(q) {
    const byGroup = {};
    for (const [code, spec] of Object.entries(CATALOG.singles)) {
      if (q && !`${code} ${spec.name}`.toLowerCase().includes(q)) continue;
      (byGroup[spec.group] = byGroup[spec.group] || []).push([code, spec]);
    }
    return byGroup;
  }

  /** List the machines, a group at a time. A chosen group starts open, else the picked machine's group does. */
  function listMachines(list, q, narrow) {
    if (belowTierOne()) {
      list.append(hintRow("Electric machines start at Tier 1."));
      return;
    }
    const colors = L().palette.groups;
    const byGroup = machinesByGroup(q);
    const picked = CATALOG.singles[state.pick.machines];
    for (const [group, label] of Object.entries(CATALOG.groups)) {
      const rows = byGroup[group];
      if (!rows || (narrow && group !== narrow)) continue;
      const mine = Boolean(picked && picked.group === group);
      if (!Lists.group(list, `machine:${group}`, label, rows.length, Boolean(narrow) || mine, q)) continue;
      for (const [code, spec] of rows) list.append(markedItem(code, spec.name, code, colors[group], "", q));
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

  /** Drop a multiblock the plan tier has closed, and take the first one still open. */
  function settlePad() {
    const entries = openMultis(Core.planTier(L()));
    if (state.pick.pads && !entries.some(([key]) => key === state.pick.pads)) {
      state.pick.pads = entries[0] ? entries[0][0] : "";
    }
  }

  /** List the multiblocks, a tier at a time. A chosen tier starts open, else the picked tier and the plan tier do. */
  function listMultis(list, q, narrow) {
    const cap = Core.planTier(L());
    settlePad();
    const entries = openMultis(cap);
    const byTier = multisByTier(entries, q);
    const pickedTier = tierOf(CATALOG.multis[state.pick.pads]);
    for (const tier of [...Core.SELECTABLE, NO_TIER]) {
      const rows = byTier.get(tier);
      if (!rows || (narrow && tier !== narrow)) continue;
      const mine = tier === pickedTier || tier === cap;
      if (!Lists.group(list, `multi:${tier}`, Core.tierLabel(tier), rows.length, Boolean(narrow) || mine, q)) continue;
      for (const [key, spec] of rows) list.append(markedItem(key, spec.name, spec.short, null, sizeLabel(spec), q));
    }
  }

  // ---- jump row ----

  /** The place tool the jump memory belongs to. */
  function toolKey() {
    return state.tool === "machines" ? "machines" : "pads";
  }

  /** The group of the machine in hand, when there is one. */
  function groupInHand() {
    const spec = CATALOG.singles[state.pick.machines];
    return spec ? spec.group : "";
  }

  /** All, then each catalog group that holds a machine. */
  function machineJumps() {
    const jumps = [{ id: "all", label: "All" }];
    const byGroup = machinesByGroup("");
    const colors = L().palette.groups;
    for (const [group, label] of Object.entries(CATALOG.groups)) {
      const rows = byGroup[group];
      if (!rows) continue;
      const jump = { id: group, label, aria: `${label}, ${rows.length}` };
      if (colors[group]) jump.color = colors[group];
      jumps.push(jump);
    }
    return jumps;
  }

  /** How many open multiblocks each tier holds. */
  function tierCounts(entries) {
    const counts = new Map();
    for (const [, spec] of entries) {
      const tier = tierOf(spec);
      counts.set(tier, (counts.get(tier) || 0) + 1);
    }
    return counts;
  }

  /** All, then each tier that has an open multiblock, then Other. */
  function multiJumps() {
    const jumps = [{ id: "all", label: "All" }];
    const counts = tierCounts(openMultis(Core.planTier(L())));
    for (const tier of [...Core.SELECTABLE, NO_TIER]) {
      if (!counts.has(tier)) continue;
      jumps.push({ id: tier, label: tier, aria: `${Core.tierLabel(tier)}, ${counts.get(tier)}` });
    }
    return jumps;
  }

  /** The item in hand, when its group or tier is on the row. Otherwise All. */
  function handOnRow(ids) {
    const hand = state.tool === "machines" ? groupInHand() : tierOf(CATALOG.multis[state.pick.pads]);
    return ids.includes(hand) ? hand : "all";
  }

  /** The pressed jump for this tool. A choice that has left the row becomes All. */
  function keptChoice(jumps) {
    const saved = jumpMemory[toolKey()];
    const ids = jumps.map((jump) => jump.id);
    if (saved == null) return handOnRow(ids);
    if (ids.includes(saved)) return saved;
    jumpMemory[toolKey()] = "all";
    return "all";
  }

  /** Hide the jump row while the tier gate is showing. */
  function hideJump() {
    const row = $("picker-jump");
    row.hidden = true;
    row.replaceChildren();
  }

  /** One jump button. A group chip uses the palette color already loaded. */
  function jumpButton(jump, pressed) {
    const button = document.createElement("button");
    button.type = "button";
    if (jump.color) button.append(colorChip(jump.color));
    button.append(document.createTextNode(jump.label));
    button.setAttribute("aria-pressed", pressed ? "true" : "false");
    if (jump.aria) button.setAttribute("aria-label", jump.aria);
    button.addEventListener("click", () => chooseJump(jump.id));
    return button;
  }

  /** Draw the jump row. Nothing is pressed while a search is typed. */
  function drawJump(jumps, pressed) {
    const row = $("picker-jump");
    row.hidden = false;
    row.replaceChildren();
    for (const jump of jumps) row.append(jumpButton(jump, jump.id === pressed));
  }

  /** Remember a jump, clear the search, open that section, and show it. */
  function chooseJump(id) {
    const keep = $("picker-jump").contains(document.activeElement);
    jumpMemory[toolKey()] = id;
    state.search = "";
    if (id !== "all") state.openLists[`${state.tool === "machines" ? "machine" : "multi"}:${id}`] = true;
    render();
    if (!keep) return;
    const pressed = $("picker-jump").querySelector('[aria-pressed="true"]');
    if (pressed) pressed.focus();
  }

  /** Draw the jump row and return the group or tier that narrows an empty search. */
  function fillJump(machines, q) {
    if (machines && belowTierOne()) {
      hideJump();
      return null;
    }
    if (!machines) settlePad();
    const jumps = machines ? machineJumps() : multiJumps();
    const choice = keptChoice(jumps);
    drawJump(jumps, q ? null : choice);
    return q || choice === "all" ? null : choice;
  }

  // ---- the panel ----

  /** Set the search prompt for the tool in hand. */
  function paintSearch(machines) {
    const search = $("picker-search");
    const name = machines ? MACHINE_QUERY : MULTI_QUERY;
    search.placeholder = name;
    search.setAttribute("aria-label", machines ? name : `${name}. The key matches.`);
    if (search.value !== state.search) search.value = state.search;
  }

  /** Bring a selected row into the list. A stuck header stays above it. */
  function revealRow(list, row) {
    const listBox = list.getBoundingClientRect();
    const rowBox = row.getBoundingClientRect();
    const head = list.querySelector("li.head");
    const cover = head ? head.getBoundingClientRect().height : 0;
    if (rowBox.top < listBox.top + cover) list.scrollTop -= listBox.top + cover - rowBox.top;
    else if (rowBox.bottom > listBox.bottom) list.scrollTop += rowBox.bottom - listBox.bottom;
  }

  /** A search starts at the top. One open section shows the row in hand. */
  function placeList(list, q, narrow) {
    if (q) {
      list.scrollTop = 0;
      return;
    }
    if (!narrow) return;
    const selected = list.querySelector("li.selected");
    if (!selected) {
      list.scrollTop = 0;
      return;
    }
    revealRow(list, selected);
  }

  /** Show the picker for the tool in hand, or hide it when the tool places nothing. */
  function render() {
    const placing = Tools.current().place;
    $("picker").hidden = !placing;
    if (!placing) return;
    const machines = state.tool === "machines";
    $("picker-title").textContent = machines ? "Machine" : "Multiblock";
    paintSearch(machines);
    const list = $("picker-list");
    list.innerHTML = "";
    const q = state.search.trim().toLowerCase();
    const narrow = fillJump(machines, q);
    if (machines) listMachines(list, q, narrow);
    else listMultis(list, q, narrow);
    if (!list.children.length) list.append(hintRow("Nothing matches."));
    placeList(list, q, narrow);
  }

  /** Something was typed in the search box. */
  function onSearch(event) {
    state.search = event.target.value;
    render();
  }

  // ---- keys ----

  /** Pick the only catalog row a search is showing. */
  function pickSoleRow() {
    if (!state.search.trim()) return;
    const rows = [...$("picker-list").children].filter((li) => !li.classList.contains("head") && !li.classList.contains("hint"));
    if (rows.length === 1) rows[0].click();
  }

  /** Enter picks a lone match. Escape clears a query, or returns to the plan when the box is empty. */
  function onSearchKey(event) {
    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      pickSoleRow();
      return;
    }
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    if (event.currentTarget.value) {
      state.search = "";
      render();
      return;
    }
    canvas.focus();
  }

  /** Which way an arrow key steps along the jump row. */
  function jumpStep(key) {
    if (key === "ArrowRight" || key === "ArrowDown") return 1;
    if (key === "ArrowLeft" || key === "ArrowUp") return -1;
    return 0;
  }

  /** Arrow keys move along the jump row and do not move the plan. */
  function onJumpKey(event) {
    const step = jumpStep(event.key);
    if (!step) return;
    const buttons = [...event.currentTarget.querySelectorAll("button")];
    const current = event.target.closest("button");
    const index = buttons.indexOf(current);
    if (index < 0) return;
    event.preventDefault();
    event.stopPropagation();
    const next = buttons[index + step];
    if (next) next.focus();
  }

  /** Listen for keys on the search box and the jump row. */
  function listen() {
    $("picker-search").addEventListener("keydown", onSearchKey);
    $("picker-jump").addEventListener("keydown", onJumpKey);
  }

  listen();
  Object.assign(App.Picker, { sizeLabel, render, onSearch });
})(window.App);
