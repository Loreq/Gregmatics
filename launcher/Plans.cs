using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace Gregmatics
{
    /// <summary>The plan library: the open .gregmatic file and the folder it lives in.</summary>
    internal static class Plans
    {
        const string PlanSuffix = ".gregmatic";
        const string DefaultPlan = "Gregmatics.gregmatic";
        const string SettingsName = "settings.json";

        /// <summary>The folder that always holds settings.json, under Roaming AppData.</summary>
        public static string HomeDir()
        {
            string baseDir = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
            if (string.IsNullOrEmpty(baseDir))
                baseDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "AppData", "Roaming");
            string path = Path.Combine(baseDir, "Gregmatics");
            Directory.CreateDirectory(path);
            return path;
        }

        /// <summary>The plan folder, the open plan's file name, and whether edits save themselves.</summary>
        public static JObject Settings()
        {
            JObject stored = StoredSettings();
            string folder = Filled(stored["folder"]) ? stored["folder"].Value<string>() : HomeDir();
            string current = Filled(stored["current"]) ? Path.GetFileName(stored["current"].Value<string>()) : DefaultPlan;
            if (!current.EndsWith(PlanSuffix, StringComparison.OrdinalIgnoreCase))
                current += PlanSuffix;
            bool autosave = !stored.ContainsKey("autosave") || JsonText.Truthy(stored["autosave"]);
            return new JObject { ["folder"] = folder, ["current"] = current, ["autosave"] = autosave };
        }

        /// <summary>Whether the editor writes each edit without being asked.</summary>
        public static bool Autosave()
        {
            return Settings()["autosave"].Value<bool>();
        }

        /// <summary>Turn autosave on or off, and say what it is now.</summary>
        public static bool SetAutosave(bool enabled)
        {
            JObject settings = Settings();
            WriteSettings(settings["folder"].Value<string>(), settings["current"].Value<string>(), enabled);
            return enabled;
        }

        /// <summary>The folder the plans are kept in. It is made if it is missing.</summary>
        public static string PlanFolder()
        {
            string folder = Settings()["folder"].Value<string>();
            Directory.CreateDirectory(folder);
            return folder;
        }

        /// <summary>The open plan's file, whether or not it exists.</summary>
        public static string CurrentFile()
        {
            JObject settings = Settings();
            return Path.Combine(settings["folder"].Value<string>(), settings["current"].Value<string>());
        }

        /// <summary>The open plan's file name without its ending.</summary>
        public static string CurrentName()
        {
            return Path.GetFileNameWithoutExtension(CurrentFile());
        }

        /// <summary>The file name of every plan in the plan folder.</summary>
        public static List<string> PlanNames()
        {
            var names = new List<string>();
            foreach (string path in GregmaticFiles(PlanFolder()))
                names.Add(Path.GetFileName(path));
            return names;
        }

        /// <summary>One plan's text.</summary>
        public static string ReadGregmatic(string path)
        {
            try
            {
                return Files.Ended(File.ReadAllText(path, new UTF8Encoding(false)));
            }
            catch (IOException ex)
            {
                throw new LayoutException("Could not read " + Path.GetFileName(path) + ": " + ex.Message);
            }
        }

        /// <summary>Write one plan. A file already holding the same text is left alone.</summary>
        public static void WriteGregmatic(string path, string text)
        {
            text = Files.Ended(text);
            if (!Holds(path, text))
                Files.SaveText(path, text);
        }

        /// <summary>The open plan's text.</summary>
        public static string ReadText()
        {
            return ReadGregmatic(EnsureCurrent());
        }

        /// <summary>The open plan. The folder's files are the only place a plan is stored.</summary>
        public static string EnsureCurrent()
        {
            string path = CurrentFile();
            if (File.Exists(path))
                return path;
            string folder = PlanFolder();
            List<string> found = GregmaticFiles(folder);
            if (found.Count == 0)
                throw new LayoutException("No plan in " + folder);
            WriteSettings(folder, Path.GetFileName(found[0]), null);
            return found[0];
        }

        /// <summary>Lowercase, spaces become underscores, and every other character is dropped.</summary>
        public static string FileSlug(string name)
        {
            string text = (name ?? "").Trim();
            if (text.EndsWith(PlanSuffix, StringComparison.OrdinalIgnoreCase))
                text = text.Substring(0, text.Length - PlanSuffix.Length).Trim();
            var words = new List<string>();
            foreach (string word in text.ToLowerInvariant().Split((char[])null, StringSplitOptions.RemoveEmptyEntries))
            {
                var kept = new StringBuilder();
                foreach (char ch in word)
                {
                    if ((ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9'))
                        kept.Append(ch);
                }
                if (kept.Length > 0)
                    words.Add(kept.ToString());
            }
            return words.Count == 0 ? "plan" : string.Join("_", words);
        }

        /// <summary>The file for this floorplan name. A taken name becomes name_1, then name_2.</summary>
        public static string FreeFilename(string name, string current)
        {
            string slug = FileSlug(name);
            var taken = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (string path in GregmaticFiles(PlanFolder()))
                taken.Add(Path.GetFileName(path));
            if (!string.IsNullOrEmpty(current))
                taken.Remove(current);
            string exact = slug + PlanSuffix;
            if (!taken.Contains(exact))
                return exact;
            string stem = slug;
            int number = 0;
            int cut = slug.LastIndexOf('_');
            int parsed;
            if (cut > 0 && int.TryParse(slug.Substring(cut + 1), out parsed))
            {
                stem = slug.Substring(0, cut);
                number = parsed;
            }
            for (int n = number + 1; ; n++)
            {
                string candidate = stem + "_" + n.ToString() + PlanSuffix;
                if (!taken.Contains(candidate))
                    return candidate;
            }
        }

        /// <summary>Write a new plan beside the others and open it. The previous file stays.</summary>
        public static string Create(string name, string text, Catalog catalog)
        {
            string filename = FreeFilename(name, null);
            string folder = PlanFolder();
            string path = Path.Combine(folder, filename);
            if (File.Exists(path))
                throw new LayoutException(filename + " already exists");
            text = Files.Ended(text);
            Layout.Check(text, catalog);
            WriteGregmatic(path, text);
            WriteSettings(folder, filename, null);
            return filename;
        }

        /// <summary>Rename the open file from the floorplan name. The current file is not a duplicate of itself.</summary>
        public static string RenameCurrent(string name)
        {
            string src = CurrentFile();
            string filename = FreeFilename(name, Path.GetFileName(src));
            string dest = Path.Combine(Path.GetDirectoryName(src), filename);
            if (string.Equals(dest, src, StringComparison.OrdinalIgnoreCase))
                return Path.GetFileName(src);
            if (File.Exists(dest))
                throw new LayoutException(filename + " already exists");
            File.Move(src, dest);
            WriteSettings(PlanFolder(), Path.GetFileName(dest), null);
            return Path.GetFileName(dest);
        }

        /// <summary>Make a plan in the plan folder the open one.</summary>
        public static string Open(string name)
        {
            string filename = Path.GetFileName(name ?? "");
            if (!File.Exists(Path.Combine(PlanFolder(), filename)))
                throw new LayoutException("No plan named " + filename);
            WriteSettings(PlanFolder(), filename, null);
            return filename;
        }

        /// <summary>Point the library at dest and move every .gregmatic file there.</summary>
        public static string MovePlans(string dest)
        {
            Directory.CreateDirectory(dest);
            string src = Path.GetFullPath(PlanFolder());
            string target = Path.GetFullPath(dest);
            if (string.Equals(src.TrimEnd('\\'), target.TrimEnd('\\'), StringComparison.OrdinalIgnoreCase))
                return target;
            if (IsInside(src, target))
                throw new LayoutException("Choose a folder that is not inside the current one.");
            List<string> files = GregmaticFiles(src);
            foreach (string path in files)
            {
                if (File.Exists(Path.Combine(target, Path.GetFileName(path))))
                    throw new LayoutException(Path.GetFileName(path) + " is already in that folder");
            }
            foreach (string path in files)
                File.Move(path, Path.Combine(target, Path.GetFileName(path)));
            WriteSettings(target, Settings()["current"].Value<string>(), null);
            return target;
        }

        /// <summary>Open a plan that is already in the plan folder, or copy one from elsewhere into it.</summary>
        public static string Adopt(string path, Catalog catalog)
        {
            string folder = Path.GetFullPath(PlanFolder());
            string chosen = Path.GetFullPath(path);
            if (string.Equals(Path.GetDirectoryName(chosen), folder, StringComparison.OrdinalIgnoreCase)
                && chosen.EndsWith(PlanSuffix, StringComparison.OrdinalIgnoreCase))
                return Open(Path.GetFileName(chosen));
            return Create(Path.GetFileNameWithoutExtension(chosen), File.ReadAllText(chosen, new UTF8Encoding(false)), catalog);
        }

        /// <summary>settings.json as it is on disk. A missing file, or one that is not an object, reads as empty.</summary>
        static JObject StoredSettings()
        {
            string path = Path.Combine(HomeDir(), SettingsName);
            if (!File.Exists(path))
                return new JObject();
            try
            {
                JToken data = JToken.Parse(File.ReadAllText(path, new UTF8Encoding(false)));
                return data as JObject ?? new JObject();
            }
            catch (JsonReaderException ex)
            {
                throw new LayoutException("settings.json is not valid JSON: line " + ex.LineNumber + ": " + ex.Message);
            }
        }

        /// <summary>Whether a stored setting is text with something in it.</summary>
        static bool Filled(JToken value)
        {
            return value != null && value.Type == JTokenType.String && value.Value<string>().Trim().Length > 0;
        }

        /// <summary>Store the plan folder and the open plan. Autosave keeps its value unless one is given.</summary>
        static void WriteSettings(string folder, string current, bool? autosave)
        {
            if (autosave == null)
                autosave = Settings()["autosave"].Value<bool>();
            var body = new JObject
            {
                ["folder"] = folder,
                ["current"] = Path.GetFileName(current),
                ["autosave"] = autosave.Value,
            };
            Files.SaveText(Path.Combine(HomeDir(), SettingsName), JsonText.Dumps(body) + "\n");
        }

        /// <summary>Whether a file already has exactly this text. A file that cannot be read does not.</summary>
        static bool Holds(string path, string text)
        {
            if (!File.Exists(path))
                return false;
            try
            {
                return File.ReadAllText(path, new UTF8Encoding(false)) == text;
            }
            catch (IOException)
            {
                return false;
            }
        }

        /// <summary>The plans in a folder, by name. Files still being written are left out.</summary>
        static List<string> GregmaticFiles(string folder)
        {
            var found = new List<string>();
            if (!Directory.Exists(folder))
                return found;
            foreach (string path in Directory.GetFiles(folder, "*" + PlanSuffix))
            {
                string name = Path.GetFileName(path);
                if (!name.StartsWith(Files.TempPrefix, StringComparison.Ordinal))
                    found.Add(path);
            }
            found.Sort((a, b) => string.Compare(Path.GetFileName(a), Path.GetFileName(b), StringComparison.OrdinalIgnoreCase));
            return found;
        }

        /// <summary>Whether a folder sits inside another.</summary>
        static bool IsInside(string parent, string child)
        {
            string root = Path.GetFullPath(parent).TrimEnd('\\') + "\\";
            string path = Path.GetFullPath(child).TrimEnd('\\') + "\\";
            return path.StartsWith(root, StringComparison.OrdinalIgnoreCase);
        }
    }

    /// <summary>The plan has a record the program cannot use.</summary>
    internal sealed class LayoutException : Exception
    {
        public LayoutException(string message) : base(message)
        {
        }
    }
}
