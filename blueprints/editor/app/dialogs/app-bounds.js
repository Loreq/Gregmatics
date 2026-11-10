/* The picture a floor's footprint is typed into: a compass rose with an X and a Z at each of its
   four corners. Settings uses it for the open plan and New for the plan about to be made.
   A footprint is a box, { x0, x1, z0, z1 }, both ends inside. */
(function (App) {
  "use strict";

  const { Core, L } = App;

  const WHERE = { nw: "North-west", ne: "North-east", sw: "South-west", se: "South-east" };
  const SVG = "http://www.w3.org/2000/svg";
  // Minecraft 1.7.10: X and Z stay inside 30,000,000 of the origin.
  const WORLD_EDGE = 30000000;
  // The spacings the rose's grid may have, and how many lines across it shows at most.
  const GRID_STEPS = [1, 2, 5, 10, 20, 25, 50, 100, 200, 500, 1000, 2000, 5000, 10000];
  const MOST_LINES = 12;
  const NOT_READ = { x0: NaN, x1: NaN, z0: NaN, z1: NaN };

  // ---- problems with a footprint ----

  /** What is wrong with a box as a place in the world, or "". */
  function worldProblem(next) {
    const nums = [next.x0, next.x1, next.z0, next.z1];
    if (!nums.every((n) => Number.isInteger(n))) return "X and Z are whole numbers.";
    if (next.x0 > next.x1 || next.z0 > next.z1) return "Each side runs from the low number to the high one.";
    if (nums.some((n) => n < -WORLD_EDGE || n > WORLD_EDGE)) return "X and Z stay within 30,000,000 of the origin.";
    return "";
  }

  /** What is wrong with a box as a floor's new footprint, or "". */
  function boundsProblem(floor, next) {
    if (!floor) return "That floor is gone.";
    const vanilla = worldProblem(next);
    if (vanilla) return vanilla;
    const box = { x0: next.x0, x1: next.x1, z0: next.z0, z1: next.z1 };
    const spec = { id: floor.id, name: floor.name, slab: floor.slab, height: Core.floorHeight(floor), pen: floor.pen };
    return Core.spanProblem(L(), spec, box);
  }

  /** What the picture starts from for a floor: the most it may cover, what it covers, and its air. */
  function floorSpec(floor) {
    const layout = L();
    const air = Core.floorAir(floor);
    return { limit: Core.floorLimit(layout, floor), box: Core.floorBox(layout, floor), y0: air[0], y1: air[1] };
  }

  // ---- the picture ----

  /** One corner's X and Z inputs, as markup. */
  function cornerMarkup(place, x, z) {
    return `<div class="corner ${place}">
        <label>X<input data-pair="${place}" data-axis="x" autocomplete="off" aria-label="${WHERE[place]} X" value="${x}"></label>
        <label>Z<input data-pair="${place}" data-axis="z" autocomplete="off" aria-label="${WHERE[place]} Z" value="${z}"></label>
      </div>`;
  }

  /** The picture's markup: a compass rose with a pair of inputs at each corner. The lines keep their white space. */
  function markup(values) {
    return `<div class="coord">
      <div class="sq">
        <svg class="rose" viewBox="0 0 100 100" aria-hidden="true">
          <g class="grid"></g>
          <g class="axis" fill="none" stroke="currentColor" stroke-width="0.55" stroke-linecap="round">
            <line x1="50" y1="7.8" x2="50" y2="48.3"/>
            <line x1="50" y1="51.7" x2="50" y2="92.2"/>
            <line x1="7.8" y1="50" x2="48.3" y2="50"/>
            <line x1="51.7" y1="50" x2="92.2" y2="50"/>
            <circle cx="50" cy="50" r="0.9"/>
          </g>
          <svg class="lucide" x="46.4" y="0.3" width="7.2" height="7.2" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 7-7 7 7"/><path d="M12 19V5"/></svg>
          <svg class="lucide" x="92.5" y="46.4" width="7.2" height="7.2" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
          <svg class="lucide" x="46.4" y="92.5" width="7.2" height="7.2" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="m19 12-7 7-7-7"/></svg>
          <svg class="lucide" x="0.3" y="46.4" width="7.2" height="7.2" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 19-7-7 7-7"/><path d="M19 12H5"/></svg>
          <g class="mark" fill="currentColor" font-size="3.4" font-family="Segoe UI, sans-serif">
            <text x="54.2" y="5.4">N</text>
            <text x="91.6" y="45.2" text-anchor="end">E</text>
            <text x="54.2" y="97.2">S</text>
            <text x="8.4" y="45.2">W</text>
          </g>
        </svg>
        ${cornerMarkup("nw", values.x0, values.z0)}
        ${cornerMarkup("ne", values.x1, values.z0)}
        ${cornerMarkup("sw", values.x0, values.z1)}
        ${cornerMarkup("se", values.x1, values.z1)}
      </div>
    </div>`;
  }

  /** A whole number typed into an input, or null. */
  function parseNum(raw) {
    const text = raw.trim();
    return /^-?\d+$/.test(text) ? Number(text) : null;
  }

  /** The spacing of the rose's grid for a footprint this many blocks across. */
  function gridStep(span) {
    for (const step of GRID_STEPS) if (span / step <= MOST_LINES) return step;
    return GRID_STEPS[GRID_STEPS.length - 1];
  }

  /** The corner editor in one host element. `onCommit(box)` hears every change that reads as whole numbers. */
  class CornerEditor {
    constructor(host, box, onCommit) {
      this.host = host;
      this.values = { x0: box.x0, x1: box.x1, z0: box.z0, z1: box.z1 };
      this.onCommit = onCommit;
      // The footprint as it was when each input took the focus: typing moves that corner from there.
      this.bases = new Map();
      host.innerHTML = markup(this.values);
      this.paintGrid();
      for (const input of this.inputs()) this.listen(input);
    }

    /** The eight inputs. */
    inputs() {
      return this.host.querySelectorAll("input");
    }

    /** A copy of the footprint as it stands. */
    box() {
      const { x0, x1, z0, z1 } = this.values;
      return { x0, x1, z0, z1 };
    }

    /** What each input should read, by its corner and axis. */
    texts() {
      const { x0, x1, z0, z1 } = this.values;
      return {
        "nw-x": String(x0), "nw-z": String(z0),
        "ne-x": String(x1), "ne-z": String(z0),
        "sw-x": String(x0), "sw-z": String(z1),
        "se-x": String(x1), "se-z": String(z1),
      };
    }

    /** Add one line to the rose's grid. */
    gridLine(group, x1, y1, x2, y2) {
      const line = document.createElementNS(SVG, "line");
      line.setAttribute("x1", x1);
      line.setAttribute("y1", y1);
      line.setAttribute("x2", x2);
      line.setAttribute("y2", y2);
      group.appendChild(line);
    }

    /** Redraw the grid behind the rose: lines at round coordinates, so the footprint's shape can be seen. */
    paintGrid() {
      const group = this.host.querySelector(".grid");
      while (group.firstChild) group.removeChild(group.firstChild);
      const { x0, x1, z0, z1 } = this.values;
      const spanX = Math.max(x1 - x0, 0);
      const spanZ = Math.max(z1 - z0, 0);
      const span = Math.max(spanX, spanZ);
      if (span < 1) return;
      const step = gridStep(span);
      const scale = 100 / span;
      const originX = (100 - spanX * scale) / 2;
      const originY = (100 - spanZ * scale) / 2;
      const worldX = (px) => x0 + (px - originX) / scale;
      const worldZ = (py) => z0 + (py - originY) / scale;
      const firstX = Math.ceil(worldX(0) / step - 1e-9);
      const lastX = Math.floor(worldX(100) / step + 1e-9);
      for (let i = firstX; i <= lastX; i += 1) {
        this.gridLine(group, originX + (i * step - x0) * scale, 0, originX + (i * step - x0) * scale, 100);
      }
      const firstZ = Math.ceil(worldZ(0) / step - 1e-9);
      const lastZ = Math.floor(worldZ(100) / step + 1e-9);
      for (let i = firstZ; i <= lastZ; i += 1) {
        this.gridLine(group, 0, originY + (i * step - z0) * scale, 100, originY + (i * step - z0) * scale);
      }
    }

    /** Make every input but the one being typed in read what the footprint now is, and redraw the grid. */
    paint(except) {
      const text = this.texts();
      for (const input of this.inputs()) {
        if (input === except) continue;
        const next = text[`${input.dataset.pair}-${input.dataset.axis}`];
        if (input.value !== next) input.value = next;
      }
      this.paintGrid();
    }

    /**
     * Take what is typed in one input into the footprint. The corner moves from where the footprint
     * was when the input took the focus, and ends that cross over swap. Returns false when it is not a whole number.
     */
    absorb(input) {
      const n = parseNum(input.value);
      if (n === null) return false;
      const base = this.bases.get(input) || this.box();
      const place = input.dataset.pair;
      let west = base.x0;
      let east = base.x1;
      let north = base.z0;
      let south = base.z1;
      if (input.dataset.axis === "x") {
        if (place === "nw" || place === "sw") west = n;
        else east = n;
      } else if (place === "nw" || place === "ne") north = n;
      else south = n;
      this.values.x0 = Math.min(west, east);
      this.values.x1 = Math.max(west, east);
      this.values.z0 = Math.min(north, south);
      this.values.z1 = Math.max(north, south);
      return true;
    }

    /** The footprint as typed. Every side is NaN while the input with the focus does not read as a whole number. */
    read() {
      const active = this.host.querySelector("input:focus");
      if (active && !this.absorb(active)) return { ...NOT_READ };
      return this.box();
    }

    /** Follow one input: remember the footprint when it takes the focus, and take in what is typed. */
    listen(input) {
      input.addEventListener("focus", () => {
        this.bases.set(input, this.box());
      });
      input.addEventListener("input", () => {
        if (!this.absorb(input)) return;
        this.paint(input);
        this.onCommit(this.read());
      });
      input.addEventListener("blur", () => {
        if (this.absorb(input)) this.paint(null);
      });
    }
  }

  /** Put the picture in a host element, starting from spec.box. Returns an editor whose read() gives the footprint. */
  function mount(host, spec) {
    return new CornerEditor(host, spec.box, spec.onCommit);
  }

  Object.assign(App.Bounds, { worldProblem, boundsProblem, floorSpec, mount });
})(window.App);
