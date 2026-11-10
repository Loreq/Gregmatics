/* The sizes the wiki allows a multiblock, and moving a placed one onto a legal size.
   A catalog entry has one `size`, or a list of `fits`, or a `span` of ranges. A turn swaps width and
   depth, so either way round is legal. A wallshared row is judged one module at a time.
   catalog.py Multi.allows is the same rule. */
(function (root) {
  "use strict";

  const Core = root.Core;
  const { orderedBox, roomById, moduleSize, rowSpan, setPadBox, laid } = Core;

  // ---- the rule ----

  /**
   * The sizes a multiblock may have, or null when it has the one `size`.
   * `fits` lists the only legal [width, depth, height] sizes. `span` holds ranges: four numbers are one
   * range for both sides and then one for the height, and six are width, depth, and height.
   */
  function sizeRule(spec) {
    if (!spec) return null;
    if (Array.isArray(spec.fits) && spec.fits.length) return { fits: spec.fits };
    const s = spec.span;
    if (!Array.isArray(s) || (s.length !== 4 && s.length !== 6)) return null;
    const rule = s.length === 4
      ? { x: [s[0], s[1]], z: [s[0], s[1]], h: [s[2], s[3]] }
      : { x: [s[0], s[1]], z: [s[2], s[3]], h: [s[4], s[5]] };
    rule.square = Boolean(spec.square);
    rule.odd = Boolean(spec.odd);
    return rule;
  }

  /** Whether a length is in a range, and odd when the rule needs it odd. */
  function inSide(n, side, odd) {
    return n >= side[0] && n <= side[1] && (!odd || n % 2 === 1);
  }

  /** Whether a footprint matches two sides, either way round. */
  function eitherWay(w, d, a, b) {
    return (w === a && d === b) || (w === b && d === a);
  }

  /** Whether a footprint fits a ranged rule the way the catalog lists it. */
  function fitsDirect(rule, w, d) {
    return inSide(w, rule.x, rule.odd) && inSide(d, rule.z, rule.odd);
  }

  /** Whether one module can be built this size. */
  function sizeAllows(spec, w, d, h) {
    const rule = sizeRule(spec);
    if (!rule) return h === spec.size[2] && eitherWay(w, d, spec.size[0], spec.size[1]);
    if (rule.fits) return rule.fits.some((f) => f[2] === h && eitherWay(w, d, f[0], f[1]));
    if ((rule.square && w !== d) || h < rule.h[0] || h > rule.h[1]) return false;
    return fitsDirect(rule, w, d) || fitsDirect(rule, d, w);
  }

  /** A range in a few characters: 3–15, or 3/5/7 when only odd lengths count. */
  function sideText(side, odd) {
    if (side[0] === side[1]) return String(side[0]);
    if (!odd) return `${side[0]}–${side[1]}`;
    const nums = [];
    for (let n = side[0]; n <= side[1]; n += 1) if (n % 2 === 1) nums.push(n);
    return nums.join("/");
  }

  /** The legal sizes in a few characters, written the way catalog.py size_text writes them. */
  function sizeText(spec) {
    const rule = sizeRule(spec);
    if (!rule) return spec.size.join("×");
    if (rule.fits) return rule.fits.map((f) => f.join("×")).join(", ");
    const high = sideText(rule.h, false);
    if (rule.square) return `${sideText(rule.x, rule.odd)} square × ${high}`;
    return `${sideText(rule.x, rule.odd)}×${sideText(rule.z, rule.odd)}×${high}`;
  }

  /** The height a placed multiblock has. The catalog's own height is stored as no `h`. */
  function padHeight(pad, spec) {
    return pad.h || spec.size[2];
  }

  /** What is wrong with a placed multiblock's size, or "". */
  function padSizeProblem(pad, spec) {
    const [w, d] = moduleSize(pad);
    const h = padHeight(pad, spec);
    if (sizeAllows(spec, w, d, h)) return "";
    return `${spec.name} is ${w}×${d}×${h}; the wiki size is ${sizeText(spec)}`;
  }

  // ---- the nearest legal size ----

  /**
   * Which way round a module lies under a rule with ranges: "direct" as the catalog lists it, or "turned".
   * It is "" when both ways fit, as for a square, or when neither does.
   */
  function lies(rule, w, d) {
    if (rule.fits || rule.square) return "";
    const direct = fitsDirect(rule, w, d);
    const turned = fitsDirect(rule, d, w);
    if (direct === turned) return "";
    return direct ? "direct" : "turned";
  }

  /** The value in a list nearest to the one wanted. The first wins a tie. */
  function nearest(values, want) {
    return values.reduce((best, v) => (Math.abs(v - want) < Math.abs(best - want) ? v : best), values[0]);
  }

  /** A length pulled into a range, and onto an odd number when the rule needs one. */
  function snap(n, side, odd) {
    const v = Math.max(side[0], Math.min(n, side[1]));
    if (!odd || v % 2 === 1) return v;
    return v + 1 <= side[1] ? v + 1 : v - 1;
  }

  /** How far a footprint is from a wanted one, in blocks along both sides. */
  function footprintGap(pair, w, d) {
    return Math.abs(pair[0] - w) + Math.abs(pair[1] - d);
  }

  /** The listed footprint nearest to a wanted one. A list of squares follows the side that led. */
  function listedFootprint(rule, w, d, led) {
    if (rule.fits.every((f) => f[0] === f[1])) {
      const side = nearest(rule.fits.map((f) => f[0]), led);
      return [side, side];
    }
    let best = [rule.fits[0][0], rule.fits[0][1]];
    for (const f of rule.fits) {
      for (const pair of [[f[0], f[1]], [f[1], f[0]]]) {
        if (footprintGap(pair, w, d) < footprintGap(best, w, d)) best = pair;
      }
    }
    return best;
  }

  /** The footprint inside a rule's ranges nearest to a wanted one, lying the way `keep` says when it says. */
  function rangedFootprint(rule, w, d, keep) {
    const direct = [snap(w, rule.x, rule.odd), snap(d, rule.z, rule.odd)];
    const turned = [snap(w, rule.z, rule.odd), snap(d, rule.x, rule.odd)];
    if (keep === "direct") return direct;
    if (keep === "turned") return turned;
    return footprintGap(turned, w, d) < footprintGap(direct, w, d) ? turned : direct;
  }

  /**
   * The legal width and depth nearest to a wanted one.
   * `lead` is "x" or "z" when only that side was dragged or typed, so a square follows it.
   * `keep` is "direct" or "turned" to leave a structure with one free side lying the way it already does.
   */
  function legalFootprint(rule, w, d, lead, keep) {
    const led = lead === "x" ? w : lead === "z" ? d : Math.max(w, d);
    if (rule.fits) return listedFootprint(rule, w, d, led);
    if (!rule.square) return rangedFootprint(rule, w, d, keep);
    const side = snap(led, rule.x, rule.odd);
    return [side, side];
  }

  /** The heights a listed size allows for one footprint, lowest first. */
  function listedHeights(rule, w, d) {
    const highs = rule.fits.filter((f) => eitherWay(w, d, f[0], f[1])).map((f) => f[2]);
    return [...new Set(highs)].sort((a, b) => a - b);
  }

  /** The legal height nearest to the one a multiblock has. */
  function legalHeight(pad, spec, rule) {
    const now = padHeight(pad, spec);
    if (!rule) return spec.size[2];
    if (!rule.fits) return Math.max(rule.h[0], Math.min(now, rule.h[1]));
    const highs = listedHeights(rule, ...moduleSize(pad));
    return highs.length ? nearest(highs, now) : now;
  }

  /** Pull a multiblock's height onto one its footprint allows. */
  function settleHeight(pad, spec) {
    const next = legalHeight(pad, spec, sizeRule(spec));
    if (next === spec.size[2]) delete pad.h;
    else pad.h = next;
  }

  /** Slide a footprint back inside its room. A room smaller than the footprint keeps the near corner. */
  function settleInRoom(box, room) {
    if (!room) return box;
    const w = box.x1 - box.x0 + 1;
    const d = box.z1 - box.z0 + 1;
    let { x0, z0 } = box;
    if (w <= room.x1 - room.x0 + 1) x0 = Math.max(room.x0, Math.min(x0, room.x1 - w + 1));
    if (d <= room.z1 - room.z0 + 1) z0 = Math.max(room.z0, Math.min(z0, room.z1 - d + 1));
    return { x0, x1: x0 + w - 1, z0, z1: z0 + d - 1 };
  }

  /** Put a multiblock on a box, slid back inside its room, at a height the box allows. */
  function seatPad(pad, layout, spec, box) {
    setPadBox(pad, settleInRoom(box, roomById(layout, pad.room)));
    settleHeight(pad, spec);
  }

  // ---- resizing a placed multiblock ----

  /** Give every module of a pad one width and depth, the nearest legal ones. A row keeps its count and its corner. */
  function resizeModules(pad, layout, spec, w, d, lead) {
    const rule = sizeRule(spec);
    const [mw, md] = rule ? legalFootprint(rule, w, d, lead, lies(rule, ...moduleSize(pad))) : [w, d];
    seatPad(pad, layout, spec, {
      x0: pad.x0, x1: pad.x0 + rowSpan(mw, pad.wx || 1) - 1,
      z0: pad.z0, z1: pad.z0 + rowSpan(md, pad.wz || 1) - 1,
    });
  }

  /** The side a handle leads with: "x" or "z" when it moves one side only, "" for a corner. */
  function handleLead(pull) {
    const alongX = pull.includes("e") || pull.includes("w");
    const alongZ = pull.includes("n") || pull.includes("s");
    return alongX === alongZ ? "" : alongX ? "x" : "z";
  }

  /**
   * Resize one multiblock to a dragged or typed box. It lands on the nearest legal size, anchored on the
   * side that did not move, and stays inside its room. `from` is the box the drag began with.
   */
  function resizePadBox(pad, layout, spec, box, handle, from) {
    const rule = sizeRule(spec);
    if (!rule) return;
    const { x0, x1, z0, z1 } = orderedBox(box);
    const pull = String(handle || "");
    const start = from || pad;
    const keep = lies(rule, start.x1 - start.x0 + 1, start.z1 - start.z0 + 1);
    const [w, d] = legalFootprint(rule, x1 - x0 + 1, z1 - z0 + 1, handleLead(pull), keep);
    const left = pull.includes("w") ? x1 - w + 1 : x0;
    const top = pull.includes("n") ? z1 - d + 1 : z0;
    seatPad(pad, layout, spec, { x0: left, x1: left + w - 1, z0: top, z1: top + d - 1 });
  }

  // ---- what the panel offers ----

  /** Every length a listed size uses on either side, lowest first. */
  function listedSides(rule) {
    return [...new Set(rule.fits.flatMap((f) => [f[0], f[1]]))].sort((a, b) => a - b);
  }

  /** The fields for a multiblock with a list of sizes: its side or sides, then the heights its footprint allows. */
  function listedFields(rule, w, d, high) {
    const out = [];
    const sides = listedSides(rule);
    if (sides.length > 1 && rule.fits.every((f) => f[0] === f[1])) out.push({ key: "side", value: w, choices: sides });
    else if (sides.length > 1) out.push({ key: "x", value: w, choices: sides }, { key: "z", value: d, choices: sides });
    const highs = listedHeights(rule, w, d);
    if (highs.length > 1) out.push({ key: "h", value: high, choices: highs });
    return out;
  }

  /** Whether a range leaves a choice. */
  function isFree(side) {
    return side[0] !== side[1];
  }

  /**
   * The fields for a structure with one side that grows. That side runs along X or Z by the way the
   * module is turned. A module that fits both ways can grow either way, so it gets both.
   */
  function oneSideFields(rule, w, d) {
    const long = isFree(rule.x) ? rule.x : rule.z;
    const way = lies(rule, w, d);
    const alongX = isFree(rule.x) ? way === "direct" : way === "turned";
    const out = [];
    if (!way || alongX) out.push({ key: "x", value: w, range: long, odd: rule.odd });
    if (!way || !alongX) out.push({ key: "z", value: d, range: long, odd: rule.odd });
    return out;
  }

  /** The width and depth fields for a multiblock with ranges. */
  function footprintFields(rule, w, d) {
    if (rule.square) return isFree(rule.x) ? [{ key: "side", value: w, range: rule.x, odd: rule.odd }] : [];
    if (isFree(rule.x) && isFree(rule.z)) {
      return [{ key: "x", value: w, range: rule.x, odd: rule.odd }, { key: "z", value: d, range: rule.z, odd: rule.odd }];
    }
    return isFree(rule.x) || isFree(rule.z) ? oneSideFields(rule, w, d) : [];
  }

  /**
   * What the panel can change on a placed multiblock. Each entry is { key, value } with a `range`
   * ([low, high], and `odd`) or a list of `choices`. The keys are "side" for a square, "x" and "z" for
   * width and depth, and "h" for height. A wallshared row lists one module.
   */
  function sizeFields(pad, spec) {
    const rule = sizeRule(spec);
    if (!rule) return [];
    const [w, d] = moduleSize(pad);
    const high = padHeight(pad, spec);
    if (rule.fits) return listedFields(rule, w, d, high);
    const out = footprintFields(rule, w, d);
    if (isFree(rule.h)) out.push({ key: "h", value: high, range: rule.h });
    return out;
  }

  /** Set one of the sizeFields. The multiblock lands on the nearest legal size and stays inside its room. */
  function setPadSize(pad, layout, spec, key, value) {
    const n = Math.round(Number(value));
    if (!Number.isFinite(n) || n < 1) return;
    if (key === "h") {
      pad.h = n;
      settleHeight(pad, spec);
      return;
    }
    const [w, d] = moduleSize(pad);
    if (key === "side") resizeModules(pad, layout, spec, n, n, "");
    else if (key === "x") resizeModules(pad, layout, spec, n, d, "x");
    else resizeModules(pad, layout, spec, w, n, "z");
  }

  /** Put a multiblock back on a legal size: the one nearest to what it has now. */
  function fitPad(pad, layout, spec) {
    const [w, d] = moduleSize(pad);
    const [fw, fd] = sizeRule(spec) ? [w, d] : laid(w >= d, spec.size[0], spec.size[1]);
    resizeModules(pad, layout, spec, fw, fd, "");
  }

  Object.assign(Core, {
    sizeRule, sizeText, padSizeProblem, sizeFields, setPadSize, resizePadBox, fitPad,
  });
})(typeof window !== "undefined" ? window : globalThis);
