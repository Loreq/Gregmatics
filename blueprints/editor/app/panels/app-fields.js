/* The panel for the selected thing: one set of fields for each kind of record. Every field
   edits the record through History.change(), so it is one undo step and the page redraws. */
(function (App) {
  "use strict";

  const {
    Core, CATALOG, RESIZABLE, CONTENTS, $, L, roomLocked, status, make, button,
    Sel, History, Edit, Machines, Picker, Lists, Form, Panels,
  } = App;

  // Panel names for Core.sizeFields.
  const SIZE_LABELS = { side: "Side", x: "Width", z: "Depth", h: "Height" };
  const MARK_SHAPES = [["box", "Box"], ["circle", "Circle"], ["service", "Service"], ["text", "Name"], ["well", "Well"]];
  // Kinds that go by a name or a number and have no id to show.
  const NO_ID = new Set(["walls", "marks", "pads"]);
  const MIN_ROOM_HEIGHT = 2;

  // ---- options for the drop-downs ----

  /** Every machine, grouped the way the catalog groups them. */
  function machineOptions() {
    const out = [];
    for (const [group, label] of Object.entries(CATALOG.groups)) {
      const options = Object.entries(CATALOG.singles).filter(([, s]) => s.group === group).map(([code, s]) => [code, `${code} ${s.name}`]);
      if (options.length) out.push({ group: label, options });
    }
    return out;
  }

  /** Every multiblock by name, with its size. */
  function padOptions() {
    return Object.entries(CATALOG.multis).sort((a, b) => a[1].name.localeCompare(b[1].name))
      .map(([key, spec]) => [key, `${spec.name} (${Picker.sizeLabel(spec)})`]);
  }

  /** Every floor, highest first. */
  function floorOptions() {
    return L().floors.slice().sort((a, b) => b.slab - a.slab).map((f) => [f.id, f.name]);
  }

  /** Floor ids, each once, lowest floor first. */
  function orderFloors(ids) {
    const unique = [...new Set(ids)];
    return unique.sort((a, b) => Core.floorById(L(), a).slab - Core.floorById(L(), b).slab);
  }

  /** The name of the room something stands in, or the room's id when the room is gone. */
  function roomName(roomId) {
    return (Core.roomById(L(), roomId) || { name: roomId }).name;
  }

  // ---- fields many kinds share ----

  /** A checkbox for a field that is stored as true or left out. */
  function flagField(F, rec, labelText, key, hint) {
    F.check(labelText, Boolean(rec[key]), (value) => History.change(() => {
      if (value) rec[key] = true;
      else delete rec[key];
    }), hint);
  }

  /** A text box for a field that is left out when it is empty. */
  function optionalText(F, rec, labelText, key, opts) {
    F.text(labelText, rec[key] || "", (value) => History.change(() => {
      if (value.trim()) rec[key] = value.trim();
      else delete rec[key];
    }), opts);
  }

  /** A drop-down that moves a record to another floor. */
  function floorField(F, rec) {
    F.choose("Floor", rec.floor, floorOptions(), (value) => History.change(() => { rec.floor = value; }));
  }

  /** The id, which renames the record and everything that points at it. */
  function idField(F, kind, rec) {
    F.text("ID", rec.id, (value) => {
      const problem = History.change(() => Core.rename(L(), kind, rec, value.trim()));
      if (problem) status(`Could not rename: ${problem}`, true);
    });
  }

  /** The Delete button at the foot of the panel. */
  function deleteAction(F) {
    F.actions([button("Delete", () => Edit.removeSelected(), "danger")]);
  }

  // ---- a machine ----

  /** The fields of one machine: what it is, the way it faces, its tier, and its cell. */
  function machineFields(F, item) {
    const { rec } = item;
    F.choose("Machine", item.code, machineOptions(), (code) => History.change(() => {
      const codes = Core.codesOf(rec);
      codes[item.slot] = code;
      Core.setCodes(rec, codes);
    }));
    F.sides("Faces", rec.face, (face) => {
      History.change(() => Core.turnMachine(L(), CATALOG, item.index, item.slot, face));
      Sel.selectMachineAt(item.x, item.z);
      Panels.refresh();
    });
    const open = Core.TIERS.filter((t) => Core.voltageRank(t) <= Core.voltageRank(Core.planTier(L())));
    F.toggle("Tier", Core.tierAt(rec, item.slot), open.map((t) => [t, t, Core.tierLabel(t)]), (tier) => History.change(() => {
      Core.setTier(rec, item.slot, tier);
    }));
    F.pair("X, Z", [item.x, item.z], ([x, z]) => Machines.drop(item, x, z));
    F.note(`Slot ${item.slot + 1} of ${Core.codesOf(rec).length} in row ${rec.id}${rec.title ? `, ${rec.title}` : ""}.`);
    F.actions([
      button("Select row", () => {
        Sel.replace({ kind: "walls", index: item.index });
        Panels.refresh();
      }),
      button("Delete", () => Edit.removeSelected(), "danger"),
    ]);
  }

  // ---- zones ----

  /** A room: its name and code, its lock, its color, its floor, a height of its own, and whether it must stay clean. */
  function roomFields(F, rec) {
    F.text("Name", rec.name, (value) => History.change(() => { rec.name = value.trim() || rec.name; }), { first: true });
    flagField(F, rec, "Lock", "locked");
    F.text("Code", rec.code, (value) => History.change(() => { rec.code = value.trim().toUpperCase() || rec.code; }));
    F.color("Color", rec.color, (value) => History.change(() => { rec.color = value.toUpperCase(); }));
    floorField(F, rec);
    const usual = Core.floorHeight(Core.floorById(L(), rec.floor));
    F.number("Height", rec.height || "", (value) => History.change(() => {
      if (!value || value === usual) delete rec.height;
      else rec.height = Math.max(MIN_ROOM_HEIGHT, value);
    }), { placeholder: `${usual} (floor)`, min: MIN_ROOM_HEIGHT });
    flagField(F, rec, "Clean", "clean", "This room needs to stay free of pollution.");
  }

  /** Give a street a label in capitals at its first block, or take its label away. */
  function setStreetLabel(rec, value) {
    if (value.trim()) {
      rec.label = value.trim().toUpperCase();
      if (!rec.label_at) rec.label_at = [rec.x0 + 1, (rec.z0 + rec.z1) >> 1];
    } else {
      delete rec.label;
      delete rec.label_at;
      delete rec.label_vertical;
    }
  }

  /** A street: its label, its trench when it runs over the crawl, and its floor. The entrance keeps its floor. */
  function streetFields(F, rec) {
    F.text("Label", rec.label || "", (value) => History.change(() => setStreetLabel(rec, value)));
    flagField(F, rec, "Vertical label", "label_vertical");
    if (rec.floor === L().site.crawl.under) {
      F.check("Trench under", rec.trench !== false, (value) => History.change(() => { rec.trench = value; }));
    }
    if (rec.style !== "entry") floorField(F, rec);
  }

  /** A stair: the two floors it joins, and the end you step on at the bottom. */
  function stairFields(F, rec) {
    F.choose("Bottom", rec.floors[0], floorOptions(), (value) => History.change(() => { rec.floors = orderFloors([value, rec.floors[1]]); }));
    F.choose("Top", rec.floors[1], floorOptions(), (value) => History.change(() => { rec.floors = orderFloors([rec.floors[0], value]); }));
    F.sides("Bottom end", rec.low, (value) => History.change(() => { rec.low = value; }));
  }

  /** A text box for a label that is kept even when it is emptied. */
  function labelField(F, rec) {
    F.text("Label", rec.label || "", (value) => History.change(() => { rec.label = value.trim(); }));
  }

  /** A shaft: its label, and whether glass caps it. */
  function shaftFields(F, rec) {
    labelField(F, rec);
    F.choose("Top", rec.cap || "", [["glass", "Glass"], ["", "Open"]], (value) => History.change(() => {
      if (value) rec.cap = value;
      else delete rec.cap;
    }));
  }

  /** A lift: its label, and the floors it stops at. */
  function liftFields(F, rec) {
    labelField(F, rec);
    const floors = L().floors.slice().sort((a, b) => b.slab - a.slab);
    F.checks("Stops", floors.map((f) => [f.id, f.name, rec.floors.includes(f.id)]), (id, on) => History.change(() => {
      const stops = new Set(rec.floors);
      if (on) stops.add(id);
      else stops.delete(id);
      rec.floors = orderFloors([...stops]);
    }));
  }

  // ---- floor marks ----

  /** Give a mark a short name. A note that only repeated the old name follows the new one. */
  function setMarkName(rec, value) {
    const text = value.trim();
    if (!text) {
      delete rec.short;
      return;
    }
    if (!rec.label || rec.label === rec.short) rec.label = text;
    rec.short = text;
  }

  /** Give a mark a shape. A circle gets a radius, and only a name can stand on its side. */
  function setMarkShape(rec, value) {
    if (value === "box") delete rec.shape;
    else rec.shape = value;
    if (value === "circle") rec.radius = Core.circleRadius(rec);
    else delete rec.radius;
    if (value !== "text") delete rec.vertical;
  }

  /** A floor mark: its short name, its note, its shape, and whether only detail sheets show it. */
  function markFields(F, rec) {
    F.text("Label", rec.short || "", (value) => History.change(() => setMarkName(rec, value)), { first: true });
    F.text("Note", rec.label || "", (value) => History.change(() => { rec.label = value.trim(); }));
    F.choose("Shape", rec.shape || "box", MARK_SHAPES, (value) => History.change(() => setMarkShape(rec, value)));
    if (rec.shape === "text") flagField(F, rec, "Vertical", "vertical");
    flagField(F, rec, "Detail only", "detail");
    F.note(`In ${roomName(rec.room)}.`);
  }

  // ---- multiblocks ----

  /** How many modules a wallshared row has, across and in ranks. */
  function moduleFields(F, rec) {
    const counts = Core.moduleCounts(rec);
    F.number("Across", counts.across, (value) => History.change(() => Core.setModules(rec, value, Core.moduleCounts(rec).ranks)),
      { hint: "Adds one beside it, sharing a wall. Dragging a handle does the same." });
    F.number("Ranks", counts.ranks, (value) => History.change(() => Core.setModules(rec, Core.moduleCounts(rec).across, value)),
      { hint: "A rank sits behind the first and faces the other way." });
  }

  /** One field for each side of a multiblock the wiki leaves a choice in: a list of sizes, or a range. */
  function sizeFields(F, rec, spec) {
    for (const field of Core.sizeFields(rec, spec)) {
      const set = (value) => History.change(() => Core.setPadSize(rec, L(), spec, field.key, value));
      if (field.choices) {
        // A size the wiki does not list is still shown, so the drop-down reads what the plan holds.
        const values = field.choices.includes(field.value) ? field.choices : [field.value, ...field.choices];
        F.choose(SIZE_LABELS[field.key], String(field.value), values.map((n) => [String(n), String(n)]), set);
      } else {
        F.number(SIZE_LABELS[field.key], field.value, set, {
          placeholder: `${field.range[0]}–${field.range[1]}`, min: field.range[0], max: field.range[1], step: field.odd ? 2 : 1,
        });
      }
    }
  }

  /** A warning for a size the wiki does not allow, with a button that puts it right. */
  function sizeWarning(F, rec, spec) {
    const problem = Core.padSizeProblem(rec, spec);
    if (!problem) return;
    F.warn(`${problem}.`);
    F.actions([button("Fit to size", () => History.change(() => Core.fitPad(rec, L(), spec)))]);
  }

  /** A line saying how big a multiblock is and which room it is in, then the catalog's note about it. */
  function sizeNote(F, rec, spec, box) {
    const [mw, md] = Core.moduleSize(rec);
    const count = (rec.wx || 1) * (rec.wz || 1);
    const size = `${mw}×${md}×${rec.h || spec.size[2]}`;
    const where = roomName(rec.room);
    F.note(count > 1 ? `${size} each, ${box.x1 - box.x0 + 1}×${box.z1 - box.z0 + 1} in all, in ${where}.` : `${size} in ${where}.`);
    if (spec.note) F.note(spec.note);
  }

  /** A multiblock: what it is, where its controller is, its modules and sizes, and its label. */
  function padFields(F, rec, box) {
    const spec = CATALOG.multis[rec.key] || { name: rec.key, size: [0, 0, 0] };
    F.choose("Multiblock", rec.key, padOptions(), (value) => History.change(() => Core.retypePad(rec, CATALOG, value)));
    const facing = F.sides("Controller", rec.front, (value) => History.change(() => Core.setPadFront(rec, value)));
    const turn = button("Turn", () => Edit.turnSelected(), "aside");
    turn.title = "Turn it a quarter clockwise (R)";
    facing.append(turn);
    if (spec.share) moduleFields(F, rec);
    sizeFields(F, rec, spec);
    optionalText(F, rec, "Label", "label");
    sizeWarning(F, rec, spec);
    sizeNote(F, rec, spec, box);
  }

  // ---- machine rows ----

  /** Give a row the codes typed for it, when every one is a machine. */
  function setRowCodes(rec, value) {
    const codes = value.trim().toUpperCase().split(/\s+/).filter(Boolean);
    const bad = codes.find((c) => c !== "-" && !CATALOG.singles[c]);
    if (!codes.length || bad) {
      status(bad ? `${bad} is not a machine code.` : "A row needs at least one machine.", true);
      Panels.refresh();
      return;
    }
    History.change(() => Core.setCodes(rec, codes));
  }

  /** A machine row: its title, its machines as codes, the way they face, and the way the row runs. */
  function wallFields(F, rec) {
    optionalText(F, rec, "Title", "title", { first: false });
    F.text("Machines", rec.codes, (value) => setRowCodes(rec, value));
    F.sides("Faces", rec.face, (value) => History.change(() => { rec.face = value; }));
    F.sides("Runs", rec.along, (value) => History.change(() => { rec.along = value; }));
  }

  // ---- where it is ----

  /** Grey out a control and everything in it. */
  function freezeControl(control) {
    if (!control) return;
    if (control.disabled !== undefined) control.disabled = true;
    control.querySelectorAll("input, select, button").forEach((el) => { el.disabled = true; });
  }

  /** Two number boxes that set one pair of a record's edges, such as X0 and X1. */
  function edgeField(F, kind, rec, labelText, low, high, values) {
    return F.pair(labelText, values, ([a, c]) => History.change(() => {
      Core.setBox(kind, rec, { ...Core.boxOf(kind, rec), [low]: a, [high]: c });
    }));
  }

  /** The corner a record starts at, and its edges when its box can be dragged. A locked room's are greyed out. */
  function positionFields(F, kind, rec, box) {
    if (kind === "lifts") {
      F.pair("X, Z", [box.x0, box.z0], ([x, z]) => History.change(() => Core.moveZone(L(), kind, rec, x - box.x0, z - box.z0)));
      return;
    }
    const controls = [F.pair("Corner", [box.x0, box.z0], ([x, z]) => History.change(() => {
      Core.moveZone(L(), kind, rec, x - box.x0, z - box.z0);
      if (CONTENTS.has(kind)) Core.rehome(L(), kind, rec);
    }))];
    if (RESIZABLE.has(kind)) {
      controls.push(edgeField(F, kind, rec, "X0, X1", "x0", "x1", [box.x0, box.x1]));
      controls.push(edgeField(F, kind, rec, "Z0, Z1", "z0", "z1", [box.z0, box.z1]));
    }
    if (kind === "rooms" && roomLocked(rec)) controls.forEach(freezeControl);
  }

  // ---- what a room holds ----

  /** What stands in a room, as [label, links] for each kind that has any. A link selects the thing. */
  function roomContents(room) {
    const layout = L();
    const blocks = [];
    for (const [label, kind] of [["Multiblocks", "pads"], ["Rows", "walls"], ["Areas", "marks"]]) {
      const links = [];
      layout[kind].forEach((rec, index) => {
        if (rec.room !== room.id) return;
        links.push(button(Core.nameOf(kind, rec, CATALOG), () => Lists.selectAndShow({ kind, index }), "link-button"));
      });
      if (links.length) blocks.push([label, links]);
    }
    return blocks;
  }

  /** The room's multiblocks, machine rows, and areas, folded away, each one click from being selected. */
  function contentsFields(F, room) {
    const blocks = roomContents(room);
    const total = blocks.reduce((n, [, links]) => n + links.length, 0);
    if (!total) return;
    const box = make("details", "inside wide");
    box.append(make("summary", "", `Inside ${total}`));
    for (const [label, links] of blocks) {
      const wrap = make("div", "links");
      wrap.append(...links);
      box.append(make("div", "hint", label), wrap);
    }
    F.form.append(box);
  }

  // ---- the panel ----

  // The fields each kind has of its own, between its id and its position.
  const KIND_FIELDS = {
    rooms: roomFields,
    streets: streetFields,
    doors: floorField,
    stairs: stairFields,
    shafts: shaftFields,
    lifts: liftFields,
    marks: markFields,
    pads: padFields,
    walls: wallFields,
  };

  /** The panel for one selected thing. */
  function oneFields(F, item) {
    const { kind, rec } = item;
    const box = Sel.boxOf(item);
    if (kind === "machines") {
      machineFields(F, item);
      return;
    }
    if (!NO_ID.has(kind)) idField(F, kind, rec);
    const own = KIND_FIELDS[kind];
    if (own) own(F, rec, box);
    positionFields(F, kind, rec, box);
    if (kind === "rooms") contentsFields(F, rec);
    deleteAction(F);
  }

  /** The panel for several selected things: their names, and Delete. */
  function manyFields(F, items) {
    F.note(Sel.namesOf(items));
    F.note("Click one to edit it.");
    deleteAction(F);
  }

  /** Rebuild the panel for whatever is selected. */
  function render() {
    const form = $("fields");
    form.innerHTML = "";
    const items = Sel.selection();
    const F = new Form.FormBuilder(form);
    if (!items.length) {
      $("sel-title").textContent = "Nothing selected";
      F.note("Click something on the plan to edit it here.");
    } else if (items.length > 1) {
      $("sel-title").textContent = `${items.length} selected`;
      manyFields(F, items);
    } else {
      $("sel-title").textContent = `${Core.KIND_NAMES[items[0].kind]}: ${Sel.nameOf(items[0])}`;
      oneFields(F, items[0]);
    }
  }

  Object.assign(App.Fields, { render });
})(window.App);
