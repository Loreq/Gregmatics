/* File → New: ask for a name and the first floor's footprint, then start an empty plan on the
   same site. In the desktop window the new plan is a new .gregmatic file beside the open one. */
(function (App) {
  "use strict";

  const { Core, $, state, L, unsaved, status, History, Files, Save, Bounds, Panels } = App;

  const FIRST_FLOOR = { id: "main", name: "Floor 1", pen: "#282C32" };
  // The air a first floor gets when the open plan has no floor to copy: Y 69 through 73.
  const DEFAULT_Y = 69;
  const FLOOR_HEIGHT = 5;
  // What a crawl is given where the open plan's does not say.
  const CRAWL = { name: "Pipe crawl", below: 4, height: 3 };
  const MIN_CRAWL = 2;

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

  /** A pipe crawl under the first floor, as deep and as tall as the open plan's. */
  function crawlUnder(crawl) {
    return {
      name: crawl.name || CRAWL.name,
      under: FIRST_FLOOR.id,
      below: Math.max(MIN_CRAWL, crawl.below || CRAWL.below),
      height: Math.max(MIN_CRAWL, crawl.height || CRAWL.height),
    };
  }

  /** The same site and palette as a plan, with one empty floor. `box` is that floor's footprint. */
  function blankPlan(layout, name, box) {
    const site = Core.clone(layout.site);
    const palette = Core.clone(layout.palette);
    const floor = firstFloor(layout);
    if (name) site.name = name;
    if (box && !Core.sameBox(box, Core.inner({ site }))) Object.assign(floor, box);
    site.crawl = crawlUnder(site.crawl || {});
    return {
      site,
      palette,
      floors: [floor],
      rooms: [], streets: [], doors: [], stairs: [], shafts: [], lifts: [],
      trenches: [], pads: [], walls: [], marks: [],
      callouts: [], cuts: [],
      sheets: [{
        id: "01-main", kind: "overview", title: floor.name, floor: FIRST_FLOOR.id,
        blurb: `${floor.name}, slab Y=${floor.slab}.`, notes: [],
      }],
    };
  }

  // ---- making it the open plan ----

  /** Start a new plan under a name. The desktop window writes its file and hands it back as read from disk. */
  async function createPlanFile(name, layoutObject) {
    const text = Core.dumps(layoutObject);
    const api = Files.desktopApi();
    if (unsaved()) await Save.save({ auto: true });
    if (!api) {
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

  /** What the footprint picture starts from: everything the open plan's main floor may cover. */
  function startingSpec(layout) {
    const floor = Core.mainFloor(layout) || layout.floors[0];
    const limit = floor ? Bounds.floorSpec(floor).limit : Core.inner(layout);
    return { limit, box: { ...limit } };
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
    const probe = blankPlan(layout, name, { x0: next.x0, x1: next.x1, z0: next.z0, z1: next.z1 });
    const made = probe.floors[0];
    const problem = Bounds.worldProblem(next) || Core.spanProblem(probe, made, Core.floorBox(probe, made));
    if (problem) {
      error.textContent = problem;
      return;
    }
    $("new-dialog").close();
    createPlanFile(name, probe);
  }

  /** Open the dialog, empty, with the footprint picture showing the whole site. */
  async function openDialog() {
    await Files.refreshPlanFiles();
    const layout = L();
    const dialog = $("new-dialog");
    const error = $("new-error");
    error.textContent = "";
    $("new-name").value = "";
    $("new-name").oninput = paintFile;
    paintFile();
    const editor = Bounds.mount($("new-bounds"), { ...startingSpec(layout), onCommit: () => { error.textContent = ""; } });
    $("new-form").onsubmit = (event) => {
      event.preventDefault();
      submit(layout, editor);
    };
    $("new-close").onclick = () => dialog.close();
    dialog.showModal();
    $("new-name").focus();
  }

  /** File → New. */
  function start() {
    Panels.closeMenus();
    openDialog();
  }

  Object.assign(App.NewPlan, { start });
})(window.App);
