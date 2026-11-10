/* The rows of the selection panel. A FormBuilder adds rows to a form: a label on the left and a
   control on the right. Each control calls `onCommit` with its value when the user is done with it. */
(function (App) {
  "use strict";

  const { SIDE_NAMES, make, button } = App;

  const SIDES = ["n", "e", "s", "w"];

  /** A new input of a type, holding a value. */
  function input(type, value) {
    const el = document.createElement("input");
    el.type = type;
    el.value = value;
    return el;
  }

  /** A new checkbox, ticked or not. */
  function checkbox(on) {
    const el = document.createElement("input");
    el.type = "checkbox";
    el.checked = on;
    return el;
  }

  /** A small "?" beside a label that explains the row when pointed at. */
  function helpMark(hint) {
    const mark = make("button", "help", "?");
    mark.type = "button";
    mark.title = hint;
    return mark;
  }

  /** Builds the rows of one form. Every method that adds a control returns that control. */
  class FormBuilder {
    constructor(form) {
      this.form = form;
    }

    /** Add a row: a label, a "?" when there is a hint, and a control. */
    row(labelText, control, hint) {
      const label = make("span", "field-label", labelText);
      if (hint) label.append(helpMark(hint));
      this.form.append(label, control);
      return control;
    }

    /** Add a line of plain text across the form. */
    note(text) {
      this.form.append(make("p", "hint wide", text));
    }

    /** Add a line of warning text across the form. */
    warn(text) {
      this.form.append(make("p", "error wide", text));
    }

    /** Add a text box. `opts.first` marks it as the one to type into right after drawing something. */
    text(labelText, value, onCommit, opts = {}) {
      const el = input("text", value);
      if (opts.first) el.dataset.first = "1";
      el.addEventListener("change", () => onCommit(el.value));
      return this.row(labelText, el);
    }

    /** Add a box for a whole number. An empty box commits 0. `opts` may set placeholder, min, max, step, and hint. */
    number(labelText, value, onCommit, opts = {}) {
      const el = input("number", value);
      for (const key of ["placeholder", "min", "max", "step"]) if (opts[key] != null) el[key] = opts[key];
      el.addEventListener("change", () => onCommit(el.value === "" ? 0 : Math.round(Number(el.value))));
      return this.row(labelText, el, opts.hint);
    }

    /** Add several number boxes side by side. They commit together, as a list, once every one reads as a number. */
    pair(labelText, values, onCommit) {
      const wrap = make("div", "pair");
      const inputs = values.map((v) => input("number", v));
      for (const el of inputs) {
        el.addEventListener("change", () => {
          const nums = inputs.map((i) => Math.round(Number(i.value)));
          if (nums.every(Number.isFinite)) onCommit(nums);
        });
        wrap.append(el);
      }
      return this.row(labelText, wrap);
    }

    /** Add a color picker. */
    color(labelText, value, onCommit) {
      const el = input("color", value);
      el.addEventListener("change", () => onCommit(el.value));
      return this.row(labelText, el);
    }

    /** Add one checkbox. */
    check(labelText, value, onCommit, hint) {
      const box = checkbox(value);
      box.addEventListener("change", () => onCommit(box.checked));
      const wrap = document.createElement("div");
      wrap.append(box);
      return this.row(labelText, wrap, hint);
    }

    /** Add a list of checkboxes. `items` are [id, text, ticked], and `onToggle(id, ticked)` hears each change. */
    checks(labelText, items, onToggle) {
      const wrap = document.createElement("div");
      for (const [id, text, on] of items) {
        const box = checkbox(on);
        box.addEventListener("change", () => onToggle(id, box.checked));
        const label = document.createElement("label");
        label.append(box, ` ${text}`);
        wrap.append(label);
      }
      return this.row(labelText, wrap);
    }

    /** Add a drop-down. `options` are [value, text] pairs, or { group, options } for a named group of them. */
    choose(labelText, value, options, onCommit) {
      const select = document.createElement("select");
      for (const opt of options) {
        if (opt.group) {
          const group = document.createElement("optgroup");
          group.label = opt.group;
          for (const [v, t] of opt.options) group.append(new Option(t, v));
          select.append(group);
        } else {
          select.append(new Option(opt[1], opt[0]));
        }
      }
      select.value = value;
      select.addEventListener("change", () => onCommit(select.value));
      return this.row(labelText, select);
    }

    /** Add a row of buttons, one pressed. `options` are [id, text, name]; the name is read out, and shown as a tooltip when `tips`. */
    pressRow(labelText, value, options, onCommit, tips) {
      const wrap = make("div", "sides");
      for (const [id, text, full] of options) {
        const b = button(text, () => onCommit(id));
        if (full && tips) b.title = full;
        if (full) b.setAttribute("aria-label", full);
        b.setAttribute("aria-pressed", String(id === value));
        wrap.append(b);
      }
      return this.row(labelText, wrap);
    }

    /** Add one button per option: [id, text], and a longer name for the tooltip when the text is short. */
    toggle(labelText, value, options, onCommit) {
      return this.pressRow(labelText, value, options, onCommit, true);
    }

    /** Add the four compass sides as buttons. */
    sides(labelText, value, onCommit) {
      const options = SIDES.map((side) => [side, side.toUpperCase(), SIDE_NAMES[side]]);
      return this.pressRow(labelText, value, options, onCommit, false);
    }

    /** Add a row of buttons across the form. */
    actions(buttons) {
      const wrap = make("div", "actions");
      wrap.append(...buttons);
      this.form.append(wrap);
    }
  }

  Object.assign(App.Form, { FormBuilder });
})(window.App);
