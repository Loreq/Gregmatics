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
  const FLOOR_NAME = "Floor";
  const CRAWL_NAME = "Crawlspace";
  // A crawlspace made with a new floor: solid blocks under that floor, then this much air.
  const NEW_CRAWL_BELOW = 4;
  const NEW_CRAWL_HEIGHT = 3;
  const PAST_LIMIT = "That stack reaches past the build limit, Y 255.";
  const WORLD_EDGE = 30000000;
  const GROUND_FALLBACK = 80;

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

  /** The crawlspaces on a plan. One stored as site.crawl counts as a list of one. */
  function crawlRecords(layout) {
    const site = layout && layout.site;
    if (!site) return [];
    if (Array.isArray(site.crawls)) return site.crawls;
    return site.crawl ? [site.crawl] : [];
  }

  /** The id a crawlspace has in the floor stack. An old one with no id is "crawl". */
  function crawlLayerId(crawl) {
    return crawl && crawl.id ? crawl.id : CRAWL;
  }

  /** The crawlspace shown as this layer, or null. */
  function crawlByLayer(layout, id) {
    return crawlRecords(layout).find((crawl) => crawlLayerId(crawl) === id) || null;
  }

  /** Whether this layer is a crawlspace. */
  function isCrawlLayer(layout, id) {
    return Boolean(crawlByLayer(layout, id));
  }

  /** An id for a new crawlspace that no floor or crawlspace has. */
  function freshCrawlId(layout) {
    const taken = new Set(crawlRecords(layout).map(crawlLayerId));
    for (const floor of layout.floors || []) taken.add(floor.id);
    if (!taken.has(CRAWL)) return CRAWL;
    for (let n = 2; ; n += 1) {
      const id = `${CRAWL}-${n}`;
      if (!taken.has(id)) return id;
    }
  }

  /** A crawlspace under a floor, ready to store. */
  function newCrawl(layout, floor) {
    return {
      id: freshCrawlId(layout),
      name: CRAWL_NAME,
      under: floor.id,
      below: NEW_CRAWL_BELOW,
      height: NEW_CRAWL_HEIGHT,
    };
  }

  /** The crawlspace a trench belongs to. One with no crawl id stays on the only crawlspace, or on "crawl". */
  function trenchCrawl(layout, trench) {
    const crawls = crawlRecords(layout);
    if (!crawls.length) return null;
    if (trench && trench.crawl) return crawls.find((crawl) => crawlLayerId(crawl) === trench.crawl) || null;
    if (crawls.length === 1) return crawls[0];
    return crawls.find((crawl) => crawlLayerId(crawl) === CRAWL) || null;
  }

  /**
   * Keep a crawlspace when the floor it hangs under leaves. Its air stays put, under the next floor
   * above that air. With no floor above, it hangs under the highest floor that remains.
   */
  function rehangCrawl(layout, crawl, goneId) {
    const air = crawlAir(layout, crawl);
    if (!air) return;
    const top = air[1];
    const hosts = layout.floors.filter((floor) => floor.id !== goneId);
    const above = hosts.filter((floor) => floor.slab > top).sort((a, b) => a.slab - b.slab)[0];
    const host = above || hosts.slice().sort((a, b) => b.slab - a.slab)[0];
    if (!host) return;
    crawl.under = host.id;
    crawl.below = Math.max(1, host.slab - top);
  }

  /** Drop a crawlspace, the trenches dug in it, and its sheet. One that remains is stored as site.crawl. */
  function removeCrawl(layout, crawl) {
    const id = crawlLayerId(crawl);
    layout.trenches = layout.trenches.filter((trench) => {
      const owner = trenchCrawl(layout, trench);
      return !owner || crawlLayerId(owner) !== id;
    });
    const site = layout.site;
    if (Array.isArray(site.crawls)) {
      site.crawls = site.crawls.filter((item) => crawlLayerId(item) !== id);
      if (site.crawls.length === 1) {
        site.crawl = site.crawls[0];
        delete site.crawls;
      } else if (!site.crawls.length) delete site.crawls;
    } else if (site.crawl && crawlLayerId(site.crawl) === id) delete site.crawl;
    layout.sheets = layout.sheets.filter((sheet) => sheet.floor !== id);
  }

  /** Remember a crawlspace. The first one stays site.crawl; another joins site.crawls. */
  function addCrawl(layout, crawl) {
    const site = layout.site;
    if (Array.isArray(site.crawls)) {
      site.crawls.push(crawl);
      return;
    }
    if (!site.crawl) {
      site.crawl = crawl;
      return;
    }
    site.crawls = [site.crawl, crawl];
    delete site.crawl;
  }

  /** A crawlspace's air as [low Y, high Y], or null when its floor is gone. */
  function crawlAir(layout, crawl) {
    if (!crawl) return null;
    const under = floorById(layout, crawl.under);
    return under ? airUnder(under, crawl) : null;
  }

  /** The name a floor shows. A blank name is Floor. */
  function floorName(floor) {
    const name = floor && typeof floor.name === "string" ? floor.name.trim() : "";
    return name || FLOOR_NAME;
  }

  /** The name a crawlspace shows. A blank name is Crawlspace. */
  function crawlName(crawl) {
    const name = crawl && typeof crawl.name === "string" ? crawl.name.trim() : "";
    return name || CRAWL_NAME;
  }

  /** One crawlspace as a band, or null when the floor it hangs under is gone. */
  function crawlBand(layout, crawl, floors) {
    const under = (floors || layout.floors).find((floor) => floor.id === crawl.under);
    if (!under) return null;
    const air = airUnder(under, crawl);
    return { air, name: crawlName(crawl), crawl: true, rec: crawl, id: crawlLayerId(crawl) };
  }

  /** Every floor plus each crawlspace, bottom to top. */
  function layers(layout) {
    const out = layout.floors.map((f) => ({ id: f.id, name: floorName(f), base: floorAir(f)[0], floor: f }));
    for (const crawl of crawlRecords(layout)) {
      const band = crawlBand(layout, crawl);
      if (band) out.push({ id: band.id, name: band.name, base: band.air[0], air: band.air, crawl: true, rec: crawl });
    }
    return out.sort((a, b) => a.base - b.base);
  }

  /** The name of a floor or the crawl. An id that names neither is returned as it is. */
  function layerName(layout, id) {
    const layer = layers(layout).find((l) => l.id === id);
    return layer ? layer.name : id;
  }

  /**
   * The first two bands, bottom up, with too little rock between them, as { lower, upper, dy }, or null.
   * Two crawlspaces are left under their floors. Checks names that meeting.
   */
  function crowdedBands(bands) {
    for (let i = 1; i < bands.length; i += 1) {
      if (bands[i].crawl && bands[i - 1].crawl) continue;
      const rock = bands[i].air[0] - bands[i - 1].air[1] - 1;
      if (rock < MIN_ROCK) return { lower: bands[i - 1], upper: bands[i], dy: MIN_ROCK - rock };
    }
    return null;
  }

  /** The upper of two crawlspaces with no floor between them, or null. Each still hangs under its own floor. */
  function adjacentCrawls(layout) {
    const bands = layout.floors.map((floor) => ({ air: floorAir(floor) }));
    for (const crawl of crawlRecords(layout)) {
      const air = crawlAir(layout, crawl);
      if (air) bands.push({ air, crawl: true, id: crawlLayerId(crawl) });
    }
    bands.sort((a, b) => a.air[0] - b.air[0] || a.air[1] - b.air[1]);
    for (let i = 1; i < bands.length; i += 1) {
      if (bands[i].crawl && bands[i - 1].crawl) return bands[i];
    }
    return null;
  }

  /** What is wrong with the spacing of these floors and the crawlspaces, or "". */
  function bandProblem(layout, floors, extraCrawl) {
    const bands = floors.map((f) => ({ air: floorAir(f), name: floorName(f) }));
    for (const crawl of crawlRecords(layout)) {
      const band = crawlBand(layout, crawl, floors);
      if (band) bands.push(band);
    }
    if (extraCrawl) {
      const under = floors.find((floor) => floor.id === extraCrawl.under);
      if (under) bands.push({ air: airUnder(under, extraCrawl), name: crawlName(extraCrawl), crawl: true });
    }
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

  /** Bands of air from the bottom up: each floor, each crawlspace, and a floor still to be added. */
  function airBands(layout, extra) {
    const bands = layout.floors.map((floor) => ({
      air: floorAir(floor), name: floorName(floor), floor, crawl: false,
    }));
    for (const crawl of crawlRecords(layout)) {
      const band = crawlBand(layout, crawl);
      if (band) bands.push(band);
    }
    if (extra) bands.push({ air: [extra.slab + 1, extra.slab + extra.height], name: floorName(extra), spec: true, floor: extra });
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
    const crawl = band.rec;
    if (!crawl) return false;
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
    const crawls = crawlRecords(layout).map((crawl) => ({ crawl, below: crawl.below }));
    return () => {
      layout.floors.forEach((floor, i) => { floor.slab = slabs[i]; });
      crawls.forEach(({ crawl, below }) => { crawl.below = below; });
    };
  }

  /** Lift the upper of two crowded bands clear of the lower. A new floor does not push what is below it. */
  function liftClear(layout, spec, crowded) {
    if (crowded.upper.spec) {
      return `${crowded.lower.name} and ${floorName(spec)} need at least 2 solid blocks between them.`;
    }
    return shiftBand(layout, crowded.upper, crowded.dy) ? "" : PAST_LIMIT;
  }

  /** The stack has room for the new floor: order the floors, unless the crawl was pushed out of the world. */
  function settleStack(layout) {
    for (const crawl of crawlRecords(layout)) {
      const air = crawlAir(layout, crawl);
      if (air && (air[0] < 0 || air[1] > WORLD_TOP)) return "A crawlspace would leave Y 0 through 255.";
    }
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

  /** The rim a site uses. One that was never set is one block. */
  function rimOf(site) {
    return Number.isInteger(site.rim) ? site.rim : 1;
  }

  /** The outer square whose inside, past the rim, is this baseline. */
  function squareAround(site, box) {
    const rim = rimOf(site);
    return { x0: box.x0 - rim, x1: box.x1 + rim, z0: box.z0 - rim, z1: box.z1 + rim };
  }

  /** How many chunk columns and rows a square covers, and the chunk where it starts. */
  function chunkCount(square) {
    return {
      cols: (square.x1 >> 4) - (square.x0 >> 4) + 1,
      rows: (square.z1 >> 4) - (square.z0 >> 4) + 1,
      x0: square.x0 >> 4,
      z0: square.z0 >> 4,
    };
  }

  /** What is wrong with a baseline, before anything already placed is considered, or "". */
  function siteProblem(site, box) {
    const square = squareAround(site, box);
    const edges = [square.x0, square.x1, square.z0, square.z1, square.z0 - 1];
    if (edges.some((n) => n < -WORLD_EDGE || n > WORLD_EDGE)) return "X and Z stay within 30,000,000 of the origin.";
    const count = chunkCount(square);
    if (count.cols < 1 || count.rows < 1) return "The baseline covers no chunks.";
    return "";
  }

  /** A ground height from the old estimate where that chunk still exists, else a sample of it. */
  function groundAt(site, col, row, origin) {
    const oz = row - origin.z;
    const ox = col - origin.x;
    const line = site.terrain && oz >= 0 && oz < site.terrain.length ? site.terrain[oz] : null;
    if (line && ox >= 0 && ox < line.length && Number.isInteger(line[ox])) return line[ox];
    const sample = site.terrain && site.terrain[0] && site.terrain[0][0];
    return Number.isInteger(sample) ? sample : GROUND_FALLBACK;
  }

  /**
   * Move a site so its inside is this baseline. The square grows by the rim, and the chunk
   * letters and ground estimate follow. Returns a problem, or "".
   */
  function placeSite(site, box) {
    const problem = siteProblem(site, box);
    if (problem) return problem;
    const square = squareAround(site, box);
    const count = chunkCount(square);
    const oldOrigin = { x: site.square.x0 >> 4, z: site.square.z0 >> 4 };
    const names = [];
    for (let c = 0; c < count.cols; c += 1) names.push(Core.columnName(c));
    const terrain = [];
    for (let r = 0; r < count.rows; r += 1) {
      const line = [];
      for (let c = 0; c < count.cols; c += 1) line.push(groundAt(site, count.x0 + c, count.z0 + r, oldOrigin));
      terrain.push(line);
    }
    const sameOrigin = oldOrigin.x === count.x0 && oldOrigin.z === count.z0;
    const dirty = sameOrigin ? (site.dirty || []).filter((name) => {
      const parts = Core.chunkParts(name);
      return parts && names.indexOf(parts.letters) >= 0 && parts.row >= 1 && parts.row <= count.rows;
    }) : [];
    site.rim = rimOf(site);
    site.square = square;
    site.sheet = { x0: square.x0, x1: square.x1, z0: square.z0 - 1, z1: square.z1 };
    site.columns = names.every((name) => name.length === 1) ? names.join("") : names;
    site.terrain = terrain;
    site.dirty = dirty;
    return "";
  }

  Object.assign(Core, {
    floorHeight, floorAir, crawlAir, floorName, crawlName, crawlRecords, crawlLayerId, crawlByLayer,
    isCrawlLayer, newCrawl, addCrawl, removeCrawl, rehangCrawl, trenchCrawl, layers, layerName, bandProblem, adjacentCrawls,
    floorUse, seatFloor,
    inner, hasSpan, spanOf, mainFloor, isMain, floorBox, floorLimit, writeSpan, siteProblem, placeSite,
  });
})(typeof window !== "undefined" ? window : globalThis);
