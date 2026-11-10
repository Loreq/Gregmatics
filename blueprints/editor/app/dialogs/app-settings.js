/* File → Settings: the plan's name and tier, autosave, the plan folder, and the main floor's
   footprint. Nothing changes until Save, and closing with changes pending asks first. */
(function (App) {
  "use strict";

  const {
    Core, CATALOG, AUTOSAVE_KEY, $, state, L, unsaved, status,
    History, Files, Save, Bounds, Dialogs, Panels,
  } = App;

  // The picture the main floor's footprint is typed into, while the dialog is open.
  let boundsEditor = null;

  // ---- the plan's name ----

  /** The name the plan goes by: its own, or its file's when it has none. */
  function planName() {
    return (L().site && L().site.name) || Files.fileStem(state.planFile);
  }

  /** Show the file name the typed plan name would be saved under. */
  function paintPlanFile() {
    const input = $("plan-name");
    const preview = $("plan-file");
    if (!input || !preview) return;
    const name = input.value.trim();
    preview.textContent = name ? Files.previewFileName(name, true) : "";
  }

  /** Put the plan's name in its input. */
  function syncPlanName() {
    const input = $("plan-name");
    if (!input || !L()) return;
    input.value = planName();
    paintPlanFile();
  }

  /** Rename the plan, and its file when the desktop window holds one. Resolves to whether it worked. */
  async function applyPlanName(raw) {
    const name = String(raw || "").trim();
    if (!name || !L()) return false;
    const filename = Files.previewFileName(name, true);
    if ((L().site.name || "") !== name) History.change(() => { L().site.name = name; });
    Panels.showPlanTitle(name);
    const api = Files.desktopApi();
    if (!api) {
      state.planFile = filename;
      paintPlanFile();
      return true;
    }
    if (unsaved()) await Save.save({ auto: true });
    if (filename.toLowerCase() === (state.planFile || "").toLowerCase()) {
      paintPlanFile();
      return true;
    }
    const reply = await api.rename_plan(name);
    if (!reply || !reply.ok) {
      status((reply && reply.error) || "Could not rename the file.", true);
      return false;
    }
    state.planFile = reply.current || filename;
    await Files.refreshPlanFiles();
    paintPlanFile();
    return true;
  }

  // ---- autosave ----

  /** Remember the autosave switch in the browser. */
  function storeAutosave() {
    localStorage.setItem(AUTOSAVE_KEY, state.autosave ? "on" : "off");
  }

  /** Turn autosave on or off, here and in the desktop window. Resolves to a problem, or "". */
  async function applyAutosave(on) {
    state.autosave = on;
    storeAutosave();
    if (on) Save.schedule();
    else Save.unschedule();
    const api = Files.desktopApi();
    if (!api) return "";
    const reply = await api.set_autosave(on);
    if (reply && reply.ok) return "";
    state.autosave = !on;
    $("autosave").checked = !on;
    storeAutosave();
    return (reply && reply.error) || "Could not store that setting.";
  }

  // ---- the footprint ----

  /** Put the footprint picture in the dialog, for the main floor. */
  function mountBounds() {
    const host = $("settings-bounds");
    const error = $("settings-bounds-error");
    if (!host) return;
    host.innerHTML = "";
    error.textContent = "";
    const floor = Core.mainFloor(L());
    if (!floor) {
      boundsEditor = null;
      host.textContent = "This plan has no floor yet.";
      return;
    }
    boundsEditor = Bounds.mount(host, {
      ...Bounds.floorSpec(floor),
      onCommit: (next) => {
        error.textContent = Bounds.boundsProblem(floor, next);
      },
    });
  }

  // ---- opening, saving, and closing ----

  /** Open the dialog, filled in from the plan. */
  async function open() {
    Panels.syncTier();
    Files.refreshFolder();
    mountBounds();
    $("autosave").checked = state.autosave;
    await Files.refreshPlanFiles();
    syncPlanName();
    $("settings-dialog").showModal();
  }

  /** Whether the dialog holds something the plan does not. A footprint that does not read counts. */
  function isDirty() {
    if (!L()) return false;
    if ($("plan-name").value.trim() !== planName()) return true;
    if ($("tier").value !== Core.planTier(L())) return true;
    if ($("autosave").checked !== state.autosave) return true;
    const floor = Core.mainFloor(L());
    if (!floor || !boundsEditor) return false;
    const next = boundsEditor.read();
    if (![next.x0, next.x1, next.z0, next.z1].every((n) => Number.isInteger(n))) return true;
    return !Core.sameBox(next, Core.floorBox(L(), floor));
  }

  /** The question to ask before the plan's tier changes, and how many placed things a lower tier would flag. */
  function tierChange(tier, currentTier) {
    const lowering = Core.voltageRank(tier) < Core.voltageRank(currentTier);
    const flagged = lowering ? Core.overTier(L(), CATALOG, tier).length : 0;
    const label = Core.tierLabel(tier);
    const message = lowering
      ? `Lower the tier to ${label}? Nothing is removed.${flagged ? ` ${flagged} will be flagged.` : ""}`
      : `Raise the tier to ${label}?`;
    return { flagged, message, okLabel: lowering ? "Lower tier" : "Raise tier" };
  }

  /** Store a new footprint for the main floor and a new tier, whichever changed, as one undo step. */
  function applyPlanChanges(floor, box, tier, currentTier) {
    const boxChanged = !Core.sameBox(box, Core.floorBox(L(), floor));
    const tierChanged = tier !== currentTier;
    if (!boxChanged && !tierChanged) return;
    History.change(() => {
      if (boxChanged) Core.writeSpan(L(), floor, box);
      if (tierChanged) L().site.tier = tier;
    });
  }

  /** Show a problem in the dialog and report that the save did not go through. */
  function refuse(text) {
    $("settings-bounds-error").textContent = text;
    return false;
  }

  /** Save what the dialog holds and close it. Resolves to false, with the dialog still open, when something is wrong. */
  async function commit() {
    const name = $("plan-name").value.trim();
    if (!name) return refuse("Give the plan a name.");
    const floor = Core.mainFloor(L());
    const next = boundsEditor ? boundsEditor.read() : null;
    const problem = Bounds.boundsProblem(floor, next || {});
    if (problem) return refuse(problem);
    const tier = $("tier").value;
    const currentTier = Core.planTier(L());
    let flagged = 0;
    if (tier !== currentTier) {
      const asked = tierChange(tier, currentTier);
      flagged = asked.flagged;
      if (!(await Dialogs.ask(asked.message, asked.okLabel))) return false;
    }
    applyPlanChanges(floor, { x0: next.x0, x1: next.x1, z0: next.z0, z1: next.z1 }, tier, currentTier);
    if ($("autosave").checked !== state.autosave) {
      const failed = await applyAutosave($("autosave").checked);
      if (failed) return refuse(failed);
    }
    if (name !== planName() && !(await applyPlanName(name))) return false;
    $("settings-bounds-error").textContent = "";
    status(flagged ? `Settings saved. ${flagged} flagged.` : "Settings saved.");
    $("settings-dialog").close();
    return true;
  }

  /** Close the dialog. With changes pending, ask whether to save them, drop them, or stay. */
  async function close() {
    if (!isDirty()) {
      $("settings-dialog").close();
      return;
    }
    const choice = await Dialogs.choose("Save these settings before closing?", "Save", "Exit");
    if (choice === "ok") await commit();
    else if (choice === "alt") $("settings-dialog").close();
  }

  /** Escape was pressed in the dialog. With changes pending it asks instead of closing. */
  function onCancel(event) {
    if (!isDirty()) return;
    event.preventDefault();
    close();
  }

  /** A button of the dialog was pressed: Save saves, and the others close. */
  function onSubmit(event) {
    event.preventDefault();
    if (event.submitter && event.submitter.id === "settings-save") commit();
    else close();
  }

  Object.assign(App.Settings, { open, paintPlanFile, onCancel, onSubmit });
})(window.App);
