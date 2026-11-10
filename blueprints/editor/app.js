/* Floor editor page. core.js holds the data. data.js holds the plan and catalog.
   desktop.py reads and writes the open .gregmatic file. */
(function () {
  "use strict";

  const Core = window.Core;
  const BASE = window.BASE;
  const appVersion = document.getElementById("app-version");
  if (appVersion && BASE && BASE.app) appVersion.textContent = `Gregmatics v${BASE.app}`;
  const CATALOG = (BASE && BASE.catalog) || { multis: {}, singles: {}, groups: {} };
  const CRAWL = Core.CRAWL;
  const DRAFT_KEY = "gregmatics:draft";
  const AUTOSAVE_KEY = "gregmatics:autosave";
  const STALE_KEY = "gregmatics:stale";
  const INK = "#1B2430";
  const MUTED = "#566270";
  const PAPER = "#F4F1EA";
  const WALL = "#282C32";
  const RUST = "#AC4E32";
  const MARK = "#5C544A";
  const GOOD = "#3F7A4D";
  const ROOM_COLORS = ["#E6DAC0", "#D2E6F4", "#D0E8CE", "#EADEEE", "#F2D6BE", "#F6E4A4", "#E0D6F0", "#C0E4DE",
    "#F0CECE", "#DEE2EE"];
  const HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
  // Panel names for Core.sizeFields.
  const SIZE_LABELS = { side: "Side", x: "Width", z: "Depth", h: "Height" };
  // Kinds whose box is free to drag. A multiblock's box follows its catalog size; see padDrag.
  const RESIZABLE = new Set(["rooms", "streets", "doors", "stairs", "shafts", "trenches", "marks"]);
  const CONTENTS = new Set(["marks", "pads", "walls", "machines"]);
  const HIT_ORDER = ["lifts", "machines", "doors", "pads", "marks", "stairs", "shafts", "streets", "rooms", "trenches"];
  const SIDE_NAMES = { n: "North", e: "East", s: "South", w: "West" };
  const OPPOSITE = { n: "s", s: "n", e: "w", w: "e" };
  const icon = (body) => `<svg viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;
  const PEN = icon('<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>');
  const TOOL_ICONS = {
    select: icon('<path d="M4.037 4.688a.495.495 0 0 1 .651-.651l16 6.5a.5.5 0 0 1-.063.947l-6.124 1.58a2 2 0 0 0-1.438 1.435l-1.579 6.126a.5.5 0 0 1-.947.063z"/>'),
    rooms: icon('<rect width="18" height="18" x="3" y="3" rx="2"/>'),
    streets: icon('<circle cx="6" cy="19" r="3"/><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"/><circle cx="18" cy="5" r="3"/>'),
    doors: icon('<path d="M11 20H2"/><path d="M11 4.562v16.157a1 1 0 0 0 1.242.97L19 20V5.562a2 2 0 0 0-1.515-1.94l-4-1A2 2 0 0 0 11 4.561z"/><path d="M11 4H8a2 2 0 0 0-2 2v14"/><path d="M14 12h.01"/><path d="M22 20h-3"/>'),
    stairs: icon('<path d="M22 5h-5v5h-5v5h-5v5h-5"/>'),
    marks: icon('<path d="M5 3a2 2 0 0 0-2 2"/><path d="M19 3a2 2 0 0 1 2 2"/><path d="M21 19a2 2 0 0 1-2 2"/><path d="M5 21a2 2 0 0 1-2-2"/><path d="M9 3h1"/><path d="M9 21h1"/><path d="M14 3h1"/><path d="M14 21h1"/><path d="M3 9v1"/><path d="M21 9v1"/><path d="M3 14v1"/><path d="M21 14v1"/>'),
    pads: icon('<path d="M2.97 12.92A2 2 0 0 0 2 14.63v3.24a2 2 0 0 0 .97 1.71l3 1.8a2 2 0 0 0 2.06 0L12 19v-5.5l-5-3-4.03 2.42Z"/><path d="m7 16.5-4.74-2.85"/><path d="m7 16.5 5-3"/><path d="M7 16.5v5.17"/><path d="M12 13.5V19l3.97 2.38a2 2 0 0 0 2.06 0l3-1.8a2 2 0 0 0 .97-1.71v-3.24a2 2 0 0 0-.97-1.71L17 10.5l-5 3Z"/><path d="m17 16.5-5-3"/><path d="m17 16.5 4.74-2.85"/><path d="M17 16.5v5.17"/><path d="M7.97 4.42A2 2 0 0 0 7 6.13v4.37l5 3 5-3V6.13a2 2 0 0 0-.97-1.71l-3-1.8a2 2 0 0 0-2.06 0l-3 1.8Z"/><path d="M12 8 7.26 5.15"/><path d="m12 8 4.74-2.85"/><path d="M12 13.5V8"/>'),
    machines: icon('<path d="M11 10.27 7 3.34"/><path d="m11 13.73-4 6.93"/><path d="M12 22v-2"/><path d="M12 2v2"/><path d="M14 12h8"/><path d="m17 20.66-1-1.73"/><path d="m17 3.34-1 1.73"/><path d="M2 12h2"/><path d="m20.66 17-1.73-1"/><path d="m20.66 7-1.73 1"/><path d="m3.34 17 1.73-1"/><path d="m3.34 7 1.73 1"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="12" r="8"/>'),
    trenches: icon('<path d="M2 6c.6.5 1.2 1 2.5 1C7 7 7 5 9.5 5c2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/><path d="M2 12c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/><path d="M2 18c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/>'),
  };

  const TOOLS = [
    { id: "select", label: "Select", key: "1",
      hint: "Click to select. Ctrl+click adds more, then drag, nudge, or delete them. Drag a handle to resize one." },
    { id: "rooms", label: "Room", key: "2", draw: true, hint: "Drag out a room, or click once for a 9×9." },
    { id: "streets", label: "Street", key: "3", draw: true, hint: "Drag out a street." },
    { id: "doors", label: "Door", key: "4", draw: true, hint: "Click a wall for a door, or drag along the wall." },
    { id: "stairs", label: "Stair", key: "5", draw: true, hint: "Drag from the bottom of the stairs." },
    { id: "marks", label: "Area", key: "6", draw: true, hint: "Drag inside a room to mark a spot." },
    { id: "pads", label: "Multiblock", key: "7", place: true, hint: "Click to place it. Press R to turn it." },
    { id: "machines", label: "Machine", key: "8", place: true, hint: "Click for one machine, or drag out a row. Press R to turn it." },
    { id: "trenches", label: "Trench", key: "9", draw: true, crawl: true, hint: "Drag out a trench for pipes." },
  ];

  const $ = (id) => document.getElementById(id);
  const canvas = $("plan");
  const ctx = canvas.getContext("2d");

  const state = {
    layout: null,
    layer: null,
    // Null, or a list of { kind, index, slot }. The last entry is the one most recently added.
    sel: null,
    // Selection for each floorplan, remembered by record id so switching plans does not mix them.
    instances: {},
    view: { scale: 6, ox: 0, oy: 0, width: 0, height: 0 },
    // True until the user pans or zooms, so a resize refits the plan instead of leaving it small.
    fitted: true,
    drag: null,
    draw: null,
    undo: [],
    redo: [],
    // A detached copy of the last Cut or Copy, and the footprint the next Paste steps from.
    clip: null,
    // The plan text as it is on disk, so "unsaved" means the plan differs from it.
    savedText: "",
    // File → Settings. Off skips the timed save. Ctrl+S and File → Save still write.
    autosave: localStorage.getItem(AUTOSAVE_KEY) !== "off",
    planFile: "",
    planFiles: [],
    // Hash of the plan text, so a draft still matches the file after Save.
    fileVersion: null,
    checks: [],
    hover: null,
    show: { others: true, contents: true },
    tool: "select",
    pick: { pads: "ebf", machines: "MAC" },
    // Set with R while placing; null means "face away from the nearest wall".
    front: null,
    swap: false,
    search: "",
    openLists: {},
    shownSel: "",
    focusFirst: false,
    space: false,
  };

  // ---- data access ----

  const L = () => state.layout;
  const toolById = (id) => TOOLS.find((t) => t.id === id) || TOOLS[0];

  function entranceFloor() {
    const entry = L().streets.find((s) => s.style === "entry");
    return entry ? entry.floor : L().floors[0].id;
  }

  function layerFloor() {
    return Core.floorById(L(), state.layer);
  }

  function selRefs() {
    return state.sel || [];
  }

  function refOf(hit) {
    const ref = { kind: hit.kind, index: hit.index };
    if (hit.slot != null) ref.slot = hit.slot;
    return ref;
  }

  function setSel(refs) {
    const list = (refs || []).map(refOf);
    state.sel = list.length ? list : null;
  }

  function replaceSel(ref) {
    setSel(ref ? [ref] : []);
  }

  function toggleSel(ref) {
    const next = selRefs().filter((item) => !same(item, ref));
    if (next.length === selRefs().length) next.push(ref);
    setSel(next);
  }

  function primaryRef() {
    const refs = selRefs();
    return refs.length ? refs[refs.length - 1] : null;
  }

  /** One selection ref as { kind, index, rec }, plus slot, code, and cell for a machine. */
  function resolveRef(sel) {
    if (!sel || !state.layout) return null;
    const list = L()[sel.kind === "machines" ? "walls" : sel.kind];
    const rec = list && list[sel.index];
    if (!rec) return null;
    if (sel.kind !== "machines") return { kind: sel.kind, index: sel.index, rec };
    const codes = Core.codesOf(rec);
    if (!(sel.slot < codes.length) || codes[sel.slot] === "-") return null;
    const [x, z] = Core.cellOf(rec, sel.slot);
    return { kind: "machines", index: sel.index, slot: sel.slot, rec, code: codes[sel.slot], x, z };
  }

  /** Every selected item that still exists. */
  function selection() {
    const out = [];
    for (const ref of selRefs()) {
      const item = resolveRef(ref);
      if (item) out.push(item);
    }
    return out;
  }

  /** The selection when exactly one thing is selected. */
  function selected() {
    const all = selection();
    return all.length === 1 ? all[0] : null;
  }

  function boxOfSel(sel) {
    if (!sel) return null;
    if (sel.kind === "machines") return { x0: sel.x, x1: sel.x, z0: sel.z, z1: sel.z };
    return Core.boxOf(sel.kind, sel.rec);
  }

  function same(a, b) {
    return Boolean(a && b) && a.kind === b.kind && a.index === b.index && (a.slot ?? null) === (b.slot ?? null);
  }

  function selectMachineAt(x, z) {
    const m = Core.machinesOn(L(), state.layer).find((item) => item.x === x && item.z === z);
    replaceSel(m ? { kind: "machines", index: m.index, slot: m.slot } : null);
  }

  function nameOfSel(sel) {
    if (sel.kind === "machines") return (CATALOG.singles[sel.code] || { name: sel.code }).name;
    return Core.nameOf(sel.kind, sel.rec, CATALOG);
  }

  function snapshot() {
    return Core.dumps(L());
  }

  function unsaved() {
    return Boolean(state.layout) && snapshot() !== state.savedText;
  }

  // ---- history and drafts ----

  function change(fn) {
    const before = snapshot();
    const result = fn();
    commit(before);
    return result;
  }

  function commit(before) {
    if (snapshot() === before) {
      refresh();
      return;
    }
    state.undo.push(before);
    if (state.undo.length > 200) state.undo.shift();
    state.redo = [];
    if ($("status").classList.contains("error")) status("");
    afterChange();
  }

  function afterChange() {
    notePlan();
    fixSelection();
    saveDraft();
    runChecks();
    refresh();
    scheduleSave();
  }

  function undo() {
    if (!state.undo.length) return;
    state.redo.push(snapshot());
    state.layout = JSON.parse(state.undo.pop());
    afterChange();
    status("Undone.");
  }

  function redo() {
    if (!state.redo.length) return;
    state.undo.push(snapshot());
    state.layout = JSON.parse(state.redo.pop());
    afterChange();
    status("Redone.");
  }

  function onLayer(sel) {
    if (!sel) return false;
    if (CONTENTS.has(sel.kind)) {
      const room = Core.roomById(L(), sel.rec.room);
      return Boolean(room && room.floor === state.layer);
    }
    return Core.zonesOn(L(), state.layer).some((i) => i.kind === sel.kind && i.index === sel.index);
  }

  function fixSelection() {
    if (!Core.layers(L()).some((l) => l.id === state.layer)) state.layer = entranceFloor();
    if (state.sel) {
      const kept = selRefs().filter((ref) => {
        const item = resolveRef(ref);
        return item && onLayer(item);
      });
      state.sel = kept.length ? kept : null;
    }
    if (!toolAvailable(state.tool)) setTool("select", true);
  }

  function saveDraft() {
    if (!state.layout) return;
    try {
      const version = state.fileVersion || BASE.version;
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ version, text: snapshot(), savedText: state.savedText }));
    } catch (err) {
      status("This browser would not keep a draft. Save before closing the page.", true);
    }
  }

  function readStored(key) {
    try {
      return JSON.parse(localStorage.getItem(key) || "null");
    } catch (err) {
      return null;
    }
  }

  function roomLocked(rec) {
    return Boolean(rec && rec.locked);
  }

  // ---- loading ----

  function desktopApi() {
    if (window.__editorApi) return window.__editorApi;
    const host = window.chrome && window.chrome.webview;
    if (!host) return null;
    const pending = new Map();
    let nextId = 0;
    host.addEventListener("message", (event) => {
      const msg = event.data || {};
      const done = pending.get(msg.id);
      if (!done) return;
      pending.delete(msg.id);
      done(msg);
    });
    const call = (method, extra) => new Promise((resolve) => {
      const id = ++nextId;
      pending.set(id, resolve);
      const body = extra !== null && typeof extra === "object" ? extra : { text: extra || "" };
      host.postMessage({ id, method, ...body });
    });
    window.__editorApi = {
      read_layout: () => call("read_layout"),
      save_layout: (text) => call("save_layout", text),
      plan_info: () => call("plan_info"),
      choose_folder: () => call("choose_folder"),
      set_autosave: (enabled) => call("set_autosave", { enabled: Boolean(enabled) }),
      rename_plan: (name) => call("rename_plan", { name }),
      choose_plan: () => call("choose_plan"),
      create_plan: (name, text) => call("create_plan", { name, text }),
      open_plan: (name) => call("open_plan", { name }),
    };
    return window.__editorApi;
  }

  let booting = false;

  async function boot() {
    if (booting || state.layout) return;
    booting = true;
    if (!BASE || !BASE.layout) {
      status("The plan could not be loaded.", true);
      return;
    }
    let baseLayout = BASE.layout;
    let baseVersion = BASE.version;
    const api = desktopApi();
    if (api) {
      try {
        const info = await api.plan_info();
        if (info && info.ok) {
          if (typeof info.autosave === "boolean") {
            state.autosave = info.autosave;
            localStorage.setItem(AUTOSAVE_KEY, info.autosave ? "on" : "off");
          }
          state.planFile = info.current || "";
          state.planFiles = info.plans || [];
        }
      } catch (err) {
        // Keep the checkbox's last value in this window.
      }
      const autosaveBox = $("autosave");
      if (autosaveBox) autosaveBox.checked = state.autosave;
      try {
        const disk = await api.read_layout();
        if (disk && disk.ok && typeof disk.text === "string") {
          baseLayout = JSON.parse(disk.text);
          if (disk.version) baseVersion = disk.version;
        }
      } catch (err) {
        status(`Could not read the plan: ${err && err.message ? err.message : err}`, true);
      }
    }
    state.fileVersion = baseVersion;
    dropOldStack(baseLayout);
    const baseText = Core.dumps(baseLayout);
    let layout = Core.clone(baseLayout);
    let savedText = baseText;
    let message = "Loaded.";
    const draft = readStored(DRAFT_KEY);
    if (draft && typeof draft.text === "string") {
      const draftSaved = typeof draft.savedText === "string" ? draft.savedText : baseText;
      if (draft.version === baseVersion && (draft.text !== baseText || draftSaved !== baseText)) {
        layout = JSON.parse(draft.text);
        savedText = draftSaved;
        if (draft.text !== draftSaved) message = "Restored unsaved edits.";
        else message = "Loaded.";
      } else if (draft.version !== baseVersion && draft.text !== draftSaved) {
        localStorage.setItem(STALE_KEY, JSON.stringify(draft));
      }
      if (draft.version !== baseVersion) localStorage.removeItem(DRAFT_KEY);
    }
    const firstPad = Object.keys(CATALOG.multis)[0];
    if (!CATALOG.multis[state.pick.pads] && firstPad) state.pick.pads = firstPad;
    load(layout, message, savedText);
    showPlanTitle((layout.site && layout.site.name) || fileStem(state.planFile));
    showStaleBanner();
  }

  function dropOldStack(layout) {
    for (const wall of layout.walls || []) delete wall.stacked;
  }

  function load(layout, message, savedText) {
    if (state.space) setSpace(false);
    dropOldStack(layout);
    state.layout = layout;
    notePlan();
    state.undo = [];
    state.redo = [];
    state.clip = null;
    state.savedText = savedText;
    state.instances = {};
    state.sel = null;
    if (!Core.layers(layout).some((l) => l.id === state.layer)) state.layer = entranceFloor();
    resize();
    fit();
    runChecks();
    refresh();
    status(message);
  }

  async function loadText(text, name) {
    let layout;
    try {
      layout = JSON.parse(text);
    } catch (err) {
      status(`${name} is not valid JSON: ${err.message}`, true);
      return;
    }
    if (!layout || !layout.site || !Array.isArray(layout.floors) || !Array.isArray(layout.rooms)) {
      status(`${name} is not a layout file.`, true);
      return;
    }
    dropOldStack(layout);
    const api = desktopApi();
    if (api) {
      if (unsaved()) await save({ auto: true });
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
      const opened = JSON.parse(disk.text);
      load(opened, `Opened ${reply.name}.`, Core.dumps(opened));
      state.planFile = reply.current || "";
      showPlanTitle((opened.site && opened.site.name) || reply.name);
      saveDraft();
      return;
    }
    load(layout, `Opened ${name}.`, Core.dumps(layout));
    showPlanTitle((layout.site && layout.site.name) || name);
    saveDraft();
  }

  /** The same site and palette, with one empty floor. */
  function blankPlan(layout, opts) {
    opts = opts || {};
    const site = Core.clone(layout.site);
    const palette = Core.clone(layout.palette);
    const current = (layout.floors || []).find((floor) => floor.id === "main") || (layout.floors || [])[0];
    const y0 = Number.isInteger(opts.y0) ? opts.y0 : (current ? current.slab + 1 : 69);
    const y1 = Number.isInteger(opts.y1) ? opts.y1 : y0 + 4;
    const floor = {
      id: "main",
      name: "Floor 1",
      slab: y0 - 1,
      height: y1 - y0 + 1,
      pen: (current && current.pen) || "#282C32",
    };
    if (opts.name) site.name = opts.name;
    if (opts.box && !Core.sameBox(opts.box, Core.inner({ site }))) Object.assign(floor, opts.box);
    const crawl = site.crawl || {};
    site.crawl = {
      name: crawl.name || "Pipe crawl",
      under: "main",
      below: Math.max(2, crawl.below || 4),
      height: Math.max(2, crawl.height || 3),
    };
    return {
      site,
      palette,
      floors: [floor],
      rooms: [], streets: [], doors: [], stairs: [], shafts: [], lifts: [],
      trenches: [], pads: [], walls: [], marks: [],
      callouts: [], cuts: [],
      sheets: [{
        id: "01-main", kind: "overview", title: floor.name, floor: "main",
        blurb: `${floor.name}, slab Y=${floor.slab}.`, notes: [],
      }],
    };
  }

  function newPlan() {
    closeMenus();
    openNewDialog();
  }

  async function loadPlan() {
    closeMenus();
    if (unsaved()) await save({ auto: true });
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
    dropOldStack(layout);
    load(layout, `Opened ${reply.name}.`, Core.dumps(layout));
    state.planFile = reply.current || "";
    showPlanTitle((layout.site && layout.site.name) || reply.name);
    saveDraft();
  }

  function fileSlug(name) {
    let text = String(name || "").trim();
    if (text.toLowerCase().endsWith(".gregmatic")) text = text.slice(0, -10).trim();
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

  function slugStem(slug) {
    const match = slug.match(/^(.*)_(\d+)$/);
    if (!match || !match[1]) return { stem: slug, number: null };
    return { stem: match[1], number: Number(match[2]) };
  }

  function freeFileName(name, files, current) {
    const slug = fileSlug(name);
    const taken = new Set((files || []).map((filename) => filename.toLowerCase()));
    const ignore = String(current || "").toLowerCase();
    const used = (filename) => filename.toLowerCase() !== ignore && taken.has(filename.toLowerCase());
    const exact = `${slug}.gregmatic`;
    if (!used(exact)) return exact;
    const parts = slugStem(slug);
    let n = parts.number || 0;
    let candidate = exact;
    do {
      n += 1;
      candidate = `${parts.stem}_${n}.gregmatic`;
    } while (used(candidate));
    return candidate;
  }

  function previewFileName(name, keepCurrent) {
    return freeFileName(name, state.planFiles, keepCurrent ? state.planFile : "");
  }

  function fileStem(filename) {
    return String(filename || "").replace(/\.gregmatic$/i, "");
  }

  async function refreshPlanFiles() {
    const api = desktopApi();
    if (!api) return;
    const info = await api.plan_info();
    if (!info || !info.ok) return;
    state.planFile = info.current || state.planFile;
    state.planFiles = info.plans || [];
  }

  /** Minecraft 1.7.10: X and Z stay inside 30,000,000 of the origin. */
  function worldProblem(next) {
    const nums = [next.x0, next.x1, next.z0, next.z1];
    if (!nums.every((n) => Number.isInteger(n))) return "X and Z are whole numbers.";
    if (next.x0 > next.x1 || next.z0 > next.z1) return "Each side runs from the low number to the high one.";
    const edge = 30000000;
    if (nums.some((n) => n < -edge || n > edge)) return "X and Z stay within 30,000,000 of the origin.";
    return "";
  }

  function boundsProblem(floor, next) {
    if (!floor) return "That floor is gone.";
    const vanilla = worldProblem(next);
    if (vanilla) return vanilla;
    const box = { x0: next.x0, x1: next.x1, z0: next.z0, z1: next.z1 };
    const spec = { id: floor.id, name: floor.name, slab: floor.slab, height: Core.floorHeight(floor), pen: floor.pen };
    return Core.spanProblem(L(), spec, box);
  }

  function mountBounds(host, spec) {
    const values = { x0: spec.box.x0, x1: spec.box.x1, z0: spec.box.z0, z1: spec.box.z1 };
    const where = { nw: "North-west", ne: "North-east", sw: "South-west", se: "South-east" };
    const corner = (place, x, z) => `<div class="corner ${place}">
        <label>X<input data-pair="${place}" data-axis="x" autocomplete="off" aria-label="${where[place]} X" value="${x}"></label>
        <label>Z<input data-pair="${place}" data-axis="z" autocomplete="off" aria-label="${where[place]} Z" value="${z}"></label>
      </div>`;
    host.innerHTML = `<div class="coord">
      <div class="sq">
        <svg class="rose" viewBox="0 0 100 100" aria-hidden="true">
          <g class="grid"></g>
          <g class="axis" fill="none" stroke="currentColor" stroke-width="0.55" stroke-linecap="round">
            <line x1="50" y1="7.8" x2="50" y2="48.3"/>
            <line x1="50" y1="51.7" x2="50" y2="92.2"/>
            <line x1="7.8" y1="50" x2="48.3" y2="50"/>
            <line x1="51.7" y1="50" x2="92.2" y2="50"/>
            <circle cx="50" cy="50" r="0.9"/>
          </g>
          <svg class="lucide" x="46.4" y="0.3" width="7.2" height="7.2" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 7-7 7 7"/><path d="M12 19V5"/></svg>
          <svg class="lucide" x="92.5" y="46.4" width="7.2" height="7.2" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
          <svg class="lucide" x="46.4" y="92.5" width="7.2" height="7.2" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="m19 12-7 7-7-7"/></svg>
          <svg class="lucide" x="0.3" y="46.4" width="7.2" height="7.2" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 19-7-7 7-7"/><path d="M19 12H5"/></svg>
          <g class="mark" fill="currentColor" font-size="3.4" font-family="Segoe UI, sans-serif">
            <text x="54.2" y="5.4">N</text>
            <text x="91.6" y="45.2" text-anchor="end">E</text>
            <text x="54.2" y="97.2">S</text>
            <text x="8.4" y="45.2">W</text>
          </g>
        </svg>
        ${corner("nw", values.x0, values.z0)}
        ${corner("ne", values.x1, values.z0)}
        ${corner("sw", values.x0, values.z1)}
        ${corner("se", values.x1, values.z1)}
      </div>
    </div>`;
    const parseNum = (raw) => {
      const text = raw.trim();
      return /^-?\d+$/.test(text) ? Number(text) : null;
    };
    const keyOf = (input) => `${input.dataset.pair}-${input.dataset.axis}`;
    const textFor = () => ({
      "nw-x": String(values.x0), "nw-z": String(values.z0),
      "ne-x": String(values.x1), "ne-z": String(values.z0),
      "sw-x": String(values.x0), "sw-z": String(values.z1),
      "se-x": String(values.x1), "se-z": String(values.z1),
    });
    const gridStep = (span) => {
      const steps = [1, 2, 5, 10, 20, 25, 50, 100, 200, 500, 1000, 2000, 5000, 10000];
      for (const step of steps) if (span / step <= 12) return step;
      return steps[steps.length - 1];
    };
    const paintGrid = () => {
      const g = host.querySelector(".grid");
      while (g.firstChild) g.removeChild(g.firstChild);
      const spanX = Math.max(values.x1 - values.x0, 0);
      const spanZ = Math.max(values.z1 - values.z0, 0);
      const span = Math.max(spanX, spanZ);
      if (span < 1) return;
      const step = gridStep(span);
      const scale = 100 / span;
      const originX = (100 - spanX * scale) / 2;
      const originY = (100 - spanZ * scale) / 2;
      const add = (x1, y1, x2, y2) => {
        const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
        line.setAttribute("x1", x1);
        line.setAttribute("y1", y1);
        line.setAttribute("x2", x2);
        line.setAttribute("y2", y2);
        g.appendChild(line);
      };
      const worldX = (px) => values.x0 + (px - originX) / scale;
      const worldZ = (py) => values.z0 + (py - originY) / scale;
      const firstX = Math.ceil(worldX(0) / step - 1e-9);
      const lastX = Math.floor(worldX(100) / step + 1e-9);
      for (let i = firstX; i <= lastX; i += 1) {
        add(originX + (i * step - values.x0) * scale, 0, originX + (i * step - values.x0) * scale, 100);
      }
      const firstZ = Math.ceil(worldZ(0) / step - 1e-9);
      const lastZ = Math.floor(worldZ(100) / step + 1e-9);
      for (let i = firstZ; i <= lastZ; i += 1) {
        add(0, originY + (i * step - values.z0) * scale, 100, originY + (i * step - values.z0) * scale);
      }
    };
    const paint = (except) => {
      const text = textFor();
      for (const input of host.querySelectorAll("input")) {
        if (input === except) continue;
        const next = text[keyOf(input)];
        if (input.value !== next) input.value = next;
      }
      paintGrid();
    };
    paintGrid();
    const absorb = (input) => {
      const n = parseNum(input.value);
      if (n === null) return false;
      const base = input._base || { x0: values.x0, x1: values.x1, z0: values.z0, z1: values.z1 };
      const place = input.dataset.pair;
      let west = base.x0;
      let east = base.x1;
      let north = base.z0;
      let south = base.z1;
      if (input.dataset.axis === "x") {
        if (place === "nw" || place === "sw") west = n;
        else east = n;
      } else if (place === "nw" || place === "ne") north = n;
      else south = n;
      values.x0 = Math.min(west, east);
      values.x1 = Math.max(west, east);
      values.z0 = Math.min(north, south);
      values.z1 = Math.max(north, south);
      return true;
    };
    const read = () => {
      const active = host.querySelector("input:focus");
      if (active && !absorb(active)) return { x0: NaN, x1: NaN, z0: NaN, z1: NaN };
      return { x0: values.x0, x1: values.x1, z0: values.z0, z1: values.z1 };
    };
    for (const input of host.querySelectorAll("input")) {
      input.addEventListener("focus", () => {
        input._base = { x0: values.x0, x1: values.x1, z0: values.z0, z1: values.z1 };
      });
      input.addEventListener("input", () => {
        if (!absorb(input)) return;
        paint(input);
        spec.onCommit(read());
      });
      input.addEventListener("blur", () => {
        if (absorb(input)) paint(null);
      });
    }
    return { read };
  }

  function floorBoundsSpec(floor) {
    const layout = L();
    const limit = Core.floorLimit(layout, floor);
    const box = Core.floorBox(layout, floor);
    const air = Core.floorAir(floor);
    return { limit, box, y0: air[0], y1: air[1] };
  }

  let settingsBounds = null;

  function mountSettingsBounds() {
    const host = $("settings-bounds");
    const error = $("settings-bounds-error");
    if (!host) return;
    host.innerHTML = "";
    error.textContent = "";
    const floor = Core.mainFloor(L());
    if (!floor) {
      settingsBounds = null;
      host.textContent = "This plan has no floor yet.";
      return;
    }
    const spec = floorBoundsSpec(floor);
    settingsBounds = mountBounds(host, {
      ...spec,
      onCommit: (next) => {
        error.textContent = boundsProblem(floor, next);
      },
    });
  }

  async function openNewDialog() {
    await refreshPlanFiles();
    const layout = L();
    const floor = Core.mainFloor(layout) || layout.floors[0];
    const spec = floor ? floorBoundsSpec(floor) : {
      limit: Core.inner(layout),
      box: Core.inner(layout),
      y0: 69,
      y1: 73,
    };
    spec.box = { ...spec.limit };
    const dialog = $("new-dialog");
    const error = $("new-error");
    const nameInput = $("new-name");
    const preview = $("new-file");
    error.textContent = "";
    nameInput.value = "";
    const paintFile = () => {
      const name = nameInput.value.trim();
      preview.textContent = name ? previewFileName(name, false) : "";
    };
    nameInput.oninput = paintFile;
    paintFile();
    const editor = mountBounds($("new-bounds"), { ...spec, onCommit: () => { error.textContent = ""; } });
    const onSubmit = (event) => {
      event.preventDefault();
      const name = nameInput.value.trim();
      if (!name) {
        error.textContent = "Give the plan a name.";
        return;
      }
      const next = editor.read();
      const probe = blankPlan(layout, {
        name,
        box: { x0: next.x0, x1: next.x1, z0: next.z0, z1: next.z1 },
      });
      const made = probe.floors[0];
      const problem = worldProblem(next) || Core.spanProblem(probe, made, Core.floorBox(probe, made));
      if (problem) {
        error.textContent = problem;
        return;
      }
      dialog.close();
      createPlanFile(name, probe);
    };
    const form = $("new-form");
    form.onsubmit = onSubmit;
    $("new-close").onclick = () => dialog.close();
    dialog.showModal();
    $("new-name").focus();
  }

  async function createPlanFile(name, layoutObject) {
    const text = Core.dumps(layoutObject);
    const api = desktopApi();
    if (unsaved()) await save({ auto: true });
    if (!api) {
      state.planFile = previewFileName(name, false);
      if (!state.planFiles.includes(state.planFile)) state.planFiles.push(state.planFile);
      load(layoutObject, `Created ${name}.`, text);
      showPlanTitle(name);
      saveDraft();
      return;
    }
    const reply = await api.create_plan(name, text);
    if (!reply || !reply.ok) {
      status((reply && reply.error) || "Could not create the plan.", true);
      return;
    }
    const disk = await api.read_layout();
    if (!disk || !disk.ok) {
      status((disk && disk.error) || "Could not read the new plan.", true);
      return;
    }
    const layout = JSON.parse(disk.text);
    load(layout, `Created ${(layout.site && layout.site.name) || name}.`, Core.dumps(layout));
    state.planFile = reply.current || "";
    showPlanTitle((layout.site && layout.site.name) || name);
    saveDraft();
  }

  function openMenu(name) {
    document.querySelectorAll(".menubar .menu").forEach((menu) => {
      const on = menu.dataset.menu === name;
      menu.querySelector(".menu-panel").hidden = !on;
      menu.querySelector(".menu-label").setAttribute("aria-expanded", String(on));
    });
  }

  function closeMenus() {
    openMenu("");
  }

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

  function showStaleBanner() {
    const stale = readStored(STALE_KEY);
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
      load(JSON.parse(stale.text), "Restored.", state.savedText);
      saveDraft();
      banner.hidden = true;
    });
    const discard = button("Discard them", () => {
      localStorage.removeItem(STALE_KEY);
      banner.hidden = true;
    });
    banner.append(text, restore, discard);
  }

  // ---- saving ----

  const SAVE_OFFLINE = "Save is unavailable in this window.";
  let saveTimer = 0;
  let saving = null;
  let saveQueued = false;
  let saveNow = false;

  function scheduleSave() {
    if (!state.autosave || !state.layout || !desktopApi() || !unsaved()) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = 0;
      save({ auto: true });
    }, 600);
  }

  async function save(opts) {
    const auto = Boolean(opts && opts.auto);
    if (!state.layout) return;
    clearTimeout(saveTimer);
    saveTimer = 0;
    if (!unsaved()) return;
    const api = desktopApi();
    if (!api) {
      if (!auto) status(SAVE_OFFLINE, true);
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
    if (!auto) showSaveToast();
    saving = (async () => {
      let reply;
      try {
        reply = await api.save_layout(text);
      } catch (err) {
        if (!auto) hideSaveToast();
        status(`Could not save: ${err && err.message ? err.message : err}`, true);
        return;
      }
      if (!reply || !reply.ok) {
        if (!auto) hideSaveToast();
        status((reply && reply.error) || "Could not save.", true);
        return;
      }
      const wait = auto ? 0 : Math.max(0, 400 - (Date.now() - started));
      setTimeout(() => saved(body, reply.version, auto), wait);
    })();
    try {
      await saving;
    } finally {
      saving = null;
      if (saveQueued) {
        saveQueued = false;
        const now = saveNow;
        saveNow = false;
        if (now) save();
        else scheduleSave();
      }
    }
  }

  let toastTimer = 0;

  function showSaveToast() {
    const toast = $("toast");
    clearTimeout(toastTimer);
    toast.hidden = false;
    toast.className = "toast";
    toast.innerHTML = '<span class="spin"></span>';
  }

  function hideSaveToast() {
    const toast = $("toast");
    clearTimeout(toastTimer);
    toast.hidden = true;
    toast.className = "toast";
    toast.innerHTML = "";
  }

  function finishSaveToast() {
    const toast = $("toast");
    toast.textContent = "Saved";
    toastTimer = setTimeout(() => {
      toast.classList.add("away");
      toastTimer = setTimeout(hideSaveToast, 500);
    }, 700);
  }

  function saved(body, version, auto) {
    state.savedText = body;
    if (version) state.fileVersion = version;
    saveDraft();
    refresh();
    if (!auto) finishSaveToast();
  }

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

  function download(name, blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ---- view ----

  function resize() {
    const box = $("view").getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    state.view.width = Math.max(1, box.width);
    state.view.height = Math.max(1, box.height);
    canvas.width = Math.round(state.view.width * dpr);
    canvas.height = Math.round(state.view.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (state.space) View3D.resize();
  }

  function fit() {
    if (!state.layout) return;
    const s = L().site.sheet;
    const w = s.x1 - s.x0 + 1;
    const h = s.z1 - s.z0 + 1;
    const v = state.view;
    v.scale = Math.max(2, Math.min((v.width - 110) / w, (v.height - 100) / h));
    v.ox = Math.round((v.width - w * v.scale) / 2 + 20);
    v.oy = Math.round((v.height - h * v.scale) / 2 + 16);
    state.fitted = true;
  }

  function toWorld(px, py, v = state.view) {
    const s = L().site.sheet;
    return [Math.floor((px - v.ox) / v.scale) + s.x0, Math.floor((py - v.oy) / v.scale) + s.z0];
  }

  /** Pixel of a block edge, shared by the room grid, footprints, and module outlines. */
  function blockX(world, v) {
    const s = L().site.sheet;
    return Math.round(v.ox + (world - s.x0) * v.scale);
  }

  function blockY(world, v) {
    const s = L().site.sheet;
    return Math.round(v.oy + (world - s.z0) * v.scale);
  }

  function rectOf(box, v = state.view) {
    const x = blockX(box.x0, v);
    const y = blockY(box.z0, v);
    return {
      x, y,
      w: Math.max(1, blockX(box.x1 + 1, v) - x),
      h: Math.max(1, blockY(box.z1 + 1, v) - y),
    };
  }

  function centerOn(box) {
    const r = rectOf(box);
    state.view.ox += state.view.width / 2 - (r.x + r.w / 2);
    state.view.oy += state.view.height / 2 - (r.y + r.h / 2);
    state.fitted = false;
  }

  // ---- placing and drawing previews ----

  function cellBox(x, z) {
    return { x0: x, x1: x, z0: z, z1: z };
  }

  function insideBox(outer, box) {
    return box.x0 >= outer.x0 && box.x1 <= outer.x1 && box.z0 >= outer.z0 && box.z1 <= outer.z1;
  }

  function padCellsOnLayer() {
    const cells = new Set();
    for (const item of Core.contentsOn(L(), state.layer)) {
      if (item.kind === "pads") for (const cell of Core.padBlocks(item.z, CATALOG)) cells.add(cell);
    }
    return cells;
  }

  /** The face of a machine row this cell would join: a slot already there, or one step past an end. */
  function rowFaceAt(roomId, x, z) {
    const hit = Core.slotIn(L(), roomId, x, z);
    if (hit) return L().walls[hit.index].face;
    for (const wall of L().walls) {
      if (wall.room !== roomId) continue;
      const step = Core.STEP[wall.along];
      const n = Core.codesOf(wall).length;
      if ((x === wall.x + step[0] * n && z === wall.z + step[1] * n) || (x === wall.x - step[0] && z === wall.z - step[1])) {
        return wall.face;
      }
    }
    return null;
  }

  /** What the placing tool would put under the pointer, and whether it fits. */
  function placement(cell = state.hover) {
    if (!cell || !state.layout || state.layer === CRAWL) return null;
    const [x, z] = cell;
    const home = Core.roomAt(L(), state.layer, x, z);
    if (state.tool === "pads") {
      const key = state.pick.pads;
      const [a, b] = Core.padSize(CATALOG, key);
      const [w, d] = state.swap ? [b, a] : [a, b];
      const x0 = x - ((w - 1) >> 1);
      const z0 = z - ((d - 1) >> 1);
      const box = { x0, x1: x0 + w - 1, z0, z1: z0 + d - 1 };
      const fits = Boolean(home) && insideBox(home.room, box);
      const front = state.front || (home ? Core.facingAway(home.room, box) : "s");
      return { kind: "pads", key, box, w, d, front, home, fits };
    }
    if (state.tool === "machines") {
      const code = state.pick.machines;
      const face = state.front || (home && rowFaceAt(home.room.id, x, z)) || (home ? Core.facingAway(home.room, cellBox(x, z)) : "s");
      const open = Core.voltageRank(Core.planTier(L())) >= Core.voltageRank("LV");
      const fits = open && Boolean(home) && !padCellsOnLayer().has(`${x},${z}`);
      return { kind: "machines", code, box: cellBox(x, z), face, home, fits };
    }
    return null;
  }

  function drawBox() {
    const d = state.draw;
    if (!d) return null;
    let [x0, z0] = d.start;
    let [x1, z1] = d.cur;
    if (state.tool === "doors") {
      if (Math.abs(x1 - x0) >= Math.abs(z1 - z0)) z1 = z0;
      else x1 = x0;
    }
    return { x0: Math.min(x0, x1), x1: Math.max(x0, x1), z0: Math.min(z0, z1), z1: Math.max(z0, z1) };
  }

  function clampCell(cell, bounds) {
    return [Math.min(Math.max(cell[0], bounds.x0), bounds.x1), Math.min(Math.max(cell[1], bounds.z0), bounds.z1)];
  }

  /** A box with the edges a handle holds moved to a cell. An edge stops at the one across from it. */
  function pulledBox(box, handle, cell) {
    const b = { ...box };
    if (handle.includes("w")) b.x0 = Math.min(cell[0], b.x1);
    if (handle.includes("e")) b.x1 = Math.max(cell[0], b.x0);
    if (handle.includes("n")) b.z0 = Math.min(cell[1], b.z1);
    if (handle.includes("s")) b.z1 = Math.max(cell[1], b.z0);
    return b;
  }

  function around(cell, w, d) {
    const x0 = cell[0] - ((w - 1) >> 1);
    const z0 = cell[1] - ((d - 1) >> 1);
    return { x0, x1: x0 + w - 1, z0, z1: z0 + d - 1 };
  }

  function fitInto(box, bounds) {
    const [dx, dz] = Core.clampDelta(box, 0, 0, bounds);
    const out = { x0: box.x0 + dx, x1: box.x1 + dx, z0: box.z0 + dz, z1: box.z1 + dz };
    return {
      x0: Math.max(out.x0, bounds.x0), x1: Math.min(out.x1, bounds.x1),
      z0: Math.max(out.z0, bounds.z0), z1: Math.min(out.z1, bounds.z1),
    };
  }

  function activeBox() {
    const layout = L();
    if (state.layer === Core.CRAWL) {
      const under = Core.floorById(layout, layout.site.crawl.under);
      return under ? Core.floorBox(layout, under) : Core.inner(layout);
    }
    const floor = layerFloor();
    return floor ? Core.floorBox(layout, floor) : Core.inner(layout);
  }

  function drawBounds() {
    if (state.tool === "marks" && state.draw && state.draw.home) return state.draw.home;
    if (state.tool === "streets") {
      const floor = layerFloor();
      return Core.boundsFor(L(), "streets", floor ? { floor: floor.id } : {});
    }
    return activeBox();
  }

  /** Dim the sheet outside this floor's footprint, and stroke the box when it is smaller than the site. */
  function paintSpan(g, v) {
    const layout = L();
    const box = activeBox();
    if (Core.sameBox(box, Core.inner(layout))) return;
    const outer = rectOf(layout.site.sheet, v);
    const hole = rectOf(box, v);
    const x0 = outer.x;
    const y0 = outer.y;
    const x1 = outer.x + outer.w;
    const y1 = outer.y + outer.h;
    const hx0 = Math.max(x0, hole.x);
    const hy0 = Math.max(y0, hole.y);
    const hx1 = Math.min(x1, hole.x + hole.w);
    const hy1 = Math.min(y1, hole.y + hole.h);
    g.fillStyle = "rgba(12, 10, 8, 0.42)";
    if (hy0 > y0) g.fillRect(x0, y0, outer.w, hy0 - y0);
    if (y1 > hy1) g.fillRect(x0, hy1, outer.w, y1 - hy1);
    if (hx0 > x0) g.fillRect(x0, hy0, hx0 - x0, Math.max(0, hy1 - hy0));
    if (x1 > hx1) g.fillRect(hx1, hy0, x1 - hx1, Math.max(0, hy1 - hy0));
    const floor = layerFloor() || Core.floorById(layout, layout.site.crawl.under);
    g.setLineDash([]);
    g.lineWidth = 3;
    g.strokeStyle = "rgba(243, 230, 212, 0.92)";
    g.strokeRect(hole.x + 1.5, hole.y + 1.5, hole.w - 3, hole.h - 3);
    g.lineWidth = 1.5;
    g.strokeStyle = (floor && floor.pen) || "#e0c4a4";
    g.strokeRect(hole.x + 1.5, hole.y + 1.5, hole.w - 3, hole.h - 3);
  }

  // ---- drawing ----

  function paint(g, v, live) {
    const layout = L();
    const s = layout.site.sheet;
    const pal = layout.palette;
    const R = (box) => rectOf(box, v);
    const sc = v.scale;
    g.save();
    g.fillStyle = "#2c2622";
    g.fillRect(0, 0, v.width, v.height);
    const all = R(s);
    g.fillStyle = pal.rock;
    g.fillRect(all.x, all.y, all.w, all.h);

    g.strokeStyle = "rgba(150, 132, 108, 0.45)";
    g.lineWidth = 1;
    for (let x = s.x0; x <= s.x1 + 1; x += 1) {
      if (x % 16 !== 0) continue;
      const px = Math.round(v.ox + (x - s.x0) * sc) + 0.5;
      line(g, px, all.y, px, all.y + all.h);
    }
    for (let z = s.z0; z <= s.z1 + 1; z += 1) {
      if (z % 16 !== 0) continue;
      const py = Math.round(v.oy + (z - s.z0) * sc) + 0.5;
      line(g, all.x, py, all.x + all.w, py);
    }

    const dirty = dirtyBox();
    if (dirty) {
      const r = R(dirty);
      g.fillStyle = "rgba(172, 78, 50, 0.07)";
      g.fillRect(r.x, r.y, r.w, r.h);
      g.setLineDash([9, 6]);
      g.strokeStyle = "rgba(172, 78, 50, 0.8)";
      g.lineWidth = 2;
      g.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
      g.setLineDash([]);
    }

    paintSpan(g, v);

    if (state.show.others) paintGhosts(g, R, v);

    const items = Core.zonesOn(layout, state.layer);
    for (const item of items) paintZone(g, item, R, sc, v);
    if (sc >= 6) {
      g.strokeStyle = "rgba(0, 0, 0, 0.16)";
      g.lineWidth = 1;
      g.beginPath();
      for (const item of items) {
        if (item.kind === "lifts") continue;
        const box = Core.boxOf(item.kind, item.z);
        const top = blockY(box.z0, v);
        const bot = blockY(box.z1 + 1, v);
        const left = blockX(box.x0, v);
        const right = blockX(box.x1 + 1, v);
        for (let x = box.x0 + 1; x <= box.x1; x += 1) {
          const px = blockX(x, v) + 0.5;
          g.moveTo(px, top);
          g.lineTo(px, bot);
        }
        for (let z = box.z0 + 1; z <= box.z1; z += 1) {
          const py = blockY(z, v) + 0.5;
          g.moveTo(left, py);
          g.lineTo(right, py);
        }
      }
      g.stroke();
    }
    if (showContents() && state.layer !== CRAWL) paintContents(g, R, sc, v);
    for (const item of items) paintLabel(g, item, R, sc);
    paintRulers(g, v, all);
    if (live) {
      paintHover(g, R);
      paintSelection(g, R);
      paintPreview(g, R, sc, v);
    }
    g.restore();
  }

  function showContents() {
    return state.show.contents || state.tool === "pads" || state.tool === "machines" || state.tool === "marks";
  }

  function line(g, x0, y0, x1, y1) {
    g.beginPath();
    g.moveTo(x0, y0);
    g.lineTo(x1, y1);
    g.stroke();
  }

  function dirtyBox() {
    const names = L().site.dirty;
    if (!names.length) return null;
    return Core.unionBoxes(names.map((n) => Core.chunkBounds(L(), n)));
  }

  /** Outlines of the floors right above and below, so stairs, lifts, and shafts can line up. */
  function paintGhosts(g, R, v) {
    const layout = L();
    let near = [];
    if (state.layer === CRAWL) {
      near = [layout.site.crawl.under];
    } else {
      const floors = layout.floors.slice().sort((a, b) => a.slab - b.slab).map((f) => f.id);
      const i = floors.indexOf(state.layer);
      near = [floors[i - 1], floors[i + 1]].filter(Boolean);
    }
    g.lineWidth = 1.5;
    for (const id of near) {
      const floor = Core.floorById(layout, id);
      const ink = hexAlpha(floor.pen || WALL, 0.55);
      g.strokeStyle = ink;
      g.setLineDash([5, 4]);
      for (const z of layout.rooms) {
        if (z.floor !== id) continue;
        const r = R(z);
        g.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
      }
      for (const z of layout.streets) {
        if (z.floor !== id) continue;
        if (state.layer === CRAWL && z.trench !== false) {
          const r = R(z);
          g.fillStyle = hexAlpha(layout.palette.trench, 0.55);
          g.fillRect(r.x, r.y, r.w, r.h);
        }
        paintStreetEdges(g, z, v, { strokeStyle: ink, lineWidth: 1.5, dash: [5, 4] });
      }
      g.setLineDash([]);
    }
  }

  function zoneFill(kind, z) {
    const pal = L().palette;
    if (kind === "rooms") return z.color;
    if (kind === "streets") return pal[z.style === "entry" ? "entry" : "corridor"];
    return { doors: pal.door, stairs: pal.stair, shafts: pal.well, trenches: pal.trench, marks: "#FFFDF8" }[kind] || pal.corridor;
  }

  /** A street's outline stops where another street on the same floor continues, so a crossing stays open. */
  function paintStreetEdges(g, street, v, style) {
    const open = (x, z) => !L().streets.some((other) => other !== street && other.floor === street.floor
      && x >= other.x0 && x <= other.x1 && z >= other.z0 && z <= other.z1);
    const runs = (n, exposed) => {
      const out = [];
      let start = null;
      for (let i = 0; i <= n; i += 1) {
        const on = i < n && exposed(i);
        if (on && start === null) start = i;
        if (!on && start !== null) {
          out.push([start, i - 1]);
          start = null;
        }
      }
      return out;
    };
    g.save();
    g.beginPath();
    g.lineCap = "butt";
    g.setLineDash(style && style.dash ? style.dash : []);
    g.strokeStyle = style ? style.strokeStyle : "rgba(40, 44, 50, 0.45)";
    g.lineWidth = style ? style.lineWidth : 1;
    const depth = street.z1 - street.z0 + 1;
    const width = street.x1 - street.x0 + 1;
    for (const [a, b] of runs(depth, (i) => open(street.x0 - 1, street.z0 + i))) {
      const x = blockX(street.x0, v) + 0.5;
      g.moveTo(x, blockY(street.z0 + a, v));
      g.lineTo(x, blockY(street.z0 + b + 1, v));
    }
    for (const [a, b] of runs(depth, (i) => open(street.x1 + 1, street.z0 + i))) {
      const x = blockX(street.x1 + 1, v) - 0.5;
      g.moveTo(x, blockY(street.z0 + a, v));
      g.lineTo(x, blockY(street.z0 + b + 1, v));
    }
    for (const [a, b] of runs(width, (i) => open(street.x0 + i, street.z0 - 1))) {
      const y = blockY(street.z0, v) + 0.5;
      g.moveTo(blockX(street.x0 + a, v), y);
      g.lineTo(blockX(street.x0 + b + 1, v), y);
    }
    for (const [a, b] of runs(width, (i) => open(street.x0 + i, street.z1 + 1))) {
      const y = blockY(street.z1 + 1, v) - 0.5;
      g.moveTo(blockX(street.x0 + a, v), y);
      g.lineTo(blockX(street.x0 + b + 1, v), y);
    }
    g.stroke();
    g.restore();
  }

  function paintZone(g, item, R, sc, v) {
    const { kind, z } = item;
    const r = R(Core.boxOf(kind, z));
    if (kind === "lifts") {
      const pad = Math.max(1, sc * 0.15);
      g.fillStyle = INK;
      g.fillRect(r.x - pad, r.y - pad, r.w + pad * 2, r.h + pad * 2);
      const cx = r.x + r.w / 2;
      const cy = r.y + r.h / 2;
      const k = Math.max(2, sc * 0.3);
      g.fillStyle = PAPER;
      triangle(g, cx, cy - k - 1, cx - k, cy - 1, cx + k, cy - 1);
      triangle(g, cx, cy + k + 1, cx - k, cy + 1, cx + k, cy + 1);
      return;
    }
    g.fillStyle = zoneFill(kind, z);
    g.fillRect(r.x, r.y, r.w, r.h);
    if (kind === "streets") {
      paintStreetEdges(g, z, v || state.view);
      return;
    }
    if (kind === "stairs") {
      paintStair(g, z, r, sc);
    } else if (kind === "shafts") {
      g.save();
      g.beginPath();
      g.rect(r.x, r.y, r.w, r.h);
      g.clip();
      g.strokeStyle = "rgba(90, 150, 190, 0.45)";
      g.lineWidth = 1;
      for (let k = -r.h; k < r.w; k += 8) line(g, r.x + k, r.y + r.h, r.x + k + r.h, r.y);
      g.restore();
      g.strokeStyle = "#5A96BE";
      g.lineWidth = 2;
      g.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
      return;
    }
    g.lineWidth = kind === "rooms" ? 1.5 : 1;
    g.strokeStyle = kind === "rooms" ? WALL : "rgba(40, 44, 50, 0.45)";
    g.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
  }

  function paintStair(g, stair, r, sc) {
    const alongZ = stair.low === "n" || stair.low === "s";
    const step = Math.max(3, sc / 2);
    g.strokeStyle = "rgba(150, 132, 104, 0.6)";
    g.lineWidth = 1;
    if (alongZ) for (let y = r.y + step; y < r.y + r.h; y += step) line(g, r.x, y, r.x + r.w, y);
    else for (let x = r.x + step; x < r.x + r.w; x += step) line(g, x, r.y, x, r.y + r.h);
    g.strokeStyle = "rgba(40, 44, 50, 0.6)";
    g.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
    const going = state.layer === stair.floors[0] ? "UP" : "DOWN";
    const dir = Core.STEP[stair.low];
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    const span = (alongZ ? r.h : r.w) * 0.36;
    const low = [cx + dir[0] * span, cy + dir[1] * span];
    const high = [cx - dir[0] * span, cy - dir[1] * span];
    const [from, to] = going === "UP" ? [low, high] : [high, low];
    g.strokeStyle = INK;
    g.fillStyle = INK;
    g.lineWidth = 2;
    line(g, from[0], from[1], to[0], to[1]);
    const ax = Math.sign(to[0] - from[0]);
    const ay = Math.sign(to[1] - from[1]);
    const k = Math.max(4, sc * 0.6);
    triangle(g, to[0] + ax * 2, to[1] + ay * 2, to[0] - ax * k - ay * k * 0.7, to[1] - ay * k - ax * k * 0.7,
      to[0] - ax * k + ay * k * 0.7, to[1] - ay * k + ax * k * 0.7);
    if (sc >= 4) {
      g.font = `bold ${Math.max(9, Math.min(13, sc * 1.4))}px Segoe UI, sans-serif`;
      g.textAlign = "center";
      g.textBaseline = "middle";
      halo(g, going, from[0], from[1]);
    }
  }

  function triangle(g, x0, y0, x1, y1, x2, y2) {
    g.beginPath();
    g.moveTo(x0, y0);
    g.lineTo(x1, y1);
    g.lineTo(x2, y2);
    g.closePath();
    g.fill();
  }

  // A multiblock's fill by tier, on the plan and in 3D. Tier "-" is the magic mods. A tier with no color here is `other`.
  const PAD_COLOR = {
    Stone: "#C4A882",
    Steam: "#D7A15A",
    LV: "#9BB0B8",
    MV: "#8FB48A",
    HV: "#7E97D0",
    EV: "#E0B15A",
    magic: "#B592C4",
    other: "#A3988C",
  };

  function padFill(spec) {
    if (spec.tier && PAD_COLOR[spec.tier]) return PAD_COLOR[spec.tier];
    if (spec.tier === "-") return PAD_COLOR.magic;
    return PAD_COLOR.other;
  }

  function paintPad(g, p, r, sc, v) {
    const spec = CATALOG.multis[p.key] || {};
    const fill = padFill(spec);
    const cols = Math.max(1, (p.x1 - p.x0) + 1);
    const rows = Math.max(1, (p.z1 - p.z0) + 1);
    const cell = (x, z) => {
      const x0 = blockX(x, v);
      const y0 = blockY(z, v);
      return { x: x0, y: y0, w: blockX(x + 1, v) - x0, h: blockY(z + 1, v) - y0 };
    };
    const shell = Boolean(spec.shell);
    if (shell) {
      const door = p.door;
      for (let x = p.x0; x <= p.x1; x += 1) {
        for (let z = p.z0; z <= p.z1; z += 1) {
          const edge = x === p.x0 || x === p.x1 || z === p.z0 || z === p.z1;
          const isDoor = Array.isArray(door) && door[0] === x && door[1] === z;
          if (!edge) continue;
          const c = cell(x, z);
          g.fillStyle = isDoor ? PAPER : fill;
          g.fillRect(c.x, c.y, c.w, c.h);
        }
      }
    } else {
      g.fillStyle = fill;
      g.fillRect(r.x, r.y, r.w, r.h);
      if (sc >= 6 && (cols > 1 || rows > 1)) {
        g.strokeStyle = "rgba(27, 36, 48, 0.22)";
        g.lineWidth = 1;
        g.beginPath();
        for (let x = p.x0 + 1; x <= p.x1; x += 1) {
          const px = blockX(x, v) + 0.5;
          g.moveTo(px, r.y);
          g.lineTo(px, r.y + r.h);
        }
        for (let z = p.z0 + 1; z <= p.z1; z += 1) {
          const py = blockY(z, v) + 0.5;
          g.moveTo(r.x, py);
          g.lineTo(r.x + r.w, py);
        }
        g.stroke();
      }
    }
    const mods = Core.moduleList(p);
    // Each module is a whole footprint. The block between two outlines is the shared wall.
    if (mods.length > 1) {
      g.strokeStyle = "rgba(27, 36, 48, 0.72)";
      g.lineWidth = 2;
      for (const mod of mods) {
        const a = cell(mod.x0, mod.z0);
        const b = cell(mod.x1, mod.z1);
        g.strokeRect(a.x + 0.5, a.y + 0.5, Math.max(0, b.x + b.w - a.x - 1), Math.max(0, b.y + b.h - a.y - 1));
      }
    }
    for (const mod of mods) {
      const [fx, fz] = Core.frontCell(mod);
      const fc = cell(fx, fz);
      const thick = Math.max(2, Math.min(fc.w, fc.h) * 0.45);
      g.fillStyle = INK;
      if (mod.front === "n") g.fillRect(fc.x, fc.y, fc.w, thick);
      else if (mod.front === "s") g.fillRect(fc.x, fc.y + fc.h - thick, fc.w, thick);
      else if (mod.front === "w") g.fillRect(fc.x, fc.y, thick, fc.h);
      else g.fillRect(fc.x + fc.w - thick, fc.y, thick, fc.h);
    }
    const over = Boolean(spec.tier) && !Core.multiOpen(spec, Core.planTier(L()));
    g.lineWidth = spec.pollution || over ? 2 : 1;
    g.strokeStyle = spec.pollution || over ? RUST : WALL;
    g.setLineDash(over && !spec.pollution ? [4, 3] : []);
    g.strokeRect(r.x + 0.5, r.y + 0.5, Math.max(0, r.w - 1), Math.max(0, r.h - 1));
    g.setLineDash([]);
    if (sc < 4) return;
    const count = mods.length;
    const name = (p.label && String(p.label).trim()) || (count > 1 ? `${count}× ${spec.short || spec.name || ""}` : (spec.short || spec.name || ""));
    if (!name) return;
    g.save();
    g.beginPath();
    g.rect(r.x + 1, r.y + 1, Math.max(0, r.w - 2), Math.max(0, r.h - 2));
    g.clip();
    g.textAlign = "center";
    g.textBaseline = "middle";
    const maxW = Math.max(4, r.w - 4);
    let size = Math.min(13, Math.max(8, sc));
    g.font = `bold ${size}px Segoe UI, sans-serif`;
    while (size > 7 && g.measureText(name).width > maxW) {
      size -= 1;
      g.font = `bold ${size}px Segoe UI, sans-serif`;
    }
    if (g.measureText(name).width <= maxW && r.h >= size) {
      halo(g, name, r.x + r.w / 2, r.y + r.h / 2);
    }
    g.restore();
  }

  function paintMark(g, m, r, sc) {
    if (m.shape === "service") {
      g.fillStyle = "rgba(120, 114, 104, 0.3)";
      g.fillRect(r.x, r.y, r.w, r.h);
      return;
    }
    if (m.shape === "text") {
      if (sc >= 8) painted(g, m.short, r.x + r.w / 2, r.y + r.h / 2, m.vertical, sc);
      return;
    }
    if (m.shape === "well") return;
    g.setLineDash([4, 3]);
    g.strokeStyle = hexAlpha(MARK, 0.75);
    g.lineWidth = 1;
    if (m.shape === "circle") {
      g.beginPath();
      g.arc(r.x + r.w / 2, r.y + r.h / 2, ((m.radius || Core.circleRadius(m)) + 0.5) * sc, 0, Math.PI * 2);
      g.stroke();
    } else {
      g.strokeRect(r.x + 1.5, r.y + 1.5, r.w - 3, r.h - 3);
    }
    g.setLineDash([]);
    if (m.short && sc >= 5 && m.shape === "circle") {
      const radius = ((m.radius || Core.circleRadius(m)) + 0.5) * sc;
      g.font = `${Math.max(9, Math.min(12, sc * 1.1))}px Segoe UI, sans-serif`;
      g.textAlign = "center";
      g.textBaseline = "top";
      if (g.measureText(m.short).width < radius * 1.6) halo(g, m.short, r.x + r.w / 2, r.y + r.h / 2 - radius + 4);
      g.textAlign = "left";
    } else if (m.short && sc >= 5) {
      g.font = `${Math.max(9, Math.min(12, sc * 1.1))}px Segoe UI, sans-serif`;
      g.textAlign = "left";
      g.textBaseline = "top";
      if (g.measureText(m.short).width < r.w - 6) halo(g, m.short, r.x + 4, r.y + 3);
    }
  }

  function paintMachine(g, code, face, r, sc, alpha = 1, tier = "MV") {
    const spec = CATALOG.singles[code] || {};
    const groups = L().palette.groups;
    const inset = sc >= 8 ? 1.5 : 0.5;
    g.globalAlpha = alpha;
    g.fillStyle = groups[spec.group] || MUTED;
    g.fillRect(r.x + inset, r.y + inset, r.w - inset * 2, r.h - inset * 2);
    const bar = Math.max(1, sc / 7);
    g.fillStyle = "rgba(255, 255, 255, 0.85)";
    if (face === "n") g.fillRect(r.x + inset, r.y + inset, r.w - inset * 2, bar);
    if (face === "s") g.fillRect(r.x + inset, r.y + r.h - inset - bar, r.w - inset * 2, bar);
    if (face === "w") g.fillRect(r.x + inset, r.y + inset, bar, r.h - inset * 2);
    if (face === "e") g.fillRect(r.x + r.w - inset - bar, r.y + inset, bar, r.h - inset * 2);
    if (sc >= 16) {
      g.font = `bold ${Math.min(12, sc * 0.42)}px Segoe UI, sans-serif`;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillStyle = "#FFFFFF";
      g.fillText(code, r.x + r.w / 2, r.y + r.h / 2 + 1);
    }
    if (tier && tier !== "MV" && sc >= 10) {
      g.font = `bold ${Math.max(8, Math.min(11, sc * 0.32))}px Segoe UI, sans-serif`;
      g.fillStyle = "#FFFFFF";
      const pad = inset + 1;
      if (face === "e") {
        g.textAlign = "left";
        g.textBaseline = "bottom";
        g.fillText(tier, r.x + pad, r.y + r.h - pad);
      } else if (face === "s") {
        g.textAlign = "right";
        g.textBaseline = "top";
        g.fillText(tier, r.x + r.w - pad, r.y + pad);
      } else {
        g.textAlign = "right";
        g.textBaseline = "bottom";
        g.fillText(tier, r.x + r.w - pad, r.y + r.h - pad);
      }
    }
    g.globalAlpha = 1;
  }

  function paintContents(g, R, sc, v) {
    const layout = L();
    const contents = Core.contentsOn(layout, state.layer);
    for (const item of contents) if (item.kind === "marks") paintMark(g, item.z, R(item.z), sc);
    for (const item of contents) if (item.kind === "pads") paintPad(g, item.z, R(item.z), sc, v);
    const moving = machineDelta(state.drag);
    const ghosts = moving && (moving[0] || moving[1]) ? state.drag.machines : null;
    for (const m of Core.machinesOn(layout, state.layer)) {
      const ghosted = ghosts && ghosts.some((item) => item.index === m.index && item.slot === m.slot);
      paintMachine(g, m.code, m.face, R(cellBox(m.x, m.z)), sc, ghosted ? 0.35 : 1, m.tier);
    }
  }

  function paintLabel(g, item, R, sc) {
    const { kind, z } = item;
    if (kind === "rooms") {
      const at = Array.isArray(z.label_at) ? z.label_at : [(z.x0 + z.x1) >> 1, (z.z0 + z.z1) >> 1];
      const room = R(z);
      const cell = R(cellBox(at[0], at[1]));
      const size = Math.max(10, Math.min(15, sc * 1.6));
      g.font = `bold ${size}px Segoe UI, sans-serif`;
      g.textAlign = "center";
      g.textBaseline = "middle";
      let text = z.name;
      if (g.measureText(text).width > room.w - 8) text = z.code;
      if (g.measureText(text).width > room.w - 4 || room.h < size) return;
      const half = g.measureText(text).width / 2;
      const cx = Math.min(Math.max(cell.x + cell.w / 2, room.x + half + 4), room.x + room.w - half - 4);
      halo(g, text, cx, cell.y + cell.h / 2);
      const floor = Core.floorById(L(), z.floor);
      if (z.height && floor && z.height !== Core.floorHeight(floor) && sc >= 4) {
        g.font = `${Math.max(9, size - 3)}px Segoe UI, sans-serif`;
        const tag = `${z.height} high`;
        if (g.measureText(tag).width < room.w - 6) halo(g, tag, cx, cell.y + cell.h / 2 + size, MUTED);
      }
    } else if (kind === "streets" && z.label) {
      const at = Array.isArray(z.label_at) ? z.label_at : [z.x0 + 1, (z.z0 + z.z1) >> 1];
      const r = R(cellBox(at[0], at[1]));
      if (z.label_vertical) painted(g, z.label, r.x + r.w / 2, r.y + r.h / 2, true, sc);
      else painted(g, z.label, r.x, r.y + r.h / 2, false, sc, "left");
    }
  }

  function painted(g, text, x, y, vertical, sc, align = "center") {
    g.save();
    g.font = `bold ${Math.max(9, Math.min(13, sc * 1.3))}px Segoe UI, sans-serif`;
    g.textAlign = align;
    g.textBaseline = "middle";
    g.translate(x, y);
    if (vertical) g.rotate(-Math.PI / 2);
    halo(g, text, 0, 0, MUTED);
    g.restore();
  }

  function halo(g, text, x, y, color = INK) {
    g.lineWidth = 3;
    g.strokeStyle = "rgba(255, 253, 248, 0.9)";
    g.lineJoin = "round";
    g.strokeText(text, x, y);
    g.fillStyle = color;
    g.fillText(text, x, y);
  }

  /** Chunk letters and numbers, and the coordinate of each chunk's first column and row, as on the sheets. */
  function paintRulers(g, v, all) {
    const layout = L();
    const s = layout.site.sheet;
    const sc = v.scale;
    const [ox, oz] = Core.chunkOrigin(layout);
    g.font = "11px Segoe UI, sans-serif";
    g.textBaseline = "middle";
    const mark = Math.max(3, Math.min(sc, 8));
    const axis = "#f3e6d4";
    for (let x = s.x0; x <= s.x1; x += 1) {
      if (x % 16 !== 0) continue;
      const px = v.ox + (x - s.x0) * sc;
      g.fillStyle = "#c4a882";
      g.fillRect(px, all.y - mark, Math.max(2, sc), mark);
      g.fillStyle = axis;
      g.textAlign = "center";
      g.fillText(String(x), px + sc / 2, all.y - 16);
    }
    for (let z = s.z0; z <= s.z1; z += 1) {
      if (z % 16 !== 0) continue;
      const py = v.oy + (z - s.z0) * sc;
      g.fillStyle = "#c4a882";
      g.fillRect(all.x - mark, py, mark, Math.max(2, sc));
      g.fillStyle = axis;
      g.textAlign = "right";
      g.fillText(String(z), all.x - 12, py + sc / 2);
    }
    const tick = Math.max(2, Math.min(sc, 8));
    if (s.x1 % 16 !== 0) {
      const east = all.x + all.w;
      g.fillStyle = "#c4a882";
      g.fillRect(east - tick, all.y - mark, tick, mark);
      g.fillStyle = axis;
      g.textAlign = "center";
      g.fillText(String(s.x1), east - sc / 2, all.y - 16);
    }
    if (s.z1 % 16 !== 0) {
      const south = all.y + all.h;
      g.fillStyle = "#c4a882";
      g.fillRect(all.x - mark, south - tick, mark, tick);
      g.fillStyle = axis;
      g.textAlign = "right";
      g.fillText(String(s.z1), all.x - 12, south - sc / 2);
    }
    g.fillStyle = axis;
    g.font = "bold 13px Segoe UI, sans-serif";
    g.textAlign = "center";
    const cols = layout.site.columns;
    for (let c = 0; c < cols.length; c += 1) {
      const x0 = Math.max((ox + c) * 16, s.x0);
      const x1 = Math.min((ox + c) * 16 + 15, s.x1);
      if (x1 - x0 < 3) continue;
      g.fillText(cols[c], v.ox + ((x0 + x1 + 1) / 2 - s.x0) * sc, all.y - 32);
    }
    for (let r = 0; r < layout.site.terrain.length; r += 1) {
      const z0 = Math.max((oz + r) * 16, s.z0);
      const z1 = Math.min((oz + r) * 16 + 15, s.z1);
      if (z1 - z0 < 3) continue;
      g.fillText(String(r + 1), all.x - 48, v.oy + ((z0 + z1 + 1) / 2 - s.z0) * sc);
    }
  }

  function paintHover(g, R) {
    if (state.tool !== "select" || state.drag || !state.hover) return;
    const hit = hitsAt(state.hover[0], state.hover[1])[0];
    if (!hit || selRefs().some((item) => same(item, hit))) return;
    const rec = L()[hit.kind === "machines" ? "walls" : hit.kind][hit.index];
    const box = hit.kind === "machines" ? cellBox(...Core.cellOf(rec, hit.slot)) : Core.boxOf(hit.kind, rec);
    const r = R(box);
    g.strokeStyle = "rgba(47, 93, 138, 0.8)";
    g.lineWidth = 1.5;
    g.setLineDash([3, 3]);
    g.strokeRect(r.x - 1, r.y - 1, r.w + 2, r.h + 2);
    g.setLineDash([]);
  }

  function selectionBox(sel) {
    const box = boxOfSel(sel);
    if (sel.kind !== "machines") return box;
    const delta = machineDelta(state.drag);
    if (!delta || (!delta[0] && !delta[1]) || !state.drag.machines) return box;
    const moved = state.drag.machines.some((item) => item.index === sel.index && item.slot === sel.slot);
    if (!moved) return box;
    return {
      x0: box.x0 + delta[0], x1: box.x1 + delta[0],
      z0: box.z0 + delta[1], z1: box.z1 + delta[1],
    };
  }

  function paintSelection(g, R) {
    const items = selection();
    if (!items.length) return;
    g.lineWidth = 2;
    g.setLineDash([]);
    g.strokeStyle = INK;
    const boxes = [];
    for (const sel of items) {
      const box = selectionBox(sel);
      boxes.push(box);
      const r = R(box);
      g.strokeRect(r.x - 1, r.y - 1, r.w + 2, r.h + 2);
    }
    if (items.length === 1) {
      const sel = items[0];
      const r = R(boxes[0]);
      if (canResize(sel)) {
        g.fillStyle = PAPER;
        for (const [hx, hy] of handlePoints(r)) {
          g.fillRect(hx - 4, hy - 4, 8, 8);
          g.strokeRect(hx - 4, hy - 4, 8, 8);
        }
      }
      let text;
      if (sel.kind === "machines") text = `${sel.code} · ${Core.tierAt(sel.rec, sel.slot)} · faces ${SIDE_NAMES[sel.rec.face].toLowerCase()}`;
      else if (sel.kind === "lifts") text = `X ${boxes[0].x0}, Z ${boxes[0].z0}`;
      else text = `${boxes[0].x1 - boxes[0].x0 + 1} × ${boxes[0].z1 - boxes[0].z0 + 1}`;
      g.font = "bold 12px Segoe UI, sans-serif";
      g.textAlign = "left";
      g.textBaseline = "bottom";
      halo(g, text, r.x, r.y - 6);
      return;
    }
    const r = R(Core.unionBoxes(boxes));
    g.font = "bold 12px Segoe UI, sans-serif";
    g.textAlign = "left";
    g.textBaseline = "bottom";
    halo(g, `${items.length} selected`, r.x, r.y - 6);
  }

  function paintPreview(g, R, sc, v) {
    if (state.draw) {
      const box = drawBox();
      const r = R(box);
      g.globalAlpha = 0.7;
      g.fillStyle = state.tool === "rooms" ? ROOM_COLORS[0] : zoneFill(state.tool, {});
      g.fillRect(r.x, r.y, r.w, r.h);
      g.globalAlpha = 1;
      g.strokeStyle = INK;
      g.lineWidth = 1.5;
      g.setLineDash([5, 3]);
      g.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
      g.setLineDash([]);
      g.font = "bold 12px Segoe UI, sans-serif";
      g.textAlign = "left";
      g.textBaseline = "bottom";
      halo(g, `${box.x1 - box.x0 + 1} × ${box.z1 - box.z0 + 1}`, r.x, r.y - 6);
      return;
    }
    if (state.drag && state.drag.machines && state.drag.machines.length) {
      const delta = machineDelta(state.drag);
      if (delta[0] || delta[1]) {
        for (const m of state.drag.machines) {
          const r = R(cellBox(m.x + delta[0], m.z + delta[1]));
          paintMachine(g, m.code, m.face, r, sc, 0.85, m.tier);
          g.strokeStyle = INK;
          g.lineWidth = 2;
          g.strokeRect(r.x - 1, r.y - 1, r.w + 2, r.h + 2);
        }
        return;
      }
    }
    const p = toolById(state.tool).place && placement();
    if (!p) return;
    const r = R(p.box);
    if (p.kind === "pads") {
      g.save();
      g.globalAlpha = 0.82;
      const spec = CATALOG.multis[p.key] || {};
      const pad = {
        key: p.key, num: "", front: p.front,
        x0: p.box.x0, x1: p.box.x1, z0: p.box.z0, z1: p.box.z1,
      };
      if (spec.shell) pad.door = Core.frontCell(pad);
      paintPad(g, pad, r, sc, v);
      g.restore();
    } else {
      paintMachine(g, p.code, p.face, r, sc, 0.85);
    }
    g.strokeStyle = p.fits ? GOOD : RUST;
    g.lineWidth = 2;
    g.setLineDash(p.fits ? [] : [4, 3]);
    g.strokeRect(r.x - 1, r.y - 1, r.w + 2, r.h + 2);
    g.setLineDash([]);
  }

  function handlePoints(r) {
    const xs = [r.x, r.x + r.w / 2, r.x + r.w];
    const ys = [r.y, r.y + r.h / 2, r.y + r.h];
    return [[xs[0], ys[0]], [xs[1], ys[0]], [xs[2], ys[0]], [xs[2], ys[1]], [xs[2], ys[2]], [xs[1], ys[2]],
      [xs[0], ys[2]], [xs[0], ys[1]]];
  }

  function hexAlpha(hex, alpha) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
  }

  const plate = document.createElement("canvas");
  const plateCtx = plate.getContext("2d");
  let plateKey = "";
  let plateRev = 0;
  let paintQueued = 0;

  /** The floor drawing changed, so the next frame rebuilds the offscreen copy. */
  function notePlan() {
    plateRev += 1;
  }

  function paintFrame() {
    if (paintQueued) {
      cancelAnimationFrame(paintQueued);
      paintQueued = 0;
    }
    if (!state.layout || state.space) return;
    const v = state.view;
    if (v.width < 1 || v.height < 1) return;
    const dpr = window.devicePixelRatio || 1;
    const key = [
      state.layer, state.show.others, showContents(),
      v.scale, v.ox, v.oy, v.width, v.height, dpr, plateRev,
    ].join("|");
    const pw = Math.round(v.width * dpr);
    const ph = Math.round(v.height * dpr);
    if (plate.width !== pw || plate.height !== ph) {
      plate.width = pw;
      plate.height = ph;
      plateKey = "";
    }
    if (plateKey !== key) {
      plateCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      paint(plateCtx, v, false);
      plateKey = key;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(plate, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const R = (box) => rectOf(box, v);
    paintHover(ctx, R);
    paintSelection(ctx, R);
    paintPreview(ctx, R, v.scale, v);
  }

  /** Pointer moves share one paint. Edits and resizes paint immediately. */
  function draw() {
    if (!state.layout || state.space || paintQueued) return;
    paintQueued = requestAnimationFrame(paintFrame);
  }

  function renderSpaceLayers() {
    const box = $("space-layers");
    box.innerHTML = "";
    for (const layer of Core.layers(L()).slice().reverse()) {
      const label = document.createElement("label");
      label.className = "toggle";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = true;
      input.addEventListener("change", () => View3D.setVisible(layer.id, input.checked));
      label.append(input, document.createTextNode(` ${layer.name}`));
      box.append(label);
    }
  }

  function setSpace(on) {
    if (on === state.space) return;
    if (on) {
      $("space").hidden = false;
      if (!View3D.open($("space"), L(), CATALOG, (text) => { $("cursor").textContent = text; }, padFill)) {
        $("space").hidden = true;
        status("This window has no 3D view.", true);
        return;
      }
      renderSpaceLayers();
    } else {
      View3D.close();
      $("space").hidden = true;
    }
    state.space = on;
    document.body.classList.toggle("view3d", on);
    $("view-3d").setAttribute("aria-pressed", String(on));
    if (on) View3D.resize();
    $("space-panel").hidden = !on;
    if (on) {
      status("Drag to turn. Right-drag to slide. The wheel zooms. Double-click frames the thing under the pointer.");
      $("cursor").textContent = "";
      $("space").focus();
    } else {
      status("");
      resize();
      paintFrame();
      canvas.focus();
    }
  }

  // ---- hit testing ----

  /** Everything under a cell on this layer, small things first. */
  function hitsAt(x, z) {
    const layout = L();
    const hits = [];
    const add = (kind, index, box, slot) => {
      if (x >= box.x0 && x <= box.x1 && z >= box.z0 && z <= box.z1) {
        hits.push({ kind, index, slot, area: (box.x1 - box.x0 + 1) * (box.z1 - box.z0 + 1) });
      }
    };
    for (const item of Core.zonesOn(layout, state.layer)) add(item.kind, item.index, Core.boxOf(item.kind, item.z));
    if (showContents() && state.layer !== CRAWL) {
      for (const item of Core.contentsOn(layout, state.layer)) {
        if (item.kind !== "walls") add(item.kind, item.index, Core.boxOf(item.kind, item.z));
      }
      for (const m of Core.machinesOn(layout, state.layer)) add("machines", m.index, cellBox(m.x, m.z), m.slot);
    }
    hits.sort((a, b) => HIT_ORDER.indexOf(a.kind) - HIT_ORDER.indexOf(b.kind) || a.area - b.area);
    return hits;
  }

  /**
   * What dragging a multiblock's handle does. "modules" adds to a wallshared row or takes from it,
   * "size" moves it to another legal size, and "" means its size is fixed.
   */
  function padDrag(pad) {
    const spec = CATALOG.multis[pad.key] || {};
    if (spec.share) return "modules";
    return Core.sizeFields(pad, spec).some((field) => field.key !== "h") ? "size" : "";
  }

  /** Whether the one selected thing shows handles. */
  function canResize(sel) {
    if (!sel) return false;
    if (sel.kind === "rooms") return !roomLocked(sel.rec);
    if (sel.kind === "pads") return padDrag(sel.rec) !== "";
    return RESIZABLE.has(sel.kind);
  }

  function hitHandle(px, py) {
    const sel = selected();
    if (!canResize(sel)) return "";
    const pts = handlePoints(rectOf(boxOfSel(sel)));
    for (let i = 0; i < pts.length; i += 1) {
      if (Math.abs(px - pts[i][0]) <= 6 && Math.abs(py - pts[i][1]) <= 6) return HANDLES[i];
    }
    return "";
  }

  // ---- input ----

  function local(event) {
    const box = canvas.getBoundingClientRect();
    return [event.clientX - box.left, event.clientY - box.top];
  }

  const CURSORS = { nw: "nwse-resize", se: "nwse-resize", ne: "nesw-resize", sw: "nesw-resize", n: "ns-resize",
    s: "ns-resize", e: "ew-resize", w: "ew-resize" };

  function capture(event) {
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch (err) {
      // Pointers the browser does not track as active cannot be captured; the drag still works inside the canvas.
    }
  }

  canvas.addEventListener("pointerdown", (event) => {
    if (!state.layout) return;
    canvas.focus();
    const [px, py] = local(event);
    const cell = toWorld(px, py);
    state.hover = cell;
    capture(event);
    if (event.button !== 0) {
      state.drag = { mode: "pan", px, py, ox: state.view.ox, oy: state.view.oy };
      return;
    }
    const tool = toolById(state.tool);
    if (tool.draw) {
      startDraw(cell);
      return;
    }
    if (tool.place) {
      startPlace(cell);
      return;
    }
    const handle = hitHandle(px, py);
    if (handle) {
      const sel = selected();
      const drag = { mode: "resize", handle, before: snapshot(), box: boxOfSel(sel) };
      if (sel.kind === "pads" && padDrag(sel.rec) === "modules") drag.module = Core.moduleSize(sel.rec);
      state.drag = drag;
      return;
    }
    const hits = hitsAt(cell[0], cell[1]);
    if (event.ctrlKey || event.metaKey) {
      if (hits[0]) toggleSel(hits[0]);
      refresh();
      return;
    }
    const current = hits.find((hit) => selRefs().some((item) => same(item, hit)));
    const target = current || hits[0];
    if (!target) {
      state.sel = null;
      state.drag = { mode: "pan", px, py, ox: state.view.ox, oy: state.view.oy };
      refresh();
      return;
    }
    const wasSelected = Boolean(current);
    if (!wasSelected) replaceSel(target);
    const anchor = refOf(target);
    const items = selection();
    const onlyLocked = items.length === 1 && items[0].kind === "rooms" && roomLocked(items[0].rec);
    if (onlyLocked) {
      state.drag = { mode: "locked", start: cell, moved: false, wasSelected, hits, anchor };
      refresh();
      return;
    }
    state.drag = beginMove(cell, items, wasSelected, hits, anchor);
    refresh();
  });

  canvas.addEventListener("pointermove", (event) => {
    if (!state.layout) return;
    const [px, py] = local(event);
    const cell = toWorld(px, py);
    const moved = !state.hover || state.hover[0] !== cell[0] || state.hover[1] !== cell[1];
    state.hover = cell;
    const drag = state.drag;
    if (state.draw) {
      state.draw.cur = clampCell(cell, drawBounds());
      draw();
      showCursor();
      return;
    }
    if (!drag) {
      const tool = toolById(state.tool);
      if (tool.draw || tool.place) canvas.style.cursor = "crosshair";
      else {
        const handle = hitHandle(px, py);
        const top = hitsAt(cell[0], cell[1])[0];
        const fixed = top && top.kind === "rooms" && roomLocked(L().rooms[top.index]);
        canvas.style.cursor = handle ? CURSORS[handle] : top && !fixed ? "move" : top ? "default" : "grab";
      }
      if (moved) draw();
      showCursor();
      return;
    }
    if (drag.mode === "pan") {
      state.view.ox = drag.ox + (px - drag.px);
      state.view.oy = drag.oy + (py - drag.py);
      state.fitted = false;
      canvas.style.cursor = "grabbing";
      draw();
      return;
    }
    if (drag.mode === "locked") {
      if (cell[0] !== drag.start[0] || cell[1] !== drag.start[1]) drag.moved = true;
      canvas.style.cursor = "not-allowed";
      return;
    }
    if (drag.mode === "paint") {
      if (moved) {
        notePlan();
        for (const next of cellsBetween(drag.last, cell)) {
          const dir = sideBetween(drag.last, next);
          if (dir && drag.freshId && !drag.oriented) orientRow(drag.freshId, dir);
          drag.oriented = true;
          paintMachineAt(next);
          drag.last = next;
        }
      }
      draw();
      showCursor();
      return;
    }
    if (drag.mode === "resize") {
      const sel = selected();
      if (!sel) return;
      if (moved) notePlan();
      const room = CONTENTS.has(sel.kind) ? Core.roomById(L(), sel.rec.room) : null;
      if (drag.module) {
        Core.stretchModules(sel.rec, drag.module, drag.box, drag.handle, cell, room);
      } else if (sel.kind === "pads") {
        const at = room ? clampCell(cell, room) : cell;
        const spec = CATALOG.multis[sel.rec.key] || {};
        Core.resizePadBox(sel.rec, L(), spec, pulledBox(drag.box, drag.handle, at), drag.handle, drag.box);
      } else {
        const bounds = room || (sel.kind === "marks" ? Core.inner(L()) : Core.boundsFor(L(), sel.kind, sel.rec));
        Core.setBox(sel.kind, sel.rec, pulledBox(drag.box, drag.handle, clampCell(cell, bounds)));
      }
      draw();
      showCursor();
      return;
    }
    if (cell[0] !== drag.start[0] || cell[1] !== drag.start[1]) drag.moved = true;
    if (moved) notePlan();
    if (drag.mode === "machine") {
      const dx = cell[0] - drag.start[0];
      const dz = cell[1] - drag.start[1];
      drag.delta = dx || dz ? [dx, dz] : null;
    } else if (drag.mode === "move") {
      const [dx, dz] = clampGroup(drag.zones, cell[0] - drag.start[0], cell[1] - drag.start[1]);
      const sx = dx - drag.applied[0];
      const sz = dz - drag.applied[1];
      if (sx || sz) {
        for (const item of drag.zones) Core.moveZone(L(), item.kind, item.rec, sx, sz);
      }
      drag.applied = [dx, dz];
    }
    draw();
    showCursor();
  });

  function endPointer() {
    if (state.draw) {
      finishDraw();
      return;
    }
    const drag = state.drag;
    state.drag = null;
    const tool = toolById(state.tool);
    canvas.style.cursor = tool.draw || tool.place ? "crosshair" : "";
    if (!drag) return;
    if (drag.mode === "locked") {
      if (drag.moved) status("This room is locked.", true);
      else finishClick(drag);
      return;
    }
    if (drag.mode === "paint") {
      commit(drag.before);
      return;
    }
    if (drag.mode === "resize") {
      commit(drag.before);
      return;
    }
    if (drag.mode === "machine") {
      const [dx, dz] = drag.delta || [0, 0];
      if (!drag.moved) {
        finishClick(drag);
        return;
      }
      if (!dx && !dz) return;
      if (drag.machines.length === 1) {
        const m = drag.machines[0];
        dropMachine(machineSel(m), m.x + dx, m.z + dz);
        return;
      }
      let problem = "";
      change(() => {
        problem = applyMachineDelta(drag.machines, dx, dz);
      });
      if (problem) status(problem, true);
      return;
    }
    if (drag.mode === "move") {
      if (!drag.moved) {
        finishClick(drag);
        return;
      }
      if (!(drag.applied[0] || drag.applied[1])) return;
      for (const item of drag.zones) {
        if (CONTENTS.has(item.kind)) Core.rehome(L(), item.kind, item.rec);
      }
      let problem = "";
      if (drag.machines.length) problem = applyMachineDelta(drag.machines, drag.applied[0], drag.applied[1]);
      commit(drag.before);
      if (problem) status(problem, true);
    }
  }

  canvas.addEventListener("pointerup", endPointer);
  canvas.addEventListener("pointercancel", endPointer);
  canvas.addEventListener("contextmenu", (event) => event.preventDefault());
  canvas.addEventListener("pointerleave", () => {
    if (state.drag || state.draw) return;
    state.hover = null;
    draw();
    showCursor();
  });

  canvas.addEventListener("wheel", (event) => {
    if (!state.layout) return;
    event.preventDefault();
    const [px, py] = local(event);
    const v = state.view;
    const factor = event.deltaY < 0 ? 1.15 : 1 / 1.15;
    const next = Math.max(2, Math.min(48, v.scale * factor));
    v.ox = px - ((px - v.ox) * next) / v.scale;
    v.oy = py - ((py - v.oy) * next) / v.scale;
    v.scale = next;
    state.fitted = false;
    draw();
  }, { passive: false });

  // ---- drawing tools ----

  function startDraw(cell) {
    const sketch = { start: cell, cur: cell };
    if (state.tool === "marks") {
      const home = Core.roomAt(L(), state.layer, cell[0], cell[1]);
      if (!home) {
        status("Draw an area inside a room.", true);
        return;
      }
      sketch.home = home.room;
    } else {
      sketch.start = clampCell(cell, drawBounds());
      sketch.cur = sketch.start;
    }
    state.draw = sketch;
    redrawCanvas();
  }

  function redrawCanvas() {
    draw();
    showCursor();
  }

  function pickRoomColor() {
    const used = new Set(L().rooms.map((r) => r.color));
    return ROOM_COLORS.find((c) => !used.has(c)) || ROOM_COLORS[L().rooms.length % ROOM_COLORS.length];
  }

  function finishDraw() {
    const d = state.draw;
    const drawn = drawBox();
    state.draw = null;
    const layout = L();
    const click = d.start[0] === d.cur[0] && d.start[1] === d.cur[1];
    const tool = state.tool;
    const bounds = activeBox();
    let made = null;
    if (tool === "rooms") {
      const box = fitInto(click ? around(d.start, 9, 9) : drawn, bounds);
      const room = {
        id: Core.uniqueId(layout, "rooms", "room"), floor: state.layer, name: "New room", code: "NR",
        color: pickRoomColor(), ...box, label_at: [(box.x0 + box.x1) >> 1, (box.z0 + box.z1) >> 1],
      };
      change(() => layout.rooms.push(room));
      made = { kind: "rooms", index: layout.rooms.length - 1, what: "room" };
    } else if (tool === "streets") {
      const box = fitInto(click ? around(d.start, 3, 9) : drawn, Core.boundsFor(layout, "streets", { floor: state.layer }));
      const street = { id: Core.uniqueId(layout, "streets", "street"), floor: state.layer, style: "corridor", ...box,
        trench: state.layer === layout.site.crawl.under };
      change(() => layout.streets.push(street));
      made = { kind: "streets", index: layout.streets.length - 1, what: "street" };
    } else if (tool === "doors") {
      let box = click ? autoDoor(d.start[0], d.start[1]) : drawn;
      if (!box) {
        status("Click the wall block between two spaces, or drag along the wall.", true);
        redrawCanvas();
        return;
      }
      box = fitInto(box, bounds);
      const door = { id: doorId(box), floor: state.layer, ...box };
      change(() => layout.doors.push(door));
      made = { kind: "doors", index: layout.doors.length - 1, what: "door" };
    } else if (tool === "stairs") {
      const stair = newStair(d, drawn, click);
      if (!stair) {
        redrawCanvas();
        return;
      }
      change(() => layout.stairs.push(stair));
      made = { kind: "stairs", index: layout.stairs.length - 1, what: "stair" };
    } else if (tool === "marks") {
      const box = fitInto(click ? around(d.start, 5, 5) : drawn, d.home);
      let index;
      change(() => {
        index = Core.addMark(layout, d.home.id, box, "Area");
      });
      made = { kind: "marks", index, what: "area" };
    } else if (tool === "trenches") {
      const box = fitInto(click ? around(d.start, 3, 9) : drawn, bounds);
      const trench = { id: Core.uniqueId(layout, "trenches", "trench"), ...box };
      change(() => layout.trenches.push(trench));
      made = { kind: "trenches", index: layout.trenches.length - 1, what: "trench" };
    }
    if (!made) return;
    replaceSel({ kind: made.kind, index: made.index });
    state.focusFirst = made.kind === "rooms" || made.kind === "marks";
    setTool("select", true);
    refresh();
    status(made.kind === "rooms" || made.kind === "marks"
      ? `Drew a new ${made.what}. Type its name; drag it or its handles to adjust.`
      : `Drew a new ${made.what}. Drag it or its handles to adjust.`);
  }

  /** A short tag for the space at a cell, for ids: a room's code, or a street's id. */
  function spaceTagOn(floor, x, z) {
    const home = Core.roomAt(L(), floor, x, z);
    if (home) return String(home.room.code || home.room.id).toLowerCase();
    const street = L().streets.find((s) => s.floor === floor && x >= s.x0 && x <= s.x1 && z >= s.z0 && z <= s.z1);
    return street ? street.id : "";
  }

  /** Doors are named for the two spaces they join, like sl_farm. */
  function doorIdOn(floor, box) {
    const mx = (box.x0 + box.x1) >> 1;
    const mz = (box.z0 + box.z1) >> 1;
    const northSouth = [spaceTagOn(floor, mx, box.z0 - 1), spaceTagOn(floor, mx, box.z1 + 1)];
    const westEast = [spaceTagOn(floor, box.x0 - 1, mz), spaceTagOn(floor, box.x1 + 1, mz)];
    const across = box.z0 === box.z1 && (box.x0 !== box.x1 || northSouth.every(Boolean));
    const tags = (across ? northSouth : westEast).filter(Boolean);
    return Core.uniqueId(L(), "doors", tags.join("_") || "door");
  }

  function doorId(box) {
    return doorIdOn(state.layer, box);
  }

  /** A door across the wall block at a cell, if there is open floor on both sides of it. */
  function autoDoor(x, z) {
    const walk = Core.walkCells(L(), state.layer);
    const open = (a, b) => walk.has(`${a},${b}`);
    if (open(x, z)) return null;
    if (open(x - 1, z) && open(x + 1, z)) return { x0: x, x1: x, z0: z - 1, z1: z + 1 };
    if (open(x, z - 1) && open(x, z + 1)) return { x0: x - 1, x1: x + 1, z0: z, z1: z };
    return null;
  }

  /** A stair drawn from where you step on. It climbs to the next floor up, or down if this is the top. */
  function newStair(d, drawn, click) {
    const layout = L();
    const floors = layout.floors.slice().sort((a, b) => a.slab - b.slab);
    const i = floors.findIndex((f) => f.id === state.layer);
    const above = floors[i + 1];
    const below = floors[i - 1];
    if (!above && !below) {
      status("A stair joins two floors. Add a floor first.", true);
      return null;
    }
    const up = Boolean(above);
    let box = drawn;
    let from = "n";
    if (click) {
      box = around(d.start, 3, 10);
    } else {
      const dx = d.cur[0] - d.start[0];
      const dz = d.cur[1] - d.start[1];
      from = Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? "w" : "e") : (dz > 0 ? "n" : "s");
    }
    const floorsJoined = up ? [state.layer, above.id] : [below.id, state.layer];
    const shared = Core.boundsFor(layout, "stairs", { floors: floorsJoined });
    if (shared.x0 > shared.x1 || shared.z0 > shared.z1) {
      status("Those floors do not share a footprint.", true);
      return null;
    }
    box = fitInto(box, shared);
    return {
      id: Core.uniqueId(layout, "stairs", `${floorsJoined.join("_")}_stair`),
      floors: floorsJoined,
      low: up ? from : OPPOSITE[from],
      ...box,
    };
  }

  // ---- placing tools ----

  function startPlace(cell) {
    const p = placement(cell);
    if (!p) return;
    if (!p.fits) {
      status(p.home ? "It does not fit there. Turn it with R, or pick a roomier spot." : "Place it inside a room on this floor.", true);
      return;
    }
    if (p.kind === "pads") {
      let index;
      change(() => {
        index = Core.placePad(L(), CATALOG, { key: p.key, x0: p.box.x0, z0: p.box.z0, w: p.w, d: p.d, front: p.front,
          room: p.home.room.id });
      });
      replaceSel({ kind: "pads", index });
      refresh();
      status(`Placed ${(CATALOG.multis[p.key] || {}).name || p.key}.`);
      return;
    }
    const before = snapshot();
    const rows = L().walls.length;
    paintMachineAt(cell);
    const freshId = L().walls.length > rows ? L().walls[L().walls.length - 1].id : null;
    state.drag = { mode: "paint", before, last: cell, freshId, oriented: false };
  }

  function paintMachineAt(cell) {
    const p = placement(cell);
    if (!p || !p.fits || p.kind !== "machines") return;
    const plan = Core.planTier(L());
    const slotTier = Core.TIERS.includes(plan) ? plan : "LV";
    Core.placeMachine(L(), CATALOG, { code: p.code, x: cell[0], z: cell[1], face: p.face, room: p.home.room.id,
      tier: slotTier === "MV" ? undefined : slotTier });
    selectMachineAt(cell[0], cell[1]);
    status(`Placed ${(CATALOG.singles[p.code] || {}).name || p.code}.`);
  }

  /** Cells on a straight run from one cell to another, not counting the first. */
  function cellsBetween(a, b) {
    const n = Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
    const out = [];
    for (let i = 1; i <= n; i += 1) {
      out.push([Math.round(a[0] + ((b[0] - a[0]) * i) / n), Math.round(a[1] + ((b[1] - a[1]) * i) / n)]);
    }
    return out;
  }

  function sideBetween(a, b) {
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    if (Math.abs(dx) + Math.abs(dz) !== 1) return null;
    return dx ? (dx > 0 ? "e" : "w") : dz > 0 ? "s" : "n";
  }

  /** Point a one-machine row along the drag, facing away from the nearer wall. */
  function orientRow(rowId, dir) {
    const wall = L().walls.find((w) => w.id === rowId);
    if (!wall || Core.codesOf(wall).length !== 1) return;
    const room = Core.roomById(L(), wall.room);
    const across = dir === "n" || dir === "s" ? ["e", "w"] : ["s", "n"];
    let face = across.includes(state.front) ? state.front : null;
    if (!face && across[0] === "e") face = wall.x - room.x0 <= room.x1 - wall.x ? "e" : "w";
    if (!face) face = wall.z - room.z0 <= room.z1 - wall.z ? "s" : "n";
    wall.face = face;
    wall.along = dir;
  }

  function turnPlacing() {
    const p = placement();
    const current = (p && p.front) || state.front || "s";
    state.front = Core.TURN[current];
    if (state.tool === "pads") state.swap = !state.swap;
    draw();
    status(`Facing ${SIDE_NAMES[state.front].toLowerCase()}.`);
  }

  function toolAvailable(id) {
    const tool = toolById(id);
    if (id === "select") return true;
    return state.layer === CRAWL ? Boolean(tool.crawl) : !tool.crawl;
  }

  function setTool(id, quiet) {
    if (!toolAvailable(id)) return;
    state.tool = id;
    state.draw = null;
    state.front = null;
    state.swap = false;
    state.search = "";
    if (!quiet) {
      status(toolById(id).hint);
      refresh();
    }
  }

  // ---- keyboard ----

  document.addEventListener("keydown", (event) => {
    if (!state.layout) return;
    const key = event.key.toLowerCase();
    const mod = event.ctrlKey || event.metaKey;
    if (key === "escape" && document.querySelector(".menubar .menu-panel:not([hidden])")
        && !document.querySelector("dialog[open]")) {
      closeMenus();
      return;
    }
    if (mod && key === "s" && !event.altKey) {
      event.preventDefault();
      save();
      return;
    }
    if (state.space) {
      if (key === "escape" && !document.querySelector("dialog[open]")) setSpace(false);
      return;
    }
    const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName) || document.querySelector("dialog[open]");
    if (typing) return;
    const tool = TOOLS.find((t) => t.key === key);
    if (mod && key === "z" && !event.shiftKey) {
      event.preventDefault();
      undo();
    } else if (mod && (key === "y" || (key === "z" && event.shiftKey))) {
      event.preventDefault();
      redo();
    } else if (mod && key === "c") {
      if (textSelected() || event.repeat) return;
      event.preventDefault();
      copy();
    } else if (mod && key === "x") {
      if (textSelected() || event.repeat) return;
      event.preventDefault();
      cut();
    } else if (mod && key === "v") {
      event.preventDefault();
      paste();
    } else if (mod && key === "d") {
      event.preventDefault();
      duplicate();
    } else if (!mod && tool) {
      setTool(tool.id);
    } else if (!mod && key === "v") {
      setTool("select");
    } else if (key === "escape") {
      if (state.draw) {
        state.draw = null;
        redrawCanvas();
      } else if (state.tool !== "select") {
        setTool("select");
      } else {
        state.sel = null;
        refresh();
      }
    } else if (key === "r" && !mod) {
      if (toolById(state.tool).place) turnPlacing();
      else turnSelected();
    } else if (["arrowleft", "arrowright", "arrowup", "arrowdown"].includes(key) && selection().length) {
      event.preventDefault();
      const n = event.shiftKey ? 5 : 1;
      const d = { arrowleft: [-n, 0], arrowright: [n, 0], arrowup: [0, -n], arrowdown: [0, n] }[key];
      nudge(d[0], d[1]);
    } else if ((key === "delete" || key === "backspace") && selection().length) {
      event.preventDefault();
      removeSelected();
    } else if (key === "pageup" || key === "pagedown") {
      event.preventDefault();
      const ids = Core.layers(L()).map((l) => l.id);
      const i = ids.indexOf(state.layer) + (key === "pageup" ? 1 : -1);
      if (i >= 0 && i < ids.length) switchLayer(ids[i]);
    }
  });

  function withoutEntrance(items) {
    const kept = items.filter((item) => !(item.kind === "streets" && item.rec.style === "entry"));
    return { kept, skipped: kept.length !== items.length };
  }

  /** A room already carries what is inside it, and a row carries its machines. */
  function independentItems(items) {
    const roomIds = new Set(items.filter((item) => item.kind === "rooms").map((item) => item.rec.id));
    const walls = items.filter((item) => item.kind === "walls" && !roomIds.has(item.rec.room));
    const wallSet = new Set(walls.map((item) => item.rec));
    const zones = [];
    const machines = [];
    for (const item of items) {
      if (item.kind === "rooms") {
        zones.push(item);
        continue;
      }
      if (item.rec && item.rec.room && roomIds.has(item.rec.room)) continue;
      if (item.kind === "machines") {
        if (wallSet.has(item.rec)) continue;
        machines.push(item);
        continue;
      }
      zones.push(item);
    }
    return { zones, machines };
  }

  function actionItems(items) {
    const split = withoutEntrance(items);
    const plan = independentItems(split.kept);
    return { items: [...plan.zones, ...plan.machines], skipped: split.skipped };
  }

  /** Locked rooms stay where they are. Anything else in the selection still moves. */
  function movePlan(items) {
    const locked = items.some((item) => item.kind === "rooms" && roomLocked(item.rec));
    const open = items.filter((item) => !(item.kind === "rooms" && roomLocked(item.rec)));
    return { ...independentItems(open), locked };
  }

  function boundsForItem(item) {
    if (CONTENTS.has(item.kind)) {
      const room = Core.roomById(L(), item.rec.room);
      const floor = room && Core.floorById(L(), room.floor);
      return floor ? Core.floorBox(L(), floor) : Core.inner(L());
    }
    return Core.boundsFor(L(), item.kind, item.rec);
  }

  function deltaRange(box, bounds) {
    const range = { loX: -Infinity, hiX: Infinity, loZ: -Infinity, hiZ: Infinity };
    if (box.x1 - box.x0 <= bounds.x1 - bounds.x0) {
      range.loX = bounds.x0 - box.x0;
      range.hiX = bounds.x1 - box.x1;
    }
    if (box.z1 - box.z0 <= bounds.z1 - bounds.z0) {
      range.loZ = bounds.z0 - box.z0;
      range.hiZ = bounds.z1 - box.z1;
    }
    return range;
  }

  /** The largest move that keeps every footprint inside its own bounds. */
  function clampGroup(entries, dx, dz) {
    let loX = -Infinity;
    let hiX = Infinity;
    let loZ = -Infinity;
    let hiZ = Infinity;
    for (const entry of entries) {
      const range = deltaRange(entry.box, entry.bounds);
      loX = Math.max(loX, range.loX);
      hiX = Math.min(hiX, range.hiX);
      loZ = Math.max(loZ, range.loZ);
      hiZ = Math.min(hiZ, range.hiZ);
    }
    if (loX > hiX) { loX = 0; hiX = 0; }
    if (loZ > hiZ) { loZ = 0; hiZ = 0; }
    return [Math.max(loX, Math.min(hiX, dx)), Math.max(loZ, Math.min(hiZ, dz))];
  }

  function snapshotMachine(sel) {
    return {
      index: sel.index, slot: sel.slot, x: sel.x, z: sel.z,
      code: sel.code, face: sel.rec.face, tier: Core.tierAt(sel.rec, sel.slot),
    };
  }

  function machineSel(m) {
    return {
      kind: "machines", index: m.index, slot: m.slot, rec: L().walls[m.index],
      code: m.code, x: m.x, z: m.z,
    };
  }

  function machineDelta(drag) {
    if (!drag || !drag.machines || !drag.machines.length) return null;
    if (drag.mode === "machine") return drag.delta || [0, 0];
    return drag.applied || [0, 0];
  }

  function machineGroupProblem(plans) {
    const leaving = new Set(plans.map((p) => `${p.x},${p.z}`));
    const landing = new Set();
    for (const p of plans) {
      const key = `${p.tx},${p.tz}`;
      if (landing.has(key)) return "Those machines would land on the same block.";
      landing.add(key);
      if (!Core.roomAt(L(), state.layer, p.tx, p.tz)) return "Machines go inside a room.";
    }
    for (const m of Core.machinesOn(L(), state.layer)) {
      const key = `${m.x},${m.z}`;
      if (landing.has(key) && !leaving.has(key)) return "A machine is already there.";
    }
    return "";
  }

  function pinsNow() {
    const pins = [];
    for (const ref of selRefs()) {
      const item = resolveRef(ref);
      if (!item) continue;
      if (item.kind === "machines") pins.push({ kind: "machines", x: item.x, z: item.z });
      else pins.push({ kind: item.kind, rec: item.rec });
    }
    return pins;
  }

  function restorePins(pins) {
    const refs = [];
    const seen = new Set();
    for (const pin of pins) {
      if (pin.kind === "machines") {
        const found = Core.machinesOn(L(), state.layer).find((item) => item.x === pin.x && item.z === pin.z);
        if (!found) continue;
        const key = `machines:${found.index}:${found.slot}`;
        if (seen.has(key)) continue;
        seen.add(key);
        refs.push({ kind: "machines", index: found.index, slot: found.slot });
        continue;
      }
      const list = L()[pin.kind];
      const index = list ? list.indexOf(pin.rec) : -1;
      if (index < 0) continue;
      const key = `${pin.kind}:${index}`;
      if (seen.has(key)) continue;
      seen.add(key);
      refs.push({ kind: pin.kind, index });
    }
    setSel(refs);
  }

  /** Move machines by a shared offset. Returns a problem, or "". Selection follows them. */
  function applyMachineDelta(machines, dx, dz) {
    const plans = machines.map((m) => ({ ...m, tx: m.x + dx, tz: m.z + dz }));
    const problem = machineGroupProblem(plans);
    if (problem) return problem;
    const pins = pinsNow();
    for (const pin of pins) {
      if (pin.kind !== "machines") continue;
      const plan = plans.find((p) => p.x === pin.x && p.z === pin.z);
      if (plan) {
        pin.x = plan.tx;
        pin.z = plan.tz;
      }
    }
    const sorted = [...plans].sort((a, b) => b.index - a.index || b.slot - a.slot);
    for (const p of sorted) Core.removeMachine(L(), p.index, p.slot);
    for (const p of plans) {
      const home = Core.roomAt(L(), state.layer, p.tx, p.tz);
      if (!home) continue;
      Core.placeMachine(L(), CATALOG, {
        code: p.code, x: p.tx, z: p.tz, face: p.face, room: home.room.id,
        tier: p.tier === "MV" ? undefined : p.tier,
      });
    }
    restorePins(pins);
    return "";
  }

  function beginMove(cell, items, wasSelected, hits, anchor) {
    const plan = movePlan(items);
    const machines = plan.machines.map(snapshotMachine);
    if (!plan.zones.length && !machines.length) {
      return { mode: "locked", start: cell, moved: false, wasSelected, hits, anchor };
    }
    if (!plan.zones.length) {
      return {
        mode: "machine", before: snapshot(), start: cell, delta: null, moved: false,
        machines, wasSelected, hits, anchor,
      };
    }
    return {
      mode: "move", before: snapshot(), start: cell, applied: [0, 0], moved: false,
      zones: plan.zones.map((item) => ({
        kind: item.kind, rec: item.rec, box: boxOfSel(item), bounds: boundsForItem(item),
      })),
      machines, wasSelected, hits, anchor,
    };
  }

  /** A click that did not move: narrow a group to the item under the pointer, or cycle a stack. */
  function finishClick(drag) {
    if (drag.wasSelected && selRefs().length > 1 && drag.anchor) {
      replaceSel(drag.anchor);
      refresh();
      return;
    }
    if (drag.wasSelected && selRefs().length === 1 && drag.hits && drag.hits.length > 1) {
      const i = drag.hits.findIndex((hit) => same(hit, primaryRef()));
      const next = drag.hits[(i + 1) % drag.hits.length];
      replaceSel(next);
      refresh();
    }
  }

  function deleteItems(items) {
    const layout = L();
    const plan = independentItems(items);
    const roomIds = new Set(plan.zones.filter((item) => item.kind === "rooms").map((item) => item.rec.id));
    const byWall = new Map();
    for (const m of plan.machines) {
      if (!byWall.has(m.rec)) byWall.set(m.rec, []);
      byWall.get(m.rec).push(m.slot);
    }
    for (const [wall, slots] of byWall) {
      const ordered = [...new Set(slots)].sort((a, b) => b - a);
      for (const slot of ordered) {
        const index = layout.walls.indexOf(wall);
        if (index < 0 || slot >= Core.codesOf(wall).length) continue;
        Core.removeMachine(layout, index, slot);
      }
    }
    const rooms = [];
    for (const item of plan.zones) {
      if (item.kind === "rooms") {
        rooms.push(item.rec);
        continue;
      }
      if (item.rec.room && roomIds.has(item.rec.room)) continue;
      const index = layout[item.kind].indexOf(item.rec);
      if (index >= 0) Core.deleteZone(layout, item.kind, index);
    }
    rooms.sort((a, b) => layout.rooms.indexOf(b) - layout.rooms.indexOf(a));
    for (const rec of rooms) {
      const index = layout.rooms.indexOf(rec);
      if (index >= 0) Core.deleteZone(layout, "rooms", index);
    }
  }

  function namesOf(items) {
    const names = items.map(nameOfSel);
    if (names.length <= 3) return names.join(", ");
    return `${names.slice(0, 3).join(", ")}, and ${names.length - 3} more`;
  }

  /** Move a machine to a cell. Dropped on another machine, the two swap places. */
  function dropMachine(sel, x, z) {
    const other = Core.machinesOn(L(), state.layer).find((m) => m.x === x && m.z === z);
    if (other) {
      change(() => Core.swapMachines(L(), sel, other));
      selectMachineAt(x, z);
      refresh();
      status("Swapped the two machines.");
      return;
    }
    let problem = "";
    change(() => {
      problem = Core.moveMachine(L(), CATALOG, sel.index, sel.slot, x, z);
    });
    if (problem) status(problem, true);
    else {
      selectMachineAt(x, z);
      refresh();
    }
  }

  function nudge(dx, dz) {
    const items = selection();
    if (!items.length) return;
    const plan = movePlan(items);
    if (!plan.zones.length && !plan.machines.length) {
      if (plan.locked) status("This room is locked.", true);
      return;
    }
    if (!plan.zones.length && plan.machines.length === 1 && items.length === 1) {
      const m = plan.machines[0];
      dropMachine(m, m.x + dx, m.z + dz);
      return;
    }
    const entries = plan.zones.map((item) => ({ box: boxOfSel(item), bounds: boundsForItem(item) }));
    const [cx, cz] = entries.length ? clampGroup(entries, dx, dz) : [dx, dz];
    if (!cx && !cz) return;
    const machines = plan.machines.map(snapshotMachine);
    if (machines.length) {
      const problem = machineGroupProblem(machines.map((m) => ({ ...m, tx: m.x + cx, tz: m.z + cz })));
      if (problem) {
        status(problem, true);
        return;
      }
    }
    let problem = "";
    change(() => {
      for (const item of plan.zones) Core.moveZone(L(), item.kind, item.rec, cx, cz);
      if (machines.length) problem = applyMachineDelta(machines, cx, cz);
      if (problem) {
        for (const item of plan.zones) Core.moveZone(L(), item.kind, item.rec, -cx, -cz);
        return;
      }
      for (const item of plan.zones) {
        if (CONTENTS.has(item.kind)) Core.rehome(L(), item.kind, item.rec);
      }
    });
    if (problem) status(problem, true);
  }

  function turnSelected() {
    const items = selection();
    if (!items.length) return;
    if (items.length === 1) {
      const sel = items[0];
      if (sel.kind === "machines") {
        const face = Core.TURN[sel.rec.face];
        change(() => Core.turnMachine(L(), CATALOG, sel.index, sel.slot, face));
        selectMachineAt(sel.x, sel.z);
        refresh();
        status(`Turned it to face ${SIDE_NAMES[face].toLowerCase()}.`);
      } else if (sel.kind === "pads") {
        change(() => Core.turnPad(sel.rec));
        status(`Turned it; the controller faces ${SIDE_NAMES[sel.rec.front].toLowerCase()}.`);
      } else if (sel.kind === "walls") {
        const face = Core.TURN[sel.rec.face];
        change(() => {
          sel.rec.face = face;
        });
        status(`The row faces ${SIDE_NAMES[face].toLowerCase()}.`);
      }
      return;
    }
    const wallRecs = new Set(items.filter((item) => item.kind === "walls").map((item) => item.rec));
    const pads = items.filter((item) => item.kind === "pads");
    const walls = items.filter((item) => item.kind === "walls");
    const machines = items.filter((item) => item.kind === "machines" && !wallRecs.has(item.rec))
      .map((item) => ({ x: item.x, z: item.z, face: Core.TURN[item.rec.face] }));
    const count = pads.length + walls.length + machines.length;
    if (!count) return;
    change(() => {
      const pins = pinsNow();
      for (const sel of pads) Core.turnPad(sel.rec);
      for (const sel of walls) sel.rec.face = Core.TURN[sel.rec.face];
      for (const m of machines) {
        const found = Core.machinesOn(L(), state.layer).find((item) => item.x === m.x && item.z === m.z);
        if (found) Core.turnMachine(L(), CATALOG, found.index, found.slot, m.face);
      }
      restorePins(pins);
    });
    status(`Turned ${count}.`);
  }

  function choose(message, okLabel, altLabel) {
    const dialog = $("confirm-dialog");
    $("confirm-text").textContent = message;
    $("confirm-ok").textContent = okLabel || "Continue";
    const alt = $("confirm-alt");
    alt.hidden = !altLabel;
    if (altLabel) alt.textContent = altLabel;
    dialog.returnValue = "";
    dialog.showModal();
    return new Promise((resolve) => {
      dialog.addEventListener("close", () => {
        alt.hidden = true;
        resolve(dialog.returnValue);
      }, { once: true });
    });
  }

  function ask(message, okLabel) {
    return choose(message, okLabel).then((value) => value === "ok");
  }

  async function confirmRemove(items, verb) {
    const list = Array.isArray(items) ? items : [items];
    if (list.length === 1) {
      const sel = list[0];
      let extra = "";
      if (sel.kind === "rooms") {
        const c = Core.contentsOf(L(), sel.rec.id);
        const parts = [plural(c.pads.length, "multiblock"), plural(c.walls.length, "machine row"),
          plural(c.marks.length, "area"), plural(c.shafts.length, "shaft")].filter(Boolean);
        if (parts.length) extra = ` and its ${parts.join(", ")}`;
      }
      return ask(`${verb} ${nameOfSel(sel)}${extra}?`, verb);
    }
    return ask(`${verb} ${namesOf(list)}?`, verb);
  }

  async function removeSelected(opts) {
    if (!selection().length) return;
    const { items, skipped } = actionItems(selection());
    if (!items.length) {
      status("The entrance stays. Move it instead.", true);
      return;
    }
    const verb = (opts && opts.verb) || "Delete";
    if ((!opts || opts.confirm !== false) && !(await confirmRemove(items, verb))) return;
    const names = namesOf(items);
    change(() => deleteItems(items));
    state.sel = null;
    refresh();
    status(`${verb === "Cut" ? "Cut" : "Deleted"} ${names}.${skipped ? " The entrance stays." : ""}`);
  }

  function textSelected() {
    const picked = window.getSelection && window.getSelection();
    return Boolean(picked && picked.toString().trim());
  }

  /** Keep a detached copy of the selection. A cut remembers that the first paste can land back on it. */
  function copy(opts) {
    const quiet = Boolean(opts && opts.quiet);
    const source = (opts && opts.items) || selection();
    const { items, skipped } = actionItems(source);
    if (!items.length) {
      if (!quiet) status(source.length ? "The entrance stays. Copy something else." : "Select something to copy.", true);
      return false;
    }
    const parts = items.map((item) => Core.capture(L(), item.kind, item.index, item.slot));
    state.clip = {
      parts, at: Core.unionBoxes(parts.map((part) => Core.clipBox(part))),
      cut: Boolean(opts && opts.cut), pasted: false,
    };
    renderButtons();
    if (!quiet) status(`Copied ${namesOf(items)}.${skipped ? " The entrance stays." : ""}`);
    return true;
  }

  async function cut() {
    const { items } = actionItems(selection());
    if (!items.length) {
      status(selection().length ? "The entrance stays. Move it instead." : "Select something to cut.", true);
      return;
    }
    if (!(await confirmRemove(items, "Cut"))) return;
    if (!copy({ quiet: true, cut: true })) return;
    removeSelected({ confirm: false, verb: "Cut" });
  }

  /** The floor a paste lands on. Trenches stay in the crawl; stairs and lifts keep the floors they join. */
  function pasteView(data) {
    if (data.kind === "trenches") return { layer: CRAWL, floor: null };
    if (data.kind === "stairs" || data.kind === "lifts") {
      const floors = data.rec.floors;
      return { layer: floors.includes(state.layer) ? state.layer : floors[0], floor: null };
    }
    if (state.layer === CRAWL) return null;
    return { layer: state.layer, floor: state.layer };
  }

  function commonPasteView(parts) {
    let view = null;
    for (const part of parts) {
      const next = pasteView(part);
      if (!next) return null;
      if (!view) view = next;
      else if (view.layer !== next.layer || view.floor !== next.floor) return null;
    }
    return view;
  }

  function paste(opts) {
    const clip = state.clip;
    const parts = clip && clip.parts;
    if (!parts || !parts.length) {
      status("Copy something first.", true);
      return false;
    }
    const view = commonPasteView(parts);
    if (!view) {
      status(parts.length > 1 ? "Those don't paste on this floor together." : "Switch to a floor to paste that.", true);
      return false;
    }
    const spot = Core.pasteGroupSpot(L(), CATALOG, parts, view.floor, Boolean(clip.cut && !clip.pasted));
    if (!spot) {
      status("No room to paste it there.", true);
      return false;
    }
    const pinned = [];
    const machineCells = [];
    change(() => {
      for (const part of parts) {
        const one = Core.pasteClip(L(), CATALOG, part, spot.dx, spot.dz, view.floor);
        if (!one) continue;
        if (one.kind === "rooms") L().rooms[one.index].color = pickRoomColor();
        if (one.kind === "machines") {
          const box = Core.clipBox(part);
          machineCells.push({ x: box.x0 + spot.dx, z: box.z0 + spot.dz });
        } else {
          pinned.push({ kind: one.kind, rec: L()[one.kind][one.index] });
        }
      }
    });
    if (!pinned.length && !machineCells.length) {
      status("Could not paste that.", true);
      return false;
    }
    for (const part of parts) Core.shiftClip(part, spot.dx, spot.dz);
    clip.at = Core.unionBoxes(parts.map((part) => Core.clipBox(part)));
    clip.pasted = true;
    state.draw = null;
    if (state.tool !== "select") setTool("select", true);
    if (view.layer !== state.layer) openLayer(view.layer);
    const refs = [];
    for (const pin of pinned) {
      const index = L()[pin.kind].indexOf(pin.rec);
      if (index >= 0) refs.push({ kind: pin.kind, index });
    }
    for (const cell of machineCells) {
      const found = Core.machinesOn(L(), state.layer).find((item) => item.x === cell.x && item.z === cell.z);
      if (found) refs.push({ kind: "machines", index: found.index, slot: found.slot });
    }
    setSel(refs);
    refresh();
    const fresh = selection();
    status(`${opts && opts.duplicate ? "Duplicated" : "Pasted"} ${fresh.length ? namesOf(fresh) : "it"}.`);
    return true;
  }

  function duplicate() {
    if (!actionItems(selection()).items.length) {
      status(selection().length ? "The entrance stays. Duplicate something else." : "Select something to duplicate.", true);
      return;
    }
    const saved = state.clip;
    if (!copy({ quiet: true })) return;
    paste({ duplicate: true });
    state.clip = saved;
    renderButtons();
  }

  function plural(n, word) {
    return n ? `${n} ${word}${n === 1 ? "" : "s"}` : "";
  }

  // ---- dialogs ----

  function openFloorDialog(mode, preset) {
    const layout = L();
    const crawlEdit = mode === "edit" && state.layer === CRAWL;
    const editing = mode === "edit" && !crawlEdit ? layerFloor() : null;
    const dialog = $("floor-dialog");
    const form = dialog.querySelector("form");
    const field = (name) => form.elements.namedItem(name);
    const crawl = layout.site.crawl;
    $("floor-under-field").hidden = !crawlEdit;
    $("floor-slab-field").hidden = crawlEdit;
    $("floor-gap-field").hidden = !crawlEdit;
    $("floor-pen-field").hidden = crawlEdit;
    field("slab").disabled = crawlEdit;
    field("below").disabled = !crawlEdit;
    field("under").disabled = !crawlEdit;
    field("pen").disabled = crawlEdit;
    field("height").min = "1";
    if (crawlEdit) {
      field("under").innerHTML = "";
      for (const floor of layout.floors) {
        const option = document.createElement("option");
        option.value = floor.id;
        option.textContent = floor.name;
        field("under").append(option);
      }
      field("name").value = crawl.name || "Pipe crawl";
      field("under").value = crawl.under;
      field("below").value = crawl.below;
      field("height").value = crawl.height;
    } else {
      const top = layout.floors.reduce((a, f) => Math.max(a, f.slab + Core.floorHeight(f)), 0);
      field("name").value = editing ? editing.name : "New floor";
      field("slab").value = editing ? editing.slab + 1 : (preset && Number.isInteger(preset.slab) ? preset.slab + 1 : top + 3);
      field("height").value = editing ? Core.floorHeight(editing) : 5;
      field("pen").value = (editing && editing.pen) || "#3C6E8C";
    }
    $("floor-title").textContent = crawlEdit ? `${crawl.name || "Pipe crawl"} settings` : editing ? `${editing.name} settings` : "Add floor";
    $("floor-ok").textContent = editing || crawlEdit ? "Apply" : "Add floor";
    $("floor-delete").hidden = !editing;

    const candidate = () => {
      const y = Number(field("slab").value);
      return {
        id: editing ? editing.id : Core.uniqueId(layout, "floors", field("name").value || "floor"),
        name: field("name").value.trim(),
        slab: y - 1,
        height: Number(field("height").value),
        pen: field("pen").value.toUpperCase(),
      };
    };
    const floorHint = () => {
      const f = candidate();
      if (!Number.isInteger(f.slab) || !Number.isInteger(f.height)) return "";
      const main = Core.mainFloor(layout);
      const where = !main || f.id === "main" || f.id === main.id ? "Inside the site." : `Inside ${main.name}.`;
      return `Air Y ${f.slab + 1}–${f.slab + f.height}. ${where}`;
    };
    const crawlCandidate = () => ({
      name: field("name").value.trim(),
      under: field("under").value,
      below: Number(field("below").value),
      height: Number(field("height").value),
    });
    const crawlAirText = (spec) => {
      const under = layout.floors.find((f) => f.id === spec.under);
      if (!under || !Number.isInteger(spec.below) || !Number.isInteger(spec.height)) return "";
      const top = under.slab - spec.below;
      return `Air Y ${top - spec.height + 1}–${top}.`;
    };
    const problem = () => {
      if (crawlEdit) {
        const spec = crawlCandidate();
        if (!spec.name) return "Give it a name.";
        if (!layout.floors.some((f) => f.id === spec.under)) return "Pick the floor it hangs under.";
        if (!Number.isInteger(spec.below) || spec.below < 1) return "Gap is at least 1.";
        if (!Number.isInteger(spec.height) || spec.height < 1) return "Height is at least 1.";
        const under = layout.floors.find((f) => f.id === spec.under);
        const top = under.slab - spec.below;
        const y0 = top - spec.height + 1;
        if (y0 < 0 || top > 255) return "Y stays from 0 to 255.";
        return "";
      }
      const f = candidate();
      if (!f.name) return "Give the floor a name.";
      if (field("slab").value.trim() === "") return "Y is required.";
      if (!Number.isInteger(f.slab + 1)) return "Y is a whole number.";
      if (f.slab + 1 < 0 || f.slab + f.height > 255) return "Y stays from 0 to 255.";
      if (!Number.isInteger(f.height) || f.height < 1) return "Height is at least 1.";
      if (!editing) {
        const trial = Core.clone(layout);
        return Core.seatFloor(trial, f);
      }
      return "";
    };
    const validate = () => {
      const text = problem();
      const hint = crawlEdit ? crawlAirText(crawlCandidate()) : floorHint();
      $("floor-hint").hidden = !hint;
      $("floor-hint").textContent = hint;
      $("floor-error").textContent = text;
      $("floor-ok").disabled = Boolean(text);
    };
    form.oninput = validate;
    validate();
    $("floor-delete").onclick = async () => {
      const use = Core.floorUse(layout, editing.id);
      const left = Object.entries(use).filter(([, n]) => n).map(([k, n]) => plural(n, k.replace(/s$/, "")));
      if (left.length) {
        $("floor-error").textContent = `Move or delete what is on it first: ${left.join(", ")}.`;
        return;
      }
      if (editing.id === layout.site.crawl.under) {
        $("floor-error").textContent = "The pipe crawl hangs under this floor, so it stays.";
        return;
      }
      if (!(await ask(`Delete ${editing.name}?`, "Delete"))) return;
      dialog.close("cancel");
      change(() => {
        layout.floors = layout.floors.filter((f) => f.id !== editing.id);
        layout.sheets = layout.sheets.filter((s) => s.floor !== editing.id);
      });
      delete state.instances[editing.id];
      openLayer(entranceFloor());
      fixSelection();
      refresh();
      status(`Deleted ${editing.name}.`);
    };
    dialog.returnValue = "";
    dialog.showModal();
    dialog.addEventListener("close", function onClose() {
      dialog.removeEventListener("close", onClose);
      form.oninput = null;
      if (dialog.returnValue !== "ok" || problem()) return;
      if (crawlEdit) {
        const spec = crawlCandidate();
        const oldName = crawl.name;
        change(() => {
          Object.assign(crawl, spec);
          for (const sheet of layout.sheets) {
            if (sheet.floor === CRAWL && sheet.kind === "overview" && sheet.title === oldName) sheet.title = spec.name;
          }
        });
        status(`Updated ${spec.name}.`);
        return;
      }
      const f = candidate();
      if (editing) {
        const oldName = editing.name;
        change(() => {
          Object.assign(editing, { name: f.name, slab: f.slab, height: f.height, pen: f.pen });
          for (const sheet of layout.sheets) {
            if (sheet.floor === editing.id && sheet.kind === "overview" && sheet.title === oldName) sheet.title = f.name;
          }
        });
        status(`Updated ${f.name}.`);
      } else {
        let seated = "";
        change(() => {
          seated = Core.seatFloor(layout, f);
          if (seated) return;
          layout.floors.push(f);
          layout.floors.sort((a, b) => a.slab - b.slab);
          layout.sheets.push({
            id: nextSheetId(layout, f.id), kind: "overview", title: f.name, floor: f.id,
            blurb: `${f.name}, slab Y=${f.slab}.`, notes: [],
          });
        });
        if (seated) {
          status(seated, true);
          return;
        }
        openLayer(f.id);
        state.sel = null;
        fit();
        refresh();
        status(`Added ${f.name}.`);
      }
    });
  }

  function nextSheetId(layout, floorId) {
    const taken = new Set(layout.sheets.map((s) => s.id));
    for (let n = layout.sheets.length + 1; ; n += 1) {
      const id = `${String(n).padStart(2, "0")}-${floorId}`;
      if (!taken.has(id)) return id;
    }
  }

  // ---- panels ----

  function button(text, onClick, cls) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = text;
    if (cls) b.className = cls;
    b.addEventListener("click", onClick);
    return b;
  }

  function tierLabel(tier) {
    return Core.tierLabel(tier);
  }

  function syncTier() {
    const select = $("tier");
    if (!select) return;
    const choices = Core.VOLTAGE;
    if (select.options.length !== choices.length) {
      select.innerHTML = "";
      for (const tier of choices) {
        const option = document.createElement("option");
        option.value = tier;
        option.textContent = tierLabel(tier);
        select.append(option);
      }
    }
    const value = Core.planTier(L());
    if (select.value !== value) select.value = value;
  }

  let panelsKey = "";

  function refresh() {
    if (!state.layout) return;
    syncTier();
    renderStack();
    const panels = `${state.tool}|${state.layer}|${state.search}|${Core.planTier(L())}`;
    if (panels !== panelsKey) {
      panelsKey = panels;
      renderTools();
      renderPicker();
    }
    renderFields();
    renderChecks();
    renderZones();
    renderButtons();
    paintFrame();
    showCursor();
    if (state.focusFirst) {
      state.focusFirst = false;
      const first = $("fields").querySelector("[data-first]");
      if (first) {
        first.focus();
        first.select();
      }
    }
  }

  function showPlanTitle(name) {
    const node = $("plan-title");
    if (!node) return;
    node.textContent = String(name || "").replace(/\.gregmatic$/i, "");
  }

  function renderButtons() {
    $("undo").disabled = !state.undo.length;
    $("redo").disabled = !state.redo.length;
    $("copy").disabled = !actionItems(selection()).items.length;
    $("paste").disabled = !(state.clip && state.clip.parts && state.clip.parts.length);
    const dirty = unsaved();
    $("revert").hidden = !dirty;
    $("file-state").hidden = !dirty;
    document.title = `${dirty ? "• " : ""}Gregmatics`;
  }

  function renderTools() {
    const bar = $("tools");
    bar.innerHTML = "";
    const label = document.createElement("span");
    label.className = "tools-label";
    label.textContent = "Tools";
    bar.append(label);
    for (const tool of TOOLS) {
      if (!toolAvailable(tool.id)) continue;
      const b = button("", () => setTool(tool.id));
      b.innerHTML = TOOL_ICONS[tool.id];
      b.setAttribute("aria-label", tool.label);
      b.setAttribute("aria-pressed", String(state.tool === tool.id));
      bar.append(b);
    }
  }

  function renderPicker() {
    const panel = $("picker");
    const placing = toolById(state.tool).place;
    panel.hidden = !placing;
    if (!placing) return;
    const machines = state.tool === "machines";
    $("picker-title").textContent = machines ? "Machine" : "Multiblock";
    const search = $("picker-search");
    if (search.value !== state.search) search.value = state.search;
    const list = $("picker-list");
    list.innerHTML = "";
    const q = state.search.trim().toLowerCase();
    const groups = L().palette.groups;
    if (machines) {
      if (Core.voltageRank(Core.planTier(L())) < Core.voltageRank("LV")) {
        const li = document.createElement("li");
        li.className = "hint";
        li.textContent = "Electric machines start at Tier 1.";
        list.append(li);
        return;
      }
      const byGroup = {};
      for (const [code, spec] of Object.entries(CATALOG.singles)) {
        if (q && !`${code} ${spec.name}`.toLowerCase().includes(q)) continue;
        (byGroup[spec.group] = byGroup[spec.group] || []).push([code, spec]);
      }
      const picked = CATALOG.singles[state.pick.machines];
      for (const [group, label] of Object.entries(CATALOG.groups)) {
        const rows = byGroup[group];
        if (!rows) continue;
        const open = Boolean(q) || listOpen(`machine:${group}`, Boolean(picked && picked.group === group));
        groupHead(list, label, rows.length, open, () => toggleList(`machine:${group}`, open));
        if (!open) continue;
        for (const [code, spec] of rows) {
          list.append(pickItem(code, spec.name, code, groups[group], ""));
        }
      }
    } else {
      const cap = Core.planTier(L());
      const entries = Object.entries(CATALOG.multis)
        .filter(([, spec]) => Core.multiOpen(spec, cap))
        .sort((a, b) => a[1].name.localeCompare(b[1].name));
      if (state.pick.pads && !entries.some(([key]) => key === state.pick.pads)) state.pick.pads = entries[0] ? entries[0][0] : "";
      const byTier = new Map();
      for (const entry of entries) {
        if (q && !`${entry[0]} ${entry[1].short} ${entry[1].name}`.toLowerCase().includes(q)) continue;
        const tier = entry[1].tier && entry[1].tier !== "-" ? entry[1].tier : "Other";
        if (!byTier.has(tier)) byTier.set(tier, []);
        byTier.get(tier).push(entry);
      }
      const picked = CATALOG.multis[state.pick.pads];
      const pickedTier = picked && picked.tier && picked.tier !== "-" ? picked.tier : "Other";
      const order = [...Core.SELECTABLE, "Other"];
      for (const tier of order) {
        const rows = byTier.get(tier);
        if (!rows) continue;
        const open = Boolean(q) || listOpen(`multi:${tier}`, tier === pickedTier || tier === cap);
        groupHead(list, tierLabel(tier), rows.length, open, () => toggleList(`multi:${tier}`, open));
        if (!open) continue;
        for (const [key, spec] of rows) list.append(pickItem(key, spec.name, spec.short, null, sizeLabel(spec)));
      }
    }
    if (!list.children.length) {
      const li = document.createElement("li");
      li.className = "hint";
      li.textContent = "Nothing matches.";
      list.append(li);
    }
  }

  /** A multiblock's legal sizes, short enough for a list row. A long list of sizes shows its ends. */
  function sizeLabel(spec) {
    const rule = Core.sizeRule(spec);
    if (rule && rule.fits && rule.fits.length > 2) {
      return `${rule.fits[0].join("×")} to ${rule.fits[rule.fits.length - 1].join("×")}`;
    }
    return Core.sizeText(spec);
  }

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
    li.addEventListener("click", () => {
      state.pick[state.tool] = value;
      state.front = null;
      state.swap = false;
      renderPicker();
      draw();
      canvas.focus();
    });
    return li;
  }

  function penStripe(hex) {
    const n = parseInt(String(hex).slice(1), 16);
    if (!Number.isFinite(n)) return hex;
    const r = (n >> 16) & 255;
    const g = (n >> 8) & 255;
    const b = n & 255;
    if (r + g + b >= 180) return hex;
    return `rgb(${Math.min(255, r + 78)}, ${Math.min(255, g + 70)}, ${Math.min(255, b + 60)})`;
  }

  function layerAir(layer) {
    if (layer.crawl) return Core.crawlAir(L());
    return Core.floorAir(layer.floor);
  }

  function editLayer(id) {
    if (state.layer !== id) switchLayer(id);
    openFloorDialog("edit");
  }

  /** The floors and the pipe crawl, highest first, with the rock between them. */
  function renderStack() {
    const body = $("stack-body");
    if (!body) return;
    body.innerHTML = "";
    const bands = Core.layers(L()).slice().reverse();
    if (!bands.length) return;
    body.append(stackGap("above", bands[0], null));
    bands.forEach((layer, i) => {
      body.append(stackBand(layer));
      const lower = bands[i + 1];
      if (!lower) {
        body.append(stackGap("below", layer, null));
        return;
      }
      const upperAir = layerAir(layer);
      const lowerAir = layerAir(lower);
      body.append(stackGap("between", lower, upperAir[0] - lowerAir[1] - 1));
    });
  }

  function stackGap(kind, layer, rock) {
    const row = document.createElement("div");
    row.className = "stack-gap";
    if (rock != null) {
      const label = document.createElement("span");
      label.textContent = `${rock} rock`;
      row.append(label);
    }
    const add = document.createElement("button");
    add.type = "button";
    add.className = "stack-add";
    add.textContent = "+";
    // A new floor is 5 high, with 2 solid blocks between it and the band it sits next to.
    const air = layerAir(layer);
    const below = kind === "below";
    const slab = below ? air[0] - 8 : air[1] + 2;
    const title = `Add a floor ${below ? "below" : "above"} ${layer.name}`;
    add.title = title;
    add.setAttribute("aria-label", title);
    add.addEventListener("click", () => openFloorDialog("add", { slab }));
    row.append(add);
    return row;
  }

  function stackBand(layer) {
    const air = layerAir(layer);
    const on = layer.id === state.layer;
    const box = layer.crawl ? null : Core.floorBox(L(), layer.floor);
    const row = document.createElement("div");
    row.className = `stack-band${on ? " on" : ""}${layer.crawl ? " crawl" : ""}`;
    if (!layer.crawl) row.dataset.floor = layer.id;
    else row.dataset.crawl = layer.id;
    row.tabIndex = 0;
    row.setAttribute("role", "button");
    row.setAttribute("aria-pressed", String(on));
    if (box) {
      row.title = `X ${box.x0}..${box.x1}, Z ${box.z0}..${box.z1}`;
      row.setAttribute("aria-label", `${layer.name}, Y ${air[0]} to ${air[1]}, X ${box.x0} to ${box.x1}, Z ${box.z0} to ${box.z1}`);
    } else {
      row.setAttribute("aria-label", `${layer.name}, Y ${air[0]} to ${air[1]}`);
    }
    const pen = document.createElement("span");
    pen.className = "stack-pen";
    if (!layer.crawl && layer.floor.pen) pen.style.background = penStripe(layer.floor.pen);
    const copy = document.createElement("span");
    copy.className = "stack-copy";
    const name = document.createElement("span");
    name.className = "stack-name";
    name.textContent = layer.name;
    const y = document.createElement("span");
    y.className = "stack-y";
    y.textContent = `Y ${air[0]}–${air[1]}`;
    copy.append(name, y);
    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "band-edit";
    edit.innerHTML = PEN;
    edit.title = `Edit ${layer.name}`;
    edit.setAttribute("aria-label", `Edit ${layer.name}`);
    edit.addEventListener("pointerdown", (event) => event.stopPropagation());
    edit.addEventListener("click", (event) => {
      event.stopPropagation();
      editLayer(layer.id);
    });
    row.append(pen, copy, edit);
    row.addEventListener("dblclick", () => editLayer(layer.id));
    row.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      switchLayer(layer.id);
    });
    row.addEventListener("click", (event) => {
      if (event.target.closest(".band-edit")) return;
      if (state.layer !== layer.id) switchLayer(layer.id);
    });
    return row;
  }

  /** A selection that still names the same records after another floorplan changes. */
  function pinSelection(sel) {
    if (!sel || !sel.length) return null;
    const pins = [];
    for (const ref of sel) {
      const item = resolveRef(ref);
      if (!item) continue;
      if (item.kind === "machines") pins.push({ kind: "machines", wall: item.rec.id, slot: item.slot });
      else if (item.kind === "pads") pins.push({ kind: "pads", num: item.rec.num });
      else if (item.kind === "marks") {
        pins.push({ kind: "marks", room: item.rec.room, x0: item.rec.x0, z0: item.rec.z0, short: item.rec.short || "" });
      } else if (item.rec && item.rec.id) pins.push({ kind: item.kind, id: item.rec.id });
    }
    return pins.length ? pins : null;
  }

  function unpinSelection(pins) {
    if (!pins || !pins.length) return null;
    const refs = [];
    for (const pin of pins) {
      let index = -1;
      if (pin.kind === "machines") index = L().walls.findIndex((wall) => wall.id === pin.wall);
      else if (pin.kind === "pads") index = L().pads.findIndex((pad) => pad.num === pin.num);
      else if (pin.kind === "marks") {
        index = L().marks.findIndex((mark) => mark.room === pin.room && mark.x0 === pin.x0 && mark.z0 === pin.z0
          && (mark.short || "") === pin.short);
      } else {
        const list = L()[pin.kind];
        index = list ? list.findIndex((row) => row.id === pin.id) : -1;
      }
      if (index < 0) continue;
      const ref = { kind: pin.kind, index };
      if (pin.kind === "machines") ref.slot = pin.slot;
      refs.push(ref);
    }
    return refs.length ? refs : null;
  }

  function parkLayer() {
    if (!state.layout || !state.layer) return;
    const box = state.instances[state.layer] || (state.instances[state.layer] = {});
    box.sel = pinSelection(state.sel);
  }

  /** Leave the current floorplan and open another, with its own selection. */
  function openLayer(id) {
    if (state.layer && state.layer !== id) parkLayer();
    state.layer = id;
    const box = state.instances[id];
    state.sel = unpinSelection(box && box.sel);
  }

  function switchLayer(id) {
    if (state.space) setSpace(false);
    if (id !== state.layer) openLayer(id);
    state.draw = null;
    if (!toolAvailable(state.tool)) setTool("select", true);
    fixSelection();
    refresh();
  }

  function listOpen(key, fallback) {
    return key in state.openLists ? state.openLists[key] : fallback;
  }

  function toggleList(key, open) {
    state.openLists[key] = !open;
    // refresh() rebuilds the picker only when the tool, floor, search, or tier changes, so a fold asks for it here.
    renderPicker();
    refresh();
  }

  function groupHead(list, label, count, open, onToggle) {
    const li = document.createElement("li");
    li.className = "head fold";
    const name = document.createElement("span");
    name.textContent = `${open ? "▾" : "▸"} ${label}`;
    const n = document.createElement("span");
    n.className = "size";
    n.textContent = String(count);
    li.append(name, n);
    li.addEventListener("click", (event) => {
      event.stopPropagation();
      onToggle();
    });
    list.append(li);
  }

  function renderZones() {
    const list = $("zones");
    list.innerHTML = "";
    $("zones-title").textContent = Core.layerName(L(), state.layer);
    const items = Core.zonesOn(L(), state.layer);
    const byKind = new Map();
    for (const item of items) {
      if (!byKind.has(item.kind)) byKind.set(item.kind, []);
      byKind.get(item.kind).push(item);
    }
    const primary = primaryRef();
    const selKey = primary ? `${primary.kind}:${primary.index}:${primary.slot ?? ""}` : "";
    if (primary && primary.kind !== "rooms" && selKey !== state.shownSel) {
      state.openLists[`zone:${primary.kind}`] = true;
    }
    let selectedRow = null;
    for (const [kind, rows] of byKind) {
      const open = listOpen(`zone:${kind}`, false);
      groupHead(list, Core.KIND_PLURALS[kind], rows.length, open, () => toggleList(`zone:${kind}`, open));
      if (!open) continue;
      for (const item of rows) {
        const b = Core.boxOf(item.kind, item.z);
        const li = document.createElement("li");
        const name = document.createElement("span");
        name.textContent = Core.nameOf(item.kind, item.z, CATALOG);
        const size = document.createElement("span");
        size.className = "size";
        size.textContent = item.kind === "lifts" ? `${b.x0}, ${b.z0}` : `${b.x1 - b.x0 + 1}×${b.z1 - b.z0 + 1}`;
        li.append(name, size);
        const ref = { kind: item.kind, index: item.index };
        if (selRefs().some((picked) => same(picked, ref))) {
          li.className = "selected";
          if (primary && same(primary, ref)) selectedRow = li;
        }
        li.addEventListener("click", (event) => selectAndShow(ref, event.ctrlKey || event.metaKey));
        list.append(li);
      }
    }
    if (selectedRow && selKey !== state.shownSel) {
      state.shownSel = selKey;
      selectedRow.scrollIntoView({ block: "nearest" });
    }
  }

  function selectAndShow(sel, additive) {
    if (additive) toggleSel(sel);
    else replaceSel(sel);
    const focus = selection().find((item) => same(item, sel)) || selection()[selection().length - 1];
    if (focus) centerOn(boxOfSel(focus));
    refresh();
  }

  function runChecks() {
    state.checks = Core.check(L(), CATALOG);
  }

  function renderChecks() {
    const list = $("checks");
    list.innerHTML = "";
    const checks = state.checks;
    $("check-count").textContent = checks.length ? String(checks.length) : "";
    if (!checks.length) {
      const li = document.createElement("li");
      li.className = "ok";
      li.textContent = "None";
      list.append(li);
      return;
    }
    for (const c of checks.filter((x) => !x.layer || x.layer === state.layer)) list.append(checkItem(c, ""));
    for (const c of checks.filter((x) => x.layer && x.layer !== state.layer)) {
      list.append(checkItem(c, `${Core.layerName(L(), c.layer)}: `));
    }
  }

  function checkItem(c, prefix) {
    const li = document.createElement("li");
    li.textContent = prefix + c.text;
    if (prefix) li.className = "other";
    li.addEventListener("click", () => {
      if (c.layer && c.layer !== state.layer) openLayer(c.layer);
      if (c.kind) {
        replaceSel({ kind: c.kind, index: c.index, slot: c.slot });
        const s = selected();
        if (s) centerOn(boxOfSel(s));
      }
      fixSelection();
      refresh();
    });
    return li;
  }

  function renderFields() {
    const form = $("fields");
    form.innerHTML = "";
    const items = selection();
    const F = formBuilder(form);
    if (!items.length) {
      $("sel-title").textContent = "Nothing selected";
      F.note("Click something on the plan to edit it here.");
      return;
    }
    if (items.length > 1) {
      $("sel-title").textContent = `${items.length} selected`;
      F.note(namesOf(items));
      F.note("Click one to edit it.");
      F.actions([button("Delete", removeSelected, "danger")]);
      return;
    }
    const sel = items[0];
    const { kind, rec } = sel;
    const layout = L();
    $("sel-title").textContent = `${Core.KIND_NAMES[kind]}: ${nameOfSel(sel)}`;
    const edit = (fn) => change(fn);
    const box = boxOfSel(sel);

    if (kind === "machines") {
      F.choose("Machine", sel.code, machineOptions(), (code) => edit(() => {
        const codes = Core.codesOf(rec);
        codes[sel.slot] = code;
        Core.setCodes(rec, codes);
      }));
      F.sides("Faces", rec.face, (face) => {
        change(() => Core.turnMachine(layout, CATALOG, sel.index, sel.slot, face));
        selectMachineAt(sel.x, sel.z);
        refresh();
      });
      const open = Core.TIERS.filter((t) => Core.voltageRank(t) <= Core.voltageRank(Core.planTier(L())));
      F.toggle("Tier", Core.tierAt(rec, sel.slot), open.map((t) => [t, t, tierLabel(t)]), (tier) => edit(() => {
        Core.setTier(rec, sel.slot, tier);
      }));
      F.pair("X, Z", [sel.x, sel.z], ([x, z]) => dropMachine(sel, x, z));
      const n = Core.codesOf(rec).length;
      F.note(`Slot ${sel.slot + 1} of ${n} in row ${rec.id}${rec.title ? `, ${rec.title}` : ""}.`);
      F.actions([
        button("Select row", () => {
          replaceSel({ kind: "walls", index: sel.index });
          refresh();
        }),
        button("Delete", removeSelected, "danger"),
      ]);
      return;
    }

    if (!["walls", "marks", "pads"].includes(kind)) {
      F.text("ID", rec.id, (value) => {
        let problem = "";
        change(() => {
          problem = Core.rename(layout, kind, rec, value.trim());
        });
        if (problem) status(`Could not rename: ${problem}`, true);
      });
    }
    if (kind === "rooms") {
      F.text("Name", rec.name, (value) => edit(() => { rec.name = value.trim() || rec.name; }), { first: true });
      F.check("Lock", Boolean(rec.locked), (value) => edit(() => {
        if (value) rec.locked = true;
        else delete rec.locked;
      }));
      F.text("Code", rec.code, (value) => edit(() => { rec.code = value.trim().toUpperCase() || rec.code; }));
      F.color("Color", rec.color, (value) => edit(() => { rec.color = value.toUpperCase(); }));
      F.choose("Floor", rec.floor, floorOptions(), (value) => edit(() => { rec.floor = value; }));
      const floor = Core.floorById(layout, rec.floor);
      F.number("Height", rec.height || "", (value) => edit(() => {
        if (!value || value === Core.floorHeight(floor)) delete rec.height;
        else rec.height = Math.max(2, value);
      }), { placeholder: `${Core.floorHeight(floor)} (floor)`, min: 2 });
      F.check("Clean", Boolean(rec.clean), (value) => edit(() => {
        if (value) rec.clean = true;
        else delete rec.clean;
      }), "This room needs to stay free of pollution.");
    }
    if (kind === "streets") {
      F.text("Label", rec.label || "", (value) => edit(() => {
        if (value.trim()) {
          rec.label = value.trim().toUpperCase();
          if (!rec.label_at) rec.label_at = [rec.x0 + 1, (rec.z0 + rec.z1) >> 1];
        } else {
          delete rec.label;
          delete rec.label_at;
          delete rec.label_vertical;
        }
      }));
      F.check("Vertical label", Boolean(rec.label_vertical), (value) => edit(() => {
        if (value) rec.label_vertical = true;
        else delete rec.label_vertical;
      }));
      if (rec.floor === layout.site.crawl.under) {
        F.check("Trench under", rec.trench !== false, (value) => edit(() => { rec.trench = value; }));
      }
      if (rec.style !== "entry") F.choose("Floor", rec.floor, floorOptions(), (value) => edit(() => { rec.floor = value; }));
    }
    if (kind === "doors") F.choose("Floor", rec.floor, floorOptions(), (value) => edit(() => { rec.floor = value; }));
    if (kind === "stairs") {
      F.choose("Bottom", rec.floors[0], floorOptions(), (value) => edit(() => { rec.floors = orderFloors([value, rec.floors[1]]); }));
      F.choose("Top", rec.floors[1], floorOptions(), (value) => edit(() => { rec.floors = orderFloors([rec.floors[0], value]); }));
      F.sides("Bottom end", rec.low, (value) => edit(() => { rec.low = value; }));
    }
    if (kind === "shafts") {
      F.text("Label", rec.label || "", (value) => edit(() => { rec.label = value.trim(); }));
      F.choose("Top", rec.cap || "", [["glass", "Glass"], ["", "Open"]], (value) => edit(() => {
        if (value) rec.cap = value;
        else delete rec.cap;
      }));
    }
    if (kind === "lifts") {
      F.text("Label", rec.label || "", (value) => edit(() => { rec.label = value.trim(); }));
      F.checks("Stops", layout.floors.slice().sort((a, b) => b.slab - a.slab).map((f) => [f.id, f.name, rec.floors.includes(f.id)]),
        (id, on) => edit(() => {
          const stops = new Set(rec.floors);
          if (on) stops.add(id);
          else stops.delete(id);
          rec.floors = orderFloors([...stops]);
        }));
    }
    if (kind === "marks") {
      F.text("Label", rec.short || "", (value) => edit(() => {
        const text = value.trim();
        if (text) {
          if (!rec.label || rec.label === rec.short) rec.label = text;
          rec.short = text;
        } else delete rec.short;
      }), { first: true });
      F.text("Note", rec.label || "", (value) => edit(() => { rec.label = value.trim(); }));
      F.choose("Shape", rec.shape || "box", [["box", "Box"], ["circle", "Circle"], ["service", "Service"],
        ["text", "Name"], ["well", "Well"]], (value) => edit(() => {
        if (value === "box") delete rec.shape;
        else rec.shape = value;
        if (value === "circle") rec.radius = Core.circleRadius(rec);
        else delete rec.radius;
        if (value !== "text") delete rec.vertical;
      }));
      if (rec.shape === "text") {
        F.check("Vertical", Boolean(rec.vertical), (value) => edit(() => {
          if (value) rec.vertical = true;
          else delete rec.vertical;
        }));
      }
      F.check("Detail only", Boolean(rec.detail), (value) => edit(() => {
        if (value) rec.detail = true;
        else delete rec.detail;
      }));
      F.note(`In ${(Core.roomById(layout, rec.room) || { name: rec.room }).name}.`);
    }
    if (kind === "pads") {
      const spec = CATALOG.multis[rec.key] || { name: rec.key, size: [0, 0, 0] };
      F.choose("Multiblock", rec.key, padOptions(), (value) => edit(() => Core.retypePad(rec, CATALOG, value)));
      const facing = F.sides("Controller", rec.front, (value) => edit(() => Core.setPadFront(rec, value)));
      const turn = button("Turn", turnSelected, "aside");
      turn.title = "Turn it a quarter clockwise (R)";
      facing.append(turn);
      if (spec.share) {
        const counts = Core.moduleCounts(rec);
        F.number("Across", counts.across, (value) => edit(() => Core.setModules(rec, value, Core.moduleCounts(rec).ranks)),
          { hint: "Adds one beside it, sharing a wall. Dragging a handle does the same." });
        F.number("Ranks", counts.ranks, (value) => edit(() => Core.setModules(rec, Core.moduleCounts(rec).across, value)),
          { hint: "A rank sits behind the first and faces the other way." });
      }
      for (const field of Core.sizeFields(rec, spec)) {
        const set = (value) => edit(() => Core.setPadSize(rec, layout, spec, field.key, value));
        if (field.choices) {
          const values = field.choices.includes(field.value) ? field.choices : [field.value, ...field.choices];
          F.choose(SIZE_LABELS[field.key], String(field.value), values.map((n) => [String(n), String(n)]), set);
        } else {
          F.number(SIZE_LABELS[field.key], field.value, set, {
            placeholder: `${field.range[0]}–${field.range[1]}`, min: field.range[0], max: field.range[1], step: field.odd ? 2 : 1,
          });
        }
      }
      F.text("Label", rec.label || "", (value) => edit(() => {
        if (value.trim()) rec.label = value.trim();
        else delete rec.label;
      }));
      const problem = Core.padSizeProblem(rec, spec);
      if (problem) {
        F.warn(`${problem}.`);
        F.actions([button("Fit to size", () => edit(() => Core.fitPad(rec, layout, spec)))]);
      }
      const [mw, md] = Core.moduleSize(rec);
      const count = (rec.wx || 1) * (rec.wz || 1);
      const size = `${mw}×${md}×${rec.h || spec.size[2]}`;
      const where = (Core.roomById(layout, rec.room) || { name: rec.room }).name;
      F.note(count > 1 ? `${size} each, ${box.x1 - box.x0 + 1}×${box.z1 - box.z0 + 1} in all, in ${where}.` : `${size} in ${where}.`);
      if (spec.note) F.note(spec.note);
    }
    if (kind === "walls") {
      F.text("Title", rec.title || "", (value) => edit(() => {
        if (value.trim()) rec.title = value.trim();
        else delete rec.title;
      }), { first: false });
      F.text("Machines", rec.codes, (value) => {
        const codes = value.trim().toUpperCase().split(/\s+/).filter(Boolean);
        const bad = codes.find((c) => c !== "-" && !CATALOG.singles[c]);
        if (!codes.length || bad) {
          status(bad ? `${bad} is not a machine code.` : "A row needs at least one machine.", true);
          refresh();
          return;
        }
        edit(() => Core.setCodes(rec, codes));
      });
      F.sides("Faces", rec.face, (value) => edit(() => { rec.face = value; }));
      F.sides("Runs", rec.along, (value) => edit(() => { rec.along = value; }));
    }

    const positionLocked = kind === "rooms" && roomLocked(rec);
    if (kind === "lifts") {
      F.pair("X, Z", [box.x0, box.z0], ([x, z]) => edit(() => Core.moveZone(layout, kind, rec, x - box.x0, z - box.z0)));
    } else {
      const corner = F.pair("Corner", [box.x0, box.z0], ([x, z]) => edit(() => {
        Core.moveZone(layout, kind, rec, x - box.x0, z - box.z0);
        if (CONTENTS.has(kind)) Core.rehome(layout, kind, rec);
      }));
      const edges = [];
      if (RESIZABLE.has(kind)) {
        edges.push(F.pair("X0, X1", [box.x0, box.x1], ([a, c]) => edit(() => Core.setBox(kind, rec, { ...Core.boxOf(kind, rec), x0: a, x1: c }))));
        edges.push(F.pair("Z0, Z1", [box.z0, box.z1], ([a, c]) => edit(() => Core.setBox(kind, rec, { ...Core.boxOf(kind, rec), z0: a, z1: c }))));
      }
      if (positionLocked) [corner, ...edges].forEach(freezeControl);
    }
    if (kind === "rooms") renderContents(F, rec);
    F.actions([button("Delete", removeSelected, "danger")]);
  }

  /** The room's multiblocks, machine rows, and areas, each one click from being selected. */
  function renderContents(F, room) {
    const layout = L();
    const groups = [
      ["Multiblocks", "pads", layout.pads],
      ["Rows", "walls", layout.walls],
      ["Areas", "marks", layout.marks],
    ];
    const blocks = [];
    let total = 0;
    for (const [label, kind, list] of groups) {
      const items = [];
      list.forEach((rec, index) => {
        if (rec.room === room.id) items.push({ text: Core.nameOf(kind, rec, CATALOG), onClick: () => selectAndShow({ kind, index }) });
      });
      if (items.length) {
        blocks.push([label, items]);
        total += items.length;
      }
    }
    if (!total) return;
    const box = document.createElement("details");
    box.className = "inside wide";
    const summary = document.createElement("summary");
    summary.textContent = `Inside ${total}`;
    box.append(summary);
    for (const [label, items] of blocks) {
      const head = document.createElement("div");
      head.className = "hint";
      head.textContent = label;
      box.append(head);
      const wrap = document.createElement("div");
      wrap.className = "links";
      for (const item of items) wrap.append(button(item.text, item.onClick, "link-button"));
      box.append(wrap);
    }
    F.form.append(box);
  }

  function machineOptions() {
    const out = [];
    for (const [group, label] of Object.entries(CATALOG.groups)) {
      const options = Object.entries(CATALOG.singles).filter(([, s]) => s.group === group).map(([code, s]) => [code, `${code} ${s.name}`]);
      if (options.length) out.push({ group: label, options });
    }
    return out;
  }

  function padOptions() {
    return Object.entries(CATALOG.multis).sort((a, b) => a[1].name.localeCompare(b[1].name))
      .map(([key, spec]) => [key, `${spec.name} (${sizeLabel(spec)})`]);
  }

  function floorOptions() {
    return L().floors.slice().sort((a, b) => b.slab - a.slab).map((f) => [f.id, f.name]);
  }

  function orderFloors(ids) {
    const unique = [...new Set(ids)];
    return unique.sort((a, b) => Core.floorById(L(), a).slab - Core.floorById(L(), b).slab);
  }

  function freezeControl(control) {
    if (!control) return;
    if (control.disabled !== undefined) control.disabled = true;
    control.querySelectorAll("input, select, button").forEach((el) => { el.disabled = true; });
  }

  function formBuilder(form) {
    const row = (labelText, control, hint) => {
      const label = document.createElement("span");
      label.className = "field-label";
      label.textContent = labelText;
      if (hint) {
        const mark = document.createElement("button");
        mark.type = "button";
        mark.className = "help";
        mark.textContent = "?";
        mark.title = hint;
        label.append(mark);
      }
      form.append(label, control);
      return control;
    };
    return {
      form,
      note(text) {
        const p = document.createElement("p");
        p.className = "hint wide";
        p.textContent = text;
        form.append(p);
      },
      warn(text) {
        const p = document.createElement("p");
        p.className = "error wide";
        p.textContent = text;
        form.append(p);
      },
      text(labelText, value, onCommit, opts = {}) {
        const input = document.createElement("input");
        input.type = "text";
        input.value = value;
        if (opts.first) input.dataset.first = "1";
        input.addEventListener("change", () => onCommit(input.value));
        return row(labelText, input);
      },
      number(labelText, value, onCommit, opts = {}) {
        const input = document.createElement("input");
        input.type = "number";
        input.value = value;
        for (const key of ["placeholder", "min", "max", "step"]) if (opts[key] != null) input[key] = opts[key];
        input.addEventListener("change", () => onCommit(input.value === "" ? 0 : Math.round(Number(input.value))));
        return row(labelText, input, opts.hint);
      },
      pair(labelText, values, onCommit) {
        const wrap = document.createElement("div");
        wrap.className = "pair";
        const inputs = values.map((v) => {
          const input = document.createElement("input");
          input.type = "number";
          input.value = v;
          input.addEventListener("change", () => {
            const nums = inputs.map((i) => Math.round(Number(i.value)));
            if (nums.every(Number.isFinite)) onCommit(nums);
          });
          wrap.append(input);
          return input;
        });
        return row(labelText, wrap);
      },
      color(labelText, value, onCommit) {
        const input = document.createElement("input");
        input.type = "color";
        input.value = value;
        input.addEventListener("change", () => onCommit(input.value));
        return row(labelText, input);
      },
      check(labelText, value, onCommit, hint) {
        const input = document.createElement("input");
        input.type = "checkbox";
        input.checked = value;
        input.addEventListener("change", () => onCommit(input.checked));
        const wrap = document.createElement("div");
        wrap.append(input);
        return row(labelText, wrap, hint);
      },
      checks(labelText, items, onToggle) {
        const wrap = document.createElement("div");
        for (const [id, text, on] of items) {
          const l = document.createElement("label");
          const box = document.createElement("input");
          box.type = "checkbox";
          box.checked = on;
          box.addEventListener("change", () => onToggle(id, box.checked));
          l.append(box, ` ${text}`);
          wrap.append(l);
        }
        return row(labelText, wrap);
      },
      choose(labelText, value, options, onCommit) {
        const select = document.createElement("select");
        for (const opt of options) {
          if (opt.group) {
            const group = document.createElement("optgroup");
            group.label = opt.group;
            for (const [v, t] of opt.options) group.append(new Option(t, v));
            select.append(group);
          } else {
            select.append(new Option(opt[1], opt[0]));
          }
        }
        select.value = value;
        select.addEventListener("change", () => onCommit(select.value));
        return row(labelText, select);
      },
      /** One button per option: [id, text], and a longer name for the tooltip when the text is short. */
      toggle(labelText, value, options, onCommit) {
        const wrap = document.createElement("div");
        wrap.className = "sides";
        for (const [id, text, full] of options) {
          const b = button(text, () => onCommit(id));
          if (full) {
            b.title = full;
            b.setAttribute("aria-label", full);
          }
          b.setAttribute("aria-pressed", String(id === value));
          wrap.append(b);
        }
        return row(labelText, wrap);
      },
      sides(labelText, value, onCommit) {
        const wrap = document.createElement("div");
        wrap.className = "sides";
        for (const side of ["n", "e", "s", "w"]) {
          const b = button(side.toUpperCase(), () => onCommit(side));
          b.setAttribute("aria-label", SIDE_NAMES[side]);
          b.setAttribute("aria-pressed", String(side === value));
          wrap.append(b);
        }
        return row(labelText, wrap);
      },
      actions(buttons) {
        const wrap = document.createElement("div");
        wrap.className = "actions";
        wrap.append(...buttons);
        form.append(wrap);
      },
    };
  }

  // ---- status ----

  function status(message, isError) {
    const el = $("status");
    el.textContent = message;
    el.classList.toggle("error", Boolean(isError));
  }

  function showCursor() {
    const el = $("cursor");
    if (state.space) return;
    if (!state.hover || !state.layout) {
      el.textContent = "";
      return;
    }
    const [x, z] = state.hover;
    let text = `X ${x} · Z ${z} · chunk ${Core.chunkName(L(), x, z)}`;
    if (state.draw) {
      const b = drawBox();
      text += ` · ${b.x1 - b.x0 + 1} × ${b.z1 - b.z0 + 1}`;
    } else {
      const hit = hitsAt(x, z)[0];
      if (hit) {
        const rec = L()[hit.kind === "machines" ? "walls" : hit.kind][hit.index];
        const name = hit.kind === "machines"
          ? (CATALOG.singles[Core.codesOf(rec)[hit.slot]] || { name: "" }).name
          : Core.nameOf(hit.kind, rec, CATALOG);
        text += ` · ${name}`;
      }
    }
    el.textContent = text;
  }

  // ---- export ----

  function exportPng() {
    const layout = L();
    const s = layout.site.sheet;
    const scale = 8;
    const left = 70;
    const top = 90;
    const width = (s.x1 - s.x0 + 1) * scale + left + 30;
    const height = (s.z1 - s.z0 + 1) * scale + top + 30;
    const out = document.createElement("canvas");
    out.width = width;
    out.height = height;
    const g = out.getContext("2d");
    paint(g, { scale, ox: left, oy: top, width, height }, false);
    const floor = layerFloor();
    g.fillStyle = "#f3e6d4";
    g.font = "bold 22px Segoe UI, sans-serif";
    g.textAlign = "left";
    g.textBaseline = "top";
    g.fillText(Core.layerName(layout, state.layer), 16, 12);
    if (floor) {
      g.font = "13px Segoe UI, sans-serif";
      g.fillStyle = "#c2b09a";
      g.fillText(`Y ${floor.slab + 2}`, 16, 40);
    }
    out.toBlob((blob) => {
      download(`${state.layer}.png`, blob);
      status("Downloaded.");
    });
  }

  // ---- wiring ----

  $("menu-save").addEventListener("click", () => save());
  $("plan-folder-change").addEventListener("click", changeFolder);

  function paintPlanFile() {
    const input = $("plan-name");
    const preview = $("plan-file");
    if (!input || !preview) return;
    const name = input.value.trim();
    preview.textContent = name ? previewFileName(name, true) : "";
  }

  function syncPlanName() {
    const input = $("plan-name");
    if (!input || !L()) return;
    input.value = (L().site && L().site.name) || fileStem(state.planFile);
    paintPlanFile();
  }

  async function applyPlanName(raw) {
    const name = String(raw || "").trim();
    if (!name || !L()) return false;
    const filename = previewFileName(name, true);
    if ((L().site.name || "") !== name) change(() => { L().site.name = name; });
    showPlanTitle(name);
    const api = desktopApi();
    if (!api) {
      state.planFile = filename;
      paintPlanFile();
      return true;
    }
    if (unsaved()) await save({ auto: true });
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
    await refreshPlanFiles();
    paintPlanFile();
    return true;
  }

  $("settings").addEventListener("click", async () => {
    syncTier();
    refreshFolder();
    mountSettingsBounds();
    $("autosave").checked = state.autosave;
    await refreshPlanFiles();
    syncPlanName();
    $("settings-dialog").showModal();
  });
  $("plan-name").addEventListener("input", paintPlanFile);

  async function applyAutosave(on) {
    state.autosave = on;
    localStorage.setItem(AUTOSAVE_KEY, on ? "on" : "off");
    if (!on) {
      clearTimeout(saveTimer);
      saveTimer = 0;
    } else scheduleSave();
    const api = desktopApi();
    if (!api) return "";
    const reply = await api.set_autosave(on);
    if (reply && reply.ok) return "";
    state.autosave = !on;
    $("autosave").checked = !on;
    localStorage.setItem(AUTOSAVE_KEY, state.autosave ? "on" : "off");
    return (reply && reply.error) || "Could not store that setting.";
  }

  function settingsDirty() {
    if (!L()) return false;
    const name = $("plan-name").value.trim();
    const currentName = (L().site && L().site.name) || fileStem(state.planFile);
    if (name !== currentName) return true;
    if ($("tier").value !== Core.planTier(L())) return true;
    if ($("autosave").checked !== state.autosave) return true;
    const floor = Core.mainFloor(L());
    if (!floor || !settingsBounds) return false;
    const next = settingsBounds.read();
    if (![next.x0, next.x1, next.z0, next.z1].every((n) => Number.isInteger(n))) return true;
    const box = Core.floorBox(L(), floor);
    return next.x0 !== box.x0 || next.x1 !== box.x1 || next.z0 !== box.z0 || next.z1 !== box.z1;
  }

  async function commitSettings() {
    const error = $("settings-bounds-error");
    const name = $("plan-name").value.trim();
    if (!name) {
      error.textContent = "Give the plan a name.";
      return false;
    }
    const floor = Core.mainFloor(L());
    const next = settingsBounds ? settingsBounds.read() : null;
    const problem = boundsProblem(floor, next || {});
    if (problem) {
      error.textContent = problem;
      return false;
    }
    const tier = $("tier").value;
    const currentTier = Core.planTier(L());
    let flagged = 0;
    if (tier !== currentTier) {
      const lowering = Core.voltageRank(tier) < Core.voltageRank(currentTier);
      flagged = lowering ? Core.overTier(L(), CATALOG, tier).length : 0;
      const label = tierLabel(tier);
      const message = lowering
        ? `Lower the tier to ${label}? Nothing is removed.${flagged ? ` ${flagged} will be flagged.` : ""}`
        : `Raise the tier to ${label}?`;
      if (!(await ask(message, lowering ? "Lower tier" : "Raise tier"))) return false;
    }
    const box = { x0: next.x0, x1: next.x1, z0: next.z0, z1: next.z1 };
    const currentBox = Core.floorBox(L(), floor);
    const boxChanged = box.x0 !== currentBox.x0 || box.x1 !== currentBox.x1 || box.z0 !== currentBox.z0 || box.z1 !== currentBox.z1;
    const tierChanged = tier !== currentTier;
    if (boxChanged || tierChanged) {
      change(() => {
        if (boxChanged) Core.writeSpan(L(), floor, box);
        if (tierChanged) L().site.tier = tier;
      });
    }
    if ($("autosave").checked !== state.autosave) {
      const failed = await applyAutosave($("autosave").checked);
      if (failed) {
        error.textContent = failed;
        return false;
      }
    }
    const currentName = (L().site && L().site.name) || fileStem(state.planFile);
    if (name !== currentName && !(await applyPlanName(name))) return false;
    error.textContent = "";
    status(flagged ? `Settings saved. ${flagged} flagged.` : "Settings saved.");
    $("settings-dialog").close();
    return true;
  }

  async function closeSettings() {
    if (!settingsDirty()) {
      $("settings-dialog").close();
      return;
    }
    const choice = await choose("Save these settings before closing?", "Save", "Exit");
    if (choice === "ok") await commitSettings();
    else if (choice === "alt") $("settings-dialog").close();
  }

  $("settings-dialog").addEventListener("cancel", (event) => {
    if (!settingsDirty()) return;
    event.preventDefault();
    closeSettings();
  });
  $("settings-dialog").querySelector("form").addEventListener("submit", (event) => {
    event.preventDefault();
    if (event.submitter && event.submitter.id === "settings-save") commitSettings();
    else closeSettings();
  });
  $("new").addEventListener("click", newPlan);
  $("load").addEventListener("click", loadPlan);
  document.querySelectorAll(".menubar .menu-label").forEach((label) => {
    label.addEventListener("click", (event) => {
      event.stopPropagation();
      const menu = label.closest(".menu");
      const opening = menu.querySelector(".menu-panel").hidden;
      openMenu(opening ? menu.dataset.menu : "");
    });
  });
  document.querySelector(".menubar").addEventListener("click", (event) => {
    if (event.target.closest(".menu-panel button")) closeMenus();
  });
  document.addEventListener("pointerdown", (event) => {
    if (event.target.closest(".menubar")) return;
    closeMenus();
  });
  $("file-input").addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (file) loadText(await file.text(), file.name);
    event.target.value = "";
  });
  $("revert").addEventListener("click", async () => {
    if (!unsaved()) return;
    if (!(await ask("Drop unsaved edits?", "Revert"))) return;
    // Back to the text last written, which is not the page's first copy once this window has saved or loaded.
    load(JSON.parse(state.savedText), "Reverted.", state.savedText);
    saveDraft();
  });
  $("undo").addEventListener("click", undo);
  $("redo").addEventListener("click", redo);
  $("copy").addEventListener("click", copy);
  $("paste").addEventListener("click", paste);
  $("png").addEventListener("click", exportPng);
  $("view-3d").addEventListener("click", () => setSpace(!state.space));
  $("picker-search").addEventListener("input", (event) => {
    state.search = event.target.value;
    renderPicker();
  });
  $("show-others").addEventListener("change", (event) => {
    state.show.others = event.target.checked;
    draw();
  });
  $("show-contents").addEventListener("change", (event) => {
    state.show.contents = event.target.checked;
    if (!state.show.contents && state.sel) {
      const kept = selRefs().filter((ref) => !CONTENTS.has(ref.kind));
      state.sel = kept.length ? kept : null;
    }
    refresh();
  });
  window.addEventListener("beforeunload", () => {
    saveDraft();
    if (state.autosave && unsaved()) save({ auto: true });
  });
  new ResizeObserver(() => {
    resize();
    if (state.fitted) fit();
    paintFrame();
  }).observe($("view"));

  boot();
})();
