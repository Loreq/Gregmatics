using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Text;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace Gregmatics
{
    /// <summary>The Gregmatics window: one form filled by one WebView2 that shows the editor page.</summary>
    internal sealed class MainForm : Form
    {
        const string Title = "Gregmatics";
        const string EmptyPlan = "The plan was empty.";
        const string PageHost = "https://gregmatics.local/";
        // The virtual key code of the S key.
        const int KeyS = 0x53;

        readonly bool test;
        readonly string log;
        readonly string sourceRoot;
        readonly Catalog catalog;
        readonly MemoryStream iconBytes;
        string script;
        int exitCode;
        WebView2 view;
        CoreWebView2Controller controller;

        /// <summary>Open the window on the open plan. Returns the process exit code.</summary>
        public static int Run(bool test, string log)
        {
            string root = SourceRoot();
            Catalog catalog;
            try
            {
                catalog = root == null ? Catalog.FromSite() : Catalog.FromTree(Path.Combine(root, "blueprints"));
            }
            catch (CatalogException ex)
            {
                return Program.Fail(ex.Message, test, log);
            }
            string path = Plans.OpenLast();
            string text = path == null ? null : Plans.ReadGregmatic(path);
            string script;
            try
            {
                script = EditorData.Script(text, catalog);
            }
            catch (JsonReaderException ex)
            {
                return Program.Fail("The plan is not valid JSON: line " + ex.LineNumber + ", column " + ex.LinePosition + ": " + ex.Message, test, log);
            }
            if (root != null)
                Files.SaveText(Path.Combine(root, "blueprints", "editor", "data.js"), script);
            var form = new MainForm(test, log, root, catalog, script);
            Application.Run(form);
            return form.exitCode;
        }

        MainForm(bool test, string log, string sourceRoot, Catalog catalog, string script)
        {
            this.test = test;
            this.log = log;
            this.sourceRoot = sourceRoot;
            this.catalog = catalog;
            this.script = script;
            Text = Title;
            ClientSize = new Size(1440, 900);
            MinimumSize = new Size(960, 640);
            WindowState = FormWindowState.Maximized;
            byte[] icon = sourceRoot == null
                ? Bundle.Bytes("launcher/Gregmatics.ico")
                : File.ReadAllBytes(Path.Combine(sourceRoot, "launcher", "Gregmatics.ico"));
            if (icon != null)
            {
                iconBytes = new MemoryStream(icon);
                Icon = new Icon(iconBytes, 256, 256);
            }
            view = new WebView2 { Dock = DockStyle.Fill };
            var props = new CoreWebView2CreationProperties();
            props.UserDataFolder = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Gregmatics", "webview");
            Directory.CreateDirectory(props.UserDataFolder);
            view.CreationProperties = props;
            view.CoreWebView2InitializationCompleted += OnReady;
            Controls.Add(view);
            Load += async (sender, args) =>
            {
                try
                {
                    await view.EnsureCoreWebView2Async(null);
                }
                catch (WebView2RuntimeNotFoundException)
                {
                    exitCode = Program.Fail("Gregmatics needs the Microsoft Edge WebView2 runtime.\r\nInstall it, then open Gregmatics again.", test, log);
                    Close();
                }
                catch (Exception ex)
                {
                    exitCode = Program.Fail(ex.Message, test, log);
                    Close();
                }
            };
        }

        /// <summary>The project folder when this exe sits in one, so the editor is read from disk.</summary>
        static string SourceRoot()
        {
            string dir = Path.GetDirectoryName(Application.ExecutablePath);
            return File.Exists(Path.Combine(dir, "blueprints", "editor", "index.html")) ? dir : null;
        }

        /// <summary>The browser is up: wire it to this window and load the page.</summary>
        void OnReady(object sender, CoreWebView2InitializationCompletedEventArgs args)
        {
            if (!args.IsSuccess)
            {
                exitCode = Program.Fail(args.InitializationException == null ? "The window could not open." : args.InitializationException.Message, test, log);
                Close();
                return;
            }
            CoreWebView2 core = view.CoreWebView2;
            core.Settings.IsWebMessageEnabled = true;
            core.Settings.AreDefaultScriptDialogsEnabled = true;
            core.Settings.AreBrowserAcceleratorKeysEnabled = true;
            core.Settings.AreDefaultContextMenusEnabled = true;
            core.Settings.IsStatusBarEnabled = false;
            core.Settings.IsZoomControlEnabled = true;
            core.WebMessageReceived += OnMessage;
            core.NavigationStarting += OnNavigation;
            if (sourceRoot == null)
            {
                core.AddWebResourceRequestedFilter(PageHost + "*", CoreWebView2WebResourceContext.All);
                core.WebResourceRequested += OnResource;
                core.Navigate(PageHost + "index.html");
            }
            else
            {
                core.Navigate(new Uri(Path.Combine(sourceRoot, "blueprints", "editor", "index.html")).AbsoluteUri);
            }
            KeepSaveKey();
        }

        /// <summary>Ctrl+S is the browser's Save command. Leave it for the page.</summary>
        void KeepSaveKey()
        {
            controller = FindController(view);
            if (controller != null)
                controller.AcceleratorKeyPressed += OnAccelerator;
        }

        /// <summary>The WebView2 controller, which is not a public field of the control.</summary>
        static CoreWebView2Controller FindController(object host)
        {
            for (Type type = host.GetType(); type != null; type = type.BaseType)
            {
                foreach (var field in type.GetFields(System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Public))
                {
                    if (typeof(CoreWebView2Controller).IsAssignableFrom(field.FieldType))
                        return field.GetValue(host) as CoreWebView2Controller;
                }
            }
            return null;
        }

        /// <summary>Keep the browser from acting on Ctrl+S.</summary>
        void OnAccelerator(object sender, CoreWebView2AcceleratorKeyPressedEventArgs args)
        {
            Keys mods = Control.ModifierKeys;
            bool ctrl = (mods & Keys.Control) == Keys.Control;
            bool alt = (mods & Keys.Alt) == Keys.Alt;
            if (args.VirtualKey == KeyS && ctrl && !alt)
                args.IsBrowserAcceleratorKeyEnabled = false;
        }

        /// <summary>The window shows the editor page and nothing else. A link opens in the user's browser.</summary>
        void OnNavigation(object sender, CoreWebView2NavigationStartingEventArgs args)
        {
            string uri = (args.Uri ?? "").Replace('\\', '/');
            if (uri.IndexOf("editor/index.html", StringComparison.OrdinalIgnoreCase) >= 0 || uri.StartsWith(PageHost, StringComparison.OrdinalIgnoreCase))
                return;
            args.Cancel = true;
            if (uri.StartsWith("file:", StringComparison.OrdinalIgnoreCase) || uri.StartsWith("http:", StringComparison.OrdinalIgnoreCase) || uri.StartsWith("https:", StringComparison.OrdinalIgnoreCase))
                Process.Start(args.Uri);
        }

        /// <summary>Serve one page file from the copy packed into the exe.</summary>
        void OnResource(object sender, CoreWebView2WebResourceRequestedEventArgs args)
        {
            var uri = new Uri(args.Request.Uri);
            string path = Uri.UnescapeDataString(uri.AbsolutePath).TrimStart('/');
            byte[] bytes = null;
            string type = "application/octet-stream";
            if (path.Contains(".."))
            {
                args.Response = Response(404, new byte[0], type);
                return;
            }
            if (path == "data.js")
            {
                bytes = Encoding.UTF8.GetBytes(script);
                type = "text/javascript; charset=utf-8";
            }
            else if (path == "launcher/Gregmatics.ico")
            {
                bytes = Bundle.Bytes("launcher/Gregmatics.ico");
                type = "image/x-icon";
            }
            else
            {
                bytes = Bundle.Bytes("editor/" + path);
                type = Mime(path);
            }
            args.Response = bytes == null ? Response(404, new byte[0], type) : Response(200, bytes, type);
        }

        /// <summary>A response the page can read.</summary>
        CoreWebView2WebResourceResponse Response(int status, byte[] bytes, string type)
        {
            return view.CoreWebView2.Environment.CreateWebResourceResponse(new MemoryStream(bytes), status, status == 200 ? "OK" : "Not Found", "Content-Type: " + type);
        }

        /// <summary>The content type for a packed file.</summary>
        static string Mime(string path)
        {
            string ext = Path.GetExtension(path).ToLowerInvariant();
            if (ext == ".html") return "text/html; charset=utf-8";
            if (ext == ".css") return "text/css; charset=utf-8";
            if (ext == ".js") return "text/javascript; charset=utf-8";
            if (ext == ".json") return "application/json";
            if (ext == ".svg") return "image/svg+xml";
            if (ext == ".png") return "image/png";
            if (ext == ".ico") return "image/x-icon";
            return "application/octet-stream";
        }

        /// <summary>Answer one request from the page.</summary>
        void OnMessage(object sender, CoreWebView2WebMessageReceivedEventArgs args)
        {
            JObject msg;
            try
            {
                msg = JObject.Parse(args.WebMessageAsJson);
            }
            catch (JsonReaderException)
            {
                return;
            }
            JObject reply;
            try
            {
                reply = Answer(msg);
            }
            catch (Exception ex)
            {
                reply = Failed(ex.Message);
            }
            if (msg["id"] != null)
                reply["id"] = msg["id"];
            view.CoreWebView2.PostWebMessageAsJson(reply.ToString(Formatting.None));
            if (test && (string)msg["method"] == "read_layout" && reply["ok"] != null && reply["ok"].Value<bool>())
            {
                Program.Report("read " + reply["version"].Value<string>() + "\n", true, log);
                BeginInvoke((MethodInvoker)Close);
            }
        }

        /// <summary>The reply for one method the page can ask for.</summary>
        JObject Answer(JObject msg)
        {
            string method = (string)msg["method"] ?? "";
            if (method == "read_layout") return ReadLayout();
            if (method == "save_layout") return SaveLayout(TextOf(msg, "text"));
            if (method == "plan_info") return PlanInfo();
            if (method == "rename_plan") return Rename(TextOf(msg, "name"));
            if (method == "set_autosave") return new JObject { ["ok"] = true, ["autosave"] = Plans.SetAutosave(JsonText.Truthy(msg["enabled"])) };
            if (method == "choose_folder") return ChooseFolder();
            if (method == "create_plan") return Create(TextOf(msg, "name"), TextOf(msg, "text"));
            if (method == "choose_plan") return ChoosePlan();
            if (method == "open_plan") return Open(TextOf(msg, "name"));
            return Failed("Unknown request.");
        }

        /// <summary>A text field of a message, or an empty string.</summary>
        static string TextOf(JObject msg, string key)
        {
            JToken token = msg[key];
            return token != null && token.Type == JTokenType.String ? token.Value<string>() : "";
        }

        /// <summary>The open plan's text, with the fingerprint a draft is matched against.</summary>
        JObject ReadLayout()
        {
            string path = Plans.OpenLast();
            if (path == null)
                return new JObject { ["ok"] = true, ["empty"] = true };
            string text = Plans.ReadGregmatic(path);
            return new JObject
            {
                ["ok"] = true,
                ["text"] = text,
                ["version"] = Files.Fingerprint(text),
                ["name"] = Plans.CurrentName(),
                ["folder"] = Plans.PlanFolder(),
            };
        }

        /// <summary>Check a plan's text, write it to the open file, and refresh editor/data.js.</summary>
        JObject SaveLayout(string text)
        {
            if (text.Trim().Length == 0)
                return Failed(EmptyPlan);
            text = Files.Ended(text);
            Gregmatics.Layout.Check(text, catalog);
            Plans.WriteGregmatic(Plans.CurrentFile(), text);
            Remember(text);
            return new JObject { ["ok"] = true, ["version"] = Files.Fingerprint(text), ["name"] = Plans.CurrentName() };
        }

        /// <summary>Where the plans are, which one is open, and whether edits save themselves.</summary>
        JObject PlanInfo()
        {
            if (Plans.OpenLast() == null)
            {
                return new JObject
                {
                    ["ok"] = true,
                    ["empty"] = true,
                    ["folder"] = Plans.PlanFolder(),
                    ["current"] = "",
                    ["name"] = "",
                    ["plans"] = new JArray(),
                    ["autosave"] = Plans.Autosave(),
                };
            }
            return new JObject
            {
                ["ok"] = true,
                ["folder"] = Plans.PlanFolder(),
                ["current"] = Path.GetFileName(Plans.CurrentFile()),
                ["name"] = Plans.CurrentName(),
                ["plans"] = new JArray(Plans.PlanNames()),
                ["autosave"] = Plans.Autosave(),
            };
        }

        /// <summary>Rename the open plan's file to match its floorplan name.</summary>
        JObject Rename(string name)
        {
            string filename = Plans.RenameCurrent(name);
            return new JObject { ["ok"] = true, ["current"] = filename, ["file"] = filename };
        }

        /// <summary>Ask for a new plan folder and move every plan into it.</summary>
        JObject ChooseFolder()
        {
            using (var dialog = new FolderBrowserDialog())
            {
                dialog.Description = "Where Gregmatics keeps its plans";
                dialog.ShowNewFolderButton = true;
                dialog.SelectedPath = Plans.PlanFolder();
                if (dialog.ShowDialog(this) != DialogResult.OK)
                    return Cancelled();
                string folder = Plans.MovePlans(dialog.SelectedPath);
                return new JObject { ["ok"] = true, ["folder"] = folder, ["name"] = Plans.CurrentName() };
            }
        }

        /// <summary>Write a new plan beside the others and open it.</summary>
        JObject Create(string name, string text)
        {
            if (text.Trim().Length == 0)
                return Failed(EmptyPlan);
            string filename = Plans.Create(name, text, catalog);
            Remember(Plans.ReadText());
            return Opened(filename);
        }

        /// <summary>Ask for a plan to open. One from outside the plan folder is copied in.</summary>
        JObject ChoosePlan()
        {
            using (var dialog = new OpenFileDialog())
            {
                dialog.Title = "Open a plan";
                dialog.Filter = "Gregmatics plan (*.gregmatic)|*.gregmatic|Layout (*.json)|*.json";
                dialog.InitialDirectory = Plans.PlanFolder();
                dialog.CheckFileExists = true;
                dialog.Multiselect = false;
                if (dialog.ShowDialog(this) != DialogResult.OK)
                    return Cancelled();
                try
                {
                    string filename = Plans.Adopt(dialog.FileName, catalog);
                    string text = Plans.ReadText();
                    Remember(text);
                    JObject reply = Opened(filename);
                    reply["text"] = text;
                    return reply;
                }
                catch (IOException ex)
                {
                    return Failed("Could not read " + Path.GetFileName(dialog.FileName) + ": " + ex.Message);
                }
            }
        }

        /// <summary>Open a plan in the plan folder by its file name.</summary>
        JObject Open(string name)
        {
            string filename = Plans.Open(name);
            Remember(Plans.ReadText());
            return Opened(filename);
        }

        /// <summary>The reply for a plan that is now the open one.</summary>
        static JObject Opened(string filename)
        {
            return new JObject
            {
                ["ok"] = true,
                ["name"] = Path.GetFileNameWithoutExtension(filename),
                ["current"] = filename,
            };
        }

        /// <summary>The reply for a dialog the user closed without choosing.</summary>
        static JObject Cancelled()
        {
            return new JObject { ["ok"] = false, ["cancelled"] = true };
        }

        /// <summary>The reply for something that did not work.</summary>
        static JObject Failed(string reason)
        {
            return new JObject { ["ok"] = false, ["error"] = reason ?? "" };
        }

        /// <summary>Keep the page's data.js in step with the plan that was just written.</summary>
        void Remember(string text)
        {
            script = EditorData.Script(text, catalog);
            if (sourceRoot != null)
                Files.SaveText(Path.Combine(sourceRoot, "blueprints", "editor", "data.js"), script);
        }
    }
}
