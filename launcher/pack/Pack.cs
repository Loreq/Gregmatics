using System;
using System.IO;
using System.IO.Compression;

namespace Gregmatics.Pack
{
    /// <summary>Packs the editor, the catalog, and the icon into launcher/site.zip.</summary>
    internal static class Program
    {
        /// <summary>Write site.zip from the paths the build passes in the environment.</summary>
        static int Main()
        {
            try
            {
                string root = Full(Env("GREG_ROOT"));
                string zipPath = Full(Env("GREG_OUT"));
                if (File.Exists(zipPath))
                    File.Delete(zipPath);
                using (ZipArchive zip = ZipFile.Open(zipPath, ZipArchiveMode.Create))
                {
                    AddTree(zip, Path.Combine(root, "blueprints", "editor"), "editor", "data.js");
                    AddTree(zip, Path.Combine(root, "blueprints", "catalog"), "catalog", null);
                    AddFile(zip, Path.Combine(root, "launcher", "Gregmatics.ico"), "launcher/Gregmatics.ico");
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
