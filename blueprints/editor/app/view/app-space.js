/* Switching between the plan and the 3D view. view3d.js draws the 3D view; this file shows and hides
   it, and lists the floors it can show. */
(function (App) {
  "use strict";

  const { Core, CATALOG, $, canvas, state, L, status, View, Paint, PaintContents } = App;

  const HOW_TO = "Drag to turn. Right-drag to slide. The wheel zooms. Double-click frames the thing under the pointer.";

  /** One checkbox per floor and for the crawl, highest first, that shows or hides it in 3D. */
  function renderLayers() {
    const box = $("space-layers");
    box.innerHTML = "";
    for (const layer of Core.layers(L()).slice().reverse()) {
      const label = document.createElement("label");
      label.className = "toggle";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = true;
      input.addEventListener("change", () => window.View3D.setVisible(layer.id, input.checked));
      label.append(input, document.createTextNode(` ${layer.name}`));
      box.append(label);
    }
  }

  /** Start the 3D view on the open plan. Returns false, with a message, when the window cannot draw it. */
  function start() {
    $("space").hidden = false;
    const hears = (text) => { $("cursor").textContent = text; };
    if (window.View3D.open($("space"), L(), CATALOG, hears, PaintContents.padFill)) {
      renderLayers();
      return true;
    }
    $("space").hidden = true;
    status("This window has no 3D view.", true);
    return false;
  }

  /** Stop the 3D view. */
  function stop() {
    window.View3D.close();
    $("space").hidden = true;
  }

  /** Give the keyboard and the status bar to the view that is now shown. */
  function hand(on) {
    if (on) {
      status(HOW_TO);
      $("cursor").textContent = "";
      $("space").focus();
      return;
    }
    status("");
    View.resize();
    Paint.paintFrame();
    canvas.focus();
  }

  /** Show the 3D view, or go back to the plan. */
  function set(on) {
    if (on === state.space) return;
    if (on && !start()) return;
    if (!on) stop();
    state.space = on;
    document.body.classList.toggle("view3d", on);
    $("view-3d").setAttribute("aria-pressed", String(on));
    if (on) window.View3D.resize();
    $("space-panel").hidden = !on;
    hand(on);
  }

  Object.assign(App.Space, { set });
})(window.App);
