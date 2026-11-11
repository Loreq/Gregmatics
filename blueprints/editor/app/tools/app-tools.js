/* The tools. Each has a number key and an icon. A draw tool drags out a box; a place tool takes its
   item from the catalog picker. app-draw.js and app-place.js say what each one makes. */
(function (App) {
  "use strict";

  const { Core, state, status, Panels } = App;

  /** An icon as SVG markup, from the paths inside it. */
  function icon(body) {
    return `<svg viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;
  }

  const PEN_ICON = icon('<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>');
  const ICONS = {
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

  // `draw` tools drag out a box and `place` tools put down a catalog item. `crawl` tools work on the pipe crawl only.
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

  /** The tool with this id. An id that names none is the Select tool. */
  function byId(id) {
    return TOOLS.find((t) => t.id === id) || TOOLS[0];
  }

  /** The tool in hand. */
  function current() {
    return byId(state.tool);
  }

  /** The tool a key picks, or undefined. */
  function byKey(key) {
    return TOOLS.find((t) => t.key === key);
  }

  /** Whether a tool works on the layer being shown. The crawl takes Select and the trench tool only. */
  function available(id) {
    const tool = byId(id);
    if (id === "select") return true;
    return Core.isCrawlLayer(state.layout, state.layer) ? Boolean(tool.crawl) : !tool.crawl;
  }

  /** Pick up a tool. Anything half done with the last one is dropped. `quiet` leaves the status bar and panels alone. */
  function set(id, quiet) {
    if (!available(id)) return;
    state.tool = id;
    state.draw = null;
    state.front = null;
    state.swap = false;
    state.search = "";
    if (quiet) return;
    status(byId(id).hint);
    Panels.refresh();
  }

  Object.assign(App.Tools, { TOOLS, ICONS, PEN_ICON, byId, current, byKey, available, set });
})(window.App);
