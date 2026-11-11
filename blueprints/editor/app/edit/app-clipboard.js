/* Copy, cut, paste, and duplicate. state.clip holds detached copies of what was copied:
   { parts, at, cut, pasted }. `at` is the footprint the next paste steps from, and a cut that has
   not been pasted yet may land back where it was. core-clipboard.js finds the spot and inserts the copies. */
(function (App) {
  "use strict";

  const {
    Core, CATALOG, CRAWL, state, L, status,
    Sel, History, Tools, Draw, Edit, Machines, Dialogs, Stack, Panels,
  } = App;

  /** Whether text on the page is selected, so Ctrl+C should copy that text and not the plan's selection. */
  function textSelected() {
    const picked = window.getSelection && window.getSelection();
    return Boolean(picked && picked.toString().trim());
  }

  // ---- copy and cut ----

  /**
   * Keep a detached copy of the selection, or of `opts.items`. Returns whether there was anything to copy.
   * `opts.quiet` says nothing about it. `opts.cut` remembers that the first paste can land back on it.
   */
  function copy(opts) {
    const quiet = Boolean(opts && opts.quiet);
    const source = (opts && opts.items) || Sel.selection();
    const { items } = Edit.actionItems(source);
    if (!items.length) {
      if (!quiet) status("Select something to copy.", true);
      return false;
    }
    const parts = items.map((item) => Core.capture(L(), item.kind, item.index, item.slot));
    state.clip = {
      parts, at: Core.unionBoxes(parts.map((part) => Core.clipBox(part))),
      cut: Boolean(opts && opts.cut), pasted: false,
    };
    Panels.renderButtons();
    if (!quiet) status(`Copied ${Sel.namesOf(items)}.`);
    return true;
  }

  /** Copy the selection and delete it, after asking. */
  async function cut() {
    const { items } = Edit.actionItems(Sel.selection());
    if (!items.length) {
      status("Select something to cut.", true);
      return;
    }
    if (!(await Dialogs.confirmRemove(items, "Cut"))) return;
    if (!copy({ quiet: true, cut: true })) return;
    Edit.removeSelected({ confirm: false, verb: "Cut" });
  }

  // ---- where a paste lands ----

  /**
   * The layer to show and the floor to paste onto for one copy, as { layer, floor }, or null when it
   * cannot go on the layer being shown. Trenches stay in the crawl; stairs and lifts keep the floors they join.
   */
  function pasteView(part) {
    if (part.kind === "trenches") {
      const crawl = Core.trenchCrawl(L(), part.rec);
      return { layer: crawl ? Core.crawlLayerId(crawl) : CRAWL, floor: null };
    }
    if (part.kind === "stairs" || part.kind === "lifts") {
      const floors = part.rec.floors;
      return { layer: floors.includes(state.layer) ? state.layer : floors[0], floor: null };
    }
    if (Core.isCrawlLayer(L(), state.layer)) return null;
    return { layer: state.layer, floor: state.layer };
  }

  /** The one place every copy of a group can go, or null when they do not agree. */
  function commonPasteView(parts) {
    let view = null;
    for (const part of parts) {
      const next = pasteView(part);
      if (!next) return null;
      if (!view) view = next;
      else if (view.layer !== next.layer || view.floor !== next.floor) return null;
    }
    return view;
  }

  // ---- paste ----

  /**
   * Insert every copy, shifted by one offset. Returns pins of what went in, records first and then
   * machines, so it can be selected once the plan has settled.
   */
  function insertParts(parts, spot, floor) {
    const records = [];
    const machines = [];
    History.change(() => {
      for (const part of parts) {
        const one = Core.pasteClip(L(), CATALOG, part, spot.dx, spot.dz, floor);
        if (!one) continue;
        if (one.kind === "rooms") L().rooms[one.index].color = Draw.pickRoomColor();
        if (one.kind === "machines") {
          const box = Core.clipBox(part);
          machines.push({ kind: "machines", x: box.x0 + spot.dx, z: box.z0 + spot.dz });
        } else {
          records.push({ kind: one.kind, rec: L()[one.kind][one.index] });
        }
      }
    });
    return [...records, ...machines];
  }

  /** Move the clip to where it was just pasted, so the next paste steps on from there. */
  function advanceClip(clip, spot) {
    for (const part of clip.parts) Core.shiftClip(part, spot.dx, spot.dz);
    clip.at = Core.unionBoxes(clip.parts.map((part) => Core.clipBox(part)));
    clip.pasted = true;
  }

  /** Where the clip can be pasted, as { view, spot }, or null with the reason in the status bar. */
  function pasteTarget(clip) {
    const parts = clip && clip.parts;
    if (!parts || !parts.length) {
      status("Copy something first.", true);
      return null;
    }
    const view = commonPasteView(parts);
    if (!view) {
      status(parts.length > 1 ? "Those don't paste on this floor together." : "Switch to a floor to paste that.", true);
      return null;
    }
    const spot = Core.pasteGroupSpot(L(), CATALOG, parts, view.floor, Boolean(clip.cut && !clip.pasted));
    if (!spot) {
      status("No room to paste it there.", true);
      return null;
    }
    return { view, spot };
  }

  /** Paste the clip beside where it was copied from, or beside the last paste, and select the copies. */
  function paste(opts) {
    const clip = state.clip;
    const target = pasteTarget(clip);
    if (!target) return false;
    const { view, spot } = target;
    const pins = insertParts(clip.parts, spot, view.floor);
    if (!pins.length) {
      status("Could not paste that.", true);
      return false;
    }
    advanceClip(clip, spot);
    state.draw = null;
    if (state.tool !== "select") Tools.set("select", true);
    if (view.layer !== state.layer) Stack.openLayer(view.layer);
    Machines.restorePins(pins);
    Panels.refresh();
    const fresh = Sel.selection();
    status(`${opts && opts.duplicate ? "Duplicated" : "Pasted"} ${fresh.length ? Sel.namesOf(fresh) : "it"}.`);
    return true;
  }

  /** Copy and paste the selection in one step, leaving the clip as it was. */
  function duplicate() {
    if (!Edit.actionItems(Sel.selection()).items.length) {
      status("Select something to duplicate.", true);
      return;
    }
    const saved = state.clip;
    if (!copy({ quiet: true })) return;
    paste({ duplicate: true });
    state.clip = saved;
    Panels.renderButtons();
  }

  Object.assign(App.Clip, { textSelected, copy, cut, paste, duplicate });
})(window.App);
