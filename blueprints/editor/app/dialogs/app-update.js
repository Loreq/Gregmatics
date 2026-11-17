/* Help → Check for updates. The desktop window compares this program with the latest release
   and, when that release is newer, replaces the exe that is running. */
(function (App) {
  "use strict";

  const { $, state, status, unsaved, Files, Save } = App;

  const OFFLINE = "Check for updates runs in the Gregmatics window.";

  // Bumped when the dialog closes, so a late reply does not change a check the user left.
  let ticket = 0;
  // True while a download is in progress. Escape and the corner X stay shut until it finishes.
  let busy = false;

  /** The lead line. A failure paints that sentence rust. */
  function setLead(message, isError) {
    $("update-dialog").classList.toggle("is-error", Boolean(isError));
    $("update-text").textContent = message;
  }

  /** A version number in its own plate. */
  function versionPlate(version) {
    const plate = document.createElement("span");
    plate.className = "update-version";
    plate.textContent = String(version ?? "");
    return plate;
  }

  /** The availability line: Gregmatics {latest} is available. You have {current}. */
  function setOffer(reply) {
    $("update-dialog").classList.remove("is-error");
    $("update-text").replaceChildren(
      "Gregmatics ",
      versionPlate(reply.latest),
      " is available. You have ",
      versionPlate(reply.current),
      "."
    );
  }

  /** The up-to-date line, with the version in a plate. */
  function setCurrent(reply) {
    $("update-dialog").classList.remove("is-error");
    $("update-text").replaceChildren(
      "Gregmatics ",
      versionPlate(reply.latest),
      " is the latest release."
    );
  }

  /** The card header: the host title, or Gregmatics plus the version when that title is empty. */
  function releaseName(reply) {
    const title = String(reply.title || "").trim();
    if (title) return title;
    return `Gregmatics ${reply.latest}`;
  }

  /** The corner name: Cancel when a newer release is offered, otherwise Close. */
  function setDismiss(offered) {
    $("update-close").setAttribute("aria-label", offered ? "Cancel" : "Close");
  }

  /** Drop the release block and the install offer. */
  function clearRelease() {
    $("update-detail").hidden = true;
    $("update-notes").hidden = true;
    $("update-date").hidden = true;
    $("update-body").replaceChildren();
    $("update-install").hidden = true;
    $("update-page").hidden = true;
    setDismiss(false);
  }

  /** Notes as paragraphs. A blank line starts a new one, and a single line break stays. */
  function noteParagraphs(notes) {
    return String(notes || "").replace(/\r\n/g, "\n").split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
  }

  /** Show the date when the host sent one. */
  function fillDate(date) {
    const dateNode = $("update-date");
    const text = String(date || "").trim();
    dateNode.hidden = !text;
    dateNode.textContent = text;
  }

  /** Write the note paragraphs into the card body. */
  function fillNotes(notes) {
    const body = $("update-body");
    body.replaceChildren();
    for (const part of noteParagraphs(notes)) {
      const paragraph = document.createElement("p");
      paragraph.textContent = part;
      body.append(paragraph);
    }
  }

  /** The release card for a newer version, then focus Install and restart. */
  function showRelease(reply) {
    $("update-detail").hidden = false;
    $("update-notes").hidden = false;
    const titleNode = $("update-title");
    titleNode.hidden = false;
    titleNode.textContent = releaseName(reply);
    fillDate(reply.date);
    fillNotes(reply.notes);
    $("update-install").hidden = false;
    $("update-page").hidden = !reply.page;
    setDismiss(true);
    $("update-install").focus();
  }

  /** Hold the dialog shut while a download is in progress. */
  function setBusy(on) {
    busy = on;
    $("update-close").disabled = on;
    $("update-install").disabled = on;
    $("update-page").disabled = on;
  }

  /** A finished check on the open dialog. */
  function showResult(reply) {
    if (!reply || !reply.ok) {
      setLead((reply && reply.error) || "Could not check for updates.", true);
      clearRelease();
      return;
    }
    if (reply.newer) {
      setOffer(reply);
      showRelease(reply);
      return;
    }
    setCurrent(reply);
    clearRelease();
  }

  /** After the plan is up: when the launch check is on, offer a newer release. A current release stays quiet. */
  async function onLaunch() {
    if (!state.checkUpdates) return;
    const api = Files.desktopApi();
    if (!api) return;
    const mine = ++ticket;
    let reply;
    try {
      reply = await api.check_update();
    } catch (err) {
      reply = null;
    }
    if (mine !== ticket || !state.checkUpdates) return;
    const dialog = $("update-dialog");
    if (dialog.open) {
      showResult(reply);
      return;
    }
    if (!reply || !reply.ok || !reply.newer) return;
    setOffer(reply);
    setBusy(false);
    try {
      dialog.showModal();
    } catch (err) {
      return;
    }
    showRelease(reply);
  }

  /** Open the dialog on a check. A browser with no desktop window is told so in the status line. */
  async function start() {
    const api = Files.desktopApi();
    if (!api) {
      status(OFFLINE, true);
      return;
    }
    const mine = ++ticket;
    setLead("Checking…");
    clearRelease();
    setBusy(false);
    $("update-dialog").showModal();
    let reply;
    try {
      reply = await api.check_update();
    } catch (err) {
      reply = null;
    }
    if (mine !== ticket) return;
    showResult(reply);
  }

  /** Save, then download the newer release. The window closes when the new exe is ready to take its place. */
  async function install() {
    const api = Files.desktopApi();
    if (!api || busy) return;
    const mine = ticket;
    setBusy(true);
    if (unsaved()) {
      await Save.save({ auto: true });
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (mine !== ticket) return;
      if (unsaved()) {
        setLead("Could not save the plan.", true);
        setBusy(false);
        return;
      }
    }
    setLead("Downloading…");
    let reply;
    try {
      reply = await api.install_update();
    } catch (err) {
      reply = null;
    }
    if (mine !== ticket) {
      if (!reply || !reply.ok) status((reply && reply.error) || "Could not install the update.", true);
      return;
    }
    if (!reply || !reply.ok) {
      setLead((reply && reply.error) || "Could not install the update.", true);
      setBusy(false);
      return;
    }
    setLead("Restarting…");
  }

  /** Ask the window to open the release page. The address stays in the window. */
  async function openPage() {
    const api = Files.desktopApi();
    if (!api || busy) return;
    let reply;
    try {
      reply = await api.open_release();
    } catch (err) {
      reply = null;
    }
    if (!reply || !reply.ok) status((reply && reply.error) || "Could not open the release.", true);
  }

  /** Close the dialog. A download in progress keeps it open. */
  function close() {
    if (busy) return;
    const dialog = $("update-dialog");
    if (dialog.open) dialog.close();
  }

  /** The dialog finished closing: drop any check that is still waiting. */
  function onClose() {
    ticket += 1;
    setBusy(false);
  }

  /** Escape closes the dialog, except while a download is in progress. */
  function onCancel(event) {
    if (busy) event.preventDefault();
  }

  Object.assign(App.Update, { onLaunch, start, install, openPage, close, onClose, onCancel });
})(window.App);
