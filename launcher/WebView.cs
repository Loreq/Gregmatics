using System;
using System.IO;
using Microsoft.Web.WebView2.Core;

namespace Gregmatics
{
    /// <summary>Points WebView2 at the loader the .NET host extracted for a single-file exe.</summary>
    internal static class WebView
    {
        const string Loader = "WebView2Loader.dll";

        /// <summary>Use the loader beside the program, or the one the single-file host already unpacked.</summary>
        public static void UseLoader()
        {
            if (File.Exists(Path.Combine(AppContext.BaseDirectory, Loader)))
                return;
            string search = AppContext.GetData("NATIVE_DLL_SEARCH_DIRECTORIES") as string;
            if (string.IsNullOrEmpty(search))
                return;
            foreach (string dir in search.Split(Path.PathSeparator))
            {
                string folder = dir.Trim();
                if (folder.Length == 0)
                    continue;
                if (File.Exists(Path.Combine(folder, Loader)))
                {
                    CoreWebView2Environment.SetLoaderDllFolderPath(folder);
                    return;
                }
            }
        }
    }
}
