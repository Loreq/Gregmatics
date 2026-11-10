"""Gregmatics window. No server.

Start with Gregmatics.exe, or: py -3 desktop.py
Loads editor/index.html. Reads and writes the open .gregmatic file.
pywebview supplies the WebView2 libraries. This file does not call webview.start.
"""

from __future__ import annotations

import hashlib
import json
import os
import sys
import webbrowser
from ctypes import windll
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from generate import write_editor_data
from schema import LayoutError
from webview.util import interop_dll_path

import clr

clr.AddReference("System.Windows.Forms")
clr.AddReference("System.Drawing")
clr.AddReference(interop_dll_path("Microsoft.Web.WebView2.Core.dll"))
clr.AddReference(interop_dll_path("Microsoft.Web.WebView2.WinForms.dll"))
for platform in ("win-x64", "win-x86", "win-arm64"):
    os.environ["Path"] += ";" + interop_dll_path(platform)

import System.Windows.Forms as WinForms
from Microsoft.Web.WebView2.WinForms import CoreWebView2CreationProperties, WebView2
from System.Drawing import Icon, Size
from System.Reflection import BindingFlags
from System.Threading import ApartmentState, Thread, ThreadStart

TEST = "--test" in sys.argv


class EditorApi:
    """Reads and writes the open .gregmatic file."""

    def __init__(self) -> None:
        self.form = None

    def _title(self) -> None:
        if self.form is not None:
            self.form.Text = "Gregmatics"

    def read_layout(self) -> dict:
        import layout
        try:
            text = layout.read_text()
        except LayoutError as err:
            return {"ok": False, "error": str(err)}
        self._title()
        return {"ok": True, "text": text, "version": _version(text), "name": layout.current_name(),
                "folder": str(layout.plan_folder())}

    def save_layout(self, text: str) -> dict:
        if not isinstance(text, str) or not text.strip():
            return {"ok": False, "error": "The plan was empty."}
        if not text.endswith("\n"):
            text += "\n"
        import layout
        try:
            layout.parse(text)
            layout.write_gregmatic(layout.current_file(), text)
        except (LayoutError, json.JSONDecodeError) as err:
            return {"ok": False, "error": str(err)}
        write_editor_data(text)
        self._title()
        return {"ok": True, "version": _version(text), "name": layout.current_name()}

    def plan_info(self) -> dict:
        import layout
        try:
            layout.ensure_current()
        except LayoutError as err:
            return {"ok": False, "error": str(err)}
        return {"ok": True, "folder": str(layout.plan_folder()), "current": layout.current_file().name,
                "name": layout.current_name(), "plans": layout.plan_names(),
                "autosave": layout._settings()["autosave"]}

    def rename_plan(self, name: str) -> dict:
        import layout
        try:
            filename = layout.rename_current(name or "")
        except LayoutError as err:
            return {"ok": False, "error": str(err)}
        return {"ok": True, "current": filename, "file": filename}

    def set_autosave(self, enabled: bool) -> dict:
        import layout
        return {"ok": True, "autosave": layout.set_autosave(bool(enabled))}

    def choose_folder(self) -> dict:
        import layout
        dialog = WinForms.FolderBrowserDialog()
        dialog.Description = "Where Gregmatics keeps its plans"
        dialog.ShowNewFolderButton = True
        dialog.SelectedPath = str(layout.plan_folder())
        if dialog.ShowDialog() != WinForms.DialogResult.OK:
            return {"ok": False, "cancelled": True}
        try:
            folder = layout.move_plans(Path(str(dialog.SelectedPath)))
        except LayoutError as err:
            return {"ok": False, "error": str(err)}
        self._title()
        return {"ok": True, "folder": folder, "name": layout.current_name()}

    def create_plan(self, name: str, text: str) -> dict:
        import layout
        if not isinstance(text, str) or not text.strip():
            return {"ok": False, "error": "The plan was empty."}
        try:
            filename = layout.create_plan(name or "", text)
        except LayoutError as err:
            return {"ok": False, "error": str(err)}
        write_editor_data(text if text.endswith("\n") else text + "\n")
        self._title()
        return {"ok": True, "name": Path(filename).stem, "current": filename}

    def choose_plan(self) -> dict:
        """Open a plan. The dialog starts in the folder that holds the plans."""
        import layout
        folder = layout.plan_folder()
        dialog = WinForms.OpenFileDialog()
        dialog.Title = "Open a plan"
        dialog.Filter = "Gregmatics plan (*.gregmatic)|*.gregmatic|Layout (*.json)|*.json"
        dialog.InitialDirectory = str(folder)
        dialog.CheckFileExists = True
        dialog.Multiselect = False
        owner = getattr(self, "form", None)
        result = dialog.ShowDialog(owner) if owner is not None else dialog.ShowDialog()
        if result != WinForms.DialogResult.OK:
            return {"ok": False, "cancelled": True}
        path = Path(str(dialog.FileName))
        try:
            chosen = path.resolve()
            if chosen.parent == folder.resolve() and chosen.suffix.lower() == layout.PLAN_SUFFIX:
                filename = layout.open_plan(chosen.name)
            else:
                filename = layout.create_plan(path.stem, path.read_text(encoding="utf-8"))
            text = layout.read_text()
        except LayoutError as err:
            return {"ok": False, "error": str(err)}
        except OSError as err:
            return {"ok": False, "error": f"Could not read {path.name}: {err}"}
        write_editor_data(text)
        self._title()
        return {"ok": True, "name": Path(filename).stem, "current": filename, "text": text}

    def open_plan(self, name: str) -> dict:
        import layout
        try:
            filename = layout.open_plan(name or "")
            text = layout.read_text()
        except LayoutError as err:
            return {"ok": False, "error": str(err)}
        write_editor_data(text)
        self._title()
        return {"ok": True, "name": Path(filename).stem, "current": filename}


