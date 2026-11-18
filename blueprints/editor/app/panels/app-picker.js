/* The catalog picker, shown while a place tool is in hand. The list is one flat sequence.
   Each tool keeps its own sort while the page is open. */
(function (App) {
  "use strict";

  const { Core, CATALOG, $, canvas, state, L, Paint, Tools } = App;

  // What the search box asks for. A multiblock search also matches the catalog key.
  const MACHINE_QUERY = "Name or code";
  const MULTI_QUERY = "Name or tag";

  // Sort for machines and for pads. Each starts at A to Z and lasts while the page is open.
  const sortMemory = { machines: "az", pads: "az" };
  // The sort menu is open. Display only, same lifetime as sortMemory.
  let sortOpen = false;

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

  // ---- sort ----

  /** The place tool the sort memory belongs to. */
  function sortTool() {
    return state.tool === "machines" ? "machines" : "pads";
  }

  /** The sort this place tool is using. */
  function sortMode() {
    return sortMemory[sortTool()];
  }

  /** Remember a sort for this place tool and show the list again. */
  function chooseSort(mode) {
    sortMemory[sortTool()] = mode;
    closeSort();
    render();
    $("picker-list").scrollTop = 0;
    $("picker-sort").focus();
  }

  /** Order two names, then the code or the key. */
  function byName(a, b) {
    const names = a.name.localeCompare(b.name);
    if (names) return names;
    return a.id.localeCompare(b.id);
  }

  /** A machine's sort rank. A blank tier sorts after the voltage list. */
  function tierRank(row) {
    const rank = Core.voltageRank(row.machine ? "" : row.spec.tier);
    return rank < 0 ? Core.VOLTAGE.length : rank;
  }

  /** The block count a catalog row sorts by. A machine is one block. */
  function blockCount(row) {
    if (row.machine) return 1;
    const size = row.spec.size;
    return size[0] * size[1] * size[2];
  }

  /** Order two catalog rows for the sort in hand. */
  function compareRows(a, b) {
    const mode = sortMode();
    if (mode === "za") return -byName(a, b);
    if (mode === "tier") return tierRank(a) - tierRank(b) || byName(a, b);
    if (mode === "size") return blockCount(a) - blockCount(b) || byName(a, b);
    return byName(a, b);
  }

  /** The sort menu's choice buttons. */
  function sortChoices() {
    return [...$("picker-sort-menu").querySelectorAll("button")];
  }

  /** The words on the sort button for a mode. */
  function sortLabel(mode) {
    const item = sortChoices().find((choice) => choice.dataset.mode === mode);
    return item ? item.textContent : "A to Z";
  }

  /** Show the sort button and its menu for the tool in hand. */
  function paintSort() {
    const mode = sortMode();
    const label = sortLabel(mode);
    const button = $("picker-sort");
    $("picker-sort-label").textContent = label;
    button.setAttribute("aria-label", `Sort, ${label}`);
    button.setAttribute("aria-expanded", sortOpen ? "true" : "false");
    $("picker-sort-menu").hidden = !sortOpen;
    for (const item of sortChoices()) {
      item.setAttribute("aria-checked", item.dataset.mode === mode ? "true" : "false");
    }
  }

  /** Open or close the sort menu. */
  function toggleSort() {
    sortOpen = !sortOpen;
    paintSort();
    if (!sortOpen) return;
    const current = sortChoices().find((item) => item.dataset.mode === sortMode());
    if (current) current.focus();
  }

  /** Close the sort menu. */
  function closeSort() {
    if (!sortOpen) return;
    sortOpen = false;
    paintSort();
  }

  /** Up and Down move through the open sort menu. */
  function moveSort(event) {
    const step = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
    if (!step || !sortOpen || !$("picker-sort-wrap").contains(event.target)) return;
    event.preventDefault();
    event.stopPropagation();
    const items = sortChoices();
    const index = items.indexOf(event.target);
    const next = index < 0 ? items[step > 0 ? 0 : items.length - 1] : items[index + step];
    if (next) next.focus();
  }

  /** Keys for the open sort menu. */
  function onSortKey(event) {
    if (event.key !== "Escape") {
      moveSort(event);
      return;
    }
    if (!sortOpen || document.querySelector("dialog[open]")) return;
    if (!$("picker-sort-wrap").contains(event.target)) return;
    event.preventDefault();
    event.stopPropagation();
    closeSort();
    $("picker-sort").focus();
  }

  /** A press off the sort button and its menu closes the menu. */
  function onSortPointer(event) {
    if (!sortOpen) return;
    const hit = event.target;
    if ($("picker-sort").contains(hit) || $("picker-sort-menu").contains(hit)) return;
    closeSort();
  }

  /** A catalog row the sorts compare. */
  function sortRow(id, spec, machine) {
    return { id, name: spec.name, spec, machine };
  }

  /** Whether a search query is empty or sits in this text. */
  function queryHits(q, text) {
    return !q || text.toLowerCase().includes(q);
  }

  // ---- machines ----

  /** Whether the plan is still below LV, where electric machines are closed. */
  function belowTierOne() {
    return Core.voltageRank(Core.planTier(L())) < Core.voltageRank("LV");
  }

  /** List the machines the plan tier allows, in the sort in hand. */
  function listMachines(list, q) {
    if (belowTierOne()) {
      list.append(hintRow("Electric machines start at Tier 1."));
      return;
    }
    const colors = L().palette.groups;
    const rows = Object.entries(CATALOG.singles)
      .filter(([code, spec]) => queryHits(q, `${code} ${spec.name}`))
      .map(([code, spec]) => sortRow(code, spec, true))
      .sort(compareRows);
    for (const row of rows) list.append(markedItem(row.id, row.name, row.id, colors[row.spec.group], "", q));
  }

  // ---- multiblocks ----

  /** Keep the pad in hand when the plan tier allows it, else the first open catalog key. */
  function settlePad() {
    const cap = Core.planTier(L());
    const held = CATALOG.multis[state.pick.pads];
    if (held && Core.multiOpen(held, cap)) return;
    for (const [key, spec] of Object.entries(CATALOG.multis)) {
      if (!Core.multiOpen(spec, cap)) continue;
      state.pick.pads = key;
      return;
    }
  }

  /** Catalog multiblocks the plan tier allows. */
  function listedMultis() {
    const cap = Core.planTier(L());
    return Object.entries(CATALOG.multis).filter(([, spec]) => Core.multiOpen(spec, cap));
  }

  /** List the multiblocks the plan tier allows, in the sort in hand. */
  function listMultis(list, q) {
    settlePad();
    const rows = listedMultis()
      .filter(([key, spec]) => queryHits(q, `${key} ${spec.short} ${spec.name}`))
      .map(([key, spec]) => sortRow(key, spec, false))
      .sort(compareRows);
    for (const row of rows) list.append(markedItem(row.id, row.name, row.spec.short, null, sizeLabel(row.spec), q));
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

  /** A search starts the list at the top. */
  function placeList(list, q) {
    if (q) list.scrollTop = 0;
  }

  /** Show the picker for the tool in hand, or hide it when the tool places nothing. */
  function render() {
    const placing = Tools.current().place;
    $("picker").hidden = !placing;
    if (!placing) {
      closeSort();
      return;
    }
    const machines = state.tool === "machines";
    $("picker-title").textContent = machines ? "Machine" : "Multiblock";
    paintSearch(machines);
    paintSort();
    const list = $("picker-list");
    list.innerHTML = "";
    const q = state.search.trim().toLowerCase();
    if (machines) listMachines(list, q);
    else listMultis(list, q);
    if (!list.children.length) list.append(hintRow("Nothing matches."));
    placeList(list, q);
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

  /** Listen for the search box and the sort menu. */
  function listen() {
    $("picker-search").addEventListener("keydown", onSearchKey);
    $("picker-sort").addEventListener("click", toggleSort);
    for (const item of sortChoices()) item.addEventListener("click", () => chooseSort(item.dataset.mode));
    document.addEventListener("keydown", onSortKey, true);
    document.addEventListener("pointerdown", onSortPointer);
  }

  listen();
  Object.assign(App.Picker, { sizeLabel, render, onSearch });
})(window.App);
