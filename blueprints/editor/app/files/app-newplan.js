/* File → New: ask for a name and the first floor's footprint, then start an empty plan on the
   same site. In the desktop window the new plan is a new .gregmatic file beside the open one. */
(function (App) {
  "use strict";

  const { Core, CATALOG, $, state, L, unsaved, status, History, Files, Save, Bounds, Panels } = App;

  const FIRST_FLOOR = { id: "main", name: "Floor", pen: "#282C32" };
  const NEW_TIER = "Stone";
  // The air a first floor gets when the open plan has no floor to copy: Y 69 through 73.
  const DEFAULT_Y = 69;
  const FLOOR_HEIGHT = 5;
  // A new plan's bounds: 256 blocks on a side, from 0 through 255. Sixteen chunks.
  const DEFAULT_SIDE = 256;
  const STARTER_COLUMNS = "ABCDEFGHIJKLMNOP";
  const STARTER_GROUND = 80;
  const STARTER_COLORS = {
    rock: "#E4DED4", corridor: "#DCE7F2", entry: "#E8C48E", door: "#FFFDF8",
    trench: "#E8D6AA", stair: "#F6ECD6", well: "#D6EAF4",
  };
  const GROUP_COLORS = {
    ore: "#B08056", form: "#6284B2", chem: "#509662", elec: "#8A68BE", power: "#CE9628",
    store: "#808892", farm: "#6E9E46", util: "#6E707C", space: "#4088B0",
  };
  const GROUP_FALLBACK = "#808892";

  // ---- an empty plan ----

  /** The first floor of a new plan: at the level of the open plan's main floor, in its pen. */
  function firstFloor(layout) {
    const current = (layout.floors || []).find((floor) => floor.id === "main") || (layout.floors || [])[0];
    const y0 = current ? current.slab + 1 : DEFAULT_Y;
    return {
      id: FIRST_FLOOR.id,
      name: FIRST_FLOOR.name,
      slab: y0 - 1,
      height: FLOOR_HEIGHT,
      pen: (current && current.pen) || FIRST_FLOOR.pen,
    };
  }

  /** The site and palette a first plan starts from, when no plan is open to copy. */
  function starter() {
    const groups = {};
    Object.keys(CATALOG.groups || {}).forEach((id) => {
      groups[id] = GROUP_COLORS[id] || GROUP_FALLBACK;
    });
    const row = [];
    for (let i = 0; i < STARTER_COLUMNS.length; i += 1) row.push(STARTER_GROUND);
    const terrain = [];
    for (let i = 0; i < STARTER_COLUMNS.length; i += 1) terrain.push(row.slice());
    const edge = DEFAULT_SIDE - 1;
    return {
      site: {
        square: { x0: 0, x1: edge, z0: 0, z1: edge },
        sheet: { x0: 0, x1: edge, z0: 0, z1: edge },
        rim: 1,
        columns: STARTER_COLUMNS,
        dirty: [],
        cover: 5,
        tier: NEW_TIER,
        terrain,
      },
      palette: { ...STARTER_COLORS, groups },
      floors: [{ id: FIRST_FLOOR.id, name: FIRST_FLOOR.name, slab: DEFAULT_Y - 1, height: FLOOR_HEIGHT, pen: FIRST_FLOOR.pen }],
      rooms: [], streets: [], doors: [], stairs: [], shafts: [], lifts: [],
      trenches: [], pads: [], walls: [], marks: [],
      callouts: [], cuts: [], sheets: [],
    };
  }

  /** The same site and palette as a plan, with one empty floor. `box` is that floor's footprint. */
  function blankPlan(layout, name, box) {
    const site = Core.clone(layout.site);
    const palette = Core.clone(layout.palette);
    const floor = firstFloor(layout);
    if (name) site.name = name;
    site.tier = NEW_TIER;
    Core.placeSite(site, box);
    const plan = {
      site,
      palette,
      floors: [floor],
      rooms: [], streets: [], doors: [], stairs: [], shafts: [], lifts: [],
      trenches: [], pads: [], walls: [], marks: [],
      callouts: [], cuts: [],
      sheets: [{
        id: "01-main", kind: "overview", title: floor.name, floor: floor.id,
        blurb: `${floor.name}, slab Y=${floor.slab}.`, notes: [],
      }],
    };
    delete site.crawl;
    return plan;
  }

  // ---- making it the open plan ----

  /** Start a new plan under a name. The desktop window writes its file and hands it back as read from disk. */
  async function createPlanFile(name, layoutObject) {
    const text = Core.dumps(layoutObject);
    const api = Files.desktopApi();
    if (unsaved()) await Save.save({ auto: true });
    if (!api) {
      Panels.setIdle(false);
      state.planFile = Files.previewFileName(name, false);
      if (!state.planFiles.includes(state.planFile)) state.planFiles.push(state.planFile);
      History.load(layoutObject, `Created ${name}.`, text);
      Panels.showPlanTitle(name);
      History.saveDraft();
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
    Files.showOpened(layout, `Created ${(layout.site && layout.site.name) || name}.`, name, reply.current || "");
  }

  // ---- the dialog ----

  /** What the footprint picture starts from: a 256 by 256 square at the origin. */
  function startingSpec() {
    const edge = DEFAULT_SIDE - 1;
    const box = { x0: 0, x1: edge, z0: 0, z1: edge };
    return { limit: box, box: { ...box } };
  }

  /** Show the file name the typed plan name would get. */
  function paintFile() {
    const name = $("new-name").value.trim();
    $("new-file").textContent = name ? Files.previewFileName(name, false) : "";
  }

  /** Create was pressed: check the name and the footprint, then make the plan. */
  function submit(layout, editor) {
    const error = $("new-error");
    const name = $("new-name").value.trim();
    if (!name) {
      error.textContent = "Give the plan a name.";
      return;
    }
    const next = editor.read();
    const box = { x0: next.x0, x1: next.x1, z0: next.z0, z1: next.z1 };
    const problem = Bounds.worldProblem(next) || Core.siteProblem(layout.site, box);
    if (problem) {
      error.textContent = problem;
      return;
    }
    $("new-dialog").close();
    createPlanFile(name, blankPlan(layout, name, box));
  }

  /** Open the dialog, empty, with the footprint picture at 256 by 256. */
  async function openDialog() {
    const dialog = $("new-dialog");
    if (dialog.open) return;
    try {
      await Files.refreshPlanFiles();
      const layout = L() || starter();
      const error = $("new-error");
      error.textContent = "";
      $("new-name").value = "";
      $("new-name").oninput = paintFile;
      paintFile();
      const editor = Bounds.mount($("new-bounds"), { ...startingSpec(), onCommit: () => { error.textContent = ""; } });
      $("new-form").onsubmit = (event) => {
        event.preventDefault();
        submit(layout, editor);
      };
      $("new-close").onclick = () => dialog.close();
      dialog.showModal();
      $("new-name").focus();
    } catch (err) {
      status(err && err.message ? err.message : "Could not open New.", true);
    }
  }

  /** File → New. */
  function start() {
    Panels.closeMenus();
    openDialog();
  }

  Object.assign(App.NewPlan, { start });
})(window.App);