def _version(text: str) -> str:
    return hashlib.sha1(text.encode("utf-8")).hexdigest()[:12]


def _form_icon():
    """Window icon from launcher/Gregmatics.ico."""
    from System import Array, Byte
    from System.IO import MemoryStream

    path = HERE.parent / "launcher" / "Gregmatics.ico"
    if path.exists():
        raw = path.read_bytes()
        data = Array.CreateInstance(Byte, len(raw))
        for index, value in enumerate(raw):
            data[index] = value
        return Icon(MemoryStream(data), 256, 256)
    exe = Path(sys.executable)
    if exe.suffix.lower() == ".exe" and exe.exists():
        return Icon.ExtractAssociatedIcon(str(exe))
    return None


def main() -> None:
    import layout
    try:
        text = layout.read_text()
    except LayoutError as err:
        WinForms.MessageBox.Show(str(err), "Gregmatics")
        return
    write_editor_data(text)
    if sys.getwindowsversion().major >= 6:
        windll.user32.SetProcessDPIAware()
    api = EditorApi()
    page = (HERE / "editor" / "index.html").resolve().as_uri()
    user_data = Path(os.environ.get("LOCALAPPDATA", str(HERE))) / "Gregmatics" / "webview"
    user_data.mkdir(parents=True, exist_ok=True)

    def run() -> None:
        form = WinForms.Form()
        api.form = form
        api._title()
        icon = _form_icon()
        if icon is not None:
            form.Icon = icon
        form.ClientSize = Size(1440, 900)
        form.MinimumSize = Size(960, 640)
        form.WindowState = WinForms.FormWindowState.Maximized
        view = WebView2()
        view.Dock = WinForms.DockStyle.Fill
        props = CoreWebView2CreationProperties()
        props.UserDataFolder = str(user_data)
        view.CreationProperties = props
        form.Controls.Add(view)
        # The accelerator handler has to stay referenced, or the runtime can drop it.
        kept = []

        def on_ready(sender, args) -> None:
            if not args.IsSuccess:
                WinForms.MessageBox.Show(
                    str(args.InitializationException),
                    "Gregmatics",
                )
                form.Close()
                return
            core = view.CoreWebView2
            settings = core.Settings
            settings.IsWebMessageEnabled = True
            settings.AreDefaultScriptDialogsEnabled = True
            settings.AreBrowserAcceleratorKeysEnabled = True
            settings.AreDefaultContextMenusEnabled = True
            settings.IsStatusBarEnabled = False
            settings.IsZoomControlEnabled = True
            core.WebMessageReceived += on_message
            core.NavigationStarting += on_navigation
            # Ctrl+S is the browser's Save command. Leave that key for the page, which saves the plan.
            field = view.GetType().GetField("_coreWebView2Controller", BindingFlags.Instance | BindingFlags.NonPublic)
            controller = field.GetValue(view) if field is not None else None
            if controller is not None:
                kept.append(on_accelerator)
                controller.AcceleratorKeyPressed += on_accelerator
            core.Navigate(page)

        def on_accelerator(sender, args) -> None:
            modifiers = WinForms.Control.ModifierKeys
            ctrl = modifiers & WinForms.Keys.Control
            alt = modifiers & WinForms.Keys.Alt
            if args.VirtualKey == 0x53 and ctrl and not alt:
                args.IsBrowserAcceleratorKeyEnabled = False

        def on_navigation(sender, args) -> None:
            uri = str(args.Uri)
            if "editor/index.html" in uri.replace("\\", "/"):
                return
            args.Cancel = True
            if uri.startswith("file:") or uri.startswith("http:") or uri.startswith("https:"):
                webbrowser.open(uri)

        def on_message(sender, args) -> None:
            try:
                msg = json.loads(args.get_WebMessageAsJson())
            except (TypeError, json.JSONDecodeError):
                return
            reply = {"id": msg.get("id"), "ok": False, "error": "Unknown request."}
            method = msg.get("method")
            try:
                if method == "read_layout":
                    reply = {"id": msg.get("id"), **api.read_layout()}
                elif method == "save_layout":
                    reply = {"id": msg.get("id"), **api.save_layout(msg.get("text") or "")}
                elif method == "plan_info":
                    reply = {"id": msg.get("id"), **api.plan_info()}
                elif method == "set_autosave":
                    reply = {"id": msg.get("id"), **api.set_autosave(bool(msg.get("enabled")))}
                elif method == "rename_plan":
                    reply = {"id": msg.get("id"), **api.rename_plan(msg.get("name") or "")}
                elif method == "choose_folder":
                    reply = {"id": msg.get("id"), **api.choose_folder()}
                elif method == "create_plan":
                    reply = {"id": msg.get("id"), **api.create_plan(msg.get("name") or "", msg.get("text") or "")}
                elif method == "choose_plan":
                    reply = {"id": msg.get("id"), **api.choose_plan()}
                elif method == "open_plan":
                    reply = {"id": msg.get("id"), **api.open_plan(msg.get("name") or "")}
            except Exception as err:
                reply = {"id": msg.get("id"), "ok": False, "error": str(err)}
            view.CoreWebView2.PostWebMessageAsJson(json.dumps(reply))
            if TEST and method == "read_layout" and reply.get("ok"):
                print(f"read {reply.get('version')}", flush=True)
                form.BeginInvoke(WinForms.MethodInvoker(form.Close))

        view.CoreWebView2InitializationCompleted += on_ready
        view.EnsureCoreWebView2Async(None)
        WinForms.Application.Run(form)

    thread = Thread(ThreadStart(run))
    thread.SetApartmentState(ApartmentState.STA)
    thread.Start()
    while thread.IsAlive:
        thread.Join(500)


if __name__ == "__main__":
    main()
