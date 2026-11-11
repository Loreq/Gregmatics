/* The picture a floor's footprint is typed into: a compass rose with an X and a Z at each of its
   four corners. Settings uses it for the open plan and New for the plan about to be made.
   A footprint is a box, { x0, x1, z0, z1 }, both ends inside.

   Corner numbers stay where they are typed. Crossing the opposite side does not swap them:
   the same rose turns so N still faces the smaller Z and E the larger X. Letters stay upright.
   Grid cells stay square, letterboxed in the picture. */
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
  // Where a letter sits beside the arrow on that edge of the original rose.
  const LETTER_SEAT = {
    top: { x: 54.2, y: 5.4, anchor: "start" },
    right: { x: 91.6, y: 45.2, anchor: "end" },
    bottom: { x: 54.2, y: 97.2, anchor: "start" },
    left: { x: 8.4, y: 45.2, anchor: "start" },
  };

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
    return Core.baselineProblem(L(), spec, box);
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
        <label>X<input data-pair="${place}" data-axis="x" inputmode="numeric" autocomplete="off" spellcheck="false" aria-label="${WHERE[place]} X" value="${x}"></label>
        <label>Z<input data-pair="${place}" data-axis="z" inputmode="numeric" autocomplete="off" spellcheck="false" aria-label="${WHERE[place]} Z" value="${z}"></label>
      </div>`;
  }

  /** The picture's markup: a compass rose with a pair of inputs at each corner. The lines keep their white space. */
  function markup(screen) {
    return `<div class="coord">
      <div class="sq">
        <svg class="rose" viewBox="0 0 100 100" aria-hidden="true">
          <g class="grid"></g>
          <g class="rose-arms">
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
          </g>
          <g class="mark" fill="currentColor" font-size="3.4" font-family="Segoe UI, sans-serif">
            <text data-side="top"></text>
            <text data-side="right"></text>
            <text data-side="bottom"></text>
            <text data-side="left"></text>
          </g>
        </svg>
        ${cornerMarkup("nw", screen.left, screen.top)}
        ${cornerMarkup("ne", screen.right, screen.top)}
        ${cornerMarkup("sw", screen.left, screen.bottom)}
        ${cornerMarkup("se", screen.right, screen.bottom)}
      </div>
    </div>`;
  }

  /** A whole number typed into an input, or null. */
  function parseNum(raw) {
    const text = raw.trim();
    return /^-?\d+$/.test(text) ? Number(text) : null;
  }

  /** Whether a bound field may hold this text: empty, a minus, or digits. */
  function numberText(text) {
    return /^-?\d*$/.test(text);
  }

  /** The spacing of the rose's grid for a footprint this many blocks across. */
  function gridStep(span) {
    for (const step of GRID_STEPS) if (span / step <= MOST_LINES) return step;
    return GRID_STEPS[GRID_STEPS.length - 1];
  }

  /** Seat a compass letter on one side of the square. */
  function seatLetter(node, side, letter) {
    const seat = LETTER_SEAT[side];
    node.textContent = letter;
    node.setAttribute("x", String(seat.x));
    node.setAttribute("y", String(seat.y));
    node.setAttribute("text-anchor", seat.anchor);
    node.removeAttribute("transform");
  }

  /** The corner editor in one host element. `onCommit(box)` hears every change that reads as whole numbers. */
  class CornerEditor {
    constructor(host, box, onCommit) {
      this.host = host;
      // The numbers as they sit on the picture. Left may be a higher X than right; the rose turns to match.
      this.screen = { left: box.x0, right: box.x1, top: box.z0, bottom: box.z1 };
      this.onCommit = onCommit;
      // The picture as it was when each input took the focus: typing moves that corner from there.
      this.bases = new Map();
      host.innerHTML = markup(this.screen);
      this.paintRose();
      this.paintGrid();
      for (const input of this.inputs()) this.listen(input);
    }

    /** The eight inputs. */
    inputs() {
      return this.host.querySelectorAll("input");
    }

    /** A copy of the footprint as it stands, low number first. */
    box() {
      const { left, right, top, bottom } = this.screen;
      return {
        x0: Math.min(left, right), x1: Math.max(left, right),
        z0: Math.min(top, bottom), z1: Math.max(top, bottom),
      };
    }

    /** What each input should read. A side keeps the number typed on it. */
    texts() {
      const { left, right, top, bottom } = this.screen;
      return {
        "nw-x": String(left), "nw-z": String(top),
        "ne-x": String(right), "ne-z": String(top),
        "sw-x": String(left), "sw-z": String(bottom),
        "se-x": String(right), "se-z": String(bottom),
      };
    }

    /**
     * Turn the rose so north stays toward the smaller Z and east toward the larger X.
     * The arms and arrowheads mirror. Letters move to that edge and stay upright.
     */
    paintRose() {
      const flipX = this.screen.left > this.screen.right;
      const flipZ = this.screen.top > this.screen.bottom;
      const sx = flipX ? -1 : 1;
      const sy = flipZ ? -1 : 1;
      const arms = this.host.querySelector(".rose-arms");
      if (sx === 1 && sy === 1) arms.removeAttribute("transform");
      else arms.setAttribute("transform", `translate(50 50) scale(${sx} ${sy}) translate(-50 -50)`);
      const sideLetter = {
        top: flipZ ? "S" : "N",
        bottom: flipZ ? "N" : "S",
        right: flipX ? "W" : "E",
        left: flipX ? "E" : "W",
      };
      for (const node of this.host.querySelectorAll(".mark text")) {
        seatLetter(node, node.dataset.side, sideLetter[node.dataset.side]);
      }
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

    /**
     * Redraw the grid behind the rose. Cells stay square and letterbox in the picture, as they do
     * when the sides are in order. Screen-left still maps to `left` and screen-top to `top`.
     */
    paintGrid() {
      const group = this.host.querySelector(".grid");
      while (group.firstChild) group.removeChild(group.firstChild);
      const { left, right, top, bottom } = this.screen;
      const spanX = Math.abs(right - left);
      const spanZ = Math.abs(bottom - top);
      const span = Math.max(spanX, spanZ);
      if (span < 1) return;
      const step = gridStep(span);
      const scale = 100 / span;
      const originX = (100 - spanX * scale) / 2;
      const originY = (100 - spanZ * scale) / 2;
      const signX = right >= left ? 1 : -1;
      const signZ = bottom >= top ? 1 : -1;
      const pixelX = (x) => originX + signX * (x - left) * scale;
      const pixelZ = (z) => originY + signZ * (z - top) * scale;
      const worldX = (px) => left + signX * (px - originX) / scale;
      const worldZ = (py) => top + signZ * (py - originY) / scale;
      const xLo = Math.min(worldX(0), worldX(100));
      const xHi = Math.max(worldX(0), worldX(100));
      const zLo = Math.min(worldZ(0), worldZ(100));
      const zHi = Math.max(worldZ(0), worldZ(100));
      const firstX = Math.ceil(xLo / step - 1e-9);
      const lastX = Math.floor(xHi / step + 1e-9);
      for (let i = firstX; i <= lastX; i += 1) {
        const x = pixelX(i * step);
        this.gridLine(group, x, 0, x, 100);
      }
      const firstZ = Math.ceil(zLo / step - 1e-9);
      const lastZ = Math.floor(zHi / step + 1e-9);
      for (let i = firstZ; i <= lastZ; i += 1) {
        const z = pixelZ(i * step);
        this.gridLine(group, 0, z, 100, z);
      }
    }

    /** Make every input but the one being typed in read what the footprint now is, and redraw the grid. */
    paint(except) {
      const text = this.texts();
      for (const input of this.inputs()) {
        if (input === except) continue;
        const next = text[`${input.dataset.pair}-${input.dataset.axis}`];
        if (typeof next === "string" && input.value !== next) input.value = next;
      }
      this.paintRose();
      this.paintGrid();
    }

    /**
     * Take what is typed into that side of the picture. The opposite side keeps its number.
     * Returns false when it is not a whole number.
     */
    absorb(input) {
      const n = parseNum(input.value);
      if (n === null) return false;
      const base = this.bases.get(input) || { ...this.screen };
      this.screen = {
        left: base.left,
        right: base.right,
        top: base.top,
        bottom: base.bottom,
      };
      const place = input.dataset.pair;
      if (input.dataset.axis === "x") {
        if (place === "nw" || place === "sw") this.screen.left = n;
        else this.screen.right = n;
      } else if (place === "nw" || place === "ne") this.screen.top = n;
      else this.screen.bottom = n;
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
      input.addEventListener("beforeinput", (event) => {
        if (event.inputType && event.inputType.startsWith("delete")) return;
        const start = input.selectionStart ?? input.value.length;
        const end = input.selectionEnd ?? input.value.length;
        const next = input.value.slice(0, start) + (event.data ?? "") + input.value.slice(end);
        if (!numberText(next)) event.preventDefault();
      });
      input.addEventListener("focus", () => {
        this.bases.set(input, {
          left: this.screen.left,
          right: this.screen.right,
          top: this.screen.top,
          bottom: this.screen.bottom,
        });
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
