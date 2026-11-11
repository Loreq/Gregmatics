/* Plans as files: starting up, opening a plan, and the folder plans live in. In the desktop window
   the page asks the Gregmatics window for the files with WebView2 messages. In a plain browser there is no
   window to ask, and the plan stays in the page. */
(function (App) {
  "use strict";

  const {
    Core, BASE, CATALOG, DRAFT_KEY, AUTOSAVE_KEY, STALE_KEY, $, state, unsaved, status, button,
    History, Save, Panels,
  } = App;

  const SUFFIX = ".gregmatic";
  // What the page can ask the desktop window for, and how each request's argument is named.
  const REQUESTS = {
    read_layout: () => undefined,
    save_layout: (text) => text,
    plan_info: () => undefined,
    choose_folder: () => undefined,
    set_autosave: (enabled) => ({ enabled: Boolean(enabled) }),
    rename_plan: (name) => ({ name }),
    choose_plan: () => undefined,
    create_plan: (name, text) => ({ name, text }),
    open_plan: (name) => ({ name }),
  };

  // ---- the desktop window ----

  /** A function that sends one request to the window and resolves with its reply. */
  function messenger(host) {
    const pending = new Map();
    let nextId = 0;
    host.addEventListener("message", (event) => {
      const msg = event.data || {};
      const done = pending.get(msg.id);
      if (!done) return;
      pending.delete(msg.id);
      done(msg);
    });
    return (method, extra) => new Promise((resolve) => {
      const id = ++nextId;
      pending.set(id, resolve);
      const body = extra !== null && typeof extra === "object" ? extra : { text: extra || "" };
      host.postMessage({ id, method, ...body });
    });
  }

  /** The desktop window's file functions, or null in a plain browser. Each returns a promise of a reply. */
  function desktopApi() {
    if (window.__editorApi) return window.__editorApi;
    const host = window.chrome && window.chrome.webview;
    if (!host) return null;
    const call = messenger(host);
    const api = {};
    for (const [method, argument] of Object.entries(REQUESTS)) {
      api[method] = (...args) => call(method, argument(...args));
    }
    window.__editorApi = api;
    return api;
  }

  // ---- file names ----

  /** A plan's name as a file name stem: lowercase letters and digits, with one underscore for each run of spaces. */
  function fileSlug(name) {
    let text = String(name || "").trim();
    if (text.toLowerCase().endsWith(SUFFIX)) text = text.slice(0, -SUFFIX.length).trim();
    let out = "";
    let gap = false;
    for (const ch of text.toLowerCase()) {
      if ((ch >= "a" && ch <= "z") || (ch >= "0" && ch <= "9")) {
        if (gap && out) out += "_";
        gap = false;
        out += ch;
      } else if (/\s/.test(ch)) gap = true;
    }
    return out.replace(/^_+|_+$/g, "") || "plan";
  }

  /** A slug split into its stem and the number it ends with, if it ends with one. */
  function slugStem(slug) {
    const match = slug.match(/^(.*)_(\d+)$/);
    if (!match || !match[1]) return { stem: slug, number: null };
    return { stem: match[1], number: Number(match[2]) };
  }

  /** A file name for a plan that none of `files` has. `current` is the plan's own file, which does not count as taken. */
  function freeFileName(name, files, current) {
    const slug = fileSlug(name);
    const taken = new Set((files || []).map((filename) => filename.toLowerCase()));
    const ignore = String(current || "").toLowerCase();
    const used = (filename) => filename.toLowerCase() !== ignore && taken.has(filename.toLowerCase());
    const exact = `${slug}${SUFFIX}`;
    if (!used(exact)) return exact;
    const parts = slugStem(slug);
    let n = parts.number || 0;
    let candidate = exact;
    do {
      n += 1;
      candidate = `${parts.stem}_${n}${SUFFIX}`;
    } while (used(candidate));
    return candidate;
  }

  /** The file name a plan name would get. `keepCurrent` lets the open plan keep its own file. */
  function previewFileName(name, keepCurrent) {
    return freeFileName(name, state.planFiles, keepCurrent ? state.planFile : "");
  }

  /** A file name without its suffix. */
  function fileStem(filename) {
    return String(filename || "").replace(/\.gregmatic$/i, "");
  }

  /** Ask the window which plan is open and which plans the folder holds. */
  async function refreshPlanFiles() {
    const api = desktopApi();
    if (!api) return;
    const info = await api.plan_info();
    if (!info || !info.ok) return;
    state.planFile = info.current || state.planFile;
    state.planFiles = info.plans || [];
  }

  // ---- starting up ----

  let booting = false;

  /** Take what the window says about the plan folder: the autosave switch, the open file, and the list of plans. */
  function takeInfo(info) {
    if (!info || !info.ok) return;
    if (typeof info.autosave === "boolean") {
      state.autosave = info.autosave;
      localStorage.setItem(AUTOSAVE_KEY, info.autosave ? "on" : "off");
    }
    state.planFile = info.current || "";
    state.planFiles = info.plans || [];
  }

  /** Take the plan the window read from disk in place of the one the page came with. */
  function takeDisk(base, disk) {
    if (!disk || !disk.ok || typeof disk.text !== "string") return;
    base.layout = JSON.parse(disk.text);
    if (disk.version) base.version = disk.version;
  }

  /**
   * What to show at startup: the file, or the browser's draft of it. A draft of this very file with edits
   * in it wins. A draft of an older file with unsaved edits is set aside for the banner. Returns
   * { layout, savedText, message }.
   */
  function resolveDraft(base) {
    const baseText = Core.dumps(base.layout);
    const fresh = { layout: Core.clone(base.layout), savedText: baseText, message: "Loaded." };
    const draft = History.readStored(DRAFT_KEY);
    if (!draft || typeof draft.text !== "string") return fresh;
    const draftSaved = typeof draft.savedText === "string" ? draft.savedText : baseText;
    const current = draft.version === base.version;
    if (!current) {
      if (draft.text !== draftSaved) localStorage.setItem(STALE_KEY, JSON.stringify(draft));
      localStorage.removeItem(DRAFT_KEY);
      return fresh;
    }
    if (draft.text === baseText && draftSaved === baseText) return fresh;
    return {
      layout: JSON.parse(draft.text),
      savedText: draftSaved,
      message: draft.text !== draftSaved ? "Restored unsaved edits." : "Loaded.",
    };
  }

  /** Make sure the multiblock tool starts on a multiblock the catalog has. */
  function pickFirstPad() {
    const firstPad = Object.keys(CATALOG.multis)[0];
    if (!CATALOG.multis[state.pick.pads] && firstPad) state.pick.pads = firstPad;
  }

  /** Show the plan the page starts with: `base`, the file as { layout, version }, or the browser's draft of it. */
  function showStart(base) {
    Panels.setIdle(false);
    state.fileVersion = base.version;
    History.dropOldStack(base.layout);
    const start = resolveDraft(base);
    pickFirstPad();
    History.load(start.layout, start.message, start.savedText);
    Panels.showPlanTitle((start.layout.site && start.layout.site.name) || fileStem(state.planFile));
    showStaleBanner();
  }

  /** No plan is open: the page stays, and only File → New and File → Load do anything. */
  function showEmpty() {
    state.layout = null;
    state.savedText = "";
    state.planFile = "";
    state.fileVersion = null;
    Panels.showPlanTitle("");
    Panels.setIdle(true);
  }

  /** Load the plan when the page opens: from the desktop window's file when there is one, else from data.js. */
  async function boot() {
    if (booting || state.layout) return;
    booting = true;
    if (!BASE || !BASE.catalog) {
      status("The plan could not be loaded.", true);
      return;
    }
    const base = { layout: BASE.layout, version: BASE.version };
    const api = desktopApi();
    if (api) {
      try {
        const info = await api.plan_info();
        takeInfo(info);
        if (info && info.empty) {
          showEmpty();
          App.NewPlan.start();
          return;
        }
      } catch (err) {
        // Keep the checkbox's last value in this window.
      }
      const autosaveBox = $("autosave");
      if (autosaveBox) autosaveBox.checked = state.autosave;
      try {
        const disk = await api.read_layout();
        if (disk && disk.empty) {
          showEmpty();
          App.NewPlan.start();
          return;
        }
        takeDisk(base, disk);
      } catch (err) {
        status(`Could not read the plan: ${err && err.message ? err.message : err}`, true);
      }
    }
    if (!base.layout) {
      showEmpty();
      App.NewPlan.start();
      return;
    }
    showStart(base);
  }

  /** Offer to bring back edits that were set aside because the file changed under them. */
  function showStaleBanner() {
    const stale = History.readStored(STALE_KEY);
    const banner = $("banner");
    if (!stale) {
      banner.hidden = true;
      return;
    }
    banner.hidden = false;
    banner.innerHTML = "";
    const text = document.createElement("span");
    text.textContent = "The plan changed. These edits were set aside.";
    const restore = button("Restore my edits", () => {
      localStorage.removeItem(STALE_KEY);
      History.load(JSON.parse(stale.text), "Restored.", state.savedText);
      History.saveDraft();
      banner.hidden = true;
    });
    const discard = button("Discard them", () => {
      localStorage.removeItem(STALE_KEY);
      banner.hidden = true;
    });
    banner.append(text, restore, discard);
  }

  // ---- opening a plan ----

  /** Show a plan that was just opened or made, as saved, under a title. `planFile` names its file when the window gave one. */
  function showOpened(layout, message, fallbackTitle, planFile) {
    Panels.setIdle(false);
    History.load(layout, message, Core.dumps(layout));
    if (planFile !== undefined) state.planFile = planFile;
    Panels.showPlanTitle((layout.site && layout.site.name) || fallbackTitle);
    History.saveDraft();
  }

  /** A plan parsed from text, or null with the reason in the status bar. `name` is what to call the text. */
  function parsePlan(text, name) {
    let layout;
    try {
      layout = JSON.parse(text);
    } catch (err) {
      status(`${name} is not valid JSON: ${err.message}`, true);
      return null;
    }
    if (!layout || !layout.site || !Array.isArray(layout.floors) || !Array.isArray(layout.rooms)) {
      status(`${name} is not a layout file.`, true);
      return null;
    }
    return layout;
  }

  /** Open a plan from its text. The desktop window copies it into the plan folder first. */
  async function loadText(text, name) {
    const layout = parsePlan(text, name);
    if (!layout) return;
    History.dropOldStack(layout);
    const api = desktopApi();
    if (!api) {
      showOpened(layout, `Opened ${name}.`, name);
      return;
    }
    if (unsaved()) await Save.save({ auto: true });
    const reply = await api.create_plan(name, text);
    if (!reply || !reply.ok) {
      status((reply && reply.error) || "Could not open that plan.", true);
      return;
    }
    const disk = await api.read_layout();
    if (!disk || !disk.ok) {
      status((disk && disk.error) || "Could not read that plan.", true);
      return;
    }
    showOpened(JSON.parse(disk.text), `Opened ${reply.name}.`, reply.name, reply.current || "");
  }

  /** Let the user pick a plan file in a plain browser. */
  async function openFile() {
    try {
      if (window.showOpenFilePicker) {
        const [handle] = await window.showOpenFilePicker({
          types: [{ description: "Layout", accept: { "application/json": [".json"] } }],
        });
        loadText(await (await handle.getFile()).text(), handle.name);
        return;
      }
      $("file-input").click();
    } catch (err) {
      if (err && err.name !== "AbortError") status(`Could not open: ${err.message}`, true);
    }
  }

  /** A file was picked with the hidden file input. */
  async function onFileChosen(event) {
    const file = event.target.files[0];
    if (file) loadText(await file.text(), file.name);
    event.target.value = "";
  }

  /** File → Load: save what is open, then open the plan the user picks. */
  async function loadPlan() {
    Panels.closeMenus();
    if (unsaved()) await Save.save({ auto: true });
    const api = desktopApi();
    if (!api) {
      openFile();
      return;
    }
    const reply = await api.choose_plan();
    if (!reply || reply.cancelled) return;
    if (!reply.ok || !reply.text) {
      status((reply && reply.error) || "Could not open that plan.", true);
      return;
    }
    let layout;
    try {
      layout = JSON.parse(reply.text);
    } catch (err) {
      status(`That plan is not valid JSON: ${err.message}`, true);
      return;
    }
    History.dropOldStack(layout);
    showOpened(layout, `Opened ${reply.name}.`, reply.name, reply.current || "");
  }

  /** Hand the browser a file to download. */
  function download(name, blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ---- the plan folder ----

  /** Show the plan folder in Settings. A plain browser has none. */
  async function refreshFolder() {
    const node = $("plan-folder");
    const change = $("plan-folder-change");
    if (!node || !change) return;
    const api = desktopApi();
    if (!api) {
      node.textContent = "This preview keeps the plan in the page.";
      node.title = "";
      change.hidden = true;
      return;
    }
    const info = await api.plan_info();
    if (!info || !info.ok) {
      node.textContent = (info && info.error) || "The plan folder could not be read.";
      node.title = "";
      return;
    }
    node.textContent = info.folder;
    node.title = info.folder;
    change.hidden = false;
  }

  /** Let the user pick another plan folder. The window moves the plans there. */
  async function changeFolder() {
    const api = desktopApi();
    if (!api) return;
    const reply = await api.choose_folder();
    if (!reply || reply.cancelled) return;
    if (!reply.ok) {
      status(reply.error || "Could not move the plans.", true);
      return;
    }
    const node = $("plan-folder");
    if (node) {
      node.textContent = reply.folder;
      node.title = reply.folder;
    }
    status("Plans now live in that folder.");
  }

  Object.assign(App.Files, {
    desktopApi, previewFileName, fileStem, refreshPlanFiles, boot, showOpened, loadText, onFileChosen, loadPlan,
    download, refreshFolder, changeFolder,
  });
})(window.App);
