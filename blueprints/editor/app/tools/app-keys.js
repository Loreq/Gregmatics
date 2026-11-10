/* The keyboard. Shortcuts are tried in the order they are listed, and the first that matches runs.
   A key typed into a field or while a dialog is open is left to the page. */
(function (App) {
  "use strict";

  const { Core, state, L, Sel, History, Save, Space, Tools, Draw, Place, Edit, Clip, Stack, Panels } = App;

  const ARROWS = { arrowleft: [-1, 0], arrowright: [1, 0], arrowup: [0, -1], arrowdown: [0, 1] };
  // How far an arrow key moves the selection with Shift held.
  const BIG_STEP = 5;

  // ---- what each key does ----

  /** Ctrl+C copies, unless text on the page is selected or the key is repeating. */
  function copyKey(event) {
    if (Clip.textSelected() || event.repeat) return;
    event.preventDefault();
    Clip.copy();
  }

  /** Ctrl+X cuts, unless text on the page is selected or the key is repeating. */
  function cutKey(event) {
    if (Clip.textSelected() || event.repeat) return;
    event.preventDefault();
    Clip.cut();
  }

  /** Escape backs out one step: of a sketch, then of a tool, then of the selection. */
  function escapeKey() {
    if (state.draw) Draw.cancel();
    else if (state.tool !== "select") Tools.set("select");
    else {
      Sel.clear();
      Panels.refresh();
    }
  }

  /** R turns what is about to be placed, or else what is selected. */
  function turnKey() {
    if (Tools.current().place) Place.turn();
    else Edit.turnSelected();
  }

  /** An arrow key moves the selection one block, or five with Shift. */
  function arrowKey(event, key) {
    event.preventDefault();
    const n = event.shiftKey ? BIG_STEP : 1;
    Edit.nudge(ARROWS[key][0] * n, ARROWS[key][1] * n);
  }

  /** Page Up and Page Down show the floor above and the floor below. */
  function pageKey(event, key) {
    event.preventDefault();
    const ids = Core.layers(L()).map((l) => l.id);
    const i = ids.indexOf(state.layer) + (key === "pageup" ? 1 : -1);
    if (i >= 0 && i < ids.length) Stack.switchLayer(ids[i]);
  }

  /** Run a function as a shortcut that the browser should not also act on. */
  function mine(fn) {
    return (event) => {
      event.preventDefault();
      fn();
    };
  }

  // Each shortcut: when it applies, given the key in lowercase and whether Ctrl or Cmd is held, and what it runs.
  const SHORTCUTS = [
    { when: (key, mod, event) => mod && key === "z" && !event.shiftKey, run: mine(() => History.undo()) },
    { when: (key, mod, event) => mod && (key === "y" || (key === "z" && event.shiftKey)), run: mine(() => History.redo()) },
    { when: (key, mod) => mod && key === "c", run: copyKey },
    { when: (key, mod) => mod && key === "x", run: cutKey },
    { when: (key, mod) => mod && key === "v", run: mine(() => Clip.paste()) },
    { when: (key, mod) => mod && key === "d", run: mine(() => Clip.duplicate()) },
    { when: (key, mod) => !mod && Boolean(Tools.byKey(key)), run: (event, key) => Tools.set(Tools.byKey(key).id) },
    { when: (key, mod) => !mod && key === "v", run: () => Tools.set("select") },
    { when: (key) => key === "escape", run: escapeKey },
    { when: (key, mod) => key === "r" && !mod, run: turnKey },
    { when: (key) => Object.hasOwn(ARROWS, key) && Sel.selection().length > 0, run: arrowKey },
    { when: (key) => (key === "delete" || key === "backspace") && Sel.selection().length > 0, run: mine(() => Edit.removeSelected()) },
    { when: (key) => key === "pageup" || key === "pagedown", run: pageKey },
  ];

  // ---- which keys reach the shortcuts ----

  /** Whether a dialog is open. */
  function dialogOpen() {
    return Boolean(document.querySelector("dialog[open]"));
  }

  /** Whether a key belongs to a field being typed in or to an open dialog. */
  function isTyping() {
    return /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName) || dialogOpen();
  }

  /** A key was pressed anywhere on the page. */
  function onKey(event) {
    if (!state.layout) return;
    const key = event.key.toLowerCase();
    const mod = event.ctrlKey || event.metaKey;
    if (key === "escape" && document.querySelector(".menubar .menu-panel:not([hidden])") && !dialogOpen()) {
      Panels.closeMenus();
      return;
    }
    if (mod && key === "s" && !event.altKey) {
      event.preventDefault();
      Save.save();
      return;
    }
    if (state.space) {
      if (key === "escape" && !dialogOpen()) Space.set(false);
      return;
    }
    if (isTyping()) return;
    const shortcut = SHORTCUTS.find((s) => s.when(key, mod, event));
    if (shortcut) shortcut.run(event, key);
  }

  Object.assign(App.Keys, { onKey });
})(window.App);
