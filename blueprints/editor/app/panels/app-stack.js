/* The floors column: every floor and the pipe crawl, highest first, with the rock between them,
   and moving from one to another. Each floor remembers its own selection while another is shown. */
(function (App) {
  "use strict";

  const { Core, $, state, L, make, Sel, Space, Tools, FloorDialog, Panels } = App;

  // A new floor is 5 high, with 2 solid blocks between it and the band it sits next to.
  const NEW_FLOOR_HEIGHT = 5;
  const ROCK_BETWEEN = 2;
  // A pen darker than this, red and green and blue added up, is lightened so its stripe shows on the dark column.
  const DARK_PEN = 180;

  // ---- one layer ----

  /** A layer's air as [low Y, high Y]. */
  function layerAir(layer) {
    if (layer.crawl) return layer.air;
    return Core.floorAir(layer.floor);
  }

  /** The color of a floor's stripe: its pen, lightened when the pen is too dark to see. */
  function penStripe(hex) {
    const n = parseInt(String(hex).slice(1), 16);
    if (!Number.isFinite(n)) return hex;
    const r = (n >> 16) & 255;
    const g = (n >> 8) & 255;
    const b = n & 255;
    if (r + g + b >= DARK_PEN) return hex;
    return `rgb(${Math.min(255, r + 78)}, ${Math.min(255, g + 70)}, ${Math.min(255, b + 60)})`;
  }

  /** Show a layer and open the dialog that edits it. */
  function editLayer(id) {
    if (state.layer !== id) switchLayer(id);
    FloorDialog.open("edit");
  }

  // ---- the column ----

  /** The space between two bands, or past the end ones: how much rock it is, and a + that adds a floor there. */
  function stackGap(kind, layer, rock) {
    const row = make("div", "stack-gap");
    if (rock != null) row.append(make("span", "", `${rock} rock`));
    const air = layerAir(layer);
    const below = kind === "below";
    const slab = below ? air[0] - ROCK_BETWEEN - NEW_FLOOR_HEIGHT - 1 : air[1] + ROCK_BETWEEN;
    const title = `Add a floor ${below ? "below" : "above"} ${layer.name}`;
    const add = make("button", "stack-add", "+");
    add.type = "button";
    add.title = title;
    add.setAttribute("aria-label", title);
    add.addEventListener("click", () => FloorDialog.open("add", { slab }));
    row.append(add);
    return row;
  }

  /** Say what a band is, for a tooltip and for a screen reader: its name, its Y, and a floor's footprint. */
  function describeBand(row, layer, air) {
    const box = layer.crawl ? null : Core.floorBox(L(), layer.floor);
    if (!box) {
      row.setAttribute("aria-label", `${layer.name}, Y ${air[0]} to ${air[1]}`);
      return;
    }
    row.title = `X ${box.x0}..${box.x1}, Z ${box.z0}..${box.z1}`;
    row.setAttribute("aria-label", `${layer.name}, Y ${air[0]} to ${air[1]}, X ${box.x0} to ${box.x1}, Z ${box.z0} to ${box.z1}`);
  }

  /** The pen button on a band, which opens the dialog that edits it. */
  function bandEditButton(layer) {
    const edit = make("button", "band-edit");
    edit.type = "button";
    edit.innerHTML = Tools.PEN_ICON;
    edit.title = `Edit ${layer.name}`;
    edit.setAttribute("aria-label", `Edit ${layer.name}`);
    // A press on the pen is not a press on the band.
    edit.addEventListener("pointerdown", (event) => event.stopPropagation());
    edit.addEventListener("click", (event) => {
      event.stopPropagation();
      editLayer(layer.id);
    });
    return edit;
  }

  /** A band's stripe in the floor's pen, and its name over its Y. */
  function bandFace(layer, air) {
    const pen = make("span", "stack-pen");
    if (!layer.crawl && layer.floor.pen) pen.style.background = penStripe(layer.floor.pen);
    const copy = make("span", "stack-copy");
    copy.append(make("span", "stack-name", layer.name), make("span", "stack-y", `Y ${air[0]}–${air[1]}`));
    return [pen, copy];
  }

  /** A click or Enter shows a band's layer, and a double-click edits it. */
  function listenToBand(row, layer) {
    row.addEventListener("dblclick", () => editLayer(layer.id));
    row.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      switchLayer(layer.id);
    });
    row.addEventListener("click", (event) => {
      if (event.target.closest(".band-edit")) return;
      if (state.layer !== layer.id) switchLayer(layer.id);
    });
  }

  /** One floor, or the crawl, as a band of the column. */
  function stackBand(layer) {
    const air = layerAir(layer);
    const on = layer.id === state.layer;
    const row = make("div", `stack-band${on ? " on" : ""}${layer.crawl ? " crawl" : ""}`);
    if (!layer.crawl) row.dataset.floor = layer.id;
    else row.dataset.crawl = layer.id;
    row.tabIndex = 0;
    row.setAttribute("role", "button");
    row.setAttribute("aria-pressed", String(on));
    describeBand(row, layer, air);
    row.append(...bandFace(layer, air), bandEditButton(layer));
    listenToBand(row, layer);
    return row;
  }

  /** The floors and the pipe crawl, highest first, with the rock between them. */
  function render() {
    const body = $("stack-body");
    if (!body) return;
    body.innerHTML = "";
    const bands = Core.layers(L()).slice().reverse();
    if (!bands.length) return;
    body.append(stackGap("above", bands[0], null));
    bands.forEach((layer, i) => {
      body.append(stackBand(layer));
      const lower = bands[i + 1];
      if (!lower) {
        body.append(stackGap("below", layer, null));
        return;
      }
      body.append(stackGap("between", lower, layerAir(layer)[0] - layerAir(lower)[1] - 1));
    });
  }

  // ---- a selection for each layer ----

  /** One selected item as a pin that still names it after another layer's edits have renumbered the lists. */
  function pinOf(item) {
    if (item.kind === "machines") return { kind: "machines", wall: item.rec.id, slot: item.slot };
    if (item.kind === "pads") return { kind: "pads", num: item.rec.num };
    if (item.kind === "marks") {
      return { kind: "marks", room: item.rec.room, x0: item.rec.x0, z0: item.rec.z0, short: item.rec.short || "" };
    }
    if (item.rec && item.rec.id) return { kind: item.kind, id: item.rec.id };
    return null;
  }

  /** A selection as pins, or null when it names nothing that can be found again. */
  function pinSelection(refs) {
    if (!refs || !refs.length) return null;
    const pins = [];
    for (const ref of refs) {
      const item = Sel.resolve(ref);
      const pin = item && pinOf(item);
      if (pin) pins.push(pin);
    }
    return pins.length ? pins : null;
  }

  /** Where the record a pin names is in its list now, or -1. */
  function indexOfPin(pin) {
    if (pin.kind === "machines") return L().walls.findIndex((wall) => wall.id === pin.wall);
    if (pin.kind === "pads") return L().pads.findIndex((pad) => pad.num === pin.num);
    if (pin.kind === "marks") {
      return L().marks.findIndex((mark) => mark.room === pin.room && mark.x0 === pin.x0 && mark.z0 === pin.z0
        && (mark.short || "") === pin.short);
    }
    const list = L()[pin.kind];
    return list ? list.findIndex((row) => row.id === pin.id) : -1;
  }

  /** Pins back as a selection, without the ones whose records are gone. Null when none are left. */
  function unpinSelection(pins) {
    if (!pins || !pins.length) return null;
    const refs = [];
    for (const pin of pins) {
      const index = indexOfPin(pin);
      if (index < 0) continue;
      const ref = { kind: pin.kind, index };
      if (pin.kind === "machines") ref.slot = pin.slot;
      refs.push(ref);
    }
    return refs.length ? refs : null;
  }

  /** Remember the selection of the layer being shown. */
  function parkLayer() {
    if (!state.layout || !state.layer) return;
    const box = state.instances[state.layer] || (state.instances[state.layer] = {});
    box.sel = pinSelection(state.sel);
  }

  /** Leave the layer being shown and open another, with its own selection. Nothing is redrawn. */
  function openLayer(id) {
    if (state.layer && state.layer !== id) parkLayer();
    state.layer = id;
    const box = state.instances[id];
    state.sel = unpinSelection(box && box.sel);
  }

  /** Show another layer. The 3D view closes, a sketch is dropped, and a tool the layer lacks is put down. */
  function switchLayer(id) {
    if (state.space) Space.set(false);
    if (id !== state.layer) openLayer(id);
    state.draw = null;
    if (!Tools.available(state.tool)) Tools.set("select", true);
    Sel.fix();
    Panels.refresh();
  }

  Object.assign(App.Stack, { render, openLayer, switchLayer });
})(window.App);
