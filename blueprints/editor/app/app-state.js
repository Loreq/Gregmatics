/* What every editor script shares: the loaded data, the editor's state, and a few small helpers.
   The scripts are grouped in folders: core/ for the data rules, view3d/ for the 3D view, and app/
   for the page, split again by subject. Each app file fills one name on App, such as App.Sel or
   App.Paint. Inside a file a plain call is to that file or to a helper from here; a call through a
   name, such as Panels.refresh(), goes to another file. The names are made here, empty, so the files
   can refer to each other whatever order they load in. core/core.js holds the data rules and never
   touches the page. data.js holds the plan and catalog. desktop.py reads and writes the open
   .gregmatic file. */
(function () {
  "use strict";

  const Core = window.Core;
  const BASE = window.BASE;
  const CATALOG = (BASE && BASE.catalog) || { multis: {}, singles: {}, groups: {} };
  const CRAWL = Core.CRAWL;

  // Where the browser keeps the draft, the autosave switch, and a draft the file has moved on from.
  const DRAFT_KEY = "gregmatics:draft";
  const AUTOSAVE_KEY = "gregmatics:autosave";
  const STALE_KEY = "gregmatics:stale";

  // Colors the editor draws with. The plan's own colors come from its palette and its rooms.
  const COLORS = {
    INK: "#1B2430",
    MUTED: "#566270",
    PAPER: "#F4F1EA",
    WALL: "#282C32",
    RUST: "#AC4E32",
    MARK: "#5C544A",
    GOOD: "#3F7A4D",
  };
  const ROOM_COLORS = ["#E6DAC0", "#D2E6F4", "#D0E8CE", "#EADEEE", "#F2D6BE", "#F6E4A4", "#E0D6F0", "#C0E4DE",
    "#F0CECE", "#DEE2EE"];
  // Kinds whose box is free to drag. A multiblock's box follows its catalog size; see Hit.padDrag.
  const RESIZABLE = new Set(["rooms", "streets", "doors", "stairs", "shafts", "trenches", "marks"]);
  // Kinds that stand in a room. A machine is one slot of a machine row.
  const CONTENTS = new Set(["marks", "pads", "walls", "machines"]);
  const SIDE_NAMES = { n: "North", e: "East", s: "South", w: "West" };

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

  // ---- the plan ----

  /** The plan being edited. */
  function L() {
    return state.layout;
  }

  /** The floor that holds the entrance, or the first floor when the plan has no entrance. */
  function entranceFloor() {
    const entry = L().streets.find((s) => s.style === "entry");
    return entry ? entry.floor : L().floors[0].id;
  }

  /** The floor being shown, or null while the pipe crawl is. */
  function layerFloor() {
    return Core.floorById(L(), state.layer);
  }

  /** Whether a room is locked in place. */
  function roomLocked(rec) {
    return Boolean(rec && rec.locked);
  }

  /** The plan as the text a save would write. */
  function snapshot() {
    return Core.dumps(L());
  }

  /** Whether the plan differs from the file. */
  function unsaved() {
    return Boolean(state.layout) && snapshot() !== state.savedText;
  }

  // ---- the page ----

  /** Show a message in the status bar, in red when it is an error. */
  function status(message, isError) {
    const el = $("status");
    el.textContent = message;
    el.classList.toggle("error", Boolean(isError));
  }

  /** A new element, with a class and with text when they are given. */
  function make(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
  }

  /** A button that runs a function when pressed. */
  function button(text, onClick, cls) {
    const b = make("button", cls, text);
    b.type = "button";
    b.addEventListener("click", onClick);
    return b;
  }

  /** A count with its noun, such as "2 areas", or "" for none. */
  function plural(n, word) {
    return n ? `${n} ${word}${n === 1 ? "" : "s"}` : "";
  }

  // ---- boxes ----

  /** The box of one cell. */
  function cellBox(x, z) {
    return { x0: x, x1: x, z0: z, z1: z };
  }

  /** Whether a box lies wholly inside another. */
  function insideBox(outer, box) {
    return box.x0 >= outer.x0 && box.x1 <= outer.x1 && box.z0 >= outer.z0 && box.z1 <= outer.z1;
  }

  /** A cell pulled inside some bounds. */
  function clampCell(cell, bounds) {
    return [Math.min(Math.max(cell[0], bounds.x0), bounds.x1), Math.min(Math.max(cell[1], bounds.z0), bounds.z1)];
  }

  /** A box of a given width and depth with a cell at its middle. */
  function around(cell, w, d) {
    const x0 = cell[0] - ((w - 1) >> 1);
    const z0 = cell[1] - ((d - 1) >> 1);
    return { x0, x1: x0 + w - 1, z0, z1: z0 + d - 1 };
  }

  /** A box slid inside some bounds, and trimmed where it is too big for them. */
  function fitInto(box, bounds) {
    const [dx, dz] = Core.clampDelta(box, 0, 0, bounds);
    const out = { x0: box.x0 + dx, x1: box.x1 + dx, z0: box.z0 + dz, z1: box.z1 + dz };
    return {
      x0: Math.max(out.x0, bounds.x0), x1: Math.min(out.x1, bounds.x1),
      z0: Math.max(out.z0, bounds.z0), z1: Math.min(out.z1, bounds.z1),
    };
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

  /** Show the program's version in Settings. */
  function showVersion() {
    const label = $("app-version");
    if (label && BASE && BASE.app) label.textContent = `Gregmatics v${BASE.app}`;
  }

  showVersion();

  window.App = {
    Core, BASE, CATALOG, CRAWL, DRAFT_KEY, AUTOSAVE_KEY, STALE_KEY, COLORS, ROOM_COLORS, RESIZABLE, CONTENTS, SIDE_NAMES,
    $, canvas, ctx, state,
    L, entranceFloor, layerFloor, roomLocked, snapshot, unsaved,
    status, make, button, plural,
    cellBox, insideBox, clampCell, around, fitInto, pulledBox,
    // One name per file, filled in by that file.
    Sel: {}, History: {}, Files: {}, NewPlan: {}, Save: {}, View: {}, Space: {},
    Paint: {}, PaintZones: {}, PaintContents: {}, Overlay: {},
    Tools: {}, Hit: {}, Draw: {}, Place: {}, Edit: {}, Machines: {}, Clip: {}, Pointer: {}, Keys: {},
    Dialogs: {}, FloorDialog: {}, Bounds: {}, Settings: {},
    Panels: {}, Lists: {}, Picker: {}, Stack: {}, Form: {}, Fields: {},
  };
})();
