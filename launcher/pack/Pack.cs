using System;
using System.IO;
using System.IO.Compression;

namespace Gregmatics.Pack
{
    /// <summary>Packs the editor, the catalog, and the window libraries into launcher/site.zip.</summary>
    internal static class Program
    {
        /// <summary>Write site.zip from the paths the build passes in the environment.</summary>
        static int Main()
        {
            try
            {
                string root = Full(Env("GREG_ROOT"));
                string nuget = Trim(Env("GREG_NUGET"));
                string zipPath = Full(Env("GREG_OUT"));
                string webview = Latest(Path.Combine(nuget, "microsoft.web.webview2"));
                string json = Latest(Path.Combine(nuget, "newtonsoft.json"));
                if (File.Exists(zipPath))
                    File.Delete(zipPath);
                using (ZipArchive zip = ZipFile.Open(zipPath, ZipArchiveMode.Create))
                {
                    AddTree(zip, Path.Combine(root, "blueprints", "editor"), "editor", "data.js");
                    AddTree(zip, Path.Combine(root, "blueprints", "catalog"), "catalog", null);
                    AddFile(zip, Path.Combine(root, "launcher", "Gregmatics.ico"), "launcher/Gregmatics.ico");
                    AddFile(zip, FindDll(json, "Newtonsoft.Json.dll", "net45"), "deps/Newtonsoft.Json.dll");
                    AddFile(zip, FindDll(webview, "Microsoft.Web.WebView2.Core.dll", "net462"), "deps/Microsoft.Web.WebView2.Core.dll");
                    AddFile(zip, FindDll(webview, "Microsoft.Web.WebView2.WinForms.dll", "net462"), "deps/Microsoft.Web.WebView2.WinForms.dll");
                    AddFile(zip, FindDll(webview, "WebView2Loader.dll", "win-x64"), "deps/WebView2Loader.dll");
                }
                return 0;
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine(ex.Message);
                return 1;
            }
        }

        /// <summary>An environment value, or a failure when the build did not set it.</summary>
        static string Env(string name)
        {
            string value = Environment.GetEnvironmentVariable(name);
            if (string.IsNullOrEmpty(value))
                throw new InvalidOperationException(name + " was not set.");
            return value;
        }

        /// <summary>A full path, with a trailing separator removed.</summary>
        static string Full(string path)
        {
            return Path.GetFullPath(Trim(path));
        }

        /// <summary>A path without a trailing slash.</summary>
        static string Trim(string path)
        {
            return path.Trim().TrimEnd('\\', '/');
        }

        /// <summary>The newest package folder under a NuGet id.</summary>
        static string Latest(string folder)
        {
            if (!Directory.Exists(folder))
                throw new InvalidOperationException("Could not find " + folder);
            string[] dirs = Directory.GetDirectories(folder);
            if (dirs.Length == 0)
                throw new InvalidOperationException("Could not find a version under " + folder);
            Array.Sort(dirs, StringComparer.OrdinalIgnoreCase);
            return dirs[dirs.Length - 1];
        }

        /// <summary>The library whose path contains a marker, or the first one of that name.</summary>
        static string FindDll(string folder, string name, string marker)
        {
            string[] found = Directory.GetFiles(folder, name, SearchOption.AllDirectories);
            if (found.Length == 0)
                throw new InvalidOperationException("Could not find " + name + " under " + folder);
            foreach (string path in found)
            {
                if (path.IndexOf(marker, StringComparison.OrdinalIgnoreCase) >= 0)
                    return path;
            }
            return found[0];
        }

        /// <summary>Add one file to the zip under a fixed name.</summary>
        static void AddFile(ZipArchive zip, string disk, string entry)
        {
            zip.CreateEntryFromFile(disk, entry.Replace('\\', '/'));
        }

        /// <summary>Add every file under a folder, skipping one name.</summary>
        static void AddTree(ZipArchive zip, string folder, string prefix, string skip)
        {
            foreach (string file in Directory.GetFiles(folder, "*", SearchOption.AllDirectories))
            {
                if (skip != null && string.Equals(Path.GetFileName(file), skip, StringComparison.OrdinalIgnoreCase))
                    continue;
                string relative = file.Substring(folder.Length).TrimStart('\\', '/');
                AddFile(zip, file, prefix + "/" + relative);
            }
        }
    }
}
