/* The draw tools: Room, Street, Door, Stair, Area, and Trench. A press starts a sketch,
   { start, cur }, in state.draw. The pointer drags it out, and the release turns it into a record,
   selects it, and goes back to the Select tool. A click with no drag makes one of a usual size. */
(function (App) {
  "use strict";

  const {
    Core, ROOM_COLORS, state, L, layerFloor, status, clampCell, around, fitInto,
    Sel, History, Paint, Tools, Panels,
  } = App;

  const OPPOSITE = { n: "s", s: "n", e: "w", w: "e" };
  // The size a click makes, as [width, depth].
  const CLICK_SIZE = { rooms: [9, 9], streets: [3, 9], stairs: [3, 10], marks: [5, 5], trenches: [3, 9] };

  // ---- where a tool may draw ----

  /** The footprint of the floor being shown, or of the floor over the crawl. */
  function activeBox() {
    const layout = L();
    if (state.layer === Core.CRAWL) return Core.crawlBox(layout);
    const floor = layerFloor();
    return floor ? Core.floorBox(layout, floor) : Core.inner(layout);
  }

  /** The box the tool in hand keeps its sketch inside. An area stays in the room it started in. */
  function bounds() {
    if (state.tool === "marks" && state.draw && state.draw.home) return state.draw.home;
    if (state.tool === "streets") {
      const floor = layerFloor();
      return Core.boundsFor(L(), "streets", floor ? { floor: floor.id } : {});
    }
    return activeBox();
  }

  // ---- the sketch ----

  /** The box of the sketch, or null when nothing is being drawn. A door is one block deep along its longer side. */
  function box() {
    const d = state.draw;
    if (!d) return null;
    const [x0, z0] = d.start;
    let [x1, z1] = d.cur;
    if (state.tool === "doors") {
      if (Math.abs(x1 - x0) >= Math.abs(z1 - z0)) z1 = z0;
      else x1 = x0;
    }
    return { x0: Math.min(x0, x1), x1: Math.max(x0, x1), z0: Math.min(z0, z1), z1: Math.max(z0, z1) };
  }

  /** Paint the sketch and show its size beside the pointer. */
  function redraw() {
    Paint.draw();
    Panels.showCursor();
  }

  /** Begin a sketch at a cell. An area must begin inside a room. */
  function start(cell) {
    const sketch = { start: cell, cur: cell };
    if (state.tool === "marks") {
      const home = Core.roomAt(L(), state.layer, cell[0], cell[1]);
      if (!home) {
        status("Draw an area inside a room.", true);
        return;
      }
      sketch.home = home.room;
    } else {
      sketch.start = clampCell(cell, bounds());
      sketch.cur = sketch.start;
    }
    state.draw = sketch;
    redraw();
  }

  /** Drag the sketch's far corner to a cell. */
  function extend(cell) {
    state.draw.cur = clampCell(cell, bounds());
    redraw();
  }

  /** Drop the sketch without making anything. */
  function cancel() {
    state.draw = null;
    redraw();
  }

  /** The box a finished sketch stands for: a usual size around a click, else what was dragged, kept inside `limit`. */
  function sketchBox(sketch, drawn, kind, limit) {
    const click = sketch.start[0] === sketch.cur[0] && sketch.start[1] === sketch.cur[1];
    return fitInto(click ? around(sketch.start, ...CLICK_SIZE[kind]) : drawn, limit);
  }

  // ---- rooms, streets, and trenches ----

  /** A color no room has yet, or the next in turn once all are used. */
  function pickRoomColor() {
    const used = new Set(L().rooms.map((r) => r.color));
    return ROOM_COLORS.find((c) => !used.has(c)) || ROOM_COLORS[L().rooms.length % ROOM_COLORS.length];
  }

  /** Add a room. Returns its index. */
  function addRoom(sketch, drawn) {
    const layout = L();
    const at = sketchBox(sketch, drawn, "rooms", activeBox());
    const room = {
      id: Core.uniqueId(layout, "rooms", "room"), floor: state.layer, name: "New room", code: "NR",
      color: pickRoomColor(), ...at, label_at: Core.middleCell(at),
    };
    History.change(() => layout.rooms.push(room));
    return layout.rooms.length - 1;
  }

  /** Add a street. One on the floor over the crawl gets a trench under it. Returns its index. */
  function addStreet(sketch, drawn) {
    const layout = L();
    const at = sketchBox(sketch, drawn, "streets", Core.boundsFor(layout, "streets", { floor: state.layer }));
    const street = {
      id: Core.uniqueId(layout, "streets", "street"), floor: state.layer, style: "corridor", ...at,
      trench: state.layer === layout.site.crawl.under,
    };
    History.change(() => layout.streets.push(street));
    return layout.streets.length - 1;
  }

  /** Add a trench to the crawl. Returns its index. */
  function addTrench(sketch, drawn) {
    const layout = L();
    const trench = { id: Core.uniqueId(layout, "trenches", "trench"), ...sketchBox(sketch, drawn, "trenches", activeBox()) };
    History.change(() => layout.trenches.push(trench));
    return layout.trenches.length - 1;
  }

  /** Add an area to the room the sketch began in. Returns its index. */
  function addMark(sketch, drawn) {
    const at = sketchBox(sketch, drawn, "marks", sketch.home);
    return History.change(() => Core.addMark(L(), sketch.home.id, at, "Area"));
  }

  // ---- doors ----

  /** A short tag for the space at a cell, for ids: a room's code, or a street's id. */
  function spaceTagOn(floor, x, z) {
    const home = Core.roomAt(L(), floor, x, z);
    if (home) return String(home.room.code || home.room.id).toLowerCase();
    const street = L().streets.find((s) => s.floor === floor && x >= s.x0 && x <= s.x1 && z >= s.z0 && z <= s.z1);
    return street ? street.id : "";
  }

  /** An id for a door, named for the two spaces it joins, like sl_farm. */
  function doorIdOn(floor, at) {
    const [mx, mz] = Core.middleCell(at);
    const northSouth = [spaceTagOn(floor, mx, at.z0 - 1), spaceTagOn(floor, mx, at.z1 + 1)];
    const westEast = [spaceTagOn(floor, at.x0 - 1, mz), spaceTagOn(floor, at.x1 + 1, mz)];
    const across = at.z0 === at.z1 && (at.x0 !== at.x1 || northSouth.every(Boolean));
    const tags = (across ? northSouth : westEast).filter(Boolean);
    return Core.uniqueId(L(), "doors", tags.join("_") || "door");
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

  /** Add a door: across the wall block that was clicked, or along what was dragged. Returns its index, or null. */
  function addDoor(sketch, drawn) {
    const layout = L();
    const click = sketch.start[0] === sketch.cur[0] && sketch.start[1] === sketch.cur[1];
    const found = click ? autoDoor(sketch.start[0], sketch.start[1]) : drawn;
    if (!found) {
      status("Click the wall block between two spaces, or drag along the wall.", true);
      redraw();
      return null;
    }
    const at = fitInto(found, activeBox());
    const door = { id: doorIdOn(state.layer, at), floor: state.layer, ...at };
    History.change(() => layout.doors.push(door));
    return layout.doors.length - 1;
  }

  // ---- stairs ----

  /** The two floors a stair drawn here joins, low first, and whether it climbs: the next floor up, or down from the top. */
  function stairFloors() {
    const floors = L().floors.slice().sort((a, b) => a.slab - b.slab);
    const i = floors.findIndex((f) => f.id === state.layer);
    const above = floors[i + 1];
    const below = floors[i - 1];
    if (!above && !below) return null;
    return above ? { ids: [state.layer, above.id], up: true } : { ids: [below.id, state.layer], up: false };
  }

  /** The side a dragged stair is stepped onto from: the side the drag began at. A click begins at the north. */
  function stairFoot(sketch, click) {
    if (click) return "n";
    const dx = sketch.cur[0] - sketch.start[0];
    const dz = sketch.cur[1] - sketch.start[1];
    return Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? "w" : "e") : (dz > 0 ? "n" : "s");
  }

  /** A stair drawn from where you step on, or null with the reason in the status bar. */
  function newStair(sketch, drawn) {
    const layout = L();
    const joined = stairFloors();
    if (!joined) {
      status("A stair joins two floors. Add a floor first.", true);
      return null;
    }
    const click = sketch.start[0] === sketch.cur[0] && sketch.start[1] === sketch.cur[1];
    const from = stairFoot(sketch, click);
    const shared = Core.boundsFor(layout, "stairs", { floors: joined.ids });
    if (shared.x0 > shared.x1 || shared.z0 > shared.z1) {
      status("Those floors do not share a footprint.", true);
      return null;
    }
    return {
      id: Core.uniqueId(layout, "stairs", `${joined.ids.join("_")}_stair`),
      floors: joined.ids,
      low: joined.up ? from : OPPOSITE[from],
      ...fitInto(click ? around(sketch.start, ...CLICK_SIZE.stairs) : drawn, shared),
    };
  }

  /** Add a stair. Returns its index, or null. */
  function addStair(sketch, drawn) {
    const stair = newStair(sketch, drawn);
    if (!stair) {
      redraw();
      return null;
    }
    History.change(() => L().stairs.push(stair));
    return L().stairs.length - 1;
  }

  // ---- finishing ----

  // What each draw tool adds, what to call it, and whether the new thing wants a name typed.
  const MAKERS = {
    rooms: { add: addRoom, what: "room", named: true },
    streets: { add: addStreet, what: "street" },
    doors: { add: addDoor, what: "door" },
    stairs: { add: addStair, what: "stair" },
    marks: { add: addMark, what: "area", named: true },
    trenches: { add: addTrench, what: "trench" },
  };

  /** Turn the sketch into a record, select it, and go back to the Select tool. */
  function finish() {
    const sketch = state.draw;
    const drawn = box();
    state.draw = null;
    const kind = state.tool;
    const maker = MAKERS[kind];
    const index = maker ? maker.add(sketch, drawn) : null;
    if (index === null) return;
    Sel.replace({ kind, index });
    state.focusFirst = Boolean(maker.named);
    Tools.set("select", true);
    Panels.refresh();
    status(maker.named
      ? `Drew a new ${maker.what}. Type its name; drag it or its handles to adjust.`
      : `Drew a new ${maker.what}. Drag it or its handles to adjust.`);
  }

  Object.assign(App.Draw, { activeBox, box, start, extend, cancel, finish, pickRoomColor });
})(window.App);
