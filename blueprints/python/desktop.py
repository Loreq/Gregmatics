"""Gregmatics window. No server.

Start with start.exe in the project folder, or: py -3 python/desktop.py
Loads editor/index.html. Reads and writes the open .gregmatic file.
pywebview supplies the WebView2 libraries. This file does not call webview.start.
"""

from __future__ import annotations

import functools
import json
import os
import sys
import webbrowser
from ctypes import windll
from pathlib import Path

# This file lives in python/. The editor is beside that folder, and the imports are inside it.
HERE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))

import layout
from files import fingerprint
from generate import write_editor_data
from schema import LayoutError
from webview.util import interop_dll_path

import clr

clr.AddReference("System.Windows.Forms")
clr.AddReference("System.Drawing")
clr.AddReference(interop_dll_path("Microsoft.Web.WebView2.Core.dll"))
clr.AddReference(interop_dll_path("Microsoft.Web.WebView2.WinForms.dll"))
# The loader is native, one folder per processor. A packed release carries only its own.
for platform in ("win-x64", "win-x86", "win-arm64"):
    try:
        os.environ["Path"] += ";" + interop_dll_path(platform)
    except FileNotFoundError:
        pass

import System.Windows.Forms as WinForms
from Microsoft.Web.WebView2.WinForms import CoreWebView2CreationProperties, WebView2
from System import Array, Byte
from System.Drawing import Icon, Size
from System.IO import MemoryStream
from System.Reflection import BindingFlags
from System.Threading import ApartmentState, Thread, ThreadStart

TEST = "--test" in sys.argv
TITLE = "Gregmatics"
PAGE = "editor/index.html"
ICON = HERE.parent / "launcher" / "Gregmatics.ico"
WINDOW_SIZE = (1440, 900)
SMALLEST_SIZE = (960, 640)
# The virtual key code of the S key.
KEY_S = 0x53
PLAN_FILTER = "Gregmatics plan (*.gregmatic)|*.gregmatic|Layout (*.json)|*.json"
EMPTY_PLAN = "The plan was empty."


# --- replies to the page ---

def _failed(reason) -> dict:
    """The reply for something that did not work, with the reason the page shows."""
    return {"ok": False, "error": str(reason)}


def _cancelled() -> dict:
    """The reply for a dialog the user closed without choosing."""
    return {"ok": False, "cancelled": True}


def _opened(filename: str, **extra) -> dict:
    """The reply for a plan that is now the open one."""
    return {"ok": True, "name": Path(filename).stem, "current": filename, **extra}


def _blank(text) -> bool:
    """Whether a plan's text is missing or empty."""
    return not isinstance(text, str) or not text.strip()


def answers(method):
    """Wrap an EditorApi method so a plan error becomes the reply the page shows."""
    @functools.wraps(method)
    def wrapped(self, *args):
        try:
            return method(self, *args)
        except LayoutError as err:
            return _failed(err)
    return wrapped


# --- dialogs ---

def _ask_folder(start: Path) -> Path | None:
    """Let the user pick a folder, or None when they close the dialog."""
    dialog = WinForms.FolderBrowserDialog()
    dialog.Description = "Where Gregmatics keeps its plans"
    dialog.ShowNewFolderButton = True
    dialog.SelectedPath = str(start)
    if dialog.ShowDialog() != WinForms.DialogResult.OK:
        return None
    return Path(str(dialog.SelectedPath))


def _ask_plan(folder: Path, owner) -> Path | None:
    """Let the user pick a plan file, starting in the plan folder, or None when they close the dialog."""
    dialog = WinForms.OpenFileDialog()
    dialog.Title = "Open a plan"
    dialog.Filter = PLAN_FILTER
    dialog.InitialDirectory = str(folder)
    dialog.CheckFileExists = True
    dialog.Multiselect = False
    result = dialog.ShowDialog(owner) if owner is not None else dialog.ShowDialog()
    return Path(str(dialog.FileName)) if result == WinForms.DialogResult.OK else None


def _adopt(path: Path, folder: Path) -> str:
    """Open a plan that is already in the plan folder, or copy one from elsewhere into it."""
    chosen = path.resolve()
    if chosen.parent == folder.resolve() and chosen.suffix.lower() == layout.PLAN_SUFFIX:
        return layout.open_plan(chosen.name)
    return layout.create_plan(path.stem, path.read_text(encoding="utf-8"))


# --- what the page can ask for ---

