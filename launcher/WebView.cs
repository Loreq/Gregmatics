using System;
using System.Reflection;

namespace Gregmatics
{
    /// <summary>Tells WebView2 where its loader was written, before the window is created.</summary>
    internal static class WebView
    {
        /// <summary>Point the WebView2 assembly at the folder that holds WebView2Loader.dll.</summary>
        public static void UseLoader(string folder)
        {
            Assembly core = Assembly.Load("Microsoft.Web.WebView2.Core");
            Type environment = core.GetType("Microsoft.Web.WebView2.Core.CoreWebView2Environment");
            MethodInfo set = environment == null ? null : environment.GetMethod("SetLoaderDllFolderPath");
            if (set != null)
                set.Invoke(null, new object[] { folder });
        }
    }
}
