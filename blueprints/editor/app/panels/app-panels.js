/* The page around the plan: refresh() redraws every panel from the state, and the small pieces of
   chrome live here too: the menu bar, the tool bar, the Undo and Copy buttons, the plan's title,
   and the line that says what is under the pointer. */
(function (App) {
  "use strict";

  const {
    Core, $, state, L, unsaved, button,
    Sel, Paint, Tools, Hit, Draw, Edit, Picker, Stack, Lists, Fields,
  } = App;

  // What the tool bar and the picker were last built for, so they are rebuilt only when that changes.
  let chromeKey = "";

  // ---- the menu bar ----

  /** Open one menu and close the rest. A name that matches none closes them all. */
  function openMenu(name) {
    document.querySelectorAll(".menubar .menu").forEach((menu) => {
      const on = menu.dataset.menu === name;
      menu.querySelector(".menu-panel").hidden = !on;
      menu.querySelector(".menu-label").setAttribute("aria-expanded", String(on));
    });
  }

  /** Close every menu. */
  function closeMenus() {
    openMenu("");
  }

  /** A menu's label was pressed: open it, or close it when it is open. */
  function onMenuLabel(event) {
    event.stopPropagation();
    const menu = event.currentTarget.closest(".menu");
    const opening = menu.querySelector(".menu-panel").hidden;
    openMenu(opening ? menu.dataset.menu : "");
  }

  // ---- small pieces ----

  /** Show the plan's name in the title bar, without the file suffix. */
  function showPlanTitle(name) {
    const node = $("plan-title");
    if (!node) return;
    node.textContent = String(name || "").replace(/\.gregmatic$/i, "");
  }

  /** Fill the tier list in Settings once, and make it show the plan's tier. */
  function syncTier() {
    const select = $("tier");
    if (!select) return;
    const choices = Core.VOLTAGE;
    if (select.options.length !== choices.length) {
      select.innerHTML = "";
      for (const tier of choices) {
        const option = document.createElement("option");
        option.value = tier;
        option.textContent = Core.tierLabel(tier);
        select.append(option);
      }
    }
    const value = Core.planTier(L());
    if (select.value !== value) select.value = value;
  }

  /** Enable the buttons that have something to act on, and show whether the plan is unsaved. */
  function renderButtons() {
    $("undo").disabled = !state.undo.length;
    $("redo").disabled = !state.redo.length;
    $("copy").disabled = !Edit.actionItems(Sel.selection()).items.length;
    $("paste").disabled = !(state.clip && state.clip.parts && state.clip.parts.length);
    const dirty = unsaved();
    $("revert").hidden = !dirty;
    $("file-state").hidden = !dirty;
    document.title = `${dirty ? "• " : ""}Gregmatics`;
  }

  /** The tool bar: one button for each tool the layer being shown has. */
  function renderTools() {
    const bar = $("tools");
    bar.innerHTML = "";
    const label = document.createElement("span");
    label.className = "tools-label";
    label.textContent = "Tools";
    bar.append(label);
    for (const tool of Tools.TOOLS) {
      if (!Tools.available(tool.id)) continue;
      const b = button("", () => Tools.set(tool.id));
      b.innerHTML = Tools.ICONS[tool.id];
      b.setAttribute("aria-label", tool.label);
      b.setAttribute("aria-pressed", String(state.tool === tool.id));
      bar.append(b);
    }
  }

  /** What the status bar says about the cell under the pointer: its coordinates, its chunk, and what is there. */
  function cursorText(x, z) {
    let text = `X ${x} · Z ${z} · chunk ${Core.chunkName(L(), x, z)}`;
    if (state.draw) {
      const b = Draw.box();
      return `${text} · ${b.x1 - b.x0 + 1} × ${b.z1 - b.z0 + 1}`;
    }
    const hit = Hit.at(x, z)[0];
    if (hit) text += ` · ${Hit.nameOf(hit)}`;
    return text;
  }

  /** Show where the pointer is. The 3D view writes this line itself. */
  function showCursor() {
    const el = $("cursor");
    if (state.space) return;
    el.textContent = state.hover && state.layout ? cursorText(state.hover[0], state.hover[1]) : "";
  }

  // ---- everything ----

  /** Rebuild the tool bar and the picker when the tool, the floor, the search, or the plan's tier has changed. */
  function refreshChrome() {
    const key = `${state.tool}|${state.layer}|${state.search}|${Core.planTier(L())}`;
    if (key === chromeKey) return;
    chromeKey = key;
    renderTools();
    Picker.render();
  }

  /** Put the cursor in the first field of something just drawn, with its text selected for typing over. */
  function focusFirstField() {
    if (!state.focusFirst) return;
    state.focusFirst = false;
    const first = $("fields").querySelector("[data-first]");
    if (first) {
      first.focus();
      first.select();
    }
  }

  /** Redraw the page from the state: every panel, then the plan. */
  function refresh() {
    if (!state.layout) return;
    syncTier();
    Stack.render();
    refreshChrome();
    Fields.render();
    Lists.renderChecks();
    Lists.renderZones();
    renderButtons();
    Paint.paintFrame();
    showCursor();
    focusFirstField();
  }

  Object.assign(App.Panels, {
    openMenu, closeMenus, onMenuLabel, showPlanTitle, syncTier, renderButtons, showCursor, refresh,
  });
})(window.App);
