/* Floors: the stack of air bands along Y, and each floor's footprint in X and Z.
   A floor's air is slab + 1 through slab + height. The pipe crawl hangs a set gap under one floor.
   A footprint is optional. Omitted, the main floor fills the site and the other floors fill the main floor. */
(function (root) {
  "use strict";

  const Core = root.Core;
  const { CRAWL, floorById, sameBox } = Core;

  const DEFAULT_HEIGHT = 5;
  // Solid blocks two bands of air must keep between them.
  const MIN_ROCK = 2;
  // The Minecraft 1.7.10 world.
  const WORLD_TOP = 255;
  const CRAWL_NAME = "Pipe crawl";
  const PAST_LIMIT = "That stack reaches past the build limit, Y 255.";

  // ---- air bands ----

  /** How many blocks of air a floor has. */
  function floorHeight(floor) {
    return floor.height || DEFAULT_HEIGHT;
  }

  /** A floor's air as [low Y, high Y]. */
  function floorAir(floor) {
    return [floor.slab + 1, floor.slab + floorHeight(floor)];
  }

  /** The air a crawl would have under a floor, as [low Y, high Y]. */
  function airUnder(floor, crawl) {
    const top = floor.slab - crawl.below;
    return [top - crawl.height + 1, top];
  }

  /** The pipe crawl's air as [low Y, high Y], or null when the floor it hangs under is gone. */
  function crawlAir(layout) {
    const crawl = layout.site.crawl;
    const under = floorById(layout, crawl.under);
    return under ? airUnder(under, crawl) : null;
  }

  /** The name the pipe crawl goes by. */
  function crawlName(crawl) {
    return crawl.name || CRAWL_NAME;
  }

  /** Every floor plus the pipe crawl, bottom to top. */
  function layers(layout) {
    const out = layout.floors.map((f) => ({ id: f.id, name: f.name, base: floorAir(f)[0], floor: f }));
    const air = crawlAir(layout);
    if (air) out.push({ id: CRAWL, name: crawlName(layout.site.crawl), base: air[0], crawl: true });
    return out.sort((a, b) => a.base - b.base);
  }

  /** The name of a floor or the crawl. An id that names neither is returned as it is. */
  function layerName(layout, id) {
    const layer = layers(layout).find((l) => l.id === id);
    return layer ? layer.name : id;
  }

  /** The first two bands, bottom up, with too little rock between them, as { lower, upper, dy }, or null. */
  function crowdedBands(bands) {
    for (let i = 1; i < bands.length; i += 1) {
      const rock = bands[i].air[0] - bands[i - 1].air[1] - 1;
      if (rock < MIN_ROCK) return { lower: bands[i - 1], upper: bands[i], dy: MIN_ROCK - rock };
    }
    return null;
  }

  /** What is wrong with the spacing of these floors and a crawl, or "". The crawl defaults to the plan's. */
  function bandProblem(layout, floors, crawl) {
    const bands = floors.map((f) => ({ air: floorAir(f), name: f.name }));
    crawl = crawl || layout.site.crawl;
    const under = floors.find((f) => f.id === crawl.under);
    if (under) bands.push({ air: airUnder(under, crawl), name: crawlName(crawl) });
    bands.sort((a, b) => a.air[0] - b.air[0]);
    const crowded = crowdedBands(bands);
    if (!crowded) return "";
    const { lower, upper } = crowded;
    return `${lower.name} (air Y ${lower.air[0]}–${lower.air[1]}) and ${upper.name} (air Y ${upper.air[0]}–${upper.air[1]}) `
      + "need at least 2 solid blocks between them.";
  }

  /** How many rooms, streets, doors, stairs, and lifts use a floor. */
  function floorUse(layout, id) {
    return {
      rooms: layout.rooms.filter((r) => r.floor === id).length,
      streets: layout.streets.filter((s) => s.floor === id).length,
      doors: layout.doors.filter((d) => d.floor === id).length,
      stairs: layout.stairs.filter((s) => s.floors.includes(id)).length,
      lifts: layout.lifts.filter((l) => l.floors.includes(id)).length,
    };
  }

  // ---- seating a new floor ----

  /** Bands of air from the bottom up: each floor, the pipe crawl when it has one, and a floor still to be added. */
  function airBands(layout, extra) {
    const bands = layout.floors.map((floor) => ({
      air: floorAir(floor), name: floor.name, floor, crawl: false,
    }));
    const crawl = crawlAir(layout);
    if (crawl) bands.push({ air: crawl, name: crawlName(layout.site.crawl), crawl: true });
    if (extra) bands.push({ air: [extra.slab + 1, extra.slab + extra.height], name: extra.name || "New floor", spec: true });
    bands.sort((a, b) => a.air[0] - b.air[0] || a.air[1] - b.air[1]);
    return bands;
  }

  /** Move a floor and every floor above it by dy. Nothing moves when one would leave the world. */
  function shiftFloorAndAbove(layout, floor, dy) {
    if (!dy) return true;
    for (const other of layout.floors) {
      if (other.slab < floor.slab) continue;
      const slab = other.slab + dy;
      if (slab < 1 || slab + floorHeight(other) > WORLD_TOP) return false;
    }
    for (const other of layout.floors) if (other.slab >= floor.slab) other.slab += dy;
    return true;
  }

  /** Move a band up by dy. The crawl moves by tightening its gap, and when that is used up by lifting its floor. */
  function shiftBand(layout, band, dy) {
    if (!dy) return true;
    if (!band.crawl) return shiftFloorAndAbove(layout, band.floor, dy);
    const crawl = layout.site.crawl;
    if (dy > 0 && crawl.below - dy >= MIN_ROCK) {
      crawl.below -= dy;
      return true;
    }
    const parent = floorById(layout, crawl.under);
    return Boolean(parent) && shiftFloorAndAbove(layout, parent, dy);
  }

  /** Remember where the stack sits. The function returned puts every floor and the crawl back. */
  function stackKeeper(layout) {
    const slabs = layout.floors.map((floor) => floor.slab);
    const below = layout.site.crawl.below;
    return () => {
      layout.floors.forEach((floor, i) => { floor.slab = slabs[i]; });
      layout.site.crawl.below = below;
    };
  }

  /** Lift the upper of two crowded bands clear of the lower. Returns a problem, or "". */
  function liftClear(layout, spec, crowded) {
    if (crowded.upper.spec) {
      return `${crowded.lower.name} and ${spec.name || "the new floor"} need at least 2 solid blocks between them.`;
    }
    return shiftBand(layout, crowded.upper, crowded.dy) ? "" : PAST_LIMIT;
  }

  /** The stack has room for the new floor: order the floors, unless the crawl was pushed out of the world. */
  function settleStack(layout) {
    const crawl = crawlAir(layout);
    if (crawl && (crawl[0] < 0 || crawl[1] > WORLD_TOP)) return "The pipe crawl would leave Y 0 through 255.";
    layout.floors.sort((a, b) => a.slab - b.slab);
    return "";
  }

  /** Lift crowded bands, one pair at a time, until the new floor fits. Returns a problem, or "". */
  function makeRoom(layout, spec) {
    for (let guard = 0; guard < 40; guard += 1) {
      const crowded = crowdedBands(airBands(layout, spec));
      if (!crowded) return settleStack(layout);
      const problem = liftClear(layout, spec, crowded);
      if (problem) return problem;
    }
    return PAST_LIMIT;
  }

  /**
   * Seat a new floor at spec.slab. Bands that would sit too close above it move up.
   * spec is not inserted. Returns a problem, or "". On a problem the stack is left as it was.
   */
  function seatFloor(layout, spec) {
    if (spec.slab + 1 < 0 || spec.slab + spec.height > WORLD_TOP) return "Y stays from 0 to 255.";
    const restore = stackKeeper(layout);
    const problem = makeRoom(layout, spec);
    if (problem) restore();
    return problem;
  }

  // ---- footprints ----

  /** The site inside its rim: the most any floor can cover. */
  function inner(layout) {
    const s = layout.site.square;
    const r = layout.site.rim;
    return { x0: s.x0 + r, x1: s.x1 - r, z0: s.z0 + r, z1: s.z1 - r };
  }

  /** Whether a floor stores a footprint of its own. */
  function hasSpan(floor) {
    return Boolean(floor) && [floor.x0, floor.x1, floor.z0, floor.z1].every((n) => Number.isInteger(n));
  }

  /** A floor's stored footprint as a box. */
  function spanOf(floor) {
    return { x0: floor.x0, x1: floor.x1, z0: floor.z0, z1: floor.z1 };
  }

  /** The floor the others fit inside: the one with id main, or the lowest slab. */
  function mainFloor(layout) {
    return layout.floors.find((f) => f.id === "main")
      || layout.floors.slice().sort((a, b) => a.slab - b.slab || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0]
      || null;
  }

  /** Whether a floor is the main one. */
  function isMain(layout, floor) {
    if (floor && floor.id === "main") return true;
    const main = mainFloor(layout);
    return Boolean(main && floor && floor.id === main.id);
  }

  /** The box a floor covers: its own footprint, else the main floor's, else the site. */
  function floorBox(layout, floor) {
    if (hasSpan(floor)) return spanOf(floor);
    const main = mainFloor(layout);
    if (floor && main && floor.id !== main.id && hasSpan(main)) return floorBox(layout, main);
    return inner(layout);
  }

  /** The most a floor's footprint may cover: the site for the main floor, the main floor for the others. */
  function floorLimit(layout, floor) {
    if (!floor || isMain(layout, floor)) return inner(layout);
    const main = mainFloor(layout);
    return main ? floorBox(layout, main) : inner(layout);
  }

  /** Give a floor a footprint. One that fills all the floor is allowed is stored as no footprint. */
  function writeSpan(layout, floor, box) {
    if (sameBox(box, floorLimit(layout, floor))) {
      delete floor.x0;
      delete floor.x1;
      delete floor.z0;
      delete floor.z1;
      return;
    }
    floor.x0 = box.x0;
    floor.x1 = box.x1;
    floor.z0 = box.z0;
    floor.z1 = box.z1;
  }

  Object.assign(Core, {
    floorHeight, floorAir, crawlAir, layers, layerName, bandProblem, floorUse, seatFloor,
    inner, hasSpan, spanOf, mainFloor, isMain, floorBox, floorLimit, writeSpan,
  });
})(typeof window !== "undefined" ? window : globalThis);