class EditorApi:
    """Reads and writes the open .gregmatic file, and keeps the plan library."""

    def __init__(self) -> None:
        # The window, once there is one. File dialogs open over it.
        self.form = None

    @answers
    def read_layout(self) -> dict:
        """The open plan's text, with the fingerprint a draft is matched against."""
        text = layout.read_text()
        return {"ok": True, "text": text, "version": fingerprint(text), "name": layout.current_name(),
                "folder": str(layout.plan_folder())}

    @answers
    def save_layout(self, text: str) -> dict:
        """Check a plan's text, write it to the open file, and refresh editor/data.js."""
        if _blank(text):
            return _failed(EMPTY_PLAN)
        text = layout.ended(text)
        layout.parse(text)
        layout.write_gregmatic(layout.current_file(), text)
        write_editor_data(text)
        return {"ok": True, "version": fingerprint(text), "name": layout.current_name()}

    @answers
    def plan_info(self) -> dict:
        """Where the plans are, which one is open, and whether edits save themselves."""
        layout.ensure_current()
        return {"ok": True, "folder": str(layout.plan_folder()), "current": layout.current_file().name,
                "name": layout.current_name(), "plans": layout.plan_names(), "autosave": layout.autosave()}

    @answers
    def rename_plan(self, name: str) -> dict:
        """Rename the open plan's file to match its floorplan name."""
        filename = layout.rename_current(name or "")
        return {"ok": True, "current": filename, "file": filename}

    @answers
    def set_autosave(self, enabled: bool) -> dict:
        """Turn autosave on or off."""
        return {"ok": True, "autosave": layout.set_autosave(bool(enabled))}

    @answers
    def choose_folder(self) -> dict:
        """Ask for a new plan folder and move every plan into it."""
        chosen = _ask_folder(layout.plan_folder())
        if chosen is None:
            return _cancelled()
        folder = layout.move_plans(chosen)
        return {"ok": True, "folder": folder, "name": layout.current_name()}

    @answers
    def create_plan(self, name: str, text: str) -> dict:
        """Write a new plan beside the others and open it."""
        if _blank(text):
            return _failed(EMPTY_PLAN)
        filename = layout.create_plan(name or "", text)
        write_editor_data(layout.ended(text))
        return _opened(filename)

    @answers
    def choose_plan(self) -> dict:
        """Ask for a plan to open. One from outside the plan folder is copied in."""
        folder = layout.plan_folder()
        path = _ask_plan(folder, self.form)
        if path is None:
            return _cancelled()
        try:
            filename = _adopt(path, folder)
            text = layout.read_text()
        except OSError as err:
            return _failed(f"Could not read {path.name}: {err}")
        write_editor_data(text)
        return _opened(filename, text=text)

    @answers
    def open_plan(self, name: str) -> dict:
        """Open a plan in the plan folder by its file name."""
        filename = layout.open_plan(name or "")
        write_editor_data(layout.read_text())
        return _opened(filename)


# Each request the page can send, and how its message becomes a call.
REQUESTS = {
    "read_layout": lambda api, msg: api.read_layout(),
    "save_layout": lambda api, msg: api.save_layout(msg.get("text") or ""),
    "plan_info": lambda api, msg: api.plan_info(),
    "set_autosave": lambda api, msg: api.set_autosave(bool(msg.get("enabled"))),
    "rename_plan": lambda api, msg: api.rename_plan(msg.get("name") or ""),
    "choose_folder": lambda api, msg: api.choose_folder(),
    "create_plan": lambda api, msg: api.create_plan(msg.get("name") or "", msg.get("text") or ""),
    "choose_plan": lambda api, msg: api.choose_plan(),
    "open_plan": lambda api, msg: api.open_plan(msg.get("name") or ""),
}


def answer(api: EditorApi, msg: dict) -> dict:
    """The reply to one message from the page. It carries the message's id, so the page can match it up."""
    handler = REQUESTS.get(msg.get("method"))
    if handler is None:
        return {"id": msg.get("id"), **_failed("Unknown request.")}
    try:
        return {"id": msg.get("id"), **handler(api, msg)}
    except Exception as err:  # noqa: BLE001 - whatever went wrong, the page is waiting for a reply
        return {"id": msg.get("id"), **_failed(err)}


# --- the window ---

def _form_icon():
    """The window's icon: launcher/Gregmatics.ico, or the exe's own when that file is not there."""
    if ICON.exists():
        raw = ICON.read_bytes()
        data = Array.CreateInstance(Byte, len(raw))
        for index, value in enumerate(raw):
            data[index] = value
        return Icon(MemoryStream(data), 256, 256)
    exe = Path(sys.executable)
    if exe.suffix.lower() == ".exe" and exe.exists():
        return Icon.ExtractAssociatedIcon(str(exe))
    return None


def _allow_page_features(settings) -> None:
    """Turn on what the editor page uses, and off what it has no use for."""
    settings.IsWebMessageEnabled = True
    settings.AreDefaultScriptDialogsEnabled = True
    settings.AreBrowserAcceleratorKeysEnabled = True
    settings.AreDefaultContextMenusEnabled = True
    settings.IsStatusBarEnabled = False
    settings.IsZoomControlEnabled = True


