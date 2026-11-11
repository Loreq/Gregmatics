using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Reflection;

namespace Gregmatics
{
    /// <summary>The editor, the catalog, and the window libraries carried inside the exe.</summary>
    internal static class Bundle
    {
        const string ResourceName = "Gregmatics.site.zip";

        static Dictionary<string, byte[]> files = new Dictionary<string, byte[]>(StringComparer.OrdinalIgnoreCase);

        /// <summary>Read the zip packed into this exe. A build that has not packed one yet leaves the map empty.</summary>
        public static void LoadEmbedded()
        {
            using (Stream packed = Assembly.GetExecutingAssembly().GetManifestResourceStream(ResourceName))
            {
                if (packed == null)
                    return;
                var memory = new MemoryStream();
                packed.CopyTo(memory);
                memory.Position = 0;
                using (var archive = new ZipArchive(memory, ZipArchiveMode.Read))
                {
                    foreach (ZipArchiveEntry entry in archive.Entries)
                    {
                        if (entry.Length == 0)
                            continue;
                        using (Stream source = entry.Open())
                        {
                            var bytes = new MemoryStream();
                            source.CopyTo(bytes);
                            files[entry.FullName.Replace('\\', '/')] = bytes.ToArray();
                        }
                    }
                }
            }
        }

        /// <summary>One packed file, or null when this exe does not carry it.</summary>
        public static byte[] Bytes(string path)
        {
            byte[] bytes;
            return files.TryGetValue(path.Replace('\\', '/'), out bytes) ? bytes : null;
        }

        /// <summary>The packed files whose names start with a folder.</summary>
        public static IEnumerable<string> Names(string folder)
        {
            string prefix = folder.Trim('/') + "/";
            foreach (string name in files.Keys)
            {
                if (name.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
                    yield return name;
            }
        }

        /// <summary>A window library, loaded from the packed files when it is not beside the exe.</summary>
        public static Assembly Resolve(object sender, ResolveEventArgs args)
        {
            string name = new AssemblyName(args.Name).Name;
            if (name.EndsWith(".resources", StringComparison.OrdinalIgnoreCase))
                return null;
            byte[] bytes = Bytes("deps/" + name + ".dll");
            return bytes == null ? null : Assembly.Load(bytes);
        }
    }
}
