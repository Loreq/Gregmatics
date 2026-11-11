/* The dialog that adds a floor, edits one, or edits the pipe crawl. A session holds what one
   opening of it is about: { layout, crawl, crawlEdit, editing, dialog, form }. `editing` is the
   floor being edited, and null when adding a floor or editing the crawl. */
(function (App) {
  "use strict";

  const {
    Core, $, state, L, entranceFloor, layerFloor, status, plural,
    Sel, History, View, Dialogs, Stack, Panels,
  } = App;

  const NEW_FLOOR = { name: "Floor", height: 5, pen: "#3C6E8C" };
  const NEW_CRAWL = { name: "Crawlspace", height: 3 };
  const WORLD_TOP = 255;
  // Solid blocks left between the top floor and a floor added with no place asked for.
  const ROCK_ABOVE = 3;

  /** One input of the dialog's form, by name. */
  function field(session, name) {
    return session.form.elements.namedItem(name);
  }

  // ---- filling the form ----

  /** Show the inputs a floor has, or the ones the crawl has. */
  function showFields(session) {
    const { crawlEdit, editing, layout } = session;
    const adding = !crawlEdit && !editing && layout.floors.length >= 1;
    $("floor-under-field").hidden = !crawlEdit;
    $("floor-slab-field").hidden = crawlEdit;
    $("floor-gap-field").hidden = !crawlEdit;
    $("floor-pen-field").hidden = crawlEdit;
    $("floor-crawl-field").hidden = !adding;
    field(session, "slab").disabled = crawlEdit;
    field(session, "below").disabled = !crawlEdit;
    field(session, "under").disabled = !crawlEdit;
    field(session, "pen").disabled = crawlEdit;
    field(session, "crawlspace").disabled = !adding;
    field(session, "height").min = "1";
  }

  /** Fill the form with the crawl: its name, the floor it hangs under, the gap, and its height. */
  function fillCrawl(session) {
    const { layout, crawl } = session;
    const under = field(session, "under");
    under.innerHTML = "";
    for (const floor of layout.floors) {
      const option = document.createElement("option");
      option.value = floor.id;
      option.textContent = Core.floorName(floor);
      under.append(option);
    }
    field(session, "name").value = Core.crawlName(crawl);
    under.value = crawl.under;
    field(session, "below").value = crawl.below;
    field(session, "height").value = crawl.height;
  }

  /** The Y a new floor is offered: where the + that was pressed points, else clear above the top floor. */
  function offeredY(layout, preset) {
    if (preset && Number.isInteger(preset.slab)) return preset.slab + 1;
    return layout.floors.reduce((a, f) => Math.max(a, f.slab + Core.floorHeight(f)), 0) + ROCK_ABOVE;
  }

  /** Fill the form with the floor being edited, or with a new floor. */
  function fillFloor(session, preset) {
    const { layout, editing } = session;
    field(session, "name").value = editing ? Core.floorName(editing) : NEW_FLOOR.name;
    field(session, "slab").value = editing ? editing.slab + 1 : offeredY(layout, preset);
    field(session, "height").value = editing ? Core.floorHeight(editing) : NEW_FLOOR.height;
    field(session, "pen").value = (editing && editing.pen) || NEW_FLOOR.pen;
    const crawlspace = field(session, "crawlspace");
    if (crawlspace) crawlspace.checked = false;
  }

  /** Whether Add floor is being used to add a crawlspace instead. */
  function addingCrawl(session) {
    const box = field(session, "crawlspace");
    return Boolean(box && !box.disabled && box.checked && !session.editing && !session.crawlEdit);
  }

  /** The floor just above a crawl whose air ends at `top`, or null. */
  function floorAbove(layout, top) {
    return layout.floors.filter((floor) => floor.slab > top).sort((a, b) => a.slab - b.slab)[0] || null;
  }

  /** The crawlspace the add form describes, hanging under the floor above its air, or null. */
  function addedCrawl(session) {
    const airLow = Number(field(session, "slab").value);
    const height = Number(field(session, "height").value);
    if (!Number.isInteger(airLow) || !Number.isInteger(height)) return null;
    const under = floorAbove(session.layout, airLow + height - 1);
    if (!under) return null;
    const crawl = Core.newCrawl(session.layout, under);
    crawl.name = field(session, "name").value.trim();
    crawl.height = height;
    crawl.below = under.slab - (airLow + height - 1);
    return crawl;
  }

  /** Switch the add dialog between a floor and a crawlspace. Defaults follow the switch once. */
  function syncCrawlToggle(session) {
    const on = addingCrawl(session);
    const pen = $("floor-pen-field");
    pen.hidden = on || session.crawlEdit;
    field(session, "pen").disabled = on || session.crawlEdit;
    if (session.editing || session.crawlEdit || on === session.asCrawl) return;
    session.asCrawl = on;
    const name = field(session, "name");
    const height = field(session, "height");
    if (on) {
      if (!name.value.trim() || name.value.trim() === NEW_FLOOR.name) name.value = NEW_CRAWL.name;
      if (Number(height.value) === NEW_FLOOR.height) height.value = String(NEW_CRAWL.height);
    } else {
      if (!name.value.trim() || name.value.trim() === NEW_CRAWL.name) name.value = NEW_FLOOR.name;
      if (Number(height.value) === NEW_CRAWL.height) height.value = String(NEW_FLOOR.height);
    }
  }

  /** Word the dialog for what it is doing. */
  function showTitles(session) {
    const { crawl, crawlEdit, editing } = session;
    const crawlAdd = addingCrawl(session);
    $("floor-title").textContent = crawlEdit ? `${Core.crawlName(crawl)} settings` : editing ? `${Core.floorName(editing)} settings` : crawlAdd ? "Add crawlspace" : "Add floor";
    $("floor-ok").textContent = editing || crawlEdit ? "Apply" : crawlAdd ? "Add crawlspace" : "Add floor";
    const remove = $("floor-delete");
    remove.hidden = !editing && !crawlEdit;
    remove.textContent = crawlEdit ? "Delete crawlspace" : "Delete floor";
  }

  // ---- reading the form ----

  /** The floor the form describes. A floor with no id is given one; the name stays a label. */
  function candidate(session) {
    const { layout, editing } = session;
    const name = field(session, "name").value;
    return {
      id: editing && editing.id ? editing.id : Core.uniqueId(layout, "floors", "floor"),
      name: name.trim(),
      slab: Number(field(session, "slab").value) - 1,
      height: Number(field(session, "height").value),
      pen: field(session, "pen").value.toUpperCase(),
    };
  }

  /** The crawl the form describes. */
  function crawlCandidate(session) {
    return {
      name: field(session, "name").value.trim(),
      under: field(session, "under").value,
      below: Number(field(session, "below").value),
      height: Number(field(session, "height").value),
    };
  }

  // ---- checking the form ----

  /** A line saying where the floor's air would be and what it has to fit inside, or "" until the numbers are whole. */
  function floorHint(session) {
    if (addingCrawl(session)) {
      const crawl = addedCrawl(session);
      if (!crawl) return "";
      const under = session.layout.floors.find((floor) => floor.id === crawl.under);
      const top = under.slab - crawl.below;
      return `Air Y ${top - crawl.height + 1}–${top}. Under ${Core.floorName(under)}.`;
    }
    const f = candidate(session);
    if (!Number.isInteger(f.slab) || !Number.isInteger(f.height)) return "";
    const main = Core.mainFloor(session.layout);
    const where = !main || f.id === "main" || f.id === main.id ? "Inside the site." : `Inside ${Core.floorName(main)}.`;
    return `Air Y ${f.slab + 1}–${f.slab + f.height}. ${where}`;
  }

  /** A line saying where the crawl's air would be, or "" until it can be worked out. */
  function crawlHint(session) {
    const spec = crawlCandidate(session);
    const under = session.layout.floors.find((f) => f.id === spec.under);
    if (!under || !Number.isInteger(spec.below) || !Number.isInteger(spec.height)) return "";
    const top = under.slab - spec.below;
    return `Air Y ${top - spec.height + 1}–${top}.`;
  }

  /** What is wrong with the crawl the form describes, or "". */
  function crawlProblem(session) {
    const spec = crawlCandidate(session);
    const under = session.layout.floors.find((f) => f.id === spec.under);
    if (!spec.name) return "Give it a name.";
    if (!under) return "Pick the floor it hangs under.";
    if (!Number.isInteger(spec.below) || spec.below < 1) return "Gap is at least 1.";
    if (!Number.isInteger(spec.height) || spec.height < 1) return "Height is at least 1.";
    const top = under.slab - spec.below;
    if (top - spec.height + 1 < 0 || top > WORLD_TOP) return "Y stays from 0 to 255.";
    const layout = Core.clone(session.layout);
    const current = Core.crawlRecords(layout).find((crawl) => Core.crawlLayerId(crawl) === Core.crawlLayerId(session.crawl));
    if (current) Object.assign(current, { name: spec.name, under: spec.under, below: spec.below, height: spec.height });
    return Core.bandProblem(layout, layout.floors);
  }

  /** What is wrong with the floor the form describes, or "". A new floor must also find a seat in the stack. */
  function floorProblem(session) {
    const f = candidate(session);
    if (!f.name) return "Give the floor a name.";
    if (field(session, "slab").value.trim() === "") return "Y is required.";
    if (!Number.isInteger(f.slab + 1)) return "Y is a whole number.";
    if (f.slab + 1 < 0 || f.slab + f.height > WORLD_TOP) return "Y stays from 0 to 255.";
    if (!Number.isInteger(f.height) || f.height < 1) return "Height is at least 1.";
    if (session.editing) return "";
    return Core.seatFloor(Core.clone(session.layout), f);
  }

  /** What is wrong with adding a crawlspace here, or "". It hangs under the floor above its air. */
  function addCrawlProblem(session) {
    if (!field(session, "name").value.trim()) return "Give it a name.";
    if (field(session, "slab").value.trim() === "") return "Y is required.";
    const airLow = Number(field(session, "slab").value);
    const height = Number(field(session, "height").value);
    if (!Number.isInteger(airLow)) return "Y is a whole number.";
    if (!Number.isInteger(height) || height < 1) return "Height is at least 1.";
    const top = airLow + height - 1;
    if (airLow < 0 || top > WORLD_TOP) return "Y stays from 0 to 255.";
    if (!floorAbove(session.layout, top)) return "A crawlspace hangs under the floor above it.";
    const crawl = addedCrawl(session);
    return Core.bandProblem(Core.clone(session.layout), session.layout.floors, crawl);
  }

  /** What is wrong with the form, or "". */
  function problem(session) {
    if (session.crawlEdit) return crawlProblem(session);
    if (addingCrawl(session)) return addCrawlProblem(session);
    return floorProblem(session);
  }

  /** Show the hint and the problem for what is typed, and let OK be pressed only when there is no problem. */
  function validate(session) {
    syncCrawlToggle(session);
    showTitles(session);
    const text = problem(session);
    const hint = session.crawlEdit ? crawlHint(session) : floorHint(session);
    $("floor-hint").hidden = !hint;
    $("floor-hint").textContent = hint;
    $("floor-error").textContent = text;
    $("floor-ok").disabled = Boolean(text);
  }

  // ---- applying it ----

  /** An id for a floor's overview sheet that no sheet has: its number in the list, then the floor. */
  function nextSheetId(layout, floorId) {
    const taken = new Set(layout.sheets.map((s) => s.id));
    for (let n = layout.sheets.length + 1; ; n += 1) {
      const id = `${String(n).padStart(2, "0")}-${floorId}`;
      if (!taken.has(id)) return id;
    }
  }

  /** Rename the overview sheets of a floor that still carry its old name. */
  function retitleSheets(layout, floorId, oldName, name) {
    for (const sheet of layout.sheets) {
      if (sheet.floor === floorId && sheet.kind === "overview" && sheet.title === oldName) sheet.title = name;
    }
  }

  /** Store the crawl the form describes. */
  function applyCrawl(session) {
    const { layout, crawl } = session;
    const spec = crawlCandidate(session);
    const oldName = crawl.name;
    History.change(() => {
      Object.assign(crawl, spec);
      retitleSheets(layout, Core.crawlLayerId(crawl), oldName, spec.name);
    });
    status(`Updated ${spec.name}.`);
  }

  /** Store the form onto the floor being edited. */
  function applyEdit(session, f) {
    const { layout, editing } = session;
    const oldName = editing.name;
    History.change(() => {
      if (!editing.id) editing.id = f.id;
      Object.assign(editing, { name: f.name, slab: f.slab, height: f.height, pen: f.pen });
      retitleSheets(layout, editing.id, oldName, f.name);
    });
    status(`Updated ${f.name}.`);
  }

  /** Add the crawlspace the form describes and show it. No floor is added. */
  function applyNewCrawl(session) {
    const { layout } = session;
    const crawl = addedCrawl(session);
    History.change(() => Core.addCrawl(layout, crawl));
    Stack.openLayer(Core.crawlLayerId(crawl));
    Sel.clear();
    View.fit();
    Panels.refresh();
    status(`Added ${Core.crawlName(crawl)}.`);
  }

  /** Add the floor the form describes, with a sheet of its own, and show it. */
  function applyNew(session, f) {
    const { layout } = session;
    const seated = History.change(() => {
      const refused = Core.seatFloor(layout, f);
      if (refused) return refused;
      layout.floors.push(f);
      layout.floors.sort((a, b) => a.slab - b.slab);
      layout.sheets.push({
        id: nextSheetId(layout, f.id), kind: "overview", title: f.name, floor: f.id,
        blurb: `${f.name}, slab Y=${f.slab}.`, notes: [],
      });
      return "";
    });
    if (seated) {
      status(seated, true);
      return;
    }
    Stack.openLayer(f.id);
    Sel.clear();
    View.fit();
    Panels.refresh();
    status(`Added ${f.name}.`);
  }

  /** The dialog closed. Apply the form when OK closed it and nothing is wrong. */
  function onClose(session) {
    session.form.oninput = null;
    if (session.dialog.returnValue !== "ok" || problem(session)) return;
    if (session.crawlEdit) applyCrawl(session);
    else if (session.editing) applyEdit(session, candidate(session));
    else if (addingCrawl(session)) applyNewCrawl(session);
    else applyNew(session, candidate(session));
  }

  // ---- deleting the floor ----

  /** Why a floor cannot be deleted yet, or "". A plan keeps one floor. */
  function deleteProblem(session) {
    const { layout, editing } = session;
    if (layout.floors.length < 2) return "A plan keeps one floor.";
    const use = Core.floorUse(layout, editing.id);
    const left = Object.entries(use).filter(([, n]) => n).map(([k, n]) => plural(n, k.replace(/s$/, "")));
    if (left.length) return `Move or delete what is on it first: ${left.join(", ")}.`;
    return "";
  }

  /** Delete the floor being edited, after asking, and show the entrance floor. A crawlspace stays. */
  async function deleteFloor(session) {
    const { layout, editing, dialog } = session;
    const refused = deleteProblem(session);
    if (refused) {
      $("floor-error").textContent = refused;
      return;
    }
    const name = Core.floorName(editing);
    if (!(await Dialogs.ask(`Delete ${name}?`, "Delete"))) return;
    dialog.close("cancel");
    History.change(() => {
      Core.crawlRecords(layout).forEach((crawl) => {
        if (crawl.under === editing.id) Core.rehangCrawl(layout, crawl, editing.id);
      });
      layout.floors = layout.floors.filter((f) => f.id !== editing.id);
      layout.sheets = layout.sheets.filter((s) => s.floor !== editing.id);
    });
    delete state.instances[editing.id];
    Stack.openLayer(entranceFloor());
    Sel.fix();
    Panels.refresh();
    status(`Deleted ${name}.`);
  }

  /** How many trenches are dug in a crawlspace. */
  function trenchCount(layout, crawl) {
    const id = Core.crawlLayerId(crawl);
    return layout.trenches.filter((trench) => {
      const owner = Core.trenchCrawl(layout, trench);
      return owner && Core.crawlLayerId(owner) === id;
    }).length;
  }

  /** Delete the crawlspace being edited, after asking, and show the floor it hung under. */
  async function deleteCrawl(session) {
    const { layout, crawl, dialog } = session;
    const name = Core.crawlName(crawl);
    const under = crawl.under;
    const id = Core.crawlLayerId(crawl);
    const trenches = trenchCount(layout, crawl);
    let question = `Delete ${name}?`;
    if (trenches === 1) question += " Its trench goes too.";
    else if (trenches) question += ` Its ${trenches} trenches go too.`;
    if (!(await Dialogs.ask(question, "Delete"))) return;
    dialog.close("cancel");
    History.change(() => Core.removeCrawl(layout, crawl));
    delete state.instances[id];
    const floor = Core.floorById(layout, under);
    Stack.openLayer(floor ? floor.id : entranceFloor());
    Sel.fix();
    Panels.refresh();
    status(`Deleted ${name}.`);
  }

  // ---- opening it ----

  /** What one opening of the dialog is about. */
  function newSession(mode) {
    const layout = L();
    const crawlEdit = mode === "edit" && Core.isCrawlLayer(layout, state.layer);
    const dialog = $("floor-dialog");
    return {
      layout,
      crawl: Core.crawlByLayer(layout, state.layer),
      crawlEdit,
      editing: mode === "edit" && !crawlEdit ? layerFloor() : null,
      asCrawl: false,
      dialog,
      form: dialog.querySelector("form"),
    };
  }

  /**
   * Open the dialog. `mode` is "add" for a new floor, or "edit" for the layer being shown, which may be
   * the crawl. `preset.slab` is where a new floor is offered.
   */
  function open(mode, preset) {
    const session = newSession(mode);
    const { dialog, form } = session;
    showFields(session);
    if (session.crawlEdit) fillCrawl(session);
    else fillFloor(session, preset);
    showTitles(session);
    form.oninput = () => validate(session);
    validate(session);
    $("floor-delete").onclick = () => (session.crawlEdit ? deleteCrawl(session) : deleteFloor(session));
    dialog.returnValue = "";
    dialog.showModal();
    dialog.addEventListener("close", () => onClose(session), { once: true });
  }

  Object.assign(App.FloorDialog, { open });
})(window.App);
