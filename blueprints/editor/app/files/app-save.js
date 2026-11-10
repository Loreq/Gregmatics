/* Saving the plan to the open .gregmatic file through the desktop window. Ctrl+S and File → Save
   write at once and show a toast. Autosave writes a moment after the last change, quietly.
   One save runs at a time; a save asked for meanwhile runs when it is done. */
(function (App) {
  "use strict";

  const { $, state, snapshot, unsaved, status, History, Files, Panels } = App;

  const OFFLINE = "Save is unavailable in this window.";
  // How long after the last change autosave writes.
  const AUTOSAVE_WAIT = 600;
  // The spinner shows at least this long, then "Saved" stays, then fades.
  const SPINNER_LEAST = 400;
  const SAVED_STAYS = 700;
  const FADE = 500;

  let saveTimer = 0;
  // The save that is running, as a promise, or null.
  let saving = null;
  // Whether a save was asked for while one was running, and whether that one was asked for by hand.
  let saveQueued = false;
  let saveNow = false;
  let toastTimer = 0;

  // ---- the toast ----

  /** Show the toast with a spinner. */
  function showToast() {
    const toast = $("toast");
    clearTimeout(toastTimer);
    toast.hidden = false;
    toast.className = "toast";
    toast.innerHTML = '<span class="spin"></span>';
  }

  /** Take the toast away. */
  function hideToast() {
    const toast = $("toast");
    clearTimeout(toastTimer);
    toast.hidden = true;
    toast.className = "toast";
    toast.innerHTML = "";
  }

  /** Turn the spinner into "Saved", let it stay a moment, then fade it out. */
  function finishToast() {
    const toast = $("toast");
    toast.textContent = "Saved";
    toastTimer = setTimeout(() => {
      toast.classList.add("away");
      toastTimer = setTimeout(hideToast, FADE);
    }, SAVED_STAYS);
  }

  // ---- autosave ----

  /** Drop a save that is waiting on the autosave timer. */
  function unschedule() {
    clearTimeout(saveTimer);
    saveTimer = 0;
  }

  /** Plan an autosave a moment from now, when autosave is on and there is something to save. */
  function schedule() {
    if (!state.autosave || !state.layout || !Files.desktopApi() || !unsaved()) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = 0;
      save({ auto: true });
    }, AUTOSAVE_WAIT);
  }

  // ---- saving ----

  /** The file now holds `body`: remember that, and finish the toast unless the save was a quiet one. */
  function saved(body, version, auto) {
    state.savedText = body;
    if (version) state.fileVersion = version;
    History.saveDraft();
    Panels.refresh();
    if (!auto) finishToast();
  }

  /** Report a save that did not go through. */
  function failed(message, auto) {
    if (!auto) hideToast();
    status(message, true);
  }

  /** Send the plan's text to the window, and when it is written, mark the plan saved. */
  async function write(api, body, text, auto, started) {
    let reply;
    try {
      reply = await api.save_layout(text);
    } catch (err) {
      failed(`Could not save: ${err && err.message ? err.message : err}`, auto);
      return;
    }
    if (!reply || !reply.ok) {
      failed((reply && reply.error) || "Could not save.", auto);
      return;
    }
    const wait = auto ? 0 : Math.max(0, SPINNER_LEAST - (Date.now() - started));
    setTimeout(() => saved(body, reply.version, auto), wait);
  }

  /** Run the save that was asked for while another was running: at once when asked by hand, else on the timer. */
  function runQueued() {
    if (!saveQueued) return;
    saveQueued = false;
    const now = saveNow;
    saveNow = false;
    if (now) save();
    else schedule();
  }

  /** Save the plan when it differs from the file. `opts.auto` is a quiet save: no toast, and no complaint with no window. */
  async function save(opts) {
    const auto = Boolean(opts && opts.auto);
    if (!state.layout) return;
    unschedule();
    if (!unsaved()) return;
    const api = Files.desktopApi();
    if (!api) {
      if (!auto) status(OFFLINE, true);
      return;
    }
    if (saving) {
      saveQueued = true;
      if (!auto) saveNow = true;
      return saving;
    }
    const body = snapshot();
    const text = body.endsWith("\n") ? body : body + "\n";
    const started = Date.now();
    if (!auto) showToast();
    saving = write(api, body, text, auto, started);
    try {
      await saving;
    } finally {
      saving = null;
      runQueued();
    }
  }

  /** The page is closing: keep a draft, and autosave what is unsaved. */
  function onLeave() {
    History.saveDraft();
    if (state.autosave && unsaved()) save({ auto: true });
  }

  Object.assign(App.Save, { schedule, unschedule, save, onLeave });
})(window.App);