class Window:
    """The Gregmatics window: one form filled by one WebView2 that shows the editor page."""

    def __init__(self, api: EditorApi, page: str, user_data: Path) -> None:
        self.api = api
        self.page = page
        self.user_data = user_data
        self.form = None
        self.view = None
        # Event handlers stay referenced here, or the runtime can drop them.
        self._handlers: list = []

    def _keep(self, handler):
        """Hold on to an event handler for as long as the window lives."""
        self._handlers.append(handler)
        return handler

    def _build_form(self):
        """The window itself, maximized, with its icon."""
        form = WinForms.Form()
        form.Text = TITLE
        icon = _form_icon()
        if icon is not None:
            form.Icon = icon
        form.ClientSize = Size(*WINDOW_SIZE)
        form.MinimumSize = Size(*SMALLEST_SIZE)
        form.WindowState = WinForms.FormWindowState.Maximized
        return form

    def _build_view(self):
        """The browser that fills the window, keeping its profile in the user's own data folder."""
        view = WebView2()
        view.Dock = WinForms.DockStyle.Fill
        props = CoreWebView2CreationProperties()
        props.UserDataFolder = str(self.user_data)
        view.CreationProperties = props
        return view

    def _leave_ctrl_s_to_page(self) -> None:
        """Ctrl+S is the browser's Save command. Watch for it, so the page gets that key and saves the plan."""
        field = self.view.GetType().GetField("_coreWebView2Controller", BindingFlags.Instance | BindingFlags.NonPublic)
        controller = field.GetValue(self.view) if field is not None else None
        if controller is not None:
            controller.AcceleratorKeyPressed += self._keep(self._on_accelerator)

    def _on_ready(self, sender, args) -> None:
        """The browser is up: wire it to this window and load the page."""
        if not args.IsSuccess:
            WinForms.MessageBox.Show(str(args.InitializationException), TITLE)
            self.form.Close()
            return
        core = self.view.CoreWebView2
        _allow_page_features(core.Settings)
        core.WebMessageReceived += self._keep(self._on_message)
        core.NavigationStarting += self._keep(self._on_navigation)
        self._leave_ctrl_s_to_page()
        core.Navigate(self.page)

    def _on_accelerator(self, sender, args) -> None:
        """Keep the browser from acting on Ctrl+S."""
        modifiers = WinForms.Control.ModifierKeys
        ctrl = modifiers & WinForms.Keys.Control
        alt = modifiers & WinForms.Keys.Alt
        if args.VirtualKey == KEY_S and ctrl and not alt:
            args.IsBrowserAcceleratorKeyEnabled = False

    def _on_navigation(self, sender, args) -> None:
        """The window shows the editor page and nothing else. A link opens in the user's browser."""
        uri = str(args.Uri)
        if PAGE in uri.replace("\\", "/"):
            return
        args.Cancel = True
        if uri.startswith("file:") or uri.startswith("http:") or uri.startswith("https:"):
            webbrowser.open(uri)

    def _on_message(self, sender, args) -> None:
        """Answer one request from the page."""
        try:
            msg = json.loads(args.get_WebMessageAsJson())
        except (TypeError, json.JSONDecodeError):
            return
        reply = answer(self.api, msg)
        self.view.CoreWebView2.PostWebMessageAsJson(json.dumps(reply))
        if TEST and msg.get("method") == "read_layout" and reply.get("ok"):
            self._finish_test(reply)

    def _finish_test(self, reply: dict) -> None:
        """A --test run ends once the page has read the plan: say which plan, and close."""
        print(f"read {reply.get('version')}", flush=True)
        self.form.BeginInvoke(WinForms.MethodInvoker(self.form.Close))

    def run(self) -> None:
        """Build the window and stay in its message loop until it closes."""
        self.form = self._build_form()
        self.api.form = self.form
        self.view = self._build_view()
        self.form.Controls.Add(self.view)
        self.view.CoreWebView2InitializationCompleted += self._keep(self._on_ready)
        self.view.EnsureCoreWebView2Async(None)
        WinForms.Application.Run(self.form)


def _use_real_pixels() -> None:
    """Tell Windows this program draws at the screen's own scale, so the page is not blurred."""
    if sys.getwindowsversion().major >= 6:
        windll.user32.SetProcessDPIAware()


def _user_data_folder() -> Path:
    """Where the browser keeps its profile: drafts, zoom, and the like."""
    folder = Path(os.environ.get("LOCALAPPDATA", str(HERE))) / "Gregmatics" / "webview"
    folder.mkdir(parents=True, exist_ok=True)
    return folder


def _run_on_ui_thread(work) -> None:
    """Run the window on a single-threaded apartment thread, as WinForms needs, and wait for it."""
    thread = Thread(ThreadStart(work))
    thread.SetApartmentState(ApartmentState.STA)
    thread.Start()
    while thread.IsAlive:
        thread.Join(500)


def main() -> None:
    """Open the window on the open plan."""
    try:
        text = layout.read_text()
    except LayoutError as err:
        WinForms.MessageBox.Show(str(err), TITLE)
        return
    write_editor_data(text)
    _use_real_pixels()
    page = (HERE / "editor" / "index.html").resolve().as_uri()
    _run_on_ui_thread(Window(EditorApi(), page, _user_data_folder()).run)


if __name__ == "__main__":
    main()
