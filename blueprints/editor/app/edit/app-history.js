/* Changing the plan. Every edit runs through change(), so undo, the browser's draft, the checks,
   and the panels stay in step. A drag that edits as it goes takes a snapshot first and calls
   commit() once on release. */
(function (App) {
  "use strict";

  const { Core, BASE, DRAFT_KEY, $, state, entranceFloor, snapshot, status, Sel, Save, View, Space, Paint, Lists, Panels } = App;

  // How many steps undo remembers.
  const UNDO_LIMIT = 200;

  // ---- one change ----

  /** Everything that follows a change to the plan: redraw, recheck, keep a draft, and plan a save. */
  function afterChange() {
    Paint.notePlan();
    Sel.fix();
    saveDraft();
    Lists.runChecks();
    Panels.refresh();
    Save.schedule();
  }

  /** Record that the plan changed since `before`, a snapshot. A change that changed nothing only redraws. */
  function commit(before) {
    if (snapshot() === before) {
      Panels.refresh();
      return;
    }
    state.undo.push(before);
    if (state.undo.length > UNDO_LIMIT) state.undo.shift();
    state.redo = [];
    if ($("status").classList.contains("error")) status("");
    afterChange();
  }

  /** Run an edit as one undo step. Returns what the edit returns. */
  function change(fn) {
    const before = snapshot();
    const result = fn();
    commit(before);
    return result;
  }

  // ---- undo and redo ----

  /** Swap the plan for the last one on a stack, keeping the current one on the other. */
  function stepBack(from, onto, message) {
    if (!from.length) return;
    onto.push(snapshot());
    state.layout = JSON.parse(from.pop());
    afterChange();
    status(message);
  }

  /** Take back the last change. */
  function undo() {
    stepBack(state.undo, state.redo, "Undone.");
  }

  /** Put back the change undo took away. */
  function redo() {
    stepBack(state.redo, state.undo, "Redone.");
  }

  // ---- the browser's draft ----

  /** Keep the plan in the browser, so edits survive a closed window. */
  function saveDraft() {
    if (!state.layout) return;
    try {
      const version = state.fileVersion || BASE.version;
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ version, text: snapshot(), savedText: state.savedText }));
    } catch (err) {
      status("This browser would not keep a draft. Save before closing the page.", true);
    }
  }

  /** Something the browser kept under a key, or null when it is missing or unreadable. */
  function readStored(key) {
    try {
      return JSON.parse(localStorage.getItem(key) || "null");
    } catch (err) {
      return null;
    }
  }

  // ---- a whole new plan ----

  /** Drop a field older plans carry on machine rows. */
  function dropOldStack(layout) {
    for (const wall of layout.walls || []) delete wall.stacked;
  }

  /** Show a plan in place of the current one, with nothing to undo. `savedText` is the plan as it is on disk. */
  function load(layout, message, savedText) {
    if (state.space) Space.set(false);
    dropOldStack(layout);
    state.layout = layout;
    Paint.notePlan();
    state.undo = [];
    state.redo = [];
    state.clip = null;
    state.savedText = savedText;
    state.instances = {};
    state.sel = null;
    if (!Core.layers(layout).some((l) => l.id === state.layer)) state.layer = entranceFloor();
    View.resize();
    View.fit();
    Lists.runChecks();
    Panels.refresh();
    status(message);
  }

  Object.assign(App.History, { change, commit, undo, redo, saveDraft, readStored, dropOldStack, load });
})(window.App);
