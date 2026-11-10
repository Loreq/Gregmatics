/* Starts the editor. Every listener the page has is added here, so this file is the map from
   what the user does to the app-*.js file that handles it. It loads last. */
(function (App) {
  "use strict";

  const {
    CONTENTS, $, canvas, state, unsaved,
    Sel, History, Files, NewPlan, Save, View, Space, Paint, Pointer, Keys, Clip, Dialogs, Settings, Panels, Picker,
  } = App;

  // ---- handlers too small for a file of their own ----

  /** File → Revert: go back to the plan as it was last saved, after asking. */
  async function revert() {
    if (!unsaved()) return;
    if (!(await Dialogs.ask("Drop unsaved edits?", "Revert"))) return;
    // Back to the text last written, which is not the page's first copy once this window has saved or loaded.
    History.load(JSON.parse(state.savedText), "Reverted.", state.savedText);
    History.saveDraft();
  }

  /** The Passthrough box: show or hide the outlines of the floors above and below. */
  function onShowOthers(event) {
    state.show.others = event.target.checked;
    Paint.draw();
  }

  /** The Contents box: show or hide what stands in the rooms. Hidden things cannot stay selected. */
  function onShowContents(event) {
    state.show.contents = event.target.checked;
    if (!state.show.contents && state.sel) {
      const kept = Sel.refs().filter((ref) => !CONTENTS.has(ref.kind));
      state.sel = kept.length ? kept : null;
    }
    Panels.refresh();
  }

  /** The space the plan is drawn in changed size. A plan that was fitted to it is fitted again. */
  function onResize() {
    View.resize();
    if (state.fitted) View.fit();
    Paint.paintFrame();
  }

  // ---- listeners ----

  /** The plan canvas: the pointer and the wheel. */
  function listenToPlan() {
    canvas.addEventListener("pointerdown", Pointer.onDown);
    canvas.addEventListener("pointermove", Pointer.onMove);
    canvas.addEventListener("pointerup", Pointer.onUp);
    canvas.addEventListener("pointercancel", Pointer.onUp);
    canvas.addEventListener("contextmenu", (event) => event.preventDefault());
    canvas.addEventListener("pointerleave", Pointer.onLeave);
    canvas.addEventListener("wheel", Pointer.onWheel, { passive: false });
  }

  /** The menu bar and the File menu. A press anywhere else closes the menu. */
  function listenToMenus() {
    document.querySelectorAll(".menubar .menu-label").forEach((label) => label.addEventListener("click", Panels.onMenuLabel));
    document.querySelector(".menubar").addEventListener("click", (event) => {
      if (event.target.closest(".menu-panel button")) Panels.closeMenus();
    });
    document.addEventListener("pointerdown", (event) => {
      if (!event.target.closest(".menubar")) Panels.closeMenus();
    });
    $("new").addEventListener("click", NewPlan.start);
    $("load").addEventListener("click", Files.loadPlan);
    $("menu-save").addEventListener("click", () => Save.save());
    $("revert").addEventListener("click", revert);
    $("png").addEventListener("click", Paint.exportPng);
    $("settings").addEventListener("click", Settings.open);
    $("file-input").addEventListener("change", Files.onFileChosen);
  }

  /** The Settings dialog. */
  function listenToSettings() {
    $("plan-folder-change").addEventListener("click", Files.changeFolder);
    $("plan-name").addEventListener("input", Settings.paintPlanFile);
    $("settings-dialog").addEventListener("cancel", Settings.onCancel);
    $("settings-dialog").querySelector("form").addEventListener("submit", Settings.onSubmit);
  }

  /** The buttons and boxes beside the plan. */
  function listenToSidePanel() {
    $("undo").addEventListener("click", History.undo);
    $("redo").addEventListener("click", History.redo);
    $("copy").addEventListener("click", () => Clip.copy());
    $("paste").addEventListener("click", () => Clip.paste());
    $("view-3d").addEventListener("click", () => Space.set(!state.space));
    $("picker-search").addEventListener("input", Picker.onSearch);
    $("show-others").addEventListener("change", onShowOthers);
    $("show-contents").addEventListener("change", onShowContents);
  }

  /** The keyboard, the window closing, and the plan's space changing size. */
  function listenToWindow() {
    document.addEventListener("keydown", Keys.onKey);
    window.addEventListener("beforeunload", Save.onLeave);
    new ResizeObserver(onResize).observe($("view"));
  }

  listenToPlan();
  listenToMenus();
  listenToSettings();
  listenToSidePanel();
  listenToWindow();
  Files.boot();
})(window.App);
