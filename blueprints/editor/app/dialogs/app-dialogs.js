/* The small dialog that asks a question before something is thrown away. */
(function (App) {
  "use strict";

  const { Core, $, L, plural, Sel } = App;

  /**
   * Ask a question with up to three answers. Resolves to "ok", "alt", or "" for Cancel.
   * `altLabel` adds the third button, for a question such as "save before closing?".
   */
  function choose(message, okLabel, altLabel) {
    const dialog = $("confirm-dialog");
    $("confirm-text").textContent = message;
    $("confirm-ok").textContent = okLabel || "Continue";
    const alt = $("confirm-alt");
    alt.hidden = !altLabel;
    if (altLabel) alt.textContent = altLabel;
    dialog.returnValue = "";
    dialog.showModal();
    return new Promise((resolve) => {
      dialog.addEventListener("close", () => {
        alt.hidden = true;
        resolve(dialog.returnValue);
      }, { once: true });
    });
  }

  /** Ask a yes or no question. Resolves to whether the answer was yes. */
  function ask(message, okLabel) {
    return choose(message, okLabel).then((value) => value === "ok");
  }

  /** What a room takes with it, for the question: " and its 2 multiblocks, 1 area". */
  function contentsText(room) {
    const c = Core.contentsOf(L(), room.id);
    const parts = [plural(c.pads.length, "multiblock"), plural(c.walls.length, "machine row"),
      plural(c.marks.length, "area"), plural(c.shafts.length, "shaft")].filter(Boolean);
    return parts.length ? ` and its ${parts.join(", ")}` : "";
  }

  /** The question to ask before removing some items. */
  function removalQuestion(list, verb) {
    if (list.length !== 1) return `${verb} ${Sel.namesOf(list)}?`;
    const item = list[0];
    const extra = item.kind === "rooms" ? contentsText(item.rec) : "";
    return `${verb} ${Sel.nameOf(item)}${extra}?`;
  }

  /** Ask before deleting or cutting. Resolves to whether to go ahead. */
  async function confirmRemove(items, verb) {
    const list = Array.isArray(items) ? items : [items];
    return ask(removalQuestion(list, verb), verb);
  }

  Object.assign(App.Dialogs, { choose, ask, confirmRemove });
})(window.App);
